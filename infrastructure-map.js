import { mapPoint, mapPolyline } from './routes.js?v=2';

const archive = 'https://raw.githubusercontent.com/stevesong/open_undersea_cable_map/' +
  'e7903491e73bcac0d0b013b945897d10928483c4/';
const netsage = 'https://ana.netsage.global/grafana/d/000000003/bandwidth-dashboard';
const exchanges = {
  berlin: {
    name: 'BCIX · Berlin', coords: [13.405, 52.52],
    page: 'https://www.bcix.de/ixp/public-statistics/public',
    chart: 'https://www.bcix.de/ixp/grapher/infrastructure?id=1&type=png&period=day',
    scope: 'Published aggregate traffic for the selected BCIX exchange infrastructure.',
  },
  dublin: {
    name: 'INEX · Dublin', coords: [-6.26, 53.35],
    page: 'https://www.inex.ie/ixp/public-statistics/public',
    chart: 'https://www.inex.ie/ixp/grapher/infrastructure?id=1&type=png&period=day',
    scope: 'Published aggregate traffic for the selected INEX exchange infrastructure in Dublin.',
  },
  frankfurt: {
    name: 'DE-CIX · Frankfurt', coords: [8.68, 50.11],
    page: 'https://www.de-cix.net/en/locations/frankfurt/statistics',
    scope: 'Aggregate DE-CIX Frankfurt exchange traffic. The interactive chart is hosted by the operator.',
  },
  johannesburg: {
    name: 'NAPAfrica · Johannesburg', coords: [28.05, -26.20],
    page: 'https://ix.nap.africa/public-statistics/public',
    chart: 'https://ix.nap.africa/grapher/infrastructure?id=2&type=png&period=day',
    scope: 'Published aggregate traffic for the NAPAfrica Johannesburg exchange infrastructure.',
  },
};

async function readArchive(path, signal = AbortSignal.timeout(15000)) {
  const response = await fetch(archive + path, { signal });
  if (!response.ok) throw new Error('Cable archive HTTP ' + response.status);
  return response.json();
}

export function setupInfrastructureMap(find, svg, viewport, { makeSvg, marker, addText }) {
  const cables = find('infrastructure-cable');
  const exchangesSelect = find('infrastructure-exchange');
  const cableLayer = find('infrastructure-cables');
  const points = find('infrastructure-points');
  const status = find('infrastructure-status');
  const detail = find('infrastructure-detail');
  const traffic = find('infrastructure-traffic');
  const scope = find('traffic-scope');
  const sources = find('traffic-sources');
  const reading = find('traffic-reading');
  const cablePaths = new Map();
  const landingLayer = makeSvg('g', {});
  const exchangeLayer = makeSvg('g', {});
  points.append(landingLayer, exchangeLayer);
  let catalogue;
  let landingLoad;
  let selectedRequest;

  addText(exchangesSelect, 'option', 'NetSage · Atlantic research circuits').value = 'netsage';
  for (const [id, exchange] of Object.entries(exchanges)) {
    addText(exchangesSelect, 'option', exchange.name).value = id;
    const dot = marker(exchangeLayer, { ...exchange, name: exchange.name.split(' · ')[0] }, 'infrastructure-exchange', 5);
    dot.setAttribute('data-map-action', '');
    dot.setAttribute('class', 'infrastructure-action');
    dot.setAttribute('aria-hidden', 'true'); // The adjacent select provides equivalent keyboard access.
    dot.addEventListener('click', () => {
      exchangesSelect.value = id;
      chooseTraffic();
    });
  }

  function chooseTraffic() {
    const exchange = exchanges[exchangesSelect.value];
    if (exchange) viewport.focus(mapPoint(exchange.coords));
    else viewport.reset();
    traffic.open = true;
    showTraffic();
  }

  function showTraffic() {
    reading.replaceChildren();
    sources.replaceChildren();
    const exchange = exchanges[exchangesSelect.value];
    if (!exchange) {
      scope.textContent = 'Measured traffic on participating Atlantic research-network circuits. NetSage shows traffic rates and volume in each direction over the selected time window.';
      addText(sources, 'a', 'Open full NetSage dashboard').href = netsage + '?from=now-6h&to=now';
      const frame = addText(reading, 'iframe', '');
      frame.title = 'NetSage bandwidth dashboard · past six hours';
      frame.loading = 'lazy';
      frame.src = netsage + '?from=now-6h&to=now&refresh=5m&kiosk';
      return;
    }

    scope.textContent = exchange.scope;
    addText(sources, 'a', 'Open ' + exchange.name + ' statistics').href = exchange.page;
    if (!exchange.chart) return;
    const graph = addText(reading, 'img', '');
    graph.alt = exchange.name + ' · operator-published daily traffic graph';
    graph.width = 500;
    graph.height = 135;
    const refresh = addText(sources, 'button', 'Refresh graph');
    refresh.type = 'button';
    refresh.addEventListener('click', () => {
      graph.hidden = false;
      graph.src = exchange.chart + '&_=' + Date.now();
    });
    graph.addEventListener('error', () => {
      graph.hidden = true;
      scope.textContent = exchange.scope + ' The graph is unavailable here. Open the operator statistics or try refreshing.';
    });
    graph.addEventListener('load', () => { scope.textContent = exchange.scope; });
    graph.src = exchange.chart;
  }

  function selectCable(id) {
    cables.value = id;
    updateCable();
  }

  async function updateCable() {
    selectedRequest?.abort();
    const id = cables.value;
    for (const [key, line] of cablePaths) line.classList.toggle('is-selected', key === id);
    cableLayer.classList.toggle('has-selection', Boolean(id));
    landingLayer.replaceChildren();
    if (!id) {
      detail.textContent = 'Select a named cable to see its listed landing points.';
      return;
    }
    cableLayer.append(cablePaths.get(id));
    const controller = new AbortController();
    selectedRequest = controller;
    const label = cables.selectedOptions[0].textContent;
    detail.textContent = label + ' · reading archived landing points…';
    landingLoad ??= readArchive('landing-point/landing-point-geo.json')
      .then((data) => new Map(data.features.map((feature) => [feature.properties.id, feature.geometry.coordinates])))
      .catch(() => { landingLoad = null; return new Map(); });
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
      const [meta, locations] = await Promise.all([readArchive('cable/' + id + '.json', signal), landingLoad]);
      if (controller.signal.aborted) return;
      const landings = meta.landing_points ?? [];
      detail.textContent = [label, meta.length === 'n.a.' ? '' : meta.length,
        landings.map((point) => point.name).join(' · ')].filter(Boolean).join(' · ');
      for (const point of landings) {
        const coords = locations.get(point.id);
        if (coords) marker(landingLayer, { name: point.name, coords }, 'infrastructure-landing', 4);
      }
    } catch {
      if (!controller.signal.aborted) detail.textContent = label + ' · archived landing details could not be loaded.';
    }
  }

  async function loadCatalogue() {
    status.textContent = 'Loading archived submarine systems…';
    cables.disabled = true;
    try {
      const data = await readArchive('cable/cable-geo.json');
      const systems = new Map();
      for (const { properties, geometry } of data.features) {
        const { id, name } = properties;
        if (!/^[a-z0-9-]+$/.test(id) || typeof name !== 'string') continue;
        const segments = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
        const entry = systems.get(id) ?? { name, paths: [] };
        entry.paths.push(...segments.map(mapPolyline));
        systems.set(id, entry);
      }
      for (const [id, entry] of [...systems].sort(([, a], [, b]) => a.name.localeCompare(b.name))) {
        addText(cables, 'option', entry.name).value = id;
        const line = makeSvg('path', {
          class: 'infrastructure-cable', d: entry.paths.join(''), 'data-map-action': '', 'aria-hidden': 'true',
        });
        const title = makeSvg('title', {});
        title.textContent = entry.name;
        line.append(title);
        line.addEventListener('click', () => selectCable(id));
        cableLayer.append(line);
        cablePaths.set(id, line);
      }
      status.textContent = systems.size + ' named systems in the 2022 archive, including systems then planned. Routes are schematic.';
      cables.disabled = false;
      updateCable();
    } catch {
      status.textContent = 'The submarine archive could not be loaded. ';
      const retry = addText(status, 'button', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { catalogue = loadCatalogue(); });
    }
  }

  cables.addEventListener('change', updateCable);
  exchangesSelect.addEventListener('change', chooseTraffic);
  traffic.addEventListener('toggle', () => {
    if (traffic.open && !reading.hasChildNodes()) showTraffic();
    if (!traffic.open) {
      reading.replaceChildren();
      sources.replaceChildren();
      scope.textContent = '';
    }
  });

  return {
    show() {
      svg.setAttribute('aria-label', 'World map of archived submarine cables and selected traffic sources.');
      catalogue ??= loadCatalogue();
    },
  };
}
