import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataFor, comparePilot } from '../pilot.js';

function run(uplink, upLoaded, overrides = {}) {
  return { target: 'freiburg', block: 'one', uplink, vpn: 'off', iface: 'Ethernet', endpoint: 'https://example.test',
    metrics: { upLoaded }, samples: ['up-bulk', 'up-probe'].map((phase) =>
      ({ phase, status: 'ok', revision: 'r1', http: 'h2', family: 'IPv4' })), ...overrides };
}

const pair = () => [run('DSL', 80), run('Cellular', 60)];

for (const [name, change] of [
  ['cancelled runs', (r) => { r.cancelled = true; }],
  ['non-finite upload-loaded medians', (r) => { r.metrics.upLoaded = Infinity; }],
  ['two successful upload revisions', (r) => { r.samples[1].revision = 'r2'; }],
]) {
  test(name + ' are ineligible', () => {
    const runs = pair();
    change(runs[0]);
    assert.deepEqual(comparePilot(runs).blocks, [{ block: 'one', paired: false }]);
  });
}

for (const uplink of ['DSL', 'Cellular']) {
  test('an extra eligible ' + uplink + ' run makes the block unmatched', () => {
    assert.equal(comparePilot([...pair(), run(uplink, 50)]).blocks[0].paired, false);
  });
  test('an ineligible extra ' + uplink + ' run does not prevent pairing', () => {
    assert.equal(comparePilot([...pair(), run(uplink, 50, { cancelled: true })]).blocks[0].paired, true);
  });
}

for (const key of ['vpn', 'iface', 'endpoint', 'revision', 'http']) {
  test('a ' + key + ' mismatch makes the block unmatched', () => {
    const runs = pair();
    if (['revision', 'http'].includes(key)) runs[1].samples.forEach((sample) => { sample[key] = 'other'; });
    else runs[1][key] = 'other';
    assert.equal(comparePilot(runs).blocks[0].paired, false);
  });
}

for (const winner of ['Cellular', 'DSL']) {
  for (const [name, slow, fast, wins] of [
    ['exactly 20 ms and exactly 25 percent', 80, 60, 1],
    ['just below 20 ms despite exceeding 25 percent', 60, 40.001, 0],
    ['just below 25 percent despite exceeding 20 ms', 100, 75.001, 0],
  ]) {
    test(winner + ' win threshold: ' + name, () => {
      const result = comparePilot([run('DSL', winner === 'DSL' ? fast : slow),
        run('Cellular', winner === 'Cellular' ? fast : slow)]);
      assert.equal(result.cellularWins, winner === 'Cellular' ? wins : 0);
      assert.equal(result.dslWins, winner === 'DSL' ? wins : 0);
    });
  }
}

function sixBlocks(winner, count) {
  return Array.from({ length: 6 }, (_, index) => {
    const runs = pair();
    runs.forEach((r) => { r.block = String(index); });
    if (index >= count) runs[1].metrics.upLoaded = 80;
    else if (winner === 'DSL') [runs[0].metrics.upLoaded, runs[1].metrics.upLoaded] = [60, 80];
    return runs;
  }).flat();
}

for (const winner of ['Cellular', 'DSL']) {
  test('six paired blocks with five ' + winner + ' wins give ' + winner + ' wins', () => {
    assert.equal(comparePilot(sixBlocks(winner, 5)).decision, winner + ' wins');
  });
  test('six paired blocks with four ' + winner + ' wins give Unresolved', () => {
    assert.equal(comparePilot(sixBlocks(winner, 4)).decision, 'Unresolved');
  });
}

test('five paired blocks plus one unmatched label give Unresolved', () => {
  const runs = sixBlocks('Cellular', 6);
  runs.pop();
  const result = comparePilot(runs);
  assert.equal(result.blockCount, 6);
  assert.equal(result.differences.length, 5);
  assert.equal(result.decision, 'Unresolved');
});

test('two comparison keys give Unresolved despite six cellular wins', () => {
  const runs = sixBlocks('Cellular', 6);
  runs[0].vpn = runs[1].vpn = 'on';
  const result = comparePilot(runs);
  assert.equal(result.cellularWins, 6);
  assert.equal(result.decision, 'Unresolved');
});

test('only Freiburg runs with a block and DSL or Cellular uplink are selected in insertion order', () => {
  const result = comparePilot([run('DSL', 80, { target: 'control' }), run('DSL', 80, { block: '' }),
    run('Other', 80), run('DSL', 80, { block: 'first' }), ...pair()]);
  assert.deepEqual(result.blocks, [{ block: 'first', paired: false },
    { block: 'one', paired: true, delta: 20, familiesDiffer: false }]);
});

test('address-family differences are reported without excluding the pair', () => {
  const runs = pair();
  runs[1].samples[0].family = 'IPv6';
  assert.equal(comparePilot(runs).blocks[0].familiesDiffer, true);
  assert.equal(comparePilot(runs).blocks[0].paired, true);
});

test('metadata uses only successful upload-bulk and upload-probe samples', () => {
  const r = run('DSL', 80);
  r.samples.push({ phase: 'up-probe', status: 'timeout', revision: 'r2' },
    { phase: 'down-bulk', status: 'ok', revision: 'r2' });
  assert.deepEqual(metadataFor(r), { http: 'h2', revision: 'r1', families: 'IPv4' });
});

test('an extra unmatched block label prevents a verdict despite six paired blocks', () => {
  assert.equal(comparePilot([...sixBlocks('Cellular', 6), run('DSL', 80, { block: 'extra' })]).decision, 'Unresolved');
});

test('empty input returns an unresolved decision and no blocks', () => {
  assert.deepEqual(comparePilot([]), { decision: 'Unresolved', blockCount: 0, differences: [],
    cellularWins: 0, dslWins: 0, blocks: [] });
});
