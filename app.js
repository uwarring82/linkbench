import { measure, median, profiles } from './measure.js';

const id = (name) => document.getElementById(name);
const form = id('settings');
const names = { demo: 'Cloudflare demo', freiburg: 'Freiburg', control: 'Independent', lan: 'Home LAN' };
const metricKeys = ['down', 'up', 'idle', 'downLoaded', 'upLoaded'];
const storageKey = 'linkbench.runs.v1';
const saveKey = 'linkbench.settings.v1';
const demoOrigin = 'https://speed.cloudflare.com';
let controller;
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
  id('custom').hidden = demo;
  id('endpoint').required = !demo;
  id('endpoint').value = settings.endpoints[target] ?? '';
  id('target-note').textContent = demo
    ? 'Measures the public Cloudflare edge. Its location may vary. Cloudflare receives the test traffic.'
    : 'Enter the HTTPS origin of a deployed Linkbench responder.';
  id('budget').textContent = (demo ? profiles.demo.bytes : profiles.pilot.bytes) / 1e6 + ' MB maximum test payload, plus protocol overhead.';
}

function showMetrics(run) {
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
    for (const key of ['down', 'up', 'idle', 'upLoaded']) addText(row, 'td', formatted(run.metrics[key]));
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
  'goodputProfile', 'loadedProfile', ...metricKeys, 'flags'];

id('export-json').onclick = () => downloadFile('linkbench-history.json', JSON.stringify(runs, null, 2), 'application/json');
id('export-csv').onclick = () => downloadFile('linkbench-history.csv', [columns.join(','), ...runs.map((run) =>
  columns.map((key) => csvField(run.metrics[key] ?? run[key])).join(','))].join('\r\n'), 'text/csv;charset=utf-8');
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
  let endpoint = demoOrigin;
  try {
    if (!values.iface || !values.uplink) throw new Error('Select the interface and uplink to label this test.');
    if (!demo) {
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
  if (!demo) settings.endpoints[values.target] = endpoint;
  settings.target = values.target;
  settings.iface = values.iface;
  settings.uplink = values.uplink;
  save(saveKey, settings);
  const { target, iface, uplink, vpn, block, note } = values;
  const run = { schema: 1, id: crypto.randomUUID(), time: new Date().toISOString(), target, endpoint, iface, uplink, vpn,
    block: block.trim(), note: note.trim(), browser: navigator.userAgent, goodputProfile: demo ? 'edge-demo-v1' : 'https-goodput-v1',
    loadedProfile: demo ? null : 'https-loaded-v1', status: 'Running', flags: [], metrics: {}, loaded: {}, samples: [] };
  controller = new AbortController();
  controller.interfaceType = navigator.connection?.type;
  for (const item of form.elements) if (item.id !== 'cancel') item.disabled = true;
  id('cancel').hidden = false;
  id('badge').textContent = 'Testing';
  id('progress').max = demo ? 15 : 17;
  id('progress').value = 0;
  showMetrics(run);
  try {
    await measure(run, controller.signal, (message) => {
      id('message').textContent = message;
      id('progress').value++;
      showMetrics(run);
    });
    run.status = run.goodputComplete && (demo || [run.metrics.downLoaded, run.metrics.upLoaded].every(Number.isFinite))
      ? 'Complete' : 'Partial';
    id('message').textContent = run.flags.length ? run.flags.join('. ') + '.' : 'Measurement recorded.';
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
    id('badge').textContent = run.status;
    showMetrics(run);
    renderHistory();
  }
});

for (const key of ['target', 'iface', 'uplink']) if (settings[key]) form.elements.namedItem(key).value = settings[key];
updateTarget();
showMetrics(runs[0]);
renderHistory();
