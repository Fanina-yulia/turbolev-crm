import fs from "node:fs";

const path = "app/parts-catalog-legacy.tsx";
let text = fs.readFileSync(path, "utf8");
let changes = 0;

function replaceExact(from, to, label) {
  if (!text.includes(from)) {
    if (text.includes(to)) {
      console.log(`already applied: ${label}`);
      return;
    }
    throw new Error(`Patch anchor not found: ${label}`);
  }
  text = text.replace(from, to);
  changes += 1;
  console.log(`patched: ${label}`);
}

replaceExact(
  'type SupplierOffer = { supplierId: string; supplierName: string; externalProductId: string | null; article: string; brand: string | null; name: string; purchasePrice: number | null; currency: string | null; multiplicity: number | null; stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>; available: boolean; sourceUrl: string | null; imageUrl?: string | null; oeNumbers?: string[]; vehicleMatch?: string | null; analogOfArticle?: string | null; markupPercent?: number | null; sellPrice?: number | null; offerClass?: "OEM" | "ANALOG" | "UNKNOWN"; fitmentStatus?: string; fitmentConfidence?: number | null; fitmentExact?: boolean | null; fitmentSource?: string | null; fitmentReason?: string | null; catalogProductId?: string | null; offerReason?: string | null; sourceKind?: "DIRECT" | "OEM" | "ANALOG" | "NAME"; stockTotal?: number | null; quantityMode?: string; fetchedAt?: string | null };',
  'type SupplierOffer = { supplierId: string; supplierName: string; externalProductId: string | null; article: string; brand: string | null; name: string; purchasePrice: number | null; currency: string | null; multiplicity: number | null; stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>; available: boolean; sourceUrl: string | null; imageUrl?: string | null; oeNumbers?: string[]; vehicleMatch?: string | null; analogOfArticle?: string | null; markupPercent?: number | null; sellPrice?: number | null; offerClass?: "OEM" | "ANALOG" | "UNKNOWN"; resultType?: "ORIGINAL" | "OEM_REPLACEMENT" | "ANALOG" | "ASSEMBLY" | "UNKNOWN"; compatibilityTier?: "CONFIRMED" | "PARTIAL" | "REVIEW_REQUIRED" | "UNCONFIRMED"; fitmentStatus?: string; fitmentConfidence?: number | null; fitmentExact?: boolean | null; fitmentSource?: string | null; fitmentReason?: string | null; catalogProductId?: string | null; offerReason?: string | null; matchReasons?: string[]; sourceKind?: "DIRECT" | "OEM" | "ANALOG" | "NAME" | "ASSEMBLY"; requiresManualConfirmation?: boolean; alternativeForCanonicalCode?: string | null; stockTotal?: number | null; quantityMode?: string; deliveryEstimate?: string | null; fetchedAt?: string | null };',
  "supplier offer type",
);

replaceExact(
  '  const [activeTab, setActiveTab] = useState<"all" | "originals" | "analogs" | "review" | "manual">("all");',
  '  const [activeTab, setActiveTab] = useState<"all" | "originals" | "analogs" | "assemblies" | "review" | "manual">("all");',
  "assembly tab state",
);

replaceExact(
`      const vehicleScoped = Boolean(
        vehicleReferenceProvided
        || referenceData?.vehicle?.id
        || resolvedFitment?.vehicle?.id
        || resolvedFitment?.vehicle?.vin
      );
      if (vehicleScoped && resolvedFitment?.status !== "VERIFIED") {
        const blockedMessage = "Запит до постачальників не відправлено: для цього автомобіля немає підтвердженого зв’язку з OE-каталогом.";
        setOffers([]);
        setSupplierProviders([]);
        setConfiguredSuppliers([]);
        setSupplierSearchBlocked(true);
        setManualConfirmation(false);
        setMessage(blockedMessage);
        return;
      }

`,
`      // Supplier search is intentionally not blocked when exact OE fitment is missing.
      // The API returns compatibility tiers and the operator must manually confirm
      // every unverified/partial/assembly result before it can be selected.

`,
  "remove legacy client-side API blocker",
);

replaceExact(
  '      setSupplierSearchBlocked(vehicleReferenceProvided);',
  '      setSupplierSearchBlocked(false);',
  "do not mislabel transport errors as policy blocks",
);

replaceExact(
`  const originalOffers = offers.filter((offer) => offer.offerClass === "OEM");
  const analogOffers = offers.filter((offer) => offer.offerClass === "ANALOG");
  const manualOffers = offers.filter((offer) => offer.offerClass !== "OEM" && offer.offerClass !== "ANALOG");
  const categoryOffers = activeTab === "originals"
    ? originalOffers
    : activeTab === "analogs"
      ? analogOffers
      : activeTab === "review" || activeTab === "manual"
        ? manualOffers
        : offers;`,
`  const originalOffers = offers.filter((offer) => offer.resultType === "ORIGINAL" || offer.resultType === "OEM_REPLACEMENT" || (!offer.resultType && offer.offerClass === "OEM"));
  const analogOffers = offers.filter((offer) => offer.resultType === "ANALOG" || (!offer.resultType && offer.offerClass === "ANALOG"));
  const assemblyOffers = offers.filter((offer) => offer.resultType === "ASSEMBLY" || offer.sourceKind === "ASSEMBLY");
  const manualOffers = offers.filter((offer) => !assemblyOffers.includes(offer) && !originalOffers.includes(offer) && !analogOffers.includes(offer));
  const categoryOffers = activeTab === "originals"
    ? originalOffers
    : activeTab === "analogs"
      ? analogOffers
      : activeTab === "assemblies"
        ? assemblyOffers
        : activeTab === "review" || activeTab === "manual"
          ? manualOffers
          : offers;`,
  "result classification and assembly bucket",
);

replaceExact(
`      const catalogVerified = offer.fitmentStatus === "VERIFIED"
        && offer.fitmentExact !== false
        && fitment?.exact !== false;
      if (!catalogVerified && !manualConfirmation) {
        setMessage("Поставте позначку ручної перевірки сумісності перед додаванням пропозиції.");
        setSelectingOffer("");
        return;
      }
      const vinSearch = selectionVin.length === 17 && catalogVerified;`,
`      const catalogVerified = offer.fitmentStatus === "VERIFIED"
        && offer.fitmentExact !== false
        && fitment?.exact !== false;
      const requiresManualReview = offer.requiresManualConfirmation === true
        || offer.resultType === "ASSEMBLY"
        || !catalogVerified
        || selectionVin.length !== 17;
      if (requiresManualReview && !manualConfirmation) {
        setMessage(offer.resultType === "ASSEMBLY"
          ? "Комплектна альтернатива не прирівнюється до окремої деталі. Підтвердьте вручну, що менеджер перевірив сумісність і склад комплекту."
          : "Поставте позначку ручної перевірки сумісності перед додаванням пропозиції.");
        setSelectingOffer("");
        return;
      }
      const vinSearch = selectionVin.length === 17 && catalogVerified && !requiresManualReview;`,
  "selection manual-review policy",
);

replaceExact(
  'fitmentProductId: offer.catalogProductId || null, fitmentSource: offer.fitmentSource || fitment?.source || null, manualConfirmation: !vinSearch }) });',
  'fitmentProductId: offer.catalogProductId || null, fitmentSource: offer.fitmentSource || fitment?.source || null, manualConfirmation, resultType: offer.resultType || null, compatibilityTier: offer.compatibilityTier || null, sourceKind: offer.sourceKind || null, offerReason: offer.offerReason || offer.fitmentReason || null, matchReasons: offer.matchReasons || [], requiresManualConfirmation: requiresManualReview }) });',
  "selection provenance payload",
);

replaceExact(
`          <button type="button" className={activeTab === "analogs" ? styles.tabActive : ""} onClick={() => setActiveTab("analogs")}>Аналоги <span>{analogOffers.length}</span></button>
          <button type="button" className={activeTab === "review" ? styles.tabActive : ""} onClick={() => setActiveTab("review")}>Перевірка <span>{manualOffers.length}</span></button>`,
`          <button type="button" className={activeTab === "analogs" ? styles.tabActive : ""} onClick={() => setActiveTab("analogs")}>Аналоги <span>{analogOffers.length}</span></button>
          <button type="button" className={activeTab === "assemblies" ? styles.tabActive : ""} onClick={() => setActiveTab("assemblies")}>Комплектні <span>{assemblyOffers.length}</span></button>
          <button type="button" className={activeTab === "review" ? styles.tabActive : ""} onClick={() => setActiveTab("review")}>Перевірка <span>{manualOffers.length}</span></button>`,
  "assembly tab button",
);

replaceExact(
  '<span className={styles.pickerApiStatus}>{supplierSearchBlocked ? "Запит до API не відправлено" : `${configuredSuppliers.length} API підключено`}</span>',
  '<span className={styles.pickerApiStatus}>{supplierSearchBlocked ? "Пошук заблоковано політикою" : fitment?.status === "VERIFIED" ? `${configuredSuppliers.length} API підключено` : `${configuredSuppliers.length} API · результати потребують перевірки`}</span>',
  "API status copy",
);

replaceExact(
  '{!supplierSearchBlocked && (manualOffers.length > 0 || fitment?.status !== "VERIFIED") && <label className={styles.policyNote}><input type="checkbox" checked={manualConfirmation} onChange={(event) => setManualConfirmation(event.target.checked)} /> Я вручну перевірив сумісність цієї деталі з автомобілем</label>}',
  '{!supplierSearchBlocked && (offers.some((offer) => offer.requiresManualConfirmation === true || offer.resultType === "ASSEMBLY" || offer.fitmentStatus !== "VERIFIED" || offer.fitmentExact === false) || fitment?.status !== "VERIFIED") && <label className={styles.policyNote}><input type="checkbox" checked={manualConfirmation} onChange={(event) => setManualConfirmation(event.target.checked)} /> Я вручну перевірив сумісність, позицію та склад комплекту для цього автомобіля</label>}',
  "manual confirmation checkbox",
);

replaceExact(
  '{activeTab !== "review" && !categoryOffers.length && manualOffers.length > 0 && <div className={styles.policyNote}>У цій вкладці немає підтверджених результатів. Непідтверджені пропозиції винесені у вкладку «Перевірка».</div>}',
  '{activeTab !== "review" && activeTab !== "assemblies" && !categoryOffers.length && manualOffers.length > 0 && <div className={styles.policyNote}>У цій вкладці немає підтверджених результатів. Непідтверджені пропозиції винесені у вкладку «Перевірка».</div>}{activeTab === "assemblies" && assemblyOffers.length > 0 && <div className={styles.warning}>Комплектні альтернативи показані окремо. Вони не є автоматичним еквівалентом окремої деталі та завжди потребують підтвердження менеджера.</div>}',
  "assembly warning",
);

replaceExact(
`            const catalogVerified = offer.fitmentStatus === "VERIFIED"
              && offer.fitmentExact !== false
              && fitment?.exact !== false;
            const canSelectOffer = Boolean(
              offer.available
              && offer.purchasePrice != null
              && selectingOffer !== key
              && activeRecommendation
              && (catalogVerified || manualConfirmation),
            );
            const offerClassLabel = offer.offerClass === "OEM" ? "Оригінал / OEM" : offer.offerClass === "ANALOG" ? "Аналог / крос" : "Ручна перевірка";
            const fitmentLabel = offer.fitmentStatus !== "VERIFIED"
              ? "Потрібна ручна перевірка"
              : offer.fitmentExact === false || fitment?.exact === false
                ? "Модель підтверджена"
                : "Сумісність підтверджена";`,
`            const catalogVerified = offer.fitmentStatus === "VERIFIED"
              && offer.fitmentExact !== false
              && fitment?.exact !== false;
            const hasSelectionVin = resolvedVin.length === 17 || looksLikeVin(vehicleRef);
            const requiresManualReview = offer.requiresManualConfirmation === true
              || offer.resultType === "ASSEMBLY"
              || !catalogVerified
              || !hasSelectionVin;
            const canSelectOffer = Boolean(
              offer.available
              && offer.purchasePrice != null
              && selectingOffer !== key
              && activeRecommendation
              && (!requiresManualReview || manualConfirmation),
            );
            const offerClassLabel = offer.resultType === "ORIGINAL"
              ? "Оригінал"
              : offer.resultType === "OEM_REPLACEMENT"
                ? "OEM replacement"
                : offer.resultType === "ANALOG"
                  ? "Аналог / крос"
                  : offer.resultType === "ASSEMBLY"
                    ? "Комплектна альтернатива"
                    : offer.offerClass === "OEM"
                      ? "Оригінал / OEM"
                      : offer.offerClass === "ANALOG"
                        ? "Аналог / крос"
                        : "Невизначений результат";
            const fitmentLabel = offer.compatibilityTier === "CONFIRMED"
              ? "Сумісність підтверджена"
              : offer.compatibilityTier === "PARTIAL"
                ? "Часткова сумісність"
                : offer.compatibilityTier === "REVIEW_REQUIRED"
                  ? "Потребує перевірки"
                  : offer.compatibilityTier === "UNCONFIRMED"
                    ? "Не підтверджено"
                    : offer.fitmentStatus !== "VERIFIED"
                      ? "Потрібна ручна перевірка"
                      : offer.fitmentExact === false || fitment?.exact === false
                        ? "Модель підтверджена"
                        : "Сумісність підтверджена";`,
  "offer card policy and labels",
);

replaceExact(
  '<div className={styles.pickerOfferTop}><div><b>{offer.name}</b><span>{offer.brand || "Бренд не вказаний"} · {offer.article} · {offerClassLabel}</span><small>{offer.offerReason || offer.fitmentReason || "Причина зіставлення не вказана"}</small>{offer.oeNumbers?.length ? <small>OE: {offer.oeNumbers.slice(0, 3).join(", ")}</small> : null}</div><span className={offer.available ? styles.available : styles.unavailable}>{offer.available ? "В наявності" : "Уточнити"}</span></div>',
  '<div className={styles.pickerOfferTop}><div><b>{offer.name}</b><span>{offer.brand || "Бренд не вказаний"} · {offer.article} · {offerClassLabel}</span><small>{offer.offerReason || offer.fitmentReason || "Причина зіставлення не вказана"}</small>{offer.resultType === "ASSEMBLY" ? <small>⚠ Комплектна альтернатива — потребує підтвердження менеджера</small> : null}{offer.oeNumbers?.length ? <small>OE: {offer.oeNumbers.slice(0, 3).join(", ")}</small> : null}</div><span className={offer.available ? styles.available : styles.unavailable}>{offer.available ? "В наявності" : "Уточнити"}</span></div>',
  "assembly badge in offer card",
);

replaceExact(
  '<div><small>Ціна продажу</small><b className={styles.sellPrice}>{formatMoney(offer.sellPrice, offer.currency)}</b></div><div><small>Сумісність</small><b className={offer.fitmentStatus === "VERIFIED" ? styles.available : styles.unavailable}>{fitmentLabel}</b></div><button type="button" className={styles.addButton} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation || (!catalogVerified && !manualConfirmation)} onClick={(event) => { event.stopPropagation(); void selectOffer(offer); }}>{selectingOffer === key ? "Зберігаю…" : catalogVerified ? "Вибрати" : "Додати вручну"}</button>',
  '<div><small>Ціна продажу</small><b className={styles.sellPrice}>{formatMoney(offer.sellPrice, offer.currency)}</b></div><div><small>Доставка</small><b>{offer.deliveryEstimate || "Уточнюється API"}</b></div><div><small>Сумісність</small><b className={offer.compatibilityTier === "CONFIRMED" ? styles.available : styles.unavailable}>{fitmentLabel}</b></div><button type="button" className={styles.addButton} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation || (requiresManualReview && !manualConfirmation)} onClick={(event) => { event.stopPropagation(); void selectOffer(offer); }}>{selectingOffer === key ? "Зберігаю…" : offer.resultType === "ASSEMBLY" ? manualConfirmation ? "Підтвердити й додати" : "Потрібне підтвердження" : requiresManualReview ? "Додати вручну" : "Вибрати"}</button>',
  "delivery, compatibility and guarded action",
);

fs.writeFileSync(path, text, "utf8");
console.log(`Parts cascade UI v2 patch complete: ${changes} replacements.`);
