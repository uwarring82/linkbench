import { defaultOrigin, distanceKm, estimateRoute, fiberRttMs, mapPath, mapPoint, routeModels } from './routes.js?v=1';

import { setupMapViewport } from './map-viewport.js?v=2';
import { setupFiberMap } from './fiber-map.js?v=1';

const svgNamespace = 'http://www.w3.org/2000/svg';
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatKm = (value) => integer.format(value) + ' km';
const formatMs = (value) => decimal.format(value) + ' ms';

function makeSvg(tag, attributes) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function addText(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

function marker(parent, point, className, radius, labelSide = 'above') {
  const [x, y] = mapPoint(point.coords);
  const group = makeSvg('g', { transform: 'translate(' + x + ' ' + y + ')' });
  const display = makeSvg('g', { class: 'map-marker' });
  display.append(makeSvg('circle', { r: radius, class: className }));
  const nearRightEdge = x > 840;
  const label = makeSvg('text', {
    x: nearRightEdge ? -8 : 8, y: labelSide === 'above' ? -7 : 15,
    'text-anchor': nearRightEdge ? 'end' : 'start',
  });
  label.textContent = point.name;
  display.append(label);
  const title = makeSvg('title', {});
  title.textContent = point.name;
  group.append(title, display);
  parent.append(group);
}

export function setupRouteMap(root, getRuns) {
  const find = (id) => root.querySelector('#' + id);
  const select = find('route-destination');
  const form = find('route-origin');
  const readout = find('route-readings');
  const points = find('route-points');
  let origin = defaultOrigin;
  let mode = 'local';
  const svg = find('route-map-image');
  const viewport = setupMapViewport(svg, {
    in: find('map-zoom-in'), out: find('map-zoom-out'),
    reset: find('map-reset'), value: find('map-zoom-value'),
  });
  const fiberMap = setupFiberMap(find, svg, viewport, { makeSvg, marker, addText, formatKm, formatMs });
  find('route-basemap').setAttribute('href', './route-land.svg');

  function draw() {
    if (mode !== 'local') return;
    const model = routeModels[select.value];
    const result = estimateRoute(model);
    const destination = result.legs.at(-1).point;
    const waypoints = [defaultOrigin, ...result.legs.map((segment) => segment.point)];
    const direct = origin === defaultOrigin ? result.directKm : distanceKm(origin.coords, destination.coords);
    const measure = getRuns().find((run) => run.target === 'global' &&
      run.regions?.some((region) => region.id === select.value &&
        [region.download?.minRttMs, region.upload?.minRttMs].some(Number.isFinite)));
    const region = measure?.regions.find((entry) => entry.id === select.value);
    const rtts = [region?.download?.minRttMs, region?.upload?.minRttMs].filter(Number.isFinite);
    const measured = rtts.length ? Math.min(...rtts) : null;

    find('route-default').textContent = model.summary;
    find('route-direct').setAttribute('d', mapPath([origin.coords, destination.coords]));
    find('route-model').setAttribute('d', mapPath(waypoints.map((point) => point.coords)));
    find('route-map-image').setAttribute('aria-label', 'World map from ' + origin.name + ' to ' + destination.name +
      '. The Ruhr-region candidate corridor passes through ' + waypoints.slice(1, -1).map((point) => point.name).join(', ') + '.');
    points.replaceChildren();
    const mapPoints = origin === defaultOrigin ? waypoints : [...waypoints, origin];
    for (const point of mapPoints) {
      const endpoint = [defaultOrigin, destination, origin].includes(point);
      marker(points, point, endpoint ? 'route-endpoint' : 'route-waypoint', endpoint ? 6 : 3.5);
    }

    readout.replaceChildren();
    for (const [label, value, context] of [
      ['Shortest distance', formatKm(direct), formatMs(fiberRttMs(direct)) + ' direct-fiber RTT'],
      ['Candidate corridor', formatKm(result.corridorKm), formatMs(fiberRttMs(result.corridorKm)) + ' modeled fiber RTT'],
      ['Latest min TCP RTT', measured === null ? '—' : formatMs(measured), measure
        ? [measure.uplink, measure.vpn === 'Off' ? 'VPN off' : measure.vpn,
          new Date(measure.time).toLocaleDateString()].filter(Boolean).join(' · ')
        : 'Run Worldwide NDT7 to compare'],
    ]) {
      const stat = document.createElement('div');
      addText(stat, 'span', label);
      addText(stat, 'strong', value);
      addText(stat, 'small', context);
      readout.append(stat);
    }

    const names = waypoints.map((point) => point.name).join(' → ');
    find('route-waypoints').textContent = names;
    find('route-measurement-note').hidden = measured === null;
    const tbody = find('route-segments');
    tbody.replaceChildren();
    for (const leg of result.legs) {
      const row = tbody.insertRow();
      addText(row, 'th', leg.from.name + ' → ' + leg.point.name).scope = 'row';
      addText(row, 'td', leg.medium);
      addText(row, 'td', formatKm(leg.km) + (leg.publishedKm ? ' · published system length' : ' · geographic estimate'));
      addText(row, 'td', leg.point.role);
    }
    const references = find('route-references');
    references.replaceChildren();
    for (const { name, href } of model.sources) {
      const anchor = addText(references, 'a', name);
      anchor.href = href;
    }
  }

  function showMode(value) {
    const isLocal = value === 'local';
    if (mode !== value) viewport.reset();
    mode = value;
    find('route-local-mode').setAttribute('aria-pressed', isLocal);
    find('route-fiber-mode').setAttribute('aria-pressed', !isLocal);
    for (const id of ['route-local-controls', 'route-local-content', 'route-direct', 'route-model', 'route-points']) {
      find(id).toggleAttribute('hidden', !isLocal);
    }
    for (const id of ['route-fiber-controls', 'route-fiber-content', 'fiber-paths', 'fiber-points']) {
      find(id).toggleAttribute('hidden', isLocal);
    }
    if (isLocal) draw();
    else fiberMap.draw();
  }

  find('route-local-mode').addEventListener('click', () => showMode('local'));
  find('route-fiber-mode').addEventListener('click', () => showMode('fiber'));
  select.addEventListener('change', () => {
    viewport.reset();
    draw();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const raw = ['latitude', 'longitude'].map((field) => fields.get(field));
    if (raw.every((value) => value === '')) origin = defaultOrigin;
    else if (raw.some((value) => value === '')) {
      find('route-origin-note').textContent = 'Enter both approximate coordinates, or clear both to use the Ruhr region.';
      return;
    } else origin = { name: 'Custom origin', coords: [Number(raw[1]), Number(raw[0])], role: 'Approximate origin' };
    find('route-origin-note').textContent = origin.name + ' is used for the shortest-path reference. The candidate corridor still starts in the Ruhr region.';
    draw();
  });
  const initial = new URLSearchParams(location.search).get('view');
  showMode(initial === 'intercontinental' ? 'fiber' : 'local');
  return draw;
}
