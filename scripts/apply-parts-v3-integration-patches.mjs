import fs from "node:fs";

function patch(path, from, to) {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(from)) throw new Error(`Patch anchor not found in ${path}: ${from.slice(0, 120)}`);
  fs.writeFileSync(path, source.replace(from, to));
}

// Preserve structured position all the way into BM Parts vehicle-scoped search.
patch(
  "src/services/suppliers/registry.ts",
  "      position: null,\n      canonicalPart:",
  "      position: context.position || context.axis || null,\n      canonicalPart:",
);

// Server-side final selection verification must use the same V3 policy as the picker.
patch(
  "src/services/parts-selection.service.ts",
  'import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";\n',
  'import { searchPartsV3 } from "@/src/services/parts-search-v3.service";\nimport { mergeOeNumbers, resolveCuratedOeEvidence } from "@/src/services/parts-oe-evidence.service";\n',
);
patch(
  "src/services/parts-selection.service.ts",
  `  // Re-query by the selected article when possible. A finding description is\n  // often a human label, while the supplier adapter indexes the catalogue by\n  // its article; using the article prevents a valid selected offer from being\n  // rejected as stale during the second server-side verification.\n  const search = await searchConfiguredSuppliers(wantedArticle || suggestion.description, 50, {\n    vehicleId: clean(input.vehicleId, 160) || null,\n    vin: clean(input.vehicleVin, 24) || null,\n    fitmentStatus: fitment.status,\n    fitmentConfidence: fitment.confidence,\n    fitmentExact: fitment.exact,\n    fitmentSource: fitment.catalog?.source || input.fitmentSource || null,\n    fitmentReason: fitment.reason,\n    providerVehicle: fitment.providerVehicle,\n    canonicalCode: input.canonicalCode || null,\n    axis: input.axis || null,\n    side: input.side || null,\n    subPosition: input.subPosition || null,\n    partName: input.partName || suggestion.description,\n    position: input.position || null,\n    genericArticleId: fitment.genericArticle?.id || clean(input.genericArticleId, 160) || suggestion.genericArticleId || null,\n    catalogArticles: fitment.catalogArticles,\n    analogArticles: fitment.analogArticles,\n    oeNumbers: fitment.oeNumbers,\n  });`,
  `  // Re-query through the same Evidence First V3 engine used by the picker.\n  // A manual checkbox can approve REVIEW_REQUIRED, but can never recover a V3 hard reject.\n  const curatedOe = resolveCuratedOeEvidence({\n    vehicle: fitment.vehicle,\n    canonicalCode: input.canonicalCode || null,\n    partName: input.partName || suggestion.description,\n    axis: input.axis || null,\n    position: input.position || null,\n  });\n  const search = await searchPartsV3(wantedArticle || suggestion.description, 50, {\n    vehicleId: clean(input.vehicleId, 160) || null,\n    vin: clean(input.vehicleVin, 24) || null,\n    fitmentStatus: fitment.status,\n    fitmentConfidence: fitment.confidence,\n    fitmentExact: fitment.exact,\n    fitmentSource: fitment.catalog?.source || curatedOe?.source || input.fitmentSource || null,\n    fitmentReason: fitment.reason,\n    providerVehicle: fitment.providerVehicle,\n    canonicalCode: input.canonicalCode || null,\n    axis: input.axis || null,\n    requestedAxis: input.axis || null,\n    side: input.side || null,\n    requestedSide: input.side || null,\n    subPosition: input.subPosition || null,\n    partName: input.partName || suggestion.description,\n    position: input.position || null,\n    genericArticleId: fitment.genericArticle?.id || clean(input.genericArticleId, 160) || suggestion.genericArticleId || null,\n    catalogArticles: fitment.catalogArticles,\n    analogArticles: fitment.analogArticles,\n    oeNumbers: mergeOeNumbers(fitment.oeNumbers, curatedOe?.oeNumbers),\n    curatedOeNumbers: curatedOe?.oeNumbers || [],\n    analogReferences: fitment.matches.map((match) => ({ brand: match.brand, article: match.article })).slice(0, 8),\n    vehicleBrand: fitment.vehicle?.brand || null,\n    vehicleModel: fitment.vehicle?.model || null,\n    vehicleYear: fitment.vehicle?.year || null,\n    quantity,\n    sourceType: "DIAGNOSTIC",\n    sourceId: findingId || manualPartId,\n  });`,
);

patch(
  "src/services/diagnostic-part-selection-draft.service.ts",
  'import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";\n',
  'import { searchPartsV3 } from "@/src/services/parts-search-v3.service";\nimport { mergeOeNumbers, resolveCuratedOeEvidence } from "@/src/services/parts-oe-evidence.service";\n',
);
patch(
  "src/services/diagnostic-part-selection-draft.service.ts",
  `  const search = await searchConfiguredSuppliers(wantedArticle || String(suggestion.description || ""), 50, {\n    vehicleId: clean(input.vehicleId, 160) || null,\n    vin: clean(input.vehicleVin, 24) || null,\n    fitmentStatus: fitment.status,\n    fitmentConfidence: fitment.confidence,\n    fitmentExact: fitment.exact,\n    fitmentSource: fitment.catalog?.source || input.fitmentSource || null,\n    fitmentReason: fitment.reason,\n    providerVehicle: fitment.providerVehicle,\n    canonicalCode: input.canonicalCode || null,\n    axis: input.axis || null,\n    side: input.side || null,\n    subPosition: input.subPosition || null,\n    partName: input.partName || String(suggestion.description || ""),\n    position: input.position || null,\n    genericArticleId: fitment.genericArticle?.id || clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,\n    catalogArticles: fitment.catalogArticles,\n    analogArticles: fitment.analogArticles,\n    oeNumbers: fitment.oeNumbers,\n  });`,
  `  const curatedOe = resolveCuratedOeEvidence({\n    vehicle: fitment.vehicle,\n    canonicalCode: input.canonicalCode || null,\n    partName: input.partName || String(suggestion.description || ""),\n    axis: input.axis || null,\n    position: input.position || null,\n  });\n  const search = await searchPartsV3(wantedArticle || String(suggestion.description || ""), 50, {\n    vehicleId: clean(input.vehicleId, 160) || null,\n    vin: clean(input.vehicleVin, 24) || null,\n    fitmentStatus: fitment.status,\n    fitmentConfidence: fitment.confidence,\n    fitmentExact: fitment.exact,\n    fitmentSource: fitment.catalog?.source || curatedOe?.source || input.fitmentSource || null,\n    fitmentReason: fitment.reason,\n    providerVehicle: fitment.providerVehicle,\n    canonicalCode: input.canonicalCode || null,\n    axis: input.axis || null,\n    requestedAxis: input.axis || null,\n    side: input.side || null,\n    requestedSide: input.side || null,\n    subPosition: input.subPosition || null,\n    partName: input.partName || String(suggestion.description || ""),\n    position: input.position || null,\n    genericArticleId: fitment.genericArticle?.id || clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,\n    catalogArticles: fitment.catalogArticles,\n    analogArticles: fitment.analogArticles,\n    oeNumbers: mergeOeNumbers(fitment.oeNumbers, curatedOe?.oeNumbers),\n    curatedOeNumbers: curatedOe?.oeNumbers || [],\n    analogReferences: fitment.matches.map((match) => ({ brand: match.brand, article: match.article })).slice(0, 8),\n    vehicleBrand: fitment.vehicle?.brand || null,\n    vehicleModel: fitment.vehicle?.model || null,\n    vehicleYear: fitment.vehicle?.year || null,\n    quantity,\n    sourceType: "DIAGNOSTIC",\n    sourceId: findingId || manualPartId,\n  });`,
);

// UI: result type controls the section, compatibility is an independent badge.
patch(
  "app/parts-selection-workspace-v4.tsx",
  '  deliveryEstimate?: string | null;\n};',
  '  deliveryEstimate?: string | null;\n  oeNumbers?: string[];\n  analogOfArticle?: string | null;\n};',
);
patch(
  "app/parts-selection-workspace-v4.tsx",
  '  if (offer.compatibilityTier === "PARTIAL" || offer.fitmentExact === false) return "◐ модель · перевірити";',
  '  if (offer.compatibilityTier === "PARTIAL" || offer.fitmentExact === false) return "◐ підтримано OE/крос · перевірити";',
);
patch(
  "app/parts-selection-workspace-v4.tsx",
  `    for (const offer of filteredOffers) {\n      if (offer.resultType === "ASSEMBLY" || offer.sourceKind === "ASSEMBLY") assemblies.push(offer);\n      else if (isReviewOffer(offer)) review.push(offer);\n      else if (offer.resultType === "ORIGINAL" || offer.resultType === "OEM_REPLACEMENT") originals.push(offer);\n      else if (offer.resultType === "ANALOG") analogs.push(offer);\n      else review.push(offer);\n    }`,
  `    for (const offer of filteredOffers) {\n      if (offer.resultType === "ASSEMBLY" || offer.sourceKind === "ASSEMBLY") assemblies.push(offer);\n      else if (offer.resultType === "ORIGINAL" || offer.resultType === "OEM_REPLACEMENT") originals.push(offer);\n      else if (offer.resultType === "ANALOG" || offer.sourceKind === "ANALOG") analogs.push(offer);\n      else review.push(offer);\n    }`,
);
patch(
  "app/parts-selection-workspace-v4.tsx",
  '<div className={styles.brandCell}><span>{offer.brand || "Бренд —"}</span><b>{offer.article}</b></div>',
  '<div className={styles.brandCell}><span>{offer.brand || "Бренд —"}</span><b>{offer.article}</b>{offer.analogOfArticle ? <small>крос від {offer.analogOfArticle}</small> : offer.oeNumbers?.length ? <small>OE {offer.oeNumbers[0]}</small> : null}</div>',
);

// Canonical CI contract.
const packagePath = "package.json";
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const smoke = "node --import tsx scripts/parts-search-v3-contract-smoke.ts";
if (!pkg.scripts["contracts:smoke"].includes(smoke)) pkg.scripts["contracts:smoke"] += ` && ${smoke}`;
pkg.scripts["parts:search:v3:smoke"] = smoke;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

const overridesPath = "docs/modules/module-path-overrides.json";
const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
const parts = new Set(overrides["parts-inventory"] || []);
for (const item of [
  "app/api/parts/search/**",
  "app/api/parts/suppliers/**",
  "app/parts-selection-workspace-v4.tsx",
  "src/services/part-offer-compatibility.service.ts",
  "src/services/part-relevance.service.ts",
  "src/services/parts-oe-evidence.service.ts",
  "src/services/strict-parts-search.service.ts",
  "src/services/part-search-intent-v3.service.ts",
  "src/services/part-family-policy.service.ts",
  "src/services/parts-candidate-aggregator.service.ts",
  "src/services/parts-search-audit-v3.service.ts",
  "src/services/parts-search-v3.service.ts",
  "src/services/parts-selection.service.ts",
  "src/services/diagnostic-part-selection-draft.service.ts"
]) parts.add(item);
overrides["parts-inventory"] = [...parts];
fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + "\n");

console.log("Parts Search V3 integration patches applied.");
