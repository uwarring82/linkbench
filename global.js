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
const maxQueued = 2 * 1024 * 1024;
const minimumInterruptedMs = 8_000;
const clock = () => performance.timeOrigin + performance.now();

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
      socketUrl.searchParams.set('client_version', '2');
      urls[direction] = socketUrl;
    }
    if (urls.download && urls.upload) return { machine, urls };
  }
  throw new Error('No matching NDT7 server');
}

export function transfer(url, direction, signal, waveStart, payload) {
  if (signal.aborted) return Promise.resolve({ status: 'cancelled' });
  return new Promise((resolve) => {
    const startOffsetMs = clock() - waveStart;
    const socket = new WebSocket(url, protocol);
    socket.binaryType = 'arraybuffer';
    let openedAt;
    let firstOffsetMs;
    let bytes = 0;
    let lastBodyAt;
    let lastReceipt;
    let clientUpload;
    let serverTcpUpload;
    let closeCode = null;
    let wasClean = null;
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
      const uploadReading = lastReceipt ?? serverTcpUpload ?? clientUpload;
      const source = downloading ? 'browser received' : lastReceipt ? 'server receipt' : serverTcpUpload ? 'server TCP receive rate'
        : clientUpload ? 'browser sent estimate' : null;
      const appBytes = downloading ? bytes : (uploadReading?.bytes ?? null);
      const appMs = downloading ? (lastBodyAt === undefined ? null : lastBodyAt - openedAt) : (uploadReading?.ms ?? null);
      const canUseInterrupted = !downloading && status !== 'cancelled' && appMs >= minimumInterruptedMs;
      const mbps = (status === 'ok' || canUseInterrupted) && appBytes > 0 && appMs > 0
        ? 8 * appBytes / (1000 * appMs) : null;
      const termination = status === 'ok' ? null : status;
      if (canUseInterrupted && mbps !== null) status = 'ok';
      resolve({ status: status === 'ok' && mbps === null ? 'no measurement' : status,
        startOffsetMs, openOffsetMs: openedAt === undefined ? null : openedAt - waveStart,
        firstOffsetMs: firstOffsetMs ?? null,
        endOffsetMs: clock() - waveStart, bytes: appBytes, elapsedMs: appMs, mbps, source, closeCode, wasClean, termination,
        queuedUploadBytes: downloading ? null : bytes, minRttMs: minRttUs === undefined ? null : minRttUs / 1000 });
    };
    const abort = () => finish('cancelled');
    signal.addEventListener('abort', abort, { once: true });
    watchdog = setTimeout(() => finish('connection timeout'), 10_000);
    const updateUploadEstimate = () => {
      const elapsed = performance.now() - openedAt;
      const sent = bytes - socket.bufferedAmount;
      if (sent > 0 && elapsed > 0 && (!clientUpload || sent > clientUpload.bytes)) {
        clientUpload = { bytes: sent, ms: elapsed };
      }
    };
    socket.onopen = () => {
      openedAt = performance.now();
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (!downloading) updateUploadEstimate();
        finish(downloading ? 'test timeout' : 'upload deadline');
      }, downloading ? 14_000 : 11_500);
      if (downloading) return;
      const send = () => {
        if (socket.readyState !== WebSocket.OPEN) {
          clearInterval(pump);
          return;
        }
        const elapsed = performance.now() - openedAt;
        updateUploadEstimate();
        if (elapsed >= uploadDurationMs) {
          clearInterval(pump);
          return;
        }
        try {
          // WebKit can update bufferedAmount after this task. Send at most one frame.
          const sent = clientUpload?.bytes ?? 0;
          const exponent = Math.min(20, Math.floor(Math.log2(Math.max(65536, sent / 16))));
          const frameSize = 2 ** exponent;
          if (socket.bufferedAmount + frameSize <= maxQueued) {
            socket.send(payload.subarray(0, frameSize));
            firstOffsetMs ??= clock() - waveStart;
            bytes += frameSize;
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
        const { BytesReceived, ElapsedTime: tcpUs } = sample.TCPInfo ?? {};
        if (!downloading && Number.isFinite(BytesReceived) && BytesReceived > 0 &&
            Number.isFinite(tcpUs) && tcpUs > 0 && tcpUs / 1000 >= (serverTcpUpload?.ms ?? 0)) {
          serverTcpUpload = { bytes: BytesReceived, ms: tcpUs / 1000 };
        }
        // ConnectionInfo can contain client IP addresses. Do not retain it.
      } catch { /* Text measurements are optional. */ }
    };
    socket.onerror = () => { sendError = true; };
    socket.onclose = (event) => {
      closeCode = event.code;
      wasClean = event.wasClean;
      if (!downloading && openedAt !== undefined) updateUploadEstimate();
      const clean = !sendError && wasClean && [1000, 1005].includes(closeCode);
      if (clean) finish('ok');
      else if (openedAt === undefined) finish('handshake failed');
      else if (closeCode === 1000) finish('normal close with incomplete handshake');
      else finish('connection interrupted');
    };
  });
}

function runUpload(url, signal, waveStart) {
  if (signal.aborted) return Promise.resolve({ status: 'cancelled' });
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./upload-worker.js?v=2', import.meta.url), { type: 'module' });
    const finish = (result) => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      resolve(result);
    };
    const abort = () => finish({ status: 'cancelled' });
    const deadline = setTimeout(() => finish({ status: 'upload worker timeout' }), 25_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = () => finish({ status: 'upload worker error' });
    worker.postMessage({ url: url.href, waveStart });
  });
}

export async function measureGlobal(run, signal, progress) {
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
  if (resolved.filter(Boolean).length < 2) {
    for (const site of sites) site.error ??= 'Need at least two available sites';
    return 0;
  }
  for (const direction of ['download', 'upload']) {
    progress(direction === 'download' ? 'Downloading from all available sites' : 'Uploading to all available sites');
    const waveStart = clock();
    await Promise.all(sites.map(async (site, index) => {
      if (!resolved[index]) return;
      const url = resolved[index].urls[direction];
      try {
        site[direction] = direction === 'upload' ? await runUpload(url, signal, waveStart)
          : await transfer(url, direction, signal, waveStart);
      } catch {
        site[direction] = { status: 'could not start connection' };
      }
    }));
    signal.throwIfAborted();
  }
  const complete = sites.filter((site) => site.download?.status === 'ok' && site.upload?.status === 'ok').length;
  return complete;
}
