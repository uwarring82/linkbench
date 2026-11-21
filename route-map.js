import { setupMeasurementOverlay } from './atlas-measurements.js';
import { defaultOrigin, distanceKm, estimateRoute, fiberRttMs, mapPath, mapPoint, mapPolyline, routeModels } from './routes.js?v=2';

import { setupAtlas } from './atlas-view.js?v=2';
import { setupMapViewport } from './map-viewport.js?v=4';
import { setupFiberMap } from './fiber-map.js?v=4';
import { setupInfrastructureMap } from './infrastructure-map.js?v=2';

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
  return group;
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
  const controls = {
    in: find('map-zoom-in'), out: find('map-zoom-out'),
    reset: find('map-reset'), value: find('map-zoom-value'),
  };
  const viewport = setupAtlas(find, svg, setupMapViewport(svg, controls), controls);

  function plotLine(element, segments, name, schematic = false) {
    element.setAttribute('d', segments.map(schematic ? mapPolyline : mapPath).join(''));
    viewport.track(element, { type: 'MultiLineString', coordinates: segments, name });
  }

  function plotMarker(parent, point, className, radius, labelSide) {
    const element = marker(parent, point, className, radius, labelSide);
    viewport.track(element, { type: 'Point', coordinates: point.coords, name: point.name, radius });
    return element;
  }

  const viewTools = { makeSvg, marker: plotMarker, plotLine, track: viewport.track, addText, formatKm, formatMs };
  const refreshMeasurements = setupMeasurementOverlay(find, getRuns, viewport, viewTools);
  const fiberMap = setupFiberMap(find, svg, viewport, viewTools);
  const infrastructureMap = setupInfrastructureMap(find, svg, viewport, viewTools);
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
    plotLine(find('route-direct'), [[origin.coords, destination.coords]], 'Shortest geographic path');
    plotLine(find('route-model'), [waypoints.map((point) => point.coords)], 'Candidate Ruhr-origin corridor');
    find('route-map-image').setAttribute('aria-label', 'World map from ' + origin.name + ' to ' + destination.name +
      '. The Ruhr-region candidate corridor passes through ' + waypoints.slice(1, -1).map((point) => point.name).join(', ') + '.');
    points.replaceChildren();
    const mapPoints = origin === defaultOrigin ? waypoints : [...waypoints, origin];
    for (const point of mapPoints) {
      const endpoint = [defaultOrigin, destination, origin].includes(point);
      plotMarker(points, point, endpoint ? 'route-endpoint' : 'route-waypoint', endpoint ? 6 : 3.5);
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
    if (mode !== value) viewport.reset();
    mode = value;
    viewport.setLayer(mode);
    for (const [name, ids] of Object.entries({
      local: ['route-local-controls', 'route-local-content', 'route-direct', 'route-model', 'route-points'],
      fiber: ['route-fiber-controls', 'route-fiber-content', 'fiber-paths', 'fiber-points',
        'fiber-trace-lines', 'fiber-trace-points'],
      infrastructure: ['route-infrastructure-controls', 'route-infrastructure-content',
        'infrastructure-cables', 'infrastructure-points'],
    })) {
      find('route-' + name + '-mode').setAttribute('aria-pressed', mode === name);
      for (const id of ids) find(id).toggleAttribute('hidden', mode !== name);
    }
    if (mode === 'local') draw();
    if (mode === 'fiber') fiberMap.draw();
    if (mode === 'infrastructure') infrastructureMap.show();
  }

  for (const name of ['local', 'fiber', 'infrastructure']) {
    find('route-' + name + '-mode').addEventListener('click', () => showMode(name));
  }
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
  const params = new URLSearchParams(location.search);
  const projection = params.get('atlas');
  const wantsAtlas = projection === '2d' || projection === '3d';
  const views = new Map([['connection', 'local'], ['intercontinental', 'fiber'], ['infrastructure', 'infrastructure']]);
  showMode(views.get(params.get('view')) ?? (wantsAtlas ? 'infrastructure' : 'local'));
  if (wantsAtlas) viewport.open(projection);
  return () => { refreshMeasurements(); draw(); };
}
