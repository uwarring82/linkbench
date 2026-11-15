import { atlasStops, corridors, tours } from './corridors.js?v=2';
import { distanceKm, mapPath, mapPoint } from './routes.js?v=1';

const atlas = 'https://atlas.ripe.net';
const sampleAgeSeconds = 6 * 60 * 60;
const displayTime = (seconds) => new Date(seconds * 1000).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});

async function atlasRtt(from, to, start, stop, signal) {
  const query = new URLSearchParams({ probe_ids: from.probe, start, stop });
  const response = await fetch(atlas + '/api/v2/measurements/' + to.ping + '/results/?' + query, { signal });
  if (!response.ok) throw new Error('Atlas HTTP ' + response.status);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error('Unexpected Atlas response');
  const times = [];
  let attempts = 0;
  let last = 0;
  for (const record of records) {
    if (record.prb_id !== from.probe || record.msm_id !== to.ping || record.af !== 4 ||
        !Array.isArray(record.result) || record.timestamp < start || record.timestamp > stop) continue;
    attempts += Number.isFinite(record.sent) ? record.sent : record.result.length;
    const replies = record.result.filter((item) => Number.isFinite(item.rtt) && item.rtt >= 0 && !item.dup);
    if (replies.length) last = Math.max(last, record.timestamp);
    times.push(...replies.map((item) => item.rtt));
  }
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const median = times.length ? (times[mid] + times[Math.floor((times.length - 1) / 2)]) / 2 : null;
  return { median, replies: times.length, attempts, last };
}

export function setupFiberMap(find, svg, viewport, { makeSvg, marker, addText, formatKm, formatMs }) {
  const select = find('fiber-corridor');
  const places = find('fiber-places');
  const status = find('fiber-status');
  const refresh = find('fiber-refresh');
  const readings = find('fiber-readings');
  const paths = find('fiber-paths');
  const points = find('fiber-points');
  const tourDetails = find('fiber-tour');
  const tourProfile = find('fiber-tour-profile');
  const tourForm = find('fiber-tour-form');
  const tourStatus = find('fiber-tour-status');
  const tourButton = find('fiber-tour-start');
  let activeQuery;
  let tourStarted = false;

  for (const [key, corridor] of Object.entries(corridors)) {
    const option = addText(select, 'option', corridor.region + ' · ' + corridor.cable);
    option.value = key;
  }
  select.value = 'sacs';

  function path(corners, className) {
    paths.append(makeSvg('path', { class: className, d: mapPath(corners) }));
  }

  function place(point) {
    const button = addText(places, 'button', point.name);
    button.type = 'button';
    button.setAttribute('aria-label', 'Zoom to ' + point.name);
    button.addEventListener('click', () => viewport.focus(mapPoint(point.coords)));
  }

  function draw() {
    const corridor = corridors[select.value];
    const { landings, from, to } = corridor;
    const a = atlasStops[from];
    const b = atlasStops[to];
    find('fiber-caption').textContent = corridor.cable + ' · ' + a.name + ' ↔ ' + b.name + ' Atlas anchors';
    svg.setAttribute('aria-label', 'Intercontinental fiber map. ' + corridor.cable + ' and the ' +
      a.name + ' and ' + b.name + ' measurement pair are highlighted.');
    paths.replaceChildren();
    points.replaceChildren();
    places.replaceChildren();
    const cableCoords = ({ landings: [left, right], via }) => [left.coords, ...via, right.coords];
    for (const entry of Object.values(corridors)) {
      if (entry !== corridor) path(cableCoords(entry), 'fiber-path');
    }
    path(cableCoords(corridor), 'fiber-path is-selected');
    path([a.coords, b.coords], 'fiber-atlas');
    find('fiber-tour-key').hidden = !tourDetails.open;
    if (tourDetails.open) {
      const travel = tours[tourProfile.value].map((stop) => atlasStops[stop]);
      path(travel.map((stop) => stop.coords), 'fiber-tour-path');
      for (const stop of new Set(travel)) marker(points, stop, 'fiber-tour-dot', 4);
      if (!tourStarted) tourStatus.textContent = travel.map((stop) => stop.name).join(' → ');
    }

    for (const point of landings) {
      marker(points, point, 'fiber-landing', 4, 'below');
      place(point);
    }
    for (const point of [a, b]) {
      marker(points, point, 'fiber-anchor', 5);
      place(point);
    }
    find('fiber-detail').textContent = landings.map((point) => point.name).join(' ↔ ') +
      ' are approximate coastal references. The Atlas anchors are ' + formatKm(distanceKm(a.coords, b.coords)) +
      ' apart by great-circle distance. The map’s cable line is schematic.';
    const sources = find('fiber-sources');
    sources.replaceChildren();
    const trace = (source, target) => {
      const stop = Math.floor(Date.now() / 1000);
      const query = new URLSearchParams({ probe_ids: source.probe, start: stop - sampleAgeSeconds, stop });
      return atlas + '/api/v2/measurements/' + target.trace + '/results/?' + query;
    };
    const references = [
      [corridor.cable + ' reference', corridor.href],
      [a.name + ' → ' + b.name + ' traceroute', trace(a, b)],
      [b.name + ' → ' + a.name + ' traceroute', trace(b, a)],
    ];
    for (const [name, href] of references) addText(sources, 'a', name).href = href;
  }

  select.addEventListener('change', () => {
    activeQuery?.abort();
    activeQuery = undefined;
    readings.replaceChildren();
    status.textContent = 'Read public IPv4 ping records from the last six hours.';
    refresh.disabled = false;
    viewport.reset();
    draw();
  });

  refresh.addEventListener('click', async () => {
    const query = new AbortController();
    activeQuery = query;
    const timeout = setTimeout(() => query.abort(), 16000);
    const { from, to } = corridors[select.value];
    const a = atlasStops[from];
    const b = atlasStops[to];
    const pairs = [[a, b], [b, a]];
    refresh.disabled = true;
    status.textContent = 'Reading RIPE Atlas results…';
    readings.replaceChildren();
    const stop = Math.floor(Date.now() / 1000);
    const start = stop - sampleAgeSeconds;
    const results = await Promise.allSettled(pairs.map(([source, target]) => atlasRtt(source, target, start, stop, query.signal)));
    clearTimeout(timeout);
    if (activeQuery !== query) return;
    activeQuery = undefined;
    results.forEach((result, index) => {
      const [source, target] = pairs[index];
      const card = addText(readings, 'div', '');
      addText(card, 'span', source.name + ' → ' + target.name + ' · median RTT');
      const reading = result.value;
      addText(card, 'strong', reading?.median != null ? formatMs(reading.median) : '—');
      addText(card, 'small', result.status === 'rejected' ? 'Atlas data unavailable. Try again.' :
        reading.attempts ? reading.replies + '/' + reading.attempts + ' replies' +
          (reading.last ? ' · latest ' + displayTime(reading.last) : '') : 'No records in this window.');
    });
    status.textContent = 'RIPE Atlas · IPv4 ICMP · ' + displayTime(start) + ' to ' + displayTime(stop);
    refresh.disabled = false;
  });

  tourDetails.addEventListener('toggle', () => {
    if (!find('route-fiber-content').hidden) draw();
  });
  tourProfile.addEventListener('change', () => {
    tourStarted = false;
    find('fiber-tour-output').hidden = true;
    draw();
  });
  tourForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = new FormData(tourForm);
    let configured;
    try { configured = new URL(fields.get('entry')); } catch { /* Report the invalid URL below. */ }
    if (!configured || configured.protocol !== 'https:' || configured.username || configured.password ||
        configured.pathname !== '/' || configured.search || configured.hash) {
      tourStatus.textContent = 'Enter the HTTPS origin of your entry relay.';
      return;
    }

    const profile = fields.get('profile');
    const travel = tours[profile];
    tourStarted = true;
    tourButton.disabled = true;
    tourProfile.disabled = true;
    find('fiber-tour-output').hidden = true;
    tourStatus.textContent = 'Waiting for the payload to return to the entry relay…';
    try {
      const response = await fetch(configured.origin + '/tour/start', {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(45000),
        headers: { Authorization: 'Bearer ' + fields.get('key'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Relay HTTP ' + response.status);
      if (typeof result.id !== 'string' || !Number.isFinite(result.loopMs) || result.loopMs < 0 ||
          !Array.isArray(result.legs) || result.legs.length !== travel.length - 1 ||
          !result.legs.every((leg, i) => leg?.from === travel[i] && leg.to === travel[i + 1] &&
            (leg.rttMs === null || (Number.isFinite(leg.rttMs) && leg.rttMs >= 0)))) {
        throw new Error('The relay result does not match this tour.');
      }
      const rows = find('fiber-tour-rows');
      rows.replaceChildren();
      for (const leg of result.legs) {
        const row = rows.insertRow();
        addText(row, 'th', atlasStops[leg.from].name + ' → ' + atlasStops[leg.to].name).scope = 'row';
        addText(row, 'td', leg.rttMs === null ? 'Unavailable' : formatMs(leg.rttMs));
      }
      tourStatus.textContent = 'Payload returned in ' + formatMs(result.loopMs) + ' · ' +
        result.legs.length + ' legs · ID ' + result.id;
      find('fiber-tour-output').hidden = false;
    } catch (error) {
      tourStatus.textContent = error instanceof TypeError ? 'Could not reach the entry relay. Check its HTTPS URL and frontend access.' :
        error.name === 'TimeoutError' ? 'The relay tour timed out.' : error.message;
    } finally {
      tourButton.disabled = false;
      tourProfile.disabled = false;
    }
  });

  return { draw };
}
