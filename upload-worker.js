import { transfer } from './global.js?v=4';

self.onmessage = async ({ data: { url, waveStart } }) => {
  try {
    const payload = new Uint8Array(1024 * 1024);
    for (let offset = 0; offset < payload.length; offset += 65536) {
      crypto.getRandomValues(payload.subarray(offset, offset + 65536));
    }
    const signal = new AbortController().signal;
    self.postMessage(await transfer(url, 'upload', signal, waveStart, payload));
  } catch {
    self.postMessage({ status: 'could not start upload' });
  }
};
