# SEARCH-BENCH-001 — fitment-aware search benchmark

Offline, non-production benchmark scaffold implementing the accepted DoR contract.

## Frozen corpus contract

`corpus.v1.json` is intentionally synthetic/reference-only. Before comparative scoring it MUST contain >=100 judged queries, >=20 vehicles and >=10 part families. Each query records compatible and forbidden entity IDs, relevance grades, position constraints and allowed fallback.

The corpus MUST be frozen before candidate scoring. Do not add production customer data, tokens, supplier secrets or DB dumps.

Every candidate result MUST declare both `corpusVersion` and the SHA-256 of the exact corpus file in `corpusSha256`. The runner recomputes SHA-256 from the corpus bytes and makes a version/hash mismatch a `NO-GO`. This prevents results from one corpus revision being compared with or presented as evidence for another revision.

Generate the hash after the judged corpus is final and before candidate runs, for example:

```bash
sha256sum research/search-bench-001/corpus.v1.json
```

## Runner

Run:

```bash
node research/search-bench-001/runner.mjs --corpus research/search-bench-001/corpus.v1.json --results research/search-bench-001/results.example.json
```

The runner validates corpus minimums, frozen state, result completeness and corpus provenance, then computes candidate metrics. Candidate result shape is documented in `results.example.json`.

Mandatory gates from DoR v1:
- forbidden incompatible top-3 count = 0 on safety traps;
- exact OE/article hit@3 >= 98%;
- Recall@10 >= 95%;
- NDCG@10 >= 0.90;
- warm p95 <= 300 ms;
- candidate result corpus version/hash must match the evaluated corpus exactly.

This branch does not integrate any vendor or modify production state. Vendor/config evaluation remains blocked until the corpus reaches the frozen acceptance minimum and credentials/config, if any, can be supplied through environment secrets rather than committed artifacts.
