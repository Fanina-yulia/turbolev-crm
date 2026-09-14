import fs from "node:fs";

function patchFile(path, patches) {
  let text = fs.readFileSync(path, "utf8");
  let changes = 0;
  for (const { from, to, label } of patches) {
    if (!text.includes(from)) {
      if (text.includes(to)) {
        console.log(`already applied: ${path} :: ${label}`);
        continue;
      }
      throw new Error(`Patch anchor not found: ${path} :: ${label}`);
    }
    text = text.replace(from, to);
    changes += 1;
    console.log(`patched: ${path} :: ${label}`);
  }
  fs.writeFileSync(path, text, "utf8");
  return changes;
}

let total = 0;

total += patchFile("src/services/parts-selection.service.ts", [
  {
    label: "live evidence and hard manual gate",
    from: `  if (!liveOffer) throw new PartsSelectionError("OFFER_STALE", "Пропозиція постачальника вже недоступна. Оновіть пошук.", 409);\n  if (searchMode === "VIN" && (liveOffer.fitmentStatus !== "VERIFIED" || liveOffer.fitmentExact === false)) {\n    throw new PartsSelectionError("CATALOG_FITMENT_REQUIRED", "Обрана пропозиція не має підтвердженого зв’язку з точною модифікацією автомобіля.", 409);\n  }\n  if (!liveOffer.available || liveOffer.purchasePrice == null) throw new PartsSelectionError("OFFER_UNAVAILABLE", "Ця деталь зараз недоступна у постачальника.", 409);`,
    to: `  if (!liveOffer) throw new PartsSelectionError("OFFER_STALE", "Пропозиція постачальника вже недоступна. Оновіть пошук.", 409);\n  if (searchMode === "VIN" && (liveOffer.fitmentStatus !== "VERIFIED" || liveOffer.fitmentExact === false)) {\n    throw new PartsSelectionError("CATALOG_FITMENT_REQUIRED", "Обрана пропозиція не має підтвердженого зв’язку з точною модифікацією автомобіля.", 409);\n  }\n  const selectionEvidence = {\n    resultType: liveOffer.resultType || "UNKNOWN",\n    compatibilityTier: liveOffer.compatibilityTier || "UNCONFIRMED",\n    sourceKind: liveOffer.sourceKind || null,\n    offerReason: liveOffer.offerReason || liveOffer.fitmentReason || null,\n    matchReasons: liveOffer.matchReasons || [],\n    requiresManualConfirmation: liveOffer.requiresManualConfirmation === true || liveOffer.resultType === "ASSEMBLY",\n  };\n  if (selectionEvidence.requiresManualConfirmation && input.manualConfirmation !== true) {\n    throw new PartsSelectionError(\n      "MANUAL_CONFIRMATION_REQUIRED",\n      liveOffer.resultType === "ASSEMBLY"\n        ? "Комплектна альтернатива потребує явного підтвердження менеджера після перевірки сумісності та складу комплекту."\n        : "Ця пропозиція потребує ручного підтвердження сумісності.",\n      409,\n    );\n  }\n  if (!liveOffer.available || liveOffer.purchasePrice == null) throw new PartsSelectionError("OFFER_UNAVAILABLE", "Ця деталь зараз недоступна у постачальника.", 409);`,
  },
  {
    label: "work order line evidence metadata",
    from: `      searchMode,\n      manualConfirmation: searchMode !== "VIN",\n      fitmentStatus: fitment.status,`,
    to: `      searchMode,\n      manualConfirmation: input.manualConfirmation === true,\n      resultType: selectionEvidence.resultType,\n      compatibilityTier: selectionEvidence.compatibilityTier,\n      sourceKind: selectionEvidence.sourceKind,\n      offerReason: selectionEvidence.offerReason,\n      matchReasons: selectionEvidence.matchReasons,\n      requiresManualConfirmation: selectionEvidence.requiresManualConfirmation,\n      fitmentStatus: fitment.status,`,
  },
  {
    label: "parts request assembly note",
    from: `          note: searchMode === "VIN"\n            ? "Підібрано за VIN"\n            : "Підібрано за номером/назвою після ручного підтвердження" + (packageResolution.priceBasis === "PER_WHEEL" ? "; ціна скоригована на кількість коліс" : ""),`,
    to: `          note: selectionEvidence.resultType === "ASSEMBLY"\n            ? "Комплектна альтернатива: менеджер вручну підтвердив сумісність і склад комплекту"\n            : searchMode === "VIN"\n              ? "Підібрано за VIN"\n              : "Підібрано за номером/назвою після ручного підтвердження" + (packageResolution.priceBasis === "PER_WHEEL" ? "; ціна скоригована на кількість коліс" : ""),`,
  },
  {
    label: "audit evidence metadata",
    from: `          searchMode,\n          manualConfirmation: searchMode !== "VIN",\n          fitmentStatus: fitment.status,`,
    to: `          searchMode,\n          manualConfirmation: input.manualConfirmation === true,\n          resultType: selectionEvidence.resultType,\n          compatibilityTier: selectionEvidence.compatibilityTier,\n          sourceKind: selectionEvidence.sourceKind,\n          offerReason: selectionEvidence.offerReason,\n          matchReasons: selectionEvidence.matchReasons,\n          requiresManualConfirmation: selectionEvidence.requiresManualConfirmation,\n          fitmentStatus: fitment.status,`,
  },
  {
    label: "return live evidence",
    from: `    searchMode,\n    manualConfirmationRequired: searchMode !== "VIN",\n    fitmentStatus: fitment.status,`,
    to: `    searchMode,\n    selectionEvidence,\n    manualConfirmationRequired: searchMode !== "VIN" || selectionEvidence.requiresManualConfirmation,\n    fitmentStatus: fitment.status,`,
  },
]);

total += patchFile("app/api/parts-selection/select/route.ts", [
  {
    label: "resolve canonical generic article for knowledge",
    from: `    let knowledge: { feedbackId?: string; stagedChangeId?: string | null; staged?: boolean; recorded: boolean } = { recorded: false };\n    try {\n      const recorded = await recordPartSelectionKnowledge({\n        genericArticleId: body?.genericArticleId || null,`,
    to: `    let knowledge: { feedbackId?: string; stagedChangeId?: string | null; staged?: boolean; recorded: boolean } = { recorded: false };\n    try {\n      let knowledgeGenericArticleId = body?.genericArticleId?.trim() || result.line?.genericArticleId || null;\n      if (!knowledgeGenericArticleId && body?.canonicalCode?.trim()) {\n        const canonicalArticle = await getPrisma().genericArticle.findFirst({\n          where: { code: body.canonicalCode.trim() },\n          select: { id: true },\n        });\n        knowledgeGenericArticleId = canonicalArticle?.id || null;\n      }\n      const evidence = result.selectionEvidence;\n      const recorded = await recordPartSelectionKnowledge({\n        genericArticleId: knowledgeGenericArticleId,`,
  },
  {
    label: "use live server evidence for knowledge",
    from: `        resultType: body?.resultType || null,\n        compatibilityTier: body?.compatibilityTier || null,\n        sourceKind: body?.sourceKind || null,\n        offerReason: body?.offerReason || null,\n        matchReasons: Array.isArray(body?.matchReasons) ? body.matchReasons : [],\n        manualConfirmation: body?.manualConfirmation === true || body?.requiresManualConfirmation === true,`,
    to: `        resultType: evidence?.resultType || null,\n        compatibilityTier: evidence?.compatibilityTier || null,\n        sourceKind: evidence?.sourceKind || null,\n        offerReason: evidence?.offerReason || null,\n        matchReasons: evidence?.matchReasons || [],\n        manualConfirmation: body?.manualConfirmation === true,`,
  },
]);

console.log(`Parts selection evidence v2 patch complete: ${total} replacements.`);
