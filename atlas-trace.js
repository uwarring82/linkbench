import { mapPath, mapPoint } from './routes.js?v=2';

function observedHops(trace) {
  return trace.result.filter((record) => Number.isInteger(record.hop) && record.hop > 0).map((record) => {
    const replies = new Map();
    for (const { from, rtt } of record.result ?? []) {
      if (typeof from !== 'string' || !Number.isFinite(rtt) || rtt < 0) continue;
      replies.set(from, Math.min(rtt, replies.get(from) ?? Infinity));
    }
    return { number: record.hop, replies };
  }).sort((a, b) => a.number - b.number);
}

function publicAddress(ip) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a > 0 && a < 224 && a !== 10 && a !== 127 &&
    !(a === 100 && b >= 64 && b < 128) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 198 && (b === 18 || b === 19));
}

export function setupAtlasTrace(find, viewport, { makeSvg, addText, formatMs }) {
  const direction = find('fiber-trace-direction');
  const load = find('fiber-trace-load');
  const status = find('fiber-trace-status');
  const output = find('fiber-trace-output');
  const rows = find('fiber-trace-rows');
  const points = find('fiber-trace-points');
  const legend = find('fiber-trace-key');
  const lines = find('fiber-trace-lines');
  const savedLocations = new Map();
  let pair = [];
  let active;

  function reset() {
    active?.abort();
    active = null;
    load.disabled = false;
    output.hidden = true;
    legend.hidden = true;
    rows.replaceChildren();
    points.replaceChildren();
    lines.replaceChildren();
    status.textContent = '';
  }

  function reveal(details, group, coords) {
    points.querySelector('.is-active')?.classList.remove('is-active');
    rows.querySelector('.is-active')?.classList.remove('is-active');
    group.classList.add('is-active');
    details.classList.add('is-active');
    viewport.focus(mapPoint(coords));
  }

  function drawHops(hops) {
    rows.replaceChildren();
    points.replaceChildren();
    lines.replaceChildren();
    let previous;
    const stacks = new Map();
    for (const { number, replies } of hops) {
      const plotted = [];
      for (const [ip, rtt] of replies.size ? replies : [['No reply', null]]) {
        const row = rows.insertRow();
        addText(row, 'th', String(number)).scope = 'row';
        addText(row, 'td', ip);
        addText(row, 'td', rtt === null ? '—' : formatMs(rtt));
        const place = savedLocations.get(ip);
        const cell = addText(row, 'td', '');
        if (!place) {
          cell.textContent = rtt !== null && publicAddress(ip) ? 'Unavailable' : '—';
          continue;
        }
        const { name, coords } = place;
        const coordinateKey = coords.join(',');
        const stack = stacks.get(coordinateKey) ?? 0;
        stacks.set(coordinateKey, stack + 1);
        const group = makeSvg('g', {
          transform: 'translate(' + mapPoint(coords).join(' ') + ')', 'data-map-action': '',
          class: 'trace-marker', role: 'button', tabindex: '0', 'aria-label': 'Hop ' + number + ', ' + ip + ', ' + name,
        });
        const dot = makeSvg('g', { class: 'map-marker' });
        const cx = (stack % 5) * 15;
        const cy = Math.floor(stack / 5) * 15;
        dot.append(makeSvg('circle', { cx, cy, r: 7 }));
        const label = makeSvg('text', { x: cx, y: cy, dy: '.35em', 'text-anchor': 'middle' });
        label.textContent = number;
        dot.append(label);
        group.append(dot);
        points.append(group);
        const button = addText(cell, 'button', name);
        button.type = 'button';
        button.addEventListener('click', () => reveal(row, group, coords));
        function selectPoint() {
          reveal(row, group, coords);
          find('fiber-trace').open = true;
          button.focus({ preventScroll: true });
          button.scrollIntoView({ block: 'nearest' });
        }
        group.addEventListener('click', selectPoint);
        group.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectPoint();
        });
        plotted.push(coords);
      }
      const current = replies.size === 1 && plotted.length === 1 ? plotted[0] : null;
      if (current && previous?.number === number - 1) {
        lines.append(makeSvg('path', { class: 'trace-path', d: mapPath([previous.coords, current]) }));
      }
      previous = current ? { number, coords: current } : null;
    }
    output.hidden = false;
    legend.hidden = !points.hasChildNodes();
  }

  direction.addEventListener('change', reset);
  load.addEventListener('click', async () => {
    reset();
    const controller = new AbortController();
    active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]);
    const [from, to] = direction.value === 'reverse' ? [...pair].reverse() : pair;
    load.disabled = true;
    status.textContent = 'Reading the latest public Atlas trace…';
    try {
      const url = 'https://atlas.ripe.net/api/v2/measurements/' + to.trace + '/latest/?probe_ids=' + from.probe;
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('Atlas HTTP ' + response.status);
      const data = await response.json();
      const trace = Array.isArray(data) && data.find((record) => record.prb_id === from.probe && record.msm_id === to.trace &&
        record.af === 4 && Number.isFinite(record.timestamp) && Array.isArray(record.result));
      if (active !== controller) return;
      if (!trace) {
        status.textContent = 'No public IPv4 trace is available for this pair.';
        return;
      }
      const hops = observedHops(trace);
      const date = new Date(trace.timestamp * 1000);
      const age = Date.now() - date.getTime() > 6 * 60 * 60 * 1000 ? ' · older than six hours' : '';
      const source = from.name + ' → ' + to.name + ' · ' + date.toLocaleString() + age +
        ' · ' + (trace.destination_ip_responded === true ? 'Destination replied.' : 'No destination reply reported.');
      status.textContent = source + ' Looking up estimated cities…';
      drawHops(hops);
      const ips = [...new Set(hops.flatMap(({ replies }) => [...replies.keys()]))].filter(publicAddress);
      const needed = ips.filter((ip) => !savedLocations.has(ip)).slice(0, 32);
      for (let offset = 0; offset < needed.length && !signal.aborted; offset += 6) {
        await Promise.allSettled(needed.slice(offset, offset + 6).map(async (ip) => {
          const result = await fetch('https://ipmap-api.ripe.net/v1/locate/' + ip +
            '/best?engines=crowdsourced,latency,reverse-dns,ixp', { signal });
          if (!result.ok) return;
          const data = await result.json();
          const match = data.location;
          if (match?.cityName && Number.isFinite(match.longitude) && Number.isFinite(match.latitude)) savedLocations.set(ip, {
            name: [match.cityName, match.countryCodeAlpha2].filter(Boolean).join(', '),
            coords: [match.longitude, match.latitude],
          });
        }));
      }
      if (active !== controller) return;
      drawHops(hops);
      status.textContent = source + ' ' + ips.filter((ip) => savedLocations.has(ip)).length + '/' + ips.length +
        ' public reply IPs mapped to estimated cities.';
    } catch {
      if (active === controller) status.textContent = 'Could not read the RIPE Atlas trace. Try again or select the other direction.';
    } finally {
      if (active === controller) {
        active = null;
        load.disabled = false;
      }
    }
  });

  return {
    setPair(from, to) {
      reset();
      pair = [from, to];
      direction.replaceChildren();
      addText(direction, 'option', from.name + ' → ' + to.name).value = 'forward';
      addText(direction, 'option', to.name + ' → ' + from.name).value = 'reverse';
    },
  };
}
