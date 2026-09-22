import fs from 'node:fs';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,arr)=>{ if(v.startsWith('--')) a.push([v.slice(2),arr[i+1]]); return a; }, []));
if (!args.corpus || !args.results) throw new Error('Usage: node runner.mjs --corpus <file> --results <file>');
const corpusRaw = fs.readFileSync(args.corpus,'utf8');
const corpus = JSON.parse(corpusRaw);
const results = JSON.parse(fs.readFileSync(args.results,'utf8'));
const corpusSha256 = createHash('sha256').update(corpusRaw).digest('hex');
if (!Array.isArray(corpus.queries) || !Array.isArray(corpus.vehicles) || !Array.isArray(corpus.entities)) throw new Error('Invalid corpus: queries, vehicles and entities must be arrays');
if (!Array.isArray(results.runs)) throw new Error('Invalid results: runs must be an array');

const qById = new Map(corpus.queries.map(q=>[q.id,q]));
if (qById.size !== corpus.queries.length) throw new Error('Invalid corpus: duplicate query ids');
const runIds = results.runs.map(r=>r.queryId);
if (new Set(runIds).size !== runIds.length) throw new Error('Invalid results: duplicate query runs');
const unknownRunIds = runIds.filter(id=>!qById.has(id));
if (unknownRunIds.length) throw new Error(`Invalid results: unknown query ids: ${unknownRunIds.join(', ')}`);
const missingRunIds = corpus.queries.filter(q=>!runIds.includes(q.id)).map(q=>q.id);
const runs = results.runs;
const at = (xs,p)=> xs.length ? xs.slice().sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(p*xs.length)-1)] : null;
let recallSum=0, ndcgSum=0, exactTotal=0, exactHit=0, forbiddenTop3=0, incompatibleTop10=0;
for (const r of runs) {
  if (!Array.isArray(r.rankedIds) || !Number.isFinite(r.latencyMs) || r.latencyMs < 0) throw new Error(`Invalid run for ${r.queryId}: rankedIds[] and non-negative latencyMs required`);
  const q=qById.get(r.queryId), top10=r.rankedIds.slice(0,10), expected=new Set(q.expectedCompatible||[]), forbidden=new Set(q.forbidden||[]);
  const hits=top10.filter(x=>expected.has(x)).length;
  recallSum += expected.size ? hits/expected.size : 1;
  incompatibleTop10 += top10.filter(x=>forbidden.has(x)).length;
  if(q.safetyTrap) forbiddenTop3 += top10.slice(0,3).filter(x=>forbidden.has(x)).length;
  if(['oe','article'].includes(q.type)){ exactTotal++; if(top10.slice(0,3).some(x=>expected.has(x))) exactHit++; }
  const dcg=top10.reduce((s,id,i)=>s+((2**(q.relevance?.[id]||0)-1)/Math.log2(i+2)),0);
  const ideal=Object.values(q.relevance||{}).sort((a,b)=>b-a).slice(0,10).reduce((s,g,i)=>s+((2**g-1)/Math.log2(i+2)),0);
  ndcgSum += ideal ? dcg/ideal : 1;
}
const warm=runs.filter(r=>r.warm).map(r=>r.latencyMs);
const n=runs.length;
const metrics={queriesEvaluated:n, recallAt10:n?recallSum/n:0, ndcgAt10:n?ndcgSum/n:0, incompatibleFitmentCountAt10:incompatibleTop10, forbiddenTop3Count:forbiddenTop3, exactNumberHitAt3:exactTotal?exactHit/exactTotal:null, warmP50Ms:at(warm,.5), warmP95Ms:at(warm,.95)};
const minimums=corpus.minimums||{};
const families=new Set(corpus.entities.map(x=>x.family).filter(Boolean));
const corpusGate={frozen:corpus.frozen===true, queries:corpus.queries.length, vehicles:corpus.vehicles.length, partFamilies:families.size, meetsMinimums:corpus.queries.length>=(minimums.queries||100)&&corpus.vehicles.length>=(minimums.vehicles||20)&&families.size>=(minimums.partFamilies||10)};
const provenanceGate={corpusVersion:corpus.version, corpusSha256, versionMatches:results.corpusVersion===corpus.version, hashMatches:results.corpusSha256===corpusSha256};
provenanceGate.valid=provenanceGate.versionMatches&&provenanceGate.hashMatches;
const evaluationGate={complete:missingRunIds.length===0, missingRuns:missingRunIds.length, missingRunIds};
const pass={forbiddenTop3:metrics.forbiddenTop3Count===0, exactNumberHitAt3:metrics.exactNumberHitAt3!==null&&metrics.exactNumberHitAt3>=.98, recallAt10:metrics.recallAt10>=.95, ndcgAt10:metrics.ndcgAt10>=.90, warmP95:metrics.warmP95Ms!==null&&metrics.warmP95Ms<=300};
const decision=corpusGate.frozen&&corpusGate.meetsMinimums&&provenanceGate.valid&&evaluationGate.complete&&Object.values(pass).every(Boolean)?'PASS':'NO-GO';
console.log(JSON.stringify({candidate:results.candidate,configVersion:results.configVersion,corpusGate,provenanceGate,evaluationGate,metrics,pass,decision},null,2));
