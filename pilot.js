export function metadataFor(run) {
  const primary = run.samples.filter((sample) => ['up-bulk', 'up-probe'].includes(sample.phase) && sample.status === 'ok');
  const versions = [...new Set(primary.map((sample) => sample.http))];
  const revisions = [...new Set(primary.map((sample) => sample.revision))];
  return { http: versions.length === 1 ? versions[0] : null, revision: revisions.length === 1 ? revisions[0] : null,
    families: [...new Set(primary.map((sample) => sample.family))].join(',') };
}

export function comparePilot(runs) {
  const blocks = new Map();
  for (const run of runs) {
    if (run.target !== 'freiburg' || !run.block || !['DSL', 'Cellular'].includes(run.uplink)) continue;
    if (!blocks.has(run.block)) blocks.set(run.block, []);
    blocks.get(run.block).push(run);
  }
  const differences = [];
  const results = [];
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
      results.push({ block, paired: false });
      continue;
    }
    comparisons.add(JSON.stringify([dsl[0].endpoint, left.revision, left.http, dsl[0].iface, dsl[0].vpn]));
    const delta = dsl[0].metrics.upLoaded - cell[0].metrics.upLoaded;
    differences.push(delta);
    if (delta >= 20 && delta >= 0.25 * dsl[0].metrics.upLoaded) cellularWins++;
    if (-delta >= 20 && -delta >= 0.25 * cell[0].metrics.upLoaded) dslWins++;
    results.push({ block, paired: true, delta, familiesDiffer: left.families !== right.families });
  }
  const n = differences.length;
  const decision = n === 6 && blocks.size === 6 && comparisons.size === 1
    ? cellularWins >= 5 ? 'Cellular wins' : dslWins >= 5 ? 'DSL wins' : 'Unresolved'
    : 'Unresolved';
  return { decision, blockCount: blocks.size, differences, cellularWins, dslWins, blocks: results };
}
