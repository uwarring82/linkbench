import { describeContext } from './field-context.js';

export function locatedRuns(runs) {
  return runs.filter(({ fieldContext: c }) => c?.locationStatus === 'captured' &&
    Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 &&
    Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180);
}

function readings(down, up, idle) {
  return [[down, ' Mbit/s down'], [up, ' Mbit/s up'], [idle, ' ms idle']]
    .filter(([value]) => Number.isFinite(value))
    .map(([value, unit]) => value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + unit)
    .join(' · ');
}

export function setupMeasurementOverlay(find, getRuns, viewport, { marker, addText }) {
  const layer = find('measurement-points');
  const toggle = find('measurement-toggle');
  const picker = find('measurement-select');
  const panel = find('measurement-info');
  const detail = find('measurement-detail');
  const count = find('measurement-count');
  const nodes = new Map();
  let runs = [];

  function select(id, focus) {
    const run = runs.find((item) => item.id === id);
    if (!run) return;
    nodes.get(picker.dataset.selected)?.classList.remove('is-active');
    nodes.get(id).classList.add('is-active');
    picker.value = id;
    picker.dataset.selected = id;
    const c = run.fieldContext;
    if (focus) viewport.focus([c.longitude, c.latitude]);
    detail.replaceChildren();
    addText(detail, 'p', [run.iface, run.uplink, run.target, run.status].filter(Boolean).join(' · '));
    addText(detail, 'p', describeContext(c));
    if (run.target === 'global') {
      for (const region of run.regions ?? []) {
        addText(detail, 'p', region.city + ' · ' +
          (readings(region.download?.mbps, region.upload?.mbps) || region.error || 'No rate recorded'));
      }
    } else {
      const rates = readings(run.metrics?.down, run.metrics?.up, run.metrics?.idle);
      if (rates) addText(detail, 'p', rates);
    }
  }

  function visibility() {
    layer.toggleAttribute('hidden', !toggle.checked);
    panel.hidden = !toggle.checked || !runs.length;
  }

  function refresh() {
    const previous = picker.value;
    runs = locatedRuns(getRuns());
    nodes.clear();
    layer.replaceChildren();
    picker.replaceChildren();
    count.textContent = runs.length
      ? runs.length + (runs.length === 1 ? ' geolocated test' : ' geolocated tests') + ' in this browser.'
      : 'To add a point, enable device coordinates in Test setup and run a test after a fix appears.';
    for (const run of runs) {
      const c = run.fieldContext;
      const name = [new Date(run.time).toLocaleString(), c.reportedOperator || run.uplink, run.target].join(' · ');
      addText(picker, 'option', name).value = run.id;
      const node = marker(layer, { coords: [c.longitude, c.latitude], name }, 'measurement-dot', 5);
      nodes.set(run.id, node);
      node.setAttribute('data-map-action', '');
      node.setAttribute('aria-label', name);
      node.classList.add('measurement-marker');
      node.addEventListener('click', () => select(run.id, false));
    }
    visibility();
    if (runs.length) select(nodes.has(previous) ? previous : runs[0].id, false);
  }
  toggle.addEventListener('change', visibility);
  picker.addEventListener('change', () => select(picker.value, true));
  find('measurement-center').addEventListener('click', () => select(picker.value, true));
  refresh();
  return refresh;
}
