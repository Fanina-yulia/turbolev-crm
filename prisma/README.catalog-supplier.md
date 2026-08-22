# Catalog + Supplier schema foundation

This branch introduces the additive canonical catalog and supplier-ingestion schema used by DATA-CAT-001 / DATA-SUP-001.

Verification contract:
- `prisma validate` must pass for the multi-file schema;
- the full existing migration history must apply on clean PostgreSQL 18;
- `20260822101500_catalog_supplier_schema_v1` must then apply cleanly;
- `prisma migrate diff --exit-code --from-config-datasource --to-schema prisma` must report zero drift;
- no production/Neon migration is performed by this PR verification.

Runtime cutover, supplier adapters, VehicleFitment FK activation, own-inventory integration, and legacy SupplierProductQuote parity remain separate follow-up work.
