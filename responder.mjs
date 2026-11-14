import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { parseArgs } from 'node:util';

const { values: config } = parseArgs({ options: {
  host: { type: 'string', default: '127.0.0.1' },
  port: { type: 'string', default: '8787' },
  origin: { type: 'string', default: 'http://localhost:8000' },
  cert: { type: 'string' }, key: { type: 'string' },
  revision: { type: 'string', default: '1' },
} });
const loopback = ['127.0.0.1', '::1'].includes(config.host);
if (Boolean(config.cert) !== Boolean(config.key) || (!config.cert && !loopback)) {
  throw new Error('Provide the TLS certificate and key for a non-loopback listener.');
}
if (new URL(config.origin).origin !== config.origin) throw new Error('Set the frontend origin without a path.');

const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const download = randomFillSync(Buffer.alloc(50_000_000));
const uploadSizes = new Set([16_000_000, 32_000_000]);
let activeBulk = 0;

function reject(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain' }).end(message);
}

function handle(req, res) {
  if (req.headers.origin !== config.origin) return reject(res, 403, 'Frontend origin is not allowed.');
  res.setHeader('Access-Control-Allow-Origin', config.origin);
  res.setHeader('Timing-Allow-Origin', config.origin);
  res.setHeader('Access-Control-Expose-Headers', 'X-Benchmark-Id, X-Benchmark-Http, X-Benchmark-Family, X-Benchmark-Revision');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Vary', 'Origin');

  let url;
  try { url = new URL(req.url, 'http://responder'); } catch { return reject(res, 400, 'Invalid request URL.'); }
  const id = url.searchParams.get('id') ?? '';
  if (!idPattern.test(id)) return reject(res, 400, 'Invalid request ID.');
  const address = req.socket.remoteAddress;
  const family = address?.startsWith('::ffff:') ? 'IPv4' : (req.socket.remoteFamily ?? 'unknown');
  const http = 'HTTP/' + req.httpVersion;
  const record = { id, started: new Date().toISOString(), http, family, route: url.pathname, bytes: 0, revision: config.revision };
  let bulk = false;
  res.once('close', () => {
    if (bulk) activeBulk--;
    process.stderr.write(JSON.stringify({ ...record, finished: new Date().toISOString(),
      status: res.statusCode, complete: res.writableFinished }) + '\n');
  });
  res.setHeader('X-Benchmark-Id', id);
  res.setHeader('X-Benchmark-Http', http);
  res.setHeader('X-Benchmark-Family', family);
  res.setHeader('X-Benchmark-Revision', config.revision);
  res.setTimeout(95_000, () => res.destroy());

  if (url.pathname === '/probe' && req.method === 'GET') {
    record.bytes = 2;
    return res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 2 }).end('ok');
  }

  const isDownload = url.pathname === '/download' && req.method === 'GET';
  const isUpload = url.pathname === '/upload' && req.method === 'POST';
  if (!isDownload && !isUpload) return reject(res, 405, 'Method not allowed.');
  if (activeBulk >= 2) return reject(res, 429, 'Responder busy.');
  activeBulk++;
  bulk = true;

  if (isDownload) {
    if (url.searchParams.get('bytes') !== String(download.length)) return reject(res, 400, 'Unsupported download size.');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': download.length });
    return res.end(download, () => { if (res.writableFinished) record.bytes = download.length; });
  }

  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'text/plain') return reject(res, 415, 'Expected text/plain.');
  const length = Number(req.headers['content-length']);
  if (req.headers['content-length'] && !uploadSizes.has(length)) return reject(res, 413, 'Unsupported upload size.');
  req.on('data', (chunk) => {
    record.firstBodyAt ??= new Date().toISOString();
    record.bytes += chunk.length;
    if (record.bytes > 32_000_000) req.destroy();
  });
  req.on('error', () => res.destroy());
  req.on('end', () => {
    record.lastBodyAt = new Date().toISOString();
    if (!uploadSizes.has(record.bytes)) return reject(res, 400, 'Incomplete or unsupported upload size.');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, bytes: record.bytes }));
  });
}

const server = config.cert
  ? createSecureServer({ cert: readFileSync(config.cert), key: readFileSync(config.key), allowHTTP1: true,
    settings: { maxConcurrentStreams: 32 } }, handle)
  : createServer({ requestTimeout: 95_000, headersTimeout: 5000 }, handle);
server.requestTimeout = 95_000;
server.headersTimeout = 5000;
server.setTimeout(95_000);
server.listen(Number(config.port), config.host, () => process.stderr.write('Responder listening on ' + config.host + ':' + config.port + '\n'));
