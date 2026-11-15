import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { atlasStops, tours } from './corridors.js';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const host = config.host ?? '127.0.0.1';
const loopback = ['127.0.0.1', '::1'].includes(host);
const maxActive = 4;
const hopTimeout = 32_000;
const pending = new Map();
let inFlight = 0;

function isOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)));
  } catch {
    return false;
  }
}
const validKey = (key) => typeof key === 'string' && /^[\x21-\x7e]{24,128}$/.test(key);
const validProfile = (profile) => Object.hasOwn(tours, profile) &&
  tours[profile].every((stop) => Object.hasOwn(config.nodes, stop));
if (!loopback || !Object.hasOwn(atlasStops, config.stop) || !isOrigin(config.frontendOrigin) ||
    !validKey(config.relayKey) || (config.stop === 'sines' &&
      (!validKey(config.runKey) || config.runKey === config.relayKey)) ||
    !config.nodes || !Object.hasOwn(config.nodes, config.stop) ||
    Object.entries(config.nodes).some(([stop, origin]) => !Object.hasOwn(atlasStops, stop) || !isOrigin(origin))) {
  throw new Error('Check the relay stop, fixed node origins, frontend origin, and keys.');
}

function allowed(req, key) {
  const expected = Buffer.from('Bearer ' + key);
  const received = Buffer.from(req.headers.authorization ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function respond(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

async function post(stop, path, body, timeout = hopTimeout) {
  const res = await fetch(config.nodes[stop] + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: 'Bearer ' + config.relayKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Relay ' + stop + ' returned HTTP ' + res.status);
  return res.json();
}

async function forward(packet, route, index) {
  const from = route[index];
  const to = route[index + 1];
  const returned = await post(to, '/tour/hop', { ...packet, index: index + 1 });
  // Measure the leg after the payload returns to the entry so echoes stay out of loop time.
  let rttMs = null;
  try {
    const before = performance.now();
    const echo = await post(to, '/tour/echo', { id: packet.id }, 800);
    if (echo.id === packet.id) rttMs = performance.now() - before;
  } catch {
    // Delivery of the payload and the independent echo have separate outcomes.
  }
  return { ...returned, legs: [{ from, to, rttMs }, ...returned.legs] };
}

async function start(req, res) {
  const body = await readBody(req);
  if (typeof body?.profile !== 'string' || !validProfile(body.profile)) {
    return respond(res, 400, { error: 'The requested tour is not configured at this relay.' });
  }
  if (pending.size >= maxActive) return respond(res, 429, { error: 'The entry relay is busy.' });
  const packet = { profile: body.profile, id: randomUUID(), payload: randomBytes(64).toString('hex') };
  const record = { began: performance.now(), payload: packet.payload, profile: packet.profile, loopMs: null };
  pending.set(packet.id, record);
  try {
    const result = await forward(packet, tours[packet.profile], 0);
    if (record.loopMs === null || result.id !== packet.id) throw new Error('Payload return could not be verified.');
    return respond(res, 200, { ...result, loopMs: record.loopMs });
  } finally {
    pending.delete(packet.id);
  }
}

async function hop(req, res) {
  const packet = await readBody(req);
  if (typeof packet?.profile !== 'string' || !validProfile(packet.profile) ||
      !/^[\da-f-]{36}$/.test(packet.id) || !/^[\da-f]{128}$/.test(packet.payload) ||
      !Number.isInteger(packet.index) || packet.index < 1 || tours[packet.profile][packet.index] !== config.stop) {
    return respond(res, 400, { error: 'Invalid tour stop or payload.' });
  }
  const route = tours[packet.profile];
  if (packet.index === route.length - 1) {
    const record = pending.get(packet.id);
    if (!record || record.profile !== packet.profile || record.payload !== packet.payload || record.loopMs !== null) {
      return respond(res, 409, { error: 'No matching tour is waiting for that payload.' });
    }
    record.loopMs = performance.now() - record.began;
    return respond(res, 200, { id: packet.id, legs: [] });
  }
  if (inFlight >= maxActive * 3) return respond(res, 429, { error: 'Relay is busy.' });
  inFlight++;
  try {
    return respond(res, 200, await forward(packet, route, packet.index));
  } finally {
    inFlight--;
  }
}

async function handle(req, res) {
  if (req.url === '/tour/start' && config.stop === 'sines') {
    if (req.headers.origin !== config.frontendOrigin) return respond(res, 403, { error: 'Frontend origin rejected.' });
    res.setHeader('Access-Control-Allow-Origin', config.frontendOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      return res.end();
    }
    if (req.method === 'POST' && allowed(req, config.runKey)) return start(req, res);
    return respond(res, 403, { error: 'Entry run key rejected.' });
  }
  if (req.method !== 'POST' || !allowed(req, config.relayKey)) return respond(res, 403, { error: 'Relay access rejected.' });
  if (req.url === '/tour/hop') return hop(req, res);
  if (req.url === '/tour/echo') {
    const body = await readBody(req);
    if (!/^[\da-f-]{36}$/.test(body?.id)) return respond(res, 400, { error: 'Invalid echo ID.' });
    return respond(res, 200, { id: body.id });
  }
  return respond(res, 404, { error: 'Unknown relay endpoint.' });
}

const server = createServer({ requestTimeout: 5000, headersTimeout: 4000 }, (req, res) => {
  handle(req, res).catch((error) => {
    console.error(error.message);
    if (!res.headersSent && !res.destroyed) respond(res, 502, { error: 'The tour could not reach every configured relay in time.' });
  });
});
server.setTimeout(35_000, (socket) => socket.destroy());
server.listen(config.port ?? 8790, host);
