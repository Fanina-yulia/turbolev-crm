# TURBO LEV Parts Search V3 — Evidence First Standard

Status: implementation standard 3.0  
Date: 2026-09-17  
Repository: `Fanina-yulia/turbolev-crm`

## 1. Purpose

TURBO LEV Parts Search V3 is the canonical architecture for all part-selection flows. The system must prove compatibility before commercial ranking. Supplier APIs provide inventory, price, delivery and cross information; they are never the independent authority that a part fits a vehicle.

Canonical pipeline:

`Diagnostic/Manual request → Structured Search Intent → Vehicle → Canonical Part → Position Policy → Fitment/OE → Cross/Analog Graph → Suppliers → Universal Compatibility Guards → Evidence Ranking → Part Candidates → Supplier Offers → Selection → Audit/Knowledge`.

This standard applies to Diagnostic Card selection, Direct Repair, Procurement, Commercial Proposal and future supplier integrations.

## 2. Non-negotiable invariants

1. Supplier free-text search is not compatibility evidence.
2. Compatibility is evaluated before price, stock or margin.
3. Explicit part-family, axle, side or vehicle-make conflict is a hard reject.
4. Manual confirmation cannot override a hard reject.
5. Known OE/catalog evidence is the primary supplier seed.
6. Analogs are expanded through OE/cross evidence and are revalidated; they never inherit confirmation automatically.
7. Product type (`ORIGINAL`, `OEM_REPLACEMENT`, `ANALOG`, `ASSEMBLY`) is independent from compatibility evidence (`CONFIRMED`, `SUPPORTED`, `REVIEW_REQUIRED`).
8. A Part Candidate is distinct from a Supplier Offer.
9. Newly discovered supplier crosses are staged for review and are never auto-approved.
10. Every operational decision must be auditable and explainable.

## 3. Structured Search Intent

Before any supplier call, CRM builds immutable `PartSearchIntentV3` with:

- vehicle: vehicleId, VIN, plate, make, model, generation, year, engine and drivetrain context when available;
- part: original text, genericArticleId, canonicalCode, canonicalName;
- axis, side, sub-position and position;
- quantity, sold-as and commercial scope;
- source flow and source entity ID;
- policy flags for side/axis sensitivity.

The algorithm version is `EVIDENCE_FIRST_V3`.

Supplier adapters cannot change canonicalCode, axis or side. They only return evidence and commercial data.

## 4. Position and packaging policy

Position semantics come from the canonical part rule, not from raw diagnostic wording.

Examples:

- `BRAKE_PAD` → sold as `SET`, scope `AXLE`; side is ignored. `REAR + RIGHT` normalizes to `REAR + side=null`.
- `BRAKE_DISC` → sold as `PIECE`, scope `WHEEL`; axis and side may be relevant.
- `BRAKE_CALIPER` → side-sensitive `WHEEL` component.
- vehicle/axle scoped items must not be artificially split by a mechanic's right/left label.

`resolvePositionPolicyV3()` is the canonical normalization layer for this behavior.

## 5. Evidence hierarchy

Evidence is evaluated in descending authority:

1. Exact VIN / exact VehicleFitment.
2. Canonical VehicleFitment record.
3. Canonical OE catalog evidence.
4. Approved cross reference.
5. Supplier vehicle catalog evidence.
6. Make + model + year + position evidence.
7. Curated OE bridge evidence.
8. Free-text/model-only result.

Lower evidence can never override a contradiction found by a higher-level constraint.

## 6. OE resolver

OE evidence is resolved before ordinary supplier text search.

Priority:

1. VehicleFitment OE;
2. canonical Product/OE records;
3. BM Parts vehicle-scoped OE evidence;
4. approved CRM cross/OE knowledge;
5. curated model/year/position evidence;
6. manual evidence that has passed review.

Curated evidence is explicitly model-level and can never claim exact VIN compatibility.

Current regression references for GEELY EMGRAND X7:

- rear stabilizer bushing → `1014012805`;
- rear brake disc → `1014012463`;
- rear brake-pad set → `101402006059`.

These are bridge records until the canonical VehicleFitment import covers the vehicle.

## 7. Supplier orchestration

### 7.1 Evidence-first stage

If OE/catalog/cross evidence exists, the primary supplier query uses that evidence, not the human description.

BM Parts and UniTrade are queried in parallel where applicable.

### 7.2 Cross expansion

For each trusted reference:

- search exact article/OE in every configured supplier;
- retrieve BM Parts cross/analog data where available;
- retrieve UniTrade analogs via its analog endpoint where brand/article allows it;
- re-run every returned analog through the same compatibility policy.

### 7.3 Vehicle/model stage

When evidence search cannot produce a product, a vehicle-scoped canonical-part search may be used. Position must remain in the provider request.

### 7.4 Fuzzy fallback

Free-text search runs only when the evidence stages yield no strong candidates. Free-text can produce `REVIEW_REQUIRED` only.

If a strong `CONFIRMED` or `SUPPORTED` result exists, fuzzy review rows are suppressed from the operational result set and retained only in audit data.

## 8. Supplier adapter contract

Every supplier integration should implement the common capabilities it supports:

- `searchByArticle`;
- `searchByOe` when available;
- `searchAnalogs` when available;
- `searchVehicleParts` when available;
- `resolveVehicle` when available;
- product details, stock, warehouses, delivery and order capabilities.

Provider-specific logic must not contain TURBO LEV compatibility policy. Compatibility belongs to the central V3 engine.

## 9. BM Parts strategy

1. Resolve vehicle/VIN context.
2. Vehicle-scoped canonical part search.
3. OE/article search.
4. Product detail retrieval.
5. Extract OE references.
6. Extract analog/cross products.
7. Return raw supplier evidence.
8. Revalidate through V3 guards.

A BM model-filter result may be `SUPPORTED` but must not be treated as exact VIN fitment when the provider vehicle context is not exact.

## 10. UniTrade strategy

UniTrade is a commercial + cross source, not the primary compatibility authority.

Preferred flow:

`trusted OE/article → UniTrade search → exact offer → UniTrade analog endpoint → revalidation → commercial offers`.

Ordinary `/api/search/{query}` is the last fallback and cannot independently produce `CONFIRMED`.

## 11. Universal Part Family Guard

Every supplier row is classified into a canonical family from:

- supplier title;
- canonical terminology/aliases;
- provider category when available;
- trusted product mapping;
- OE/cross evidence.

An explicit mismatch is a hard reject.

Examples:

- request `BRAKE_DISC`, result `BRAKE_CALIPER` → `PART_FAMILY_CONFLICT`;
- request `BRAKE_PAD`, result brake rotor → reject;
- request stabilizer bushing, result stabilizer link → reject;
- request standalone ball joint, result control-arm assembly mentioning a ball joint → reject.

Unknown/unclassifiable family may proceed only to strict review; it cannot become confirmed without stronger evidence.

## 12. Vehicle and position guards

Hard reject codes:

- `PART_FAMILY_CONFLICT`;
- `AXIS_CONFLICT`;
- `SIDE_CONFLICT`;
- `VEHICLE_MAKE_CONFLICT`;
- `VEHICLE_MODEL_CONFLICT`;
- `YEAR_CONFLICT`;
- `ENGINE_CONFLICT`;
- `OE_CONFLICT`;
- `KNOWN_REJECTED_MATCH`.

Side conflict applies only to a side-sensitive canonical part. Axle/vehicle scoped sets must not be rejected merely because the diagnostic wording contained a side.

Vehicle OEM makes in supplier brand/title may be used as explicit vehicle evidence. Aftermarket brands such as BOSCH, TRW, MOOG, SKF, FEBI, FAG etc. must never be mistaken for vehicle makes.

## 13. Compatibility states

Internal compatibility tiers remain backward-compatible with existing data:

- `CONFIRMED`;
- `PARTIAL` (presented as **SUPPORTED** in V3 UI/API candidates);
- `REVIEW_REQUIRED`;
- `UNCONFIRMED` for legacy/internal states.

V3 user-facing meanings:

- `CONFIRMED` — exact VIN/VehicleFitment proof;
- `SUPPORTED` — strong OE/cross/model evidence without exact VIN proof;
- `REVIEW_REQUIRED` — no sufficient fitment proof;
- `REJECTED` — not returned to the operational picker.

## 14. Result types

Independent result types:

- `ORIGINAL`;
- `OEM_REPLACEMENT`;
- `ANALOG`;
- `ASSEMBLY`;
- `UNKNOWN`.

A result can therefore be `ANALOG + SUPPORTED` or `ORIGINAL + REVIEW_REQUIRED`. Result type must never be overwritten by the compatibility grouping.

## 15. Assembly alternatives

Assembly fallback is a separate result type. Example:

`WHEEL_HUB_BEARING → WHEEL_HUB_ASSEMBLY`.

Assembly alternatives:

- never auto-replace the requested component;
- always require manager confirmation unless later exact policy explicitly supports the assembly;
- preserve `alternativeForCanonicalCode` and provenance.

## 16. Part Candidate vs Supplier Offer

The V3 response groups identical product identity (`normalized brand + normalized article`) into a `PartCandidate`.

Candidate contains:

- identity and name;
- result type;
- compatibility state;
- OE references;
- analog-of reference;
- evidence reasons;
- all supplier offers;
- best commercial offer.

Supplier offers remain separate by provider/external product and retain provider price, stock, warehouse and delivery data.

## 17. Ranking

Compatibility dominates commercial factors.

Ordering:

1. exact VIN/VehicleFitment;
2. strong OE evidence;
3. verified cross;
4. model/vehicle evidence;
5. review-only results;
6. availability;
7. valid delivery;
8. valid price;
9. lower purchase price only as a tie-breaker inside equivalent evidence.

A cheaper uncertain part can never outrank a proven compatible part purely by price.

## 18. Price policy

`purchasePrice <= 0` is invalid and becomes `null`; sell price also becomes `null`. The picker cannot add an offer without a valid purchase price.

## 19. Known-negative knowledge

Active `PartRejectedMatch` records are loaded for the canonical generic article and applied as `KNOWN_REJECTED_MATCH` hard rejects. A known wrong article must not reappear as an actionable result on future searches.

## 20. Cross-learning policy

Supplier-discovered analog/cross relationships are staged as `PartCatalogChange` candidates with status `PENDING`.

They are never auto-activated into trusted catalog truth.

Promotion to an approved ProductCrossReference requires review/approval or a future explicit evidence threshold policy. Selection feedback may increase confidence but cannot bypass the review lifecycle.

## 21. Search audit

Every V3 search creates `PartSearchRun` and decision rows where the database is available.

Run records:

- search ID;
- vehicle/search intent identifiers;
- algorithm version;
- evidence-driven flag;
- duration and result counts;
- status and metadata.

Decision records capture:

- provider and product identity;
- detected canonical family;
- ACCEPT / REVIEW / REJECT;
- evidence tier;
- reject reason code;
- reason and score;
- relevant provenance metadata.

Audit is fail-open: an audit storage problem must not make supplier search unavailable.

## 22. API contract

Primary V3 orchestration is exposed through existing parts endpoints for backward compatibility and returns additional fields:

- `algorithm = EVIDENCE_FIRST_V3`;
- `searchId`;
- `intent`;
- `candidates`;
- legacy `offers`;
- effective OE numbers;
- catalog/analog articles;
- `strictSearch` summary;
- rejected counts by code;
- supplier status and cascade evidence;
- policy flags;
- timings.

Existing clients can continue consuming `offers`, while V3-aware UI can consume candidates and evidence metadata.

## 23. UI standard

Operational groups are based on result type:

1. Originals / OEM;
2. Analogs;
3. Assembly alternatives;
4. Needs review.

Compatibility is shown as a separate badge and must not move an analog into the generic review group.

`PARTIAL` is presented as `SUPPORTED` / “підтримано OE/крос · перевірити”.

Rows should expose analog provenance (`крос від …` / OE number) when available. Hard-rejected items are not shown to an ordinary manager.

The manager's manual confirmation may add a `REVIEW_REQUIRED`/supported item where policy requires it. It cannot recover an item already rejected by the server.

## 24. Server-side selection gate

Final selection and diagnostic draft staging must re-query/revalidate the chosen supplier offer through the same V3 engine. The browser's compatibility fields are informational only.

This prevents a stale or crafted client request from bypassing V3 hard-reject rules.

## 25. Performance

Target:

- P50 < 2 seconds where provider latency permits;
- P95 < 5 seconds;
- provider hard timeout 8 seconds;
- supplier searches in parallel;
- bounded cross expansion.

Long-lived cache may hold vehicle/fitment/cross evidence. Price and stock must remain short-lived/no-store.

## 26. Security

Supplier credentials, JWT and API keys stay server-side. Frontend receives only normalized offers and evidence metadata.

## 27. Backward compatibility and migration

`searchConfiguredSuppliers` remains the low-level provider layer. `searchPartsV3` is the canonical orchestration/policy layer. Existing routes progressively call V3 while legacy response fields remain available.

Direct selection and diagnostic draft revalidation must use V3, not the permissive low-level layer.

## 28. Required regression cases

1. `BRAKE_DISC` request + brake caliper response → hard reject.
2. REAR request + explicit FRONT response → hard reject.
3. side-sensitive RIGHT request + LEFT response → hard reject.
4. GEELY vehicle + explicit Renault/Hyundai-only evidence → hard reject.
5. GEELY Emgrand X7 2014 REAR stabilizer bushing → curated OE `1014012805` when canonical fitment is absent.
6. Same vehicle REAR brake disc → `1014012463`.
7. Same vehicle REAR brake-pad set → `101402006059` and side normalizes to null.
8. zero price → null / cannot add.
9. free text without evidence → REVIEW_REQUIRED, never CONFIRMED.
10. same brand/article from multiple suppliers → one PartCandidate with multiple SupplierOffers.
11. analog retains result type ANALOG even when compatibility requires confirmation.
12. known rejected article → hard reject.

## 29. Definition of Done

A V3 release is accepted when:

- Prisma schema + additive migration validate on a clean database;
- V3 contract smoke passes;
- canonical contract smoke passes;
- module-scope check passes;
- production Next build passes;
- preview deployment is READY;
- PR is mergeable and required CI succeeds;
- production deployment of merged main is READY;
- runtime does not show new V3 errors;
- exact live provider fitment claims are made only when the provider/vehicle scenario was actually executed.

## 30. Architectural ownership rule

Future supplier integrations must plug into this standard rather than introduce provider-specific compatibility decisions. New product families, evidence sources and suppliers may expand V3, but cannot weaken the invariants in section 2 without a documented architecture decision.
