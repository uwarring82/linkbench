export const globalSites = [
  { id: 'fra04', city: 'Frankfurt', region: 'Europe' },
  { id: 'lga05', city: 'New York', region: 'North America' },
  { id: 'jnb01', city: 'Johannesburg', region: 'Africa' },
  { id: 'sin01', city: 'Singapore', region: 'Asia' },
  { id: 'syd03', city: 'Sydney', region: 'Oceania' },
];

const locateOrigin = 'https://locate.measurementlab.net';
const protocol = 'net.measurementlab.ndt.v7';
const uploadDurationMs = 10_000;
const maxQueued = 256 * 1024;

async function discover(site, signal) {
  const url = new URL('/v2/nearest/ndt/ndt7', locateOrigin);
  url.searchParams.set('site', site.id);
  const response = await fetch(url, {
    credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(8500)]),
  });
  if (!response.ok || response.status === 204) throw new Error('No available server at this site');
  const { results } = await response.json();
  for (const candidate of results ?? []) {
    const machine = candidate.machine;
    if (typeof machine !== 'string' || !machine.includes('-' + site.id + '.')) continue;
    const urls = {};
    for (const direction of ['download', 'upload']) {
      const address = candidate.urls?.['wss:///ndt/v7/' + direction];
      if (!address) break;
      const socketUrl = new URL(address);
      if (socketUrl.protocol !== 'wss:' || !socketUrl.hostname.endsWith('.measurement-lab.org') ||
          socketUrl.pathname !== '/ndt/v7/' + direction ||
          !socketUrl.searchParams.has('access_token') || socketUrl.username || socketUrl.password) break;
      socketUrl.searchParams.set('client_name', 'linkbench');
      socketUrl.searchParams.set('client_version', '1');
      urls[direction] = socketUrl;
    }
    if (urls.download && urls.upload) return { machine, urls };
  }
  throw new Error('No matching NDT7 server');
}

function transfer(url, direction, signal, waveStart, payload) {
  if (signal.aborted) return Promise.resolve({ status: 'cancelled' });
  return new Promise((resolve) => {
    const startOffsetMs = performance.now() - waveStart;
    const socket = new WebSocket(url, protocol);
    socket.binaryType = 'arraybuffer';
    let openedAt;
    let firstOffsetMs;
    let bytes = 0;
    let lastBodyAt;
    let lastReceipt;
    let minRttUs;
    let pump;
    let watchdog;
    let sendError;
    let finished = false;
    const downloading = direction === 'download';
    const finish = (status) => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      clearInterval(pump);
      signal.removeEventListener('abort', abort);
      if (socket.readyState < WebSocket.CLOSING) socket.close();
      const appBytes = downloading ? bytes : (lastReceipt?.bytes ?? null);
      const appMs = downloading ? (lastBodyAt === undefined ? null : lastBodyAt - openedAt) : (lastReceipt?.ms ?? null);
      const mbps = status === 'ok' && appBytes > 0 && appMs > 0 ? 8 * appBytes / (1000 * appMs) : null;
      resolve({ status: status === 'ok' && mbps === null ? 'no measurement' : status,
        startOffsetMs, openOffsetMs: openedAt === undefined ? null : openedAt - waveStart,
        firstOffsetMs: firstOffsetMs ?? null,
        endOffsetMs: performance.now() - waveStart, bytes: appBytes, elapsedMs: appMs, mbps,
        queuedUploadBytes: downloading ? null : bytes, minRttMs: minRttUs === undefined ? null : minRttUs / 1000 });
    };
    const abort = () => finish('cancelled');
    signal.addEventListener('abort', abort, { once: true });
    watchdog = setTimeout(() => finish('connection timeout'), 8500);
    socket.onopen = () => {
      openedAt = performance.now();
      clearTimeout(watchdog);
      watchdog = setTimeout(() => finish('test timeout'), 14_000);
      if (downloading) return;
      const send = () => {
        if (socket.readyState !== WebSocket.OPEN || performance.now() - openedAt >= uploadDurationMs) {
          clearInterval(pump);
          return;
        }
        try {
          while (socket.bufferedAmount + payload.byteLength <= maxQueued &&
                 socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
            firstOffsetMs ??= performance.now() - waveStart;
            bytes += payload.byteLength;
            // Limit each browser task, including implementations that drain synchronously.
            if (bytes % maxQueued === 0) break;
          }
        } catch {
          sendError = true;
          finish('socket error');
        }
      };
      pump = setInterval(send, 4);
      send();
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (downloading) {
          const arrived = performance.now();
          firstOffsetMs ??= arrived - waveStart;
          bytes += event.data.byteLength;
          lastBodyAt = arrived;
        }
        return;
      }
      try {
        const sample = JSON.parse(event.data);
        const minRtt = sample.TCPInfo?.MinRTT;
        if (Number.isFinite(minRtt) && minRtt > 0) minRttUs = Math.min(minRttUs ?? Infinity, minRtt);
        const { NumBytes, ElapsedTime } = sample.AppInfo ?? {};
        if (Number.isFinite(NumBytes) && NumBytes > 0 && Number.isFinite(ElapsedTime) && ElapsedTime > 0 &&
            ElapsedTime / 1000 >= (lastReceipt?.ms ?? 0)) {
          lastReceipt = { bytes: NumBytes, ms: ElapsedTime / 1000 };
        }
        // ConnectionInfo can contain client IP addresses. Do not retain it.
      } catch { /* Text measurements are optional. */ }
    };
    socket.onerror = () => { sendError = true; };
    socket.onclose = (event) => {
      finish(!sendError && event.code === 1000 && event.wasClean ? 'ok' : 'connection interrupted');
    };
  });
}

export async function measureGlobal(run, signal, progress) {
  const payload = crypto.getRandomValues(new Uint8Array(64 * 1024));
  const sites = run.regions;
  progress('Finding M-Lab servers');
  const resolved = await Promise.all(sites.map(async (site) => {
    try {
      const match = await discover(site, signal);
      site.machine = match.machine;
      return match;
    } catch (error) {
      site.error = signal.aborted ? 'Cancelled' : error.message;
      return null;
    }
  }));
  signal.throwIfAborted();
  for (const direction of ['download', 'upload']) {
    if (!resolved.some(Boolean)) break;
    progress(direction === 'download' ? 'Downloading from all available sites' : 'Uploading to all available sites');
    const waveStart = performance.now();
    await Promise.all(sites.map(async (site, index) => {
      if (!resolved[index]) return;
      site[direction] = await transfer(resolved[index].urls[direction], direction, signal, waveStart, payload);
    }));
    signal.throwIfAborted();
  }
  const complete = sites.filter((site) => site.download?.status === 'ok' && site.upload?.status === 'ok').length;
  return complete;
}
