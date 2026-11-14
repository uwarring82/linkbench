export const profiles = {
  pilot: { down: 50e6, up: 16e6, downLoad: 50e6, upLoad: 32e6, repeats: 2, idle: 10, bytes: 214e6 },
  demo: { down: 4e6, up: 1e6, downLoad: 0, upLoad: 0, repeats: 2, idle: 10, bytes: 10e6 },
};

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return !sorted.length ? null : (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestUrl(run, phase, id, bytes) {
  const upload = phase === 'up' || phase === 'up-bulk';
  const path = run.target === 'demo' ? (upload ? '/__up' : '/__down')
    : upload ? '/upload' : bytes > 0 ? '/download' : '/probe';
  const url = new URL(path, run.endpoint);
  url.searchParams.set('id', id);
  if (!upload && (bytes || run.target === 'demo')) url.searchParams.set('bytes', bytes || 1);
  return url;
}

async function request(run, phase, signal, payload, expectedBytes = 0, bulkStart = null) {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const url = requestUrl(run, phase, id, expectedBytes);
  const started = performance.now();
  const sample = {
    id, phase, time: new Date().toISOString(), offsetMs: bulkStart === null ? null : started - bulkStart,
    bytes: 0, expectedBytes, status: 'pending',
  };
  run.samples.push(sample);
  const deadline = new AbortController();
  const watchdog = setTimeout(() => deadline.abort(), expectedBytes ? 90000 : 5000);
  const abort = () => deadline.abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      method: payload ? 'POST' : 'GET',
      body: payload ?? undefined,
      headers: payload ? { 'Content-Type': 'text/plain' } : undefined,
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: deadline.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Responder returned HTTP ' + response.status);
    }
    if (run.target !== 'demo') {
      const headers = response.headers;
      sample.http = headers.get('x-benchmark-http');
      sample.family = headers.get('x-benchmark-family');
      sample.revision = headers.get('x-benchmark-revision');
      if (headers.get('x-benchmark-id') !== id || !sample.http || !sample.family || !sample.revision) {
        await response.body?.cancel();
        throw new Error('Responder did not return the required benchmark metadata');
      }
      if (payload) {
        const receipt = await response.json();
        if (receipt.id !== id || receipt.bytes !== expectedBytes) throw new Error('Upload byte acknowledgement mismatch');
        sample.bytes = receipt.bytes;
      }
    }
    if (!payload) {
      const reader = response.body.getReader();
      let chunk = await reader.read();
      while (!chunk.done) {
        sample.bytes += chunk.value.byteLength;
        if (sample.bytes > (expectedBytes || 1024)) {
          await reader.cancel();
          throw new Error('Responder exceeded the expected body size');
        }
        chunk = await reader.read();
      }
      if (expectedBytes && sample.bytes !== expectedBytes) throw new Error('Download byte count mismatch');
    } else if (run.target === 'demo') {
      await response.arrayBuffer();
      sample.bytes = expectedBytes;
      sample.byteCountConfirmed = false;
    }
    sample.status = 'ok';
  } catch (error) {
    sample.status = signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'error';
    sample.error = sample.status === 'timeout' ? 'Request deadline exceeded'
      : signal.aborted ? String(signal.reason) : String(error.message ?? error);
  } finally {
    sample.elapsedMs = performance.now() - started;
    clearTimeout(watchdog);
    signal.removeEventListener('abort', abort);
  }
  return sample;
}

function randomPayload(size) {
  const payload = new Uint8Array(size);
  for (let index = 0; index < size; index += 65536) {
    crypto.getRandomValues(payload.subarray(index, index + 65536));
  }
  return payload;
}

function requireTransfer(sample) {
  if (sample.status !== 'ok') throw new Error(sample.error);
  return sample.bytes * 8 / (1000 * sample.elapsedMs);
}

async function loaded(run, direction, signal, payload, bytes) {
  const start = performance.now();
  const probes = [];
  let pending;
  const issue = () => {
    if (pending || signal.aborted) return;
    pending = request(run, direction + '-probe', signal, null, 0, start)
      .then((sample) => probes.push(sample)).finally(() => { pending = null; });
  };
  let interval;
  const timer = setTimeout(() => {
    issue();
    interval = setInterval(issue, 250);
  }, 500);
  let transfer;
  try {
    transfer = await request(run, direction + '-bulk', signal, payload, bytes);
  } finally {
    clearTimeout(timer);
    clearInterval(interval);
    await pending;
  }
  signal.throwIfAborted();
  const goodput = requireTransfer(transfer);
  const valid = probes.filter((probe) => ['ok', 'timeout'].includes(probe.status));
  const complete = probes.length >= 4 && valid.length === probes.length;
  return { medianMs: complete ? median(valid.map((p) => p.status === 'timeout' ? 5000 : p.elapsedMs)) : null,
    probes: probes.length, timeouts: valid.filter((p) => p.status === 'timeout').length, goodput };
}

export async function measure(run, signal, progress) {
  const demo = run.target === 'demo';
  const profile = profiles[demo ? 'demo' : 'pilot'];
  const upload = randomPayload(profile.up);
  const loadedUpload = demo ? null : randomPayload(profile.upLoad);
  progress('Warming up the connection');
  requireTransfer(await request(run, 'warm', signal, null));
  const idle = [];
  for (let index = 0; index < profile.idle; index++) {
    progress('Idle probe ' + (index + 1) + ' of ' + profile.idle);
    const probe = await request(run, 'idle', signal, null);
    if (probe.status === 'ok') idle.push(probe.elapsedMs);
    if (index + 1 < profile.idle) await delay(200);
  }
  run.metrics.idle = idle.length >= 8 ? median(idle) : null;
  if (idle.length < 8) run.flags.push('Incomplete idle phase');
  for (const [direction, bytes, body] of [['down', profile.down, null], ['up', profile.up, upload]]) {
    const rates = [];
    const times = [];
    for (let index = 0; index < profile.repeats; index++) {
      progress((direction === 'down' ? 'Download ' : 'Upload ') + (index + 1) + ' of ' + profile.repeats);
      const transfer = await request(run, direction, signal, body, bytes);
      rates.push(requireTransfer(transfer));
      times.push(transfer.elapsedMs);
    }
    run.metrics[direction] = median(rates);
    if (median(times) < 1000) run.flags.push('Short ' + (direction === 'down' ? 'download' : 'upload'));
  }
  run.goodputComplete = idle.length >= 8;
  if (!demo) {
    for (const [direction, bytes, body] of [['down', profile.downLoad, null], ['up', profile.upLoad, loadedUpload]]) {
      progress(direction === 'down' ? 'Latency during download' : 'Latency during upload');
      const result = await loaded(run, direction, signal, body, bytes);
      run.loaded[direction] = result;
      run.metrics[direction + 'Loaded'] = result.medianMs;
      if (result.medianMs === null) run.flags.push('Incomplete ' + direction + '-loaded probe series');
      if (result.timeouts) run.flags.push(direction + '-loaded: ' + result.timeouts + ' capped timeout(s)');
    }
  }
}
