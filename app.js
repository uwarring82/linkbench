import { measure, median, profiles } from './measure.js';
import { globalSites, measureGlobal } from './global.js?v=4';

const id = (name) => document.getElementById(name);
const form = id('settings');
const names = { demo: 'Cloudflare demo', global: 'Worldwide · M-Lab NDT7', freiburg: 'Freiburg', control: 'Independent', lan: 'Home LAN' };
const metricKeys = ['down', 'up', 'idle', 'downLoaded', 'upLoaded'];
const storageKey = 'linkbench.runs.v1';
const saveKey = 'linkbench.settings.v1';
const demoOrigin = 'https://speed.cloudflare.com';
let controller;
let refreshRouteMap;
let runs = readStored(storageKey, []);
const settings = readStored(saveKey, { endpoints: {} });

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function updateTarget() {
  const target = id('target').value;
  const demo = target === 'demo';
  const global = target === 'global';
  id('global-settings').hidden = !global;
  id('custom').hidden = demo || global;
  id('endpoint').required = !demo && !global;
  id('endpoint').value = settings.endpoints[target] ?? '';
  id('target-note').textContent = demo
    ? 'Measures the public Cloudflare edge. Its location may vary. Cloudflare receives the test traffic.'
    : global ? 'Each site uses the same NDT7 protocol. All selected sites run together in each direction.'
      : 'Enter the HTTPS origin of a deployed Linkbench responder.';
  id('budget').textContent = global ? 'Up to about 10 seconds per direction once connected. Fast links can use substantial data. Best on an unmetered connection.' : (demo ? profiles.demo.bytes : profiles.pilot.bytes) / 1e6 + ' MB maximum test payload, plus protocol overhead.';
}

function showMetrics(run) {
  const global = run?.target === 'global';
  id('single-metrics').hidden = global;
  id('global-readout').hidden = !global;
  if (global) {
    id('global-results').replaceChildren(regionTable(run.regions));
    return;
  }
  for (const key of metricKeys) id(key).textContent = formatted(run?.metrics[key]);
}

function formatted(value) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
}

function addText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

function regionalNotes(phase, direction) {
  if (!phase) return [];
  const normalClose = phase.closeCode === 1000;
  const code = phase.closeCode === null || phase.closeCode === undefined ? '' : ' (' + phase.closeCode + ')';
  if (phase.status !== 'ok') {
    if (normalClose && ['connection interrupted', 'normal close with incomplete handshake'].includes(phase.status)) {
      return ['Closed before a usable measurement'];
    }
    const notes = [phase.status + code];
    if (Number.isFinite(phase.elapsedMs)) notes.push('Measured ' + formatted(phase.elapsedMs / 1000) + ' s');
    return notes;
  }
  const notes = [];
  if (phase.source === 'browser sent estimate') notes.push('Browser estimate');
  if (phase.source === 'server TCP receive rate') notes.push('Server TCP rate');
  if (direction === 'upload' && Number.isFinite(phase.elapsedMs)) {
    notes.push('Measured ' + formatted(phase.elapsedMs / 1000) + ' s');
  }
  if (phase.termination && phase.termination !== 'upload deadline' &&
      !(normalClose && ['connection interrupted', 'normal close with incomplete handshake'].includes(phase.termination))) {
    notes.push(phase.termination + code);
  }
  return notes;
}

function regionTable(regions) {
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll region-results';
  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Regional NDT7 results');
  const head = table.createTHead().insertRow();
  for (const label of ['Site', 'Down (Mbps)', 'Up (Mbps)', 'Min TCP RTT (ms)']) {
    const cell = addText(head, 'th', label);
    cell.scope = 'col';
  }
  const body = table.createTBody();
  for (const region of regions) {
    const row = body.insertRow();
    const site = addText(row, 'td', region.city);
    if (region.machine) addText(site, 'small', region.machine.split('.')[0]);
    if (region.error) addText(site, 'small', region.error);
    for (const direction of ['download', 'upload']) {
      const phase = region[direction];
      const cell = addText(row, 'td', formatted(phase?.mbps));
      for (const note of regionalNotes(phase, direction)) addText(cell, 'small', note);
    }
    const rtts = [region.download?.minRttMs, region.upload?.minRttMs].filter(Number.isFinite);
    addText(row, 'td', formatted(rtts.length ? Math.min(...rtts) : null));
  }
  wrap.append(table);
  return wrap;
}

function metadataFor(run) {
  const primary = run.samples.filter((sample) => ['up-bulk', 'up-probe'].includes(sample.phase) && sample.status === 'ok');
  const versions = [...new Set(primary.map((sample) => sample.http))];
  const revisions = [...new Set(primary.map((sample) => sample.revision))];
  return { http: versions.length === 1 ? versions[0] : null, revision: revisions.length === 1 ? revisions[0] : null,
    families: [...new Set(primary.map((sample) => sample.family))].join(',') };
}

function renderComparison(visible) {
  const root = id('comparison');
  root.replaceChildren();
  const blocks = new Map();
  for (const run of visible) {
    if (run.target !== 'freiburg' || !run.block || !['DSL', 'Cellular'].includes(run.uplink)) continue;
    if (!blocks.has(run.block)) blocks.set(run.block, []);
    blocks.get(run.block).push(run);
  }
  id('pilot').hidden = blocks.size === 0;
  if (!blocks.size) return;
  const differences = [];
  const list = document.createElement('ul');
  const comparisons = new Set();
  let cellularWins = 0;
  let dslWins = 0;
  for (const [block, attempts] of blocks) {
    const eligible = attempts.filter((run) => !run.cancelled && Number.isFinite(run.metrics.upLoaded) && metadataFor(run).revision);
    const dsl = eligible.filter((run) => run.uplink === 'DSL');
    const cell = eligible.filter((run) => run.uplink === 'Cellular');
    const left = dsl[0] && metadataFor(dsl[0]);
    const right = cell[0] && metadataFor(cell[0]);
    if (dsl.length !== 1 || cell.length !== 1 || dsl[0].vpn !== cell[0].vpn || dsl[0].iface !== cell[0].iface ||
        dsl[0].endpoint !== cell[0].endpoint || left.revision !== right.revision || !left.http || left.http !== right.http) {
      addText(list, 'li', block + ' · unavailable or unmatched pair');
      continue;
    }
    comparisons.add(JSON.stringify([dsl[0].endpoint, left.revision, left.http, dsl[0].iface, dsl[0].vpn]));
    const delta = dsl[0].metrics.upLoaded - cell[0].metrics.upLoaded;
    differences.push(delta);
    if (delta >= 20 && delta >= 0.25 * dsl[0].metrics.upLoaded) cellularWins++;
    if (-delta >= 20 && -delta >= 0.25 * cell[0].metrics.upLoaded) dslWins++;
    addText(list, 'li', block + ' · DSL minus cellular ' + formatted(delta) + ' ms' +
      (left.families !== right.families ? ' · address family differs' : ''));
  }
  const n = differences.length;
  const decision = n === 6 && blocks.size === 6 && comparisons.size === 1
    ? cellularWins >= 5 ? 'Cellular wins' : dslWins >= 5 ? 'DSL wins' : 'Unresolved'
    : 'Unresolved';
  addText(root, 'p', decision + ' · ' + n + ' eligible block(s) · ' + cellularWins + ' cellular wins · ' + dslWins + ' DSL wins.');
  if (n) addText(root, 'p', 'Median paired difference ' + formatted(median(differences)) + ' ms. Range ' +
    formatted(Math.min(...differences)) + ' to ' + formatted(Math.max(...differences)) + ' ms.');
  root.append(list);
}

function renderHistory() {
  const filters = { target: id('filter-target').value, uplink: id('filter-uplink').value, iface: id('filter-interface').value };
  const visible = runs.filter((run) => Object.entries(filters).every(([key, value]) => !value || run[key] === value));
  const rows = id('rows');
  rows.replaceChildren();
  id('empty').hidden = visible.length > 0;
  id('empty').textContent = runs.length ? 'No tests match these filters.' : 'Your first test will appear here.';
  id('table-wrap').hidden = !visible.length;
  id('export-json').disabled = !runs.length;
  id('export-csv').disabled = !runs.length;
  for (const run of visible) {
    const row = document.createElement('tr');
    addText(row, 'td', names[run.target] + ' · ' + new Date(run.time).toLocaleString());
    addText(row, 'td', [run.iface, run.uplink, run.vpn].join(' / '));
    if (run.target === 'global') {
      const cell = row.insertCell();
      cell.colSpan = 4;
      const details = addText(cell, 'details', '');
      addText(details, 'summary', run.regions.length + ' sites · show regional results');
      details.append(regionTable(run.regions));
    } else {
      for (const key of ['down', 'up', 'idle', 'upLoaded']) addText(row, 'td', formatted(run.metrics[key]));
    }
    addText(row, 'td', run.status + (run.flags.length ? ' · ' + run.flags.join(', ') : ''));
    rows.append(row);
  }
  renderComparison(visible);
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvField(value) {
  const cleaned = typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + String(cleaned ?? '').replaceAll('"', '""') + '"';
}

const columns = ['time', 'id', 'target', 'endpoint', 'iface', 'uplink', 'vpn', 'block', 'note', 'status',
  'goodputProfile', 'loadedProfile', ...metricKeys, 'flags', 'site', 'city', 'machine', 'minTcpRttMs', 'downloadStatus', 'uploadStatus', 'uploadSource', 'uploadTermination', 'uploadCloseCode', 'uploadWasClean'];

id('export-json').onclick = () => downloadFile('linkbench-history.json', JSON.stringify(runs, null, 2), 'application/json');
id('export-csv').onclick = () => {
  const records = runs.flatMap((run) => run.target === 'global' ? run.regions.map((region) => {
    const rtts = [region.download?.minRttMs, region.upload?.minRttMs].filter(Number.isFinite);
    return { ...run, site: region.id, city: region.city, machine: region.machine,
      minTcpRttMs: rtts.length ? Math.min(...rtts) : null, down: region.download?.mbps, up: region.upload?.mbps,
      downloadStatus: region.download?.status ?? region.error, uploadStatus: region.upload?.status ?? region.error, uploadSource: region.upload?.source, uploadTermination: region.upload?.termination, uploadCloseCode: region.upload?.closeCode, uploadWasClean: region.upload?.wasClean };
  }) : [{ ...run, ...run.metrics }]);
  downloadFile('linkbench-history.csv', [columns.join(','), ...records.map((record) =>
    columns.map((key) => csvField(record[key])).join(','))].join('\r\n'), 'text/csv;charset=utf-8');
};
for (const name of ['filter-target', 'filter-uplink', 'filter-interface']) id(name).onchange = renderHistory;
id('target').onchange = updateTarget;
id('cancel').onclick = () => controller?.abort('Cancelled');
window.addEventListener('offline', () => controller?.abort('Browser went offline'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) controller?.abort('Test page was hidden');
});
navigator.connection?.addEventListener('change', () => {
  const reported = navigator.connection.type;
  if (reported && controller?.interfaceType && reported !== controller.interfaceType) controller.abort('Reported interface changed');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controller) return;
  const values = Object.fromEntries(new FormData(form));
  const demo = values.target === 'demo';
  const global = values.target === 'global';
  const regions = globalSites.filter((region) => values[region.id] === 'on').map((region) => ({ ...region }));
  let endpoint = demoOrigin;
  try {
    if (!values.iface || !values.uplink) throw new Error('Select the interface and uplink to label this test.');
    if (global) {
      if (!id('mlab-consent').checked) throw new Error('Review the M-Lab privacy policy and check the consent box before testing.');
      if (regions.length < 2) throw new Error('Choose at least two sites for a simultaneous test.');
      endpoint = 'https://locate.measurementlab.net';
    } else if (!demo) {
      const url = new URL(values.endpoint);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
          (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
        throw new Error('Use an HTTPS origin with no path or credentials. HTTP is available for loopback development.');
      }
      endpoint = url.origin;
    }
  } catch (error) {
    id('message').textContent = error.message;
    return;
  }
  if (!demo && !global) settings.endpoints[values.target] = endpoint;
  settings.target = values.target;
  settings.iface = values.iface;
  settings.uplink = values.uplink;
  if (global) settings.regions = regions.map((region) => region.id);
  save(saveKey, settings);
  const { target, iface, uplink, vpn, block, note } = values;
  const run = { schema: 1, id: crypto.randomUUID(), time: new Date().toISOString(), target, endpoint, iface, uplink, vpn,
    block: block.trim(), note: note.trim(), browser: navigator.userAgent, goodputProfile: global ? 'ndt7-parallel-v2' : demo ? 'edge-demo-v1' : 'https-goodput-v1',
    loadedProfile: (demo || global) ? null : 'https-loaded-v1', status: 'Running', flags: [], metrics: {}, loaded: {}, samples: [] };
  if (global) run.regions = regions;
  controller = new AbortController();
  controller.interfaceType = navigator.connection?.type;
  for (const item of form.elements) if (item.id !== 'cancel') item.disabled = true;
  id('cancel').hidden = false;
  id('badge').textContent = 'Testing';
  id('progress').max = global ? 3 : demo ? 15 : 17;
  id('progress').value = 0;
  showMetrics(run);
  try {
    const onProgress = (message) => {
      id('message').textContent = message;
      id('progress').value++;
      showMetrics(run);
    };
    if (global) {
      const finished = await measureGlobal(run, controller.signal, onProgress);
      run.status = finished === regions.length ? 'Complete' : 'Partial';
      id('message').textContent = finished + ' of ' + regions.length + ' sites completed both directions.';
    } else {
      await measure(run, controller.signal, onProgress);
      run.status = run.goodputComplete && (demo || [run.metrics.downLoaded, run.metrics.upLoaded].every(Number.isFinite))
        ? 'Complete' : 'Partial';
      id('message').textContent = run.flags.length ? run.flags.join('. ') + '.' : 'Measurement recorded.';
    }
  } catch (error) {
    run.cancelled = controller.signal.aborted;
    run.status = run.cancelled ? 'Cancelled' : 'Partial';
    run.flags.push(run.cancelled ? String(controller.signal.reason) : String(error.message ?? error));
    id('message').textContent = run.flags.at(-1);
  } finally {
    runs = [run, ...runs];
    if (!save(storageKey, runs)) id('message').textContent += ' History storage is unavailable. Export this run before closing the page.';
    controller = null;
    for (const item of form.elements) item.disabled = false;
    id('cancel').hidden = true;
    if (global) id('mlab-consent').checked = false;
    id('badge').textContent = run.status;
    showMetrics(run);
    renderHistory();
    refreshRouteMap?.();
  }
});

for (const site of globalSites) {
  const label = addText(id('regions'), 'label', '');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = site.id;
  input.checked = settings.regions ? settings.regions.includes(site.id) : true;
  label.append(input);
  addText(label, 'span', site.city);
}
for (const key of ['target', 'iface', 'uplink']) if (settings[key]) form.elements.namedItem(key).value = settings[key];
updateTarget();
showMetrics(runs[0]);
renderHistory();

const routeMap = id('route-map');
let routeLoading = false;
async function openRouteMap() {
  routeMap.open = true;
  if (refreshRouteMap || routeLoading) return;
  routeLoading = true;
  try {
    const { setupRouteMap } = await import('./route-map.js?v=network-1');
    refreshRouteMap = setupRouteMap(routeMap, () => runs);
  } catch {
    id('route-default').textContent = 'The route map could not load. Collapse it and reopen to retry.';
  } finally {
    routeLoading = false;
  }
}
routeMap.addEventListener('toggle', () => { if (routeMap.open) openRouteMap(); });
document.querySelector('nav a[href="#route-map"]').addEventListener('click', openRouteMap);
if (location.hash === '#route-map' || new URLSearchParams(location.search).get('view') === 'infrastructure') openRouteMap();
