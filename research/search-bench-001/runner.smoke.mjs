import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'search-bench-'));
const runner = new URL('./runner.mjs', import.meta.url).pathname;
const corpus = {
  version: 'smoke', frozen: true,
  minimums: { queries: 2, vehicles: 1, partFamilies: 2 },
  vehicles: [{ id: 'v1' }],
  entities: [{ id: 'brake', family: 'BRAKE_PAD' }, { id: 'bush', family: 'STABILIZER_BUSHING' }],
  queries: [
    { id: 'q1', type: 'natural_language', expectedCompatible: ['brake'], forbidden: ['bush'], relevance: { brake: 3 }, safetyTrap: true },
    { id: 'q2', type: 'oe', expectedCompatible: ['bush'], forbidden: ['brake'], relevance: { bush: 3 }, safetyTrap: true }
  ]
};
const corpusRaw = JSON.stringify(corpus);
const corpusSha256 = createHash('sha256').update(corpusRaw).digest('hex');
const full = { candidate: 'smoke', configVersion: '1', corpusVersion: corpus.version, corpusSha256, runs: [
  { queryId: 'q1', rankedIds: ['brake'], latencyMs: 100, warm: true },
  { queryId: 'q2', rankedIds: ['bush'], latencyMs: 120, warm: true }
]};
const partial = { ...full, runs: full.runs.slice(0, 1) };
const wrongCorpus = { ...full, corpusSha256: '0'.repeat(64) };
const corpusPath = join(dir, 'corpus.json');
const fullPath = join(dir, 'full.json');
const partialPath = join(dir, 'partial.json');
const wrongCorpusPath = join(dir, 'wrong-corpus.json');
writeFileSync(corpusPath, corpusRaw);
writeFileSync(fullPath, JSON.stringify(full));
writeFileSync(partialPath, JSON.stringify(partial));
writeFileSync(wrongCorpusPath, JSON.stringify(wrongCorpus));
const run = p => JSON.parse(execFileSync(process.execPath, [runner, '--corpus', corpusPath, '--results', p], { encoding: 'utf8' }));
const pass = run(fullPath);
assert.equal(pass.decision, 'PASS');
assert.equal(pass.provenanceGate.valid, true);
assert.equal(pass.evaluationGate.complete, true);
assert.equal(pass.metrics.forbiddenTop3Count, 0);
const noGo = run(partialPath);
assert.equal(noGo.decision, 'NO-GO');
assert.equal(noGo.evaluationGate.complete, false);
assert.deepEqual(noGo.evaluationGate.missingRunIds, ['q2']);
const provenanceNoGo = run(wrongCorpusPath);
assert.equal(provenanceNoGo.decision, 'NO-GO');
assert.equal(provenanceNoGo.provenanceGate.hashMatches, false);
console.log('SEARCH-BENCH-001 runner smoke: PASS');
