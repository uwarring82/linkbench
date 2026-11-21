// Use only readings that are recent enough to describe the start of a test.
export function positionSnapshot(position, status, now = Date.now()) {
  if (!position) return { locationStatus: status };
  const { latitude, longitude, accuracy } = position.coords;
  if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite)) {
    return { locationStatus: 'unavailable' };
  }
  if (now - position.timestamp > 30000) return { locationStatus: 'stale' };
  return { locationStatus: 'captured', latitude, longitude, accuracyM: accuracy,
    fixTime: new Date(position.timestamp).toISOString() };
}

export function radioSnapshot(connection, values) {
  return {
    browserInterface: connection?.type || null,
    browserEffectiveType: connection?.effectiveType || null,
    reportedOperator: values.operator.trim() || null,
    reportedRadio: values.radio || null,
    reportedCellId: values.cellId.trim() || null,
    reportedRsrpDbm: values.rsrp === '' ? null : Number(values.rsrp)
  };
}

export function describeContext(c) {
  if (!c) return '';
  const parts = [];
  if (c.locationStatus === 'captured') {
    parts.push(c.latitude.toFixed(5) + ', ' + c.longitude.toFixed(5) + ' · accuracy ' +
      Math.round(c.accuracyM) + ' m · fix ' + new Date(c.fixTime).toLocaleTimeString());
  } else if (c.locationStatus !== 'off') parts.push('Location: ' + c.locationStatus);
  const radio = [c.reportedOperator, c.reportedRadio, c.reportedCellId && 'Cell ID ' + c.reportedCellId,
    c.reportedRsrpDbm != null && c.reportedRsrpDbm + ' dBm RSRP'].filter(Boolean);
  if (radio.length) parts.push('Manual: ' + radio.join(' · '));
  if (c.browserInterface) parts.push('Browser interface: ' + c.browserInterface);
  if (c.browserEffectiveType) parts.push('Browser speed class: ' + c.browserEffectiveType);
  return parts.join(' | ');
}

export function setupLocation(toggle, output) {
  let watchId = null;
  let latest = null;
  let status = 'off';
  let generation = 0;
  const snapshot = () => positionSnapshot(latest, status);
  function stop() {
    generation++;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    latest = null;
    status = 'off';
    toggle.checked = false;
    output.textContent = 'Location is off.';
  }
  toggle.onchange = () => {
    if (!toggle.checked) return stop();
    const token = ++generation;
    status = 'waiting';
    output.textContent = 'Waiting for a device position. You can still run a test.';
    const fail = (error) => {
      if (token !== generation) return;
      latest = null;
      status = ({1: 'permission denied', 3: 'timed out'})[error?.code] || 'unavailable';
      output.textContent = 'Location: ' + status + '. Toggle location to retry.';
    };
    try {
      watchId = navigator.geolocation.watchPosition((position) => {
        if (token !== generation) return;
        latest = position;
        output.textContent = describeContext(snapshot());
      }, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    } catch { fail(); }
  };
  window.addEventListener('pagehide', stop);
  return snapshot;
}
