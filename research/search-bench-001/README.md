# SEARCH-BENCH-001 — fitment-aware search benchmark

Offline, non-production benchmark scaffold implementing the accepted DoR contract.

## Frozen corpus contract

`corpus.v1.json` is intentionally synthetic/reference-only. Before comparative scoring it MUST contain >=100 judged queries, >=20 vehicles and >=10 part families. Each query records compatible and forbidden entity IDs, relevance grades, position constraints and allowed fallback.

The corpus MUST be frozen before candidate scoring. Do not add production customer data, tokens, supplier secrets or DB dumps.

## Runner

Run:

```bash
node research/search-bench-001/runner.mjs --corpus research/search-bench-001/corpus.v1.json --results research/search-bench-001/results.example.json
```

The runner validates corpus gates and computes candidate metrics from a result JSON file. Candidate result shape is documented in `results.example.json`.

Mandatory gates from DoR v1:
- forbidden incompatible top-3 count = 0 on safety traps;
- exact OE/article hit@3 >= 98%;
- Recall@10 >= 95%;
- NDCG@10 >= 0.90;
- warm p95 <= 300 ms.

This branch does not integrate any vendor or modify production state. Vendor/config evaluation remains blocked until the corpus reaches the frozen acceptance minimum and credentials/config, if any, can be supplied through environment secrets rather than committed artifacts.
