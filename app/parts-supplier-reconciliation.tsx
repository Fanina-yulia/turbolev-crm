"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./parts-supplier-reconciliation.module.css";

type Product = {
  id: string;
  title: string;
  shortTitle?: string | null;
  mpnRaw: string;
  mpnNormalized: string;
  status: string;
  brand: { canonicalName: string };
  genericArticle?: { name: string } | null;
};

type Candidate = {
  id: string;
  rank: number;
  score: number;
  reasonCodes: unknown;
  evidence: unknown;
  product: Product;
};

type Task = {
  id: string;
  status: "OPEN" | "IN_REVIEW" | "ESCALATED" | string;
  reason: string;
  priority: number;
  evidence: unknown;
  conflictFields: unknown;
  notes?: string | null;
  createdAt: string;
  supplier: { id: string; code: string; name: string };
  batch?: {
    id: string;
    integrationScope: string;
    sourceVersion?: string | null;
    adapterVersion: string;
    schemaVersion: string;
    createdAt: string;
  } | null;
  importRecord: {
    id: string;
    supplierRecordKey: string;
    state: string;
    externalProductId?: string | null;
    supplierArticleRaw?: string | null;
    supplierArticleNorm?: string | null;
    brandRaw?: string | null;
    brandNormalized?: string | null;
    mpnCandidateRaw?: string | null;
    mpnCandidateNorm?: string | null;
    gtinCandidate?: string | null;
    currency?: string | null;
    purchasePrice?: number | null;
    quantityMode: string;
    exactQty?: number | null;
    availabilityBand?: string | null;
    warehouseKey?: string | null;
    sourceUpdatedAt?: string | null;
    sourceTimeTrusted: boolean;
    matchedProductId?: string | null;
    mappingMethod?: string | null;
    matchConfidence?: number | null;
    identityEvidence: unknown;
    errorCodes: unknown;
  };
  candidates: Candidate[];
};

type Payload = {
  ok: boolean;
  error?: string;
  tasks?: Task[];
  suppliers?: Array<{ id: string; code: string; name: string }>;
};

const REASONS = ["", "UNMATCHED", "AMBIGUOUS", "IDENTITY_CONFLICT", "INVALID_IDENTIFIER", "BRAND_CONFLICT", "PRICE_ANOMALY", "STOCK_ANOMALY", "SCHEMA_ERROR"];
const STATUSES = ["OPEN", "IN_REVIEW", "ESCALATED"];

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function money(value: number | null | undefined, currency?: string | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: currency || "UAH", maximumFractionDigits: 2 }).format(value);
}

function safeJson(value: unknown) {
  if (value == null) return "—";
  try {
    const result = JSON.stringify(value, null, 2);
    return result === "{}" || result === "[]" ? "—" : result;
  } catch {
    return "—";
  }
}

function recordIdentity(task: Task) {
  const row = task.importRecord;
  return [row.brandNormalized || row.brandRaw, row.mpnCandidateNorm || row.supplierArticleNorm || row.supplierArticleRaw, row.gtinCandidate].filter(Boolean).join(" · ") || row.supplierRecordKey;
}

export function SupplierReconciliationWorkspace() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [q, setQ] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("OPEN,IN_REVIEW,ESCALATED");
  const [notes, setNotes] = useState("");
  const [productQ, setProductQ] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const selected = useMemo(() => tasks.find((task) => task.id === selectedId) || tasks[0] || null, [tasks, selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ take: "100" });
      if (q.trim()) params.set("q", q.trim());
      if (supplierId) params.set("supplierId", supplierId);
      if (reason) params.set("reason", reason);
      for (const value of status.split(",").map((item) => item.trim()).filter(Boolean)) params.append("status", value);
      const response = await fetch(`/api/parts/supplier-reconciliation?${params}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити reconciliation queue.");
      setTasks(payload.tasks || []);
      setSuppliers(payload.suppliers || []);
      setSelectedId((current) => (payload.tasks || []).some((task) => task.id === current) ? current : (payload.tasks?.[0]?.id || ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити reconciliation queue.");
    } finally {
      setLoading(false);
    }
  }, [q, supplierId, reason, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setNotes(selected?.notes || "");
    setSelectedProduct(null);
    setProductResults([]);
    setProductQ("");
  }, [selected?.id]);

  async function searchProducts() {
    if (productQ.trim().length < 2) return setMessage("Введіть щонайменше 2 символи для пошуку canonical Product.");
    setBusy("product-search");
    setMessage("");
    try {
      const params = new URLSearchParams({ mode: "products", q: productQ.trim(), take: "30" });
      const response = await fetch(`/api/parts/supplier-reconciliation?${params}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; products?: Product[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Пошук Product не виконано.");
      setProductResults(payload.products || []);
      if (!(payload.products || []).length) setMessage("У canonical catalog не знайдено ACTIVE Product. Ескалюйте запис у catalog authoring.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Пошук Product не виконано.");
    } finally {
      setBusy("");
    }
  }

  async function mutate(action: "START_REVIEW" | "RESOLVE" | "REJECT" | "ESCALATE", product?: Product) {
    if (!selected || busy) return;
    if (action === "RESOLVE" && !product) return setMessage("Оберіть canonical Product.");
    if (action === "RESOLVE" && !window.confirm(`Прив'язати supplier record до ${product?.brand.canonicalName} ${product?.mpnRaw}? Наступний ingestion використає цей mapping.`)) return;
    if (action === "REJECT" && !window.confirm("Відхилити цей supplier record? Поточний запис не буде опублікований як offer.")) return;
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch("/api/parts/supplier-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskId: selected.id, productId: product?.id, notes }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; result?: { status?: string } };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Дію reconciliation не виконано.");
      setMessage(action === "RESOLVE"
        ? "Mapping збережено. SupplierOffer не публікувався; зміна набуде комерційної сили лише через нормальний ingestion/publish gate."
        : action === "REJECT"
          ? "Supplier record відхилено й зааудитовано."
          : action === "ESCALATE"
            ? "Запис ескальовано в catalog authoring. Product автоматично не створювався."
            : "Задачу взято в роботу.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Дію reconciliation не виконано.");
    } finally {
      setBusy("");
    }
  }

  const candidateProducts = selected?.candidates.map((candidate) => candidate.product) || [];

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p>TURBO LEV · SUPPLIER DATA</p>
        <h1>Reconciliation постачальників</h1>
        <span>Ручне вирішення нерозпізнаних, неоднозначних і конфліктних рядків без auto-create Product.</span>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    <section className={styles.safety}>
      <strong>Fail-closed workspace</strong>
      <span>Рішення тут змінює identity mapping та audit. Воно не створює SupplierOffer, не змінює склад і не відправляє замовлення постачальнику.</span>
    </section>

    <section className={styles.filters}>
      <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Артикул, бренд, GTIN, record key або постачальник…" />
      <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Усі постачальники</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
      <select value={reason} onChange={(event) => setReason(event.target.value)}>{REASONS.map((value) => <option key={value || "all"} value={value}>{value || "Усі причини"}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="OPEN,IN_REVIEW,ESCALATED">Уся активна черга</option>{STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </section>

    {message && <div className={styles.notice}>{message}</div>}

    <div className={styles.workspace}>
      <aside className={styles.queue}>
        <div className={styles.queueHead}><strong>Черга</strong><span>{tasks.length}</span></div>
        {loading && !tasks.length ? <div className={styles.empty}>Завантажую…</div> : !tasks.length ? <div className={styles.empty}>Активних reconciliation-задач немає.</div> : tasks.map((task) => <button type="button" key={task.id} className={selected?.id === task.id ? styles.taskActive : styles.task} onClick={() => setSelectedId(task.id)}>
          <div><b>{task.supplier.name}</b><em>{task.status}</em></div>
          <strong>{recordIdentity(task)}</strong>
          <span>{task.reason} · P{task.priority} · {formatDate(task.createdAt)}</span>
        </button>)}
      </aside>

      <main className={styles.detail}>
        {!selected ? <div className={styles.empty}>Оберіть задачу.</div> : <>
          <section className={styles.titleRow}>
            <div><span>{selected.supplier.name} · {selected.batch?.integrationScope || "scope ?"}</span><h2>{recordIdentity(selected)}</h2><p>Record key: {selected.importRecord.supplierRecordKey}</p></div>
            <div className={styles.badges}><b>{selected.status}</b><b>{selected.reason}</b></div>
          </section>

          <section className={styles.facts}>
            <div><span>Артикул</span><strong>{selected.importRecord.supplierArticleRaw || "—"}</strong><small>norm: {selected.importRecord.supplierArticleNorm || "—"}</small></div>
            <div><span>Бренд</span><strong>{selected.importRecord.brandRaw || "—"}</strong><small>norm: {selected.importRecord.brandNormalized || "—"}</small></div>
            <div><span>GTIN</span><strong>{selected.importRecord.gtinCandidate || "—"}</strong><small>external: {selected.importRecord.externalProductId || "—"}</small></div>
            <div><span>Комерційні дані</span><strong>{money(selected.importRecord.purchasePrice, selected.importRecord.currency)}</strong><small>{selected.importRecord.exactQty ?? selected.importRecord.availabilityBand ?? "qty ?"} · {selected.importRecord.warehouseKey || "warehouse ?"}</small></div>
          </section>

          <section className={styles.evidenceGrid}>
            <details><summary>Identity evidence</summary><pre>{safeJson(selected.importRecord.identityEvidence)}</pre></details>
            <details><summary>Conflict / task evidence</summary><pre>{safeJson({ conflictFields: selected.conflictFields, evidence: selected.evidence, errorCodes: selected.importRecord.errorCodes })}</pre></details>
          </section>

          <section className={styles.mapping}>
            <header><div><p>CANONICAL MATCH</p><h3>Прив’язати до існуючого Product</h3></div><span>Offer publish: OFF</span></header>
            {!!selected.candidates.length && <div className={styles.candidates}>{selected.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => setSelectedProduct(candidate.product)} className={selectedProduct?.id === candidate.product.id ? styles.productActive : styles.product}>
              <div><b>#{candidate.rank} · {candidate.product.brand.canonicalName}</b><em>score {candidate.score}</em></div>
              <strong>{candidate.product.mpnRaw}</strong>
              <span>{candidate.product.title}</span>
            </button>)}</div>}
            <div className={styles.productSearch}><input value={productQ} onChange={(event) => setProductQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchProducts(); }} placeholder="Пошук ACTIVE Product: MPN, назва або бренд…"/><button type="button" onClick={() => void searchProducts()} disabled={busy === "product-search"}>{busy === "product-search" ? "Шукаю…" : "Знайти"}</button></div>
            {!!productResults.length && <div className={styles.searchResults}>{productResults.map((product) => <button type="button" key={product.id} onClick={() => setSelectedProduct(product)} className={selectedProduct?.id === product.id ? styles.productActive : styles.product}>
              <div><b>{product.brand.canonicalName}</b><em>{product.genericArticle?.name || "Product"}</em></div>
              <strong>{product.mpnRaw}</strong><span>{product.title}</span>
            </button>)}</div>}
            {selectedProduct && <div className={styles.selectedProduct}><span>Обраний canonical Product</span><strong>{selectedProduct.brand.canonicalName} · {selectedProduct.mpnRaw}</strong><p>{selectedProduct.title}</p></div>}
          </section>

          <label className={styles.notes}><span>Примітка до рішення</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Що перевірено / чому обрано Product / причина reject або escalation…"/></label>

          <footer className={styles.actions}>
            {selected.status === "OPEN" && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void mutate("START_REVIEW")}>Взяти в роботу</button>}
            <button type="button" className={styles.resolve} disabled={Boolean(busy) || !selectedProduct} onClick={() => void mutate("RESOLVE", selectedProduct || undefined)}>Підтвердити mapping</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void mutate("ESCALATE")}>У catalog authoring</button>
            <button type="button" className={styles.reject} disabled={Boolean(busy)} onClick={() => void mutate("REJECT")}>Відхилити record</button>
          </footer>
        </>}
      </main>
    </div>
  </div>;
}
