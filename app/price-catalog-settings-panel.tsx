"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./price-catalog-settings-panel.module.css";

type Source = "TURBO_LEV_LEGACY" | "MS_MASTER" | "MANUAL";
type ReviewStatus = "READY" | "NEEDS_REVIEW" | "QUARANTINED";
type ItemType = "LABOR" | "DIAGNOSTIC" | "MATERIAL" | "INFORMATION" | "CHECKLIST" | "RENT" | "PARKING" | "WASH" | "OTHER";
type Category = { id: string; name: string; slug: string };
type CatalogItem = {
  id: string;
  source: Source;
  externalServiceId: string | null;
  code: string | null;
  internalName: string;
  displayName: string;
  categoryId: string | null;
  category: Category | null;
  sourceCategory: string | null;
  itemType: ItemType;
  basePrice: string | null;
  unit: string;
  defaultQuantity: string;
  normMinutes: number | null;
  vehicleCoefficientEnabled: boolean;
  warrantyKm: number | null;
  warrantyDays: number | null;
  payrollCategory: string | null;
  payrollType: string;
  bodyPart: string | null;
  bodySide: string | null;
  calculatorOperation: string | null;
  isActive: boolean;
  showToOperator: boolean;
  showToClient: boolean;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
  sourceRow: number | null;
  sourceVersion: string | null;
  importedAt: string;
};
type CatalogResponse = {
  ok: boolean;
  page: number;
  limit: number;
  count: number;
  pages: number;
  counts: { total: number; active: number; ready: number; review: number; quarantine: number; msMaster: number };
  categories: Category[];
  latestBatch?: { fileName: string; createdAt: string; totalRows: number; readyRows: number; reviewRows: number; quarantinedRows: number } | null;
  items: CatalogItem[];
  error?: string;
};
type ImportPreview = {
  ok: boolean;
  mode: "preview" | "import";
  format: string;
  source: Source | "MANUAL";
  fileName: string;
  sheetName: string;
  batchId?: string;
  stats: { total: number; ready: number; needsReview: number; quarantined: number; bodyCalculatorRows: number; warrantyRows: number; payrollRows: number; missingPrice: number; lowTechnicalPrice: number; missingCategory: number; missingPrintName: number; create: number; update: number; autoActivate: number; preservedActive?: number };
  warnings: string[];
  rows: Array<{ externalServiceId: string; displayName: string; category: string; basePrice: number | null; normMinutes: number | null; reviewStatus: ReviewStatus; reviewReason: string | null }>;
  message?: string;
  error?: string;
};
type EditDraft = {
  displayName: string;
  internalName: string;
  basePrice: string;
  normMinutes: string;
  categoryId: string;
  itemType: ItemType;
  warrantyKm: string;
  warrantyDays: string;
  reviewStatus: ReviewStatus;
  reviewReason: string;
  vehicleCoefficientEnabled: boolean;
  isActive: boolean;
  showToClient: boolean;
};

const SOURCE_LABEL: Record<Source, string> = { TURBO_LEV_LEGACY: "Turbo LEV", MS_MASTER: "МС Мастер", MANUAL: "Ручний" };
const STATUS_LABEL: Record<ReviewStatus, string> = { READY: "READY", NEEDS_REVIEW: "Перевірити", QUARANTINED: "Карантин" };
const TYPE_LABEL: Record<ItemType, string> = { LABOR: "Робота", DIAGNOSTIC: "Діагностика", MATERIAL: "Матеріал", INFORMATION: "Інформація", CHECKLIST: "Чек-лист", RENT: "Оренда", PARKING: "Стоянка", WASH: "Мийка", OTHER: "Інше" };

function money(value: string | null) { const n = Number(value); return value == null || !Number.isFinite(n) ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(n)} грн`; }
function dateText(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d); }
function draftFrom(item: CatalogItem): EditDraft { return { displayName: item.displayName, internalName: item.internalName, basePrice: item.basePrice ?? "", normMinutes: item.normMinutes == null ? "" : String(item.normMinutes), categoryId: item.categoryId ?? "", itemType: item.itemType, warrantyKm: item.warrantyKm == null ? "" : String(item.warrantyKm), warrantyDays: item.warrantyDays == null ? "" : String(item.warrantyDays), reviewStatus: item.reviewStatus, reviewReason: item.reviewReason ?? "", vehicleCoefficientEnabled: item.vehicleCoefficientEnabled, isActive: item.isActive, showToClient: item.showToClient } }

export function PriceCatalogSettingsPanel() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      if (source) params.set("source", source);
      if (status) params.set("status", status);
      if (categoryId) params.set("categoryId", categoryId);
      if (active) params.set("active", active);
      const response = await fetch(`/api/settings/work-prices/catalog?${params}`, { cache: "no-store" });
      const payload = await response.json() as CatalogResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити каталог");
      setData(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка каталогу"); }
    finally { setLoading(false); }
  }, [page, query, source, status, categoryId, active, refreshKey]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), query.trim() ? 220 : 0); return () => window.clearTimeout(timer); }, [load, query]);
  useEffect(() => { setPage(1); }, [source, status, categoryId, active]);

  const counts = data?.counts || { total: 0, active: 0, ready: 0, review: 0, quarantine: 0, msMaster: 0 };
  const canActivateReady = counts.ready > counts.active && counts.msMaster > 0;
  const latest = data?.latestBatch;
  const items = data?.items || [];

  async function importFile(mode: "preview" | "import") {
    if (!file) { setError("Оберіть XLSX-файл."); return; }
    setImporting(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.set("file", file); form.set("mode", mode);
      const response = await fetch("/api/settings/work-prices/import", { method: "POST", body: form });
      const payload = await response.json() as ImportPreview;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося обробити файл");
      setPreview(payload);
      setMessage(mode === "import" ? payload.message || "Імпорт завершено." : `Розпізнано ${payload.stats.total} позицій. Перевірте статистику перед імпортом.`);
      if (mode === "import") { setPage(1); setSource(payload.source === "MS_MASTER" ? "MS_MASTER" : ""); setRefreshKey((value) => value + 1); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка імпорту"); }
    finally { setImporting(false); }
  }

  async function activateReady() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings/work-prices/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ACTIVATE_READY", source: "MS_MASTER" }) });
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося активувати READY");
      setMessage(payload.message || "READY-позиції активовано."); setRefreshKey((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка активації"); }
    finally { setSaving(false); }
  }

  function openEdit(item: CatalogItem) { setEditing(item); setDraft(draftFrom(item)); setError(""); }
  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !draft) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings/work-prices/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, ...draft, basePrice: draft.basePrice || null, normMinutes: draft.normMinutes || null, warrantyKm: draft.warrantyKm || null, warrantyDays: draft.warrantyDays || null }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося зберегти позицію");
      setEditing(null); setDraft(null); setMessage("Позицію каталогу оновлено."); setRefreshKey((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка збереження"); }
    finally { setSaving(false); }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>PRICE CATALOG 2.0</p><h1>Прайс робіт</h1><span>Один каталог для запису, діагностики, кошторису, ЗН, гарантій, зарплати й кузовного калькулятора.</span></div>
      <button type="button" className={styles.refresh} onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>↻ Оновити</button>
    </header>

    <section className={styles.kpis}>
      <Stat label="Усього" value={counts.total}/><Stat label="Активні" value={counts.active}/><Stat label="READY" value={counts.ready}/><Stat label="Перевірити" value={counts.review} warn/><Stat label="Карантин" value={counts.quarantine} danger/><Stat label="МС Мастер" value={counts.msMaster}/>
    </section>

    <section className={styles.importBox}>
      <div className={styles.importHead}><div><strong>Імпорт XLSX · МС Мастер</strong><span>Нові позиції завжди імпортуються неактивними. Ключ оновлення — «Послуга» / externalServiceId.</span></div>{latest && <small>Останній імпорт: {latest.fileName} · {dateText(latest.createdAt)}</small>}</div>
      <div className={styles.importControls}><input type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }}/><button type="button" disabled={!file || importing} onClick={() => void importFile("preview")}>{importing ? "Обробляю…" : "Перевірити файл"}</button>{preview?.mode === "preview" && <button type="button" className={styles.primary} disabled={importing} onClick={() => void importFile("import")}>Імпортувати у staging</button>}</div>
      {preview && <div className={styles.preview}>
        <div className={styles.previewStats}><Stat label="Рядків" value={preview.stats.total}/><Stat label="READY" value={preview.stats.ready}/><Stat label="Review" value={preview.stats.needsReview} warn/><Stat label="Quarantine" value={preview.stats.quarantined} danger/><Stat label="Кузовний кальк." value={preview.stats.bodyCalculatorRows}/><Stat label="Гарантія" value={preview.stats.warrantyRows}/></div>
        {preview.warnings.map((warning) => <div className={styles.warning} key={warning}>{warning}</div>)}
        <div className={styles.previewRows}>{preview.rows.slice(0, 12).map((row) => <div key={`${row.externalServiceId}-${row.displayName}`}><b>{row.externalServiceId}</b><span>{row.displayName}</span><em>{row.category}</em><strong>{row.basePrice == null ? "—" : `${row.basePrice} грн`}</strong><Status value={row.reviewStatus}/></div>)}</div>
      </div>}
    </section>

    {message && <div className={styles.message}>{message}</div>}{error && <div className={styles.error}>{error}</div>}

    <section className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="ID, код, назва, категорія, кузовна деталь…"/></label>
      <select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Усі джерела</option><option value="TURBO_LEV_LEGACY">Turbo LEV</option><option value="MS_MASTER">МС Мастер</option><option value="MANUAL">Ручні</option></select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Усі статуси</option><option value="READY">READY</option><option value="NEEDS_REVIEW">Перевірити</option><option value="QUARANTINED">Карантин</option></select>
      <select value={active} onChange={(event) => setActive(event.target.value)}><option value="">Активні + staging</option><option value="true">Тільки активні</option><option value="false">Тільки неактивні</option></select>
      <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Усі категорії</option>{(data?.categories || []).map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
      <button type="button" className={styles.activate} disabled={!canActivateReady || saving} onClick={() => void activateReady()}>Активувати READY · МС Мастер</button>
    </section>

    {loading ? <div className={styles.state}>Завантажую Price Catalog 2.0…</div> : !items.length ? <div className={styles.state}>За цими фільтрами позицій немає.</div> : <section className={styles.table}>
      <div className={styles.tableHead}><span>Послуга</span><span>Категорія / тип</span><span>Ціна / норма</span><span>Метадані</span><span>Стан</span><span/></div>
      {items.map((item) => <article key={item.id} className={`${styles.row} ${item.reviewStatus === "QUARANTINED" ? styles.quarantineRow : ""}`}>
        <div className={styles.service}><strong>{item.displayName}</strong>{item.internalName !== item.displayName && <small>Внутрішня: {item.internalName}</small>}<small>{SOURCE_LABEL[item.source]} · ID {item.externalServiceId || "—"}{item.sourceRow ? ` · рядок ${item.sourceRow}` : ""}</small></div>
        <div><strong>{item.category?.name || "Без категорії"}</strong><small>{TYPE_LABEL[item.itemType]}{item.sourceCategory && item.sourceCategory !== item.category?.name ? ` · джерело: ${item.sourceCategory}` : ""}</small></div>
        <div><strong>{money(item.basePrice)}</strong><small>{item.normMinutes == null ? "Норма не вказана" : `${item.normMinutes} хв`}{item.vehicleCoefficientEnabled ? " · коеф. авто ✓" : " · без коеф. авто"}</small></div>
        <div className={styles.meta}>{(item.warrantyKm != null || item.warrantyDays != null) && <small>Гарантія: {item.warrantyKm != null ? `${item.warrantyKm} км` : "—"} / {item.warrantyDays != null ? `${item.warrantyDays} дн` : "—"}</small>}{item.payrollType !== "NONE" && <small>ЗП: {item.payrollType}</small>}{item.bodyPart && <small>Кузов: {item.bodyPart}{item.bodySide ? ` · ${item.bodySide}` : ""}{item.calculatorOperation ? ` · ${item.calculatorOperation}` : ""}</small>}{!item.warrantyKm && !item.warrantyDays && item.payrollType === "NONE" && !item.bodyPart && <small>—</small>}</div>
        <div className={styles.stateCell}><Status value={item.reviewStatus}/><span className={item.isActive ? styles.live : styles.staging}>{item.isActive ? "Активна" : "Staging"}</span>{item.reviewReason && <small title={item.reviewReason}>{item.reviewReason}</small>}</div>
        <button type="button" className={styles.edit} onClick={() => openEdit(item)}>Редагувати</button>
      </article>)}
    </section>}

    <footer className={styles.pagination}><span>Показано {items.length} з {data?.count || 0} · сторінка {data?.page || page} з {data?.pages || 1}</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Назад</button><button disabled={page >= (data?.pages || 1) || loading} onClick={() => setPage((value) => value + 1)}>Далі →</button></div></footer>

    {editing && draft && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setEditing(null); setDraft(null); } }}><form className={styles.modal} onSubmit={saveEdit}>
      <header><div><small>{SOURCE_LABEL[editing.source]} · ID {editing.externalServiceId || "—"}</small><h2>Картка послуги</h2></div><button type="button" onClick={() => { if (!saving) { setEditing(null); setDraft(null); } }}>×</button></header>
      <div className={styles.formGrid}>
        <label className={styles.full}><span>Назва для оператора / клієнта</span><input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}/></label>
        <label className={styles.full}><span>Внутрішня назва</span><input value={draft.internalName} onChange={(event) => setDraft({ ...draft, internalName: event.target.value })}/></label>
        <label><span>Базова ціна, грн</span><input inputMode="decimal" value={draft.basePrice} onChange={(event) => setDraft({ ...draft, basePrice: event.target.value })}/></label>
        <label><span>Норма, хв</span><input inputMode="numeric" value={draft.normMinutes} onChange={(event) => setDraft({ ...draft, normMinutes: event.target.value })}/></label>
        <label><span>Категорія</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Не вибрана</option>{(data?.categories || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span>Тип позиції</span><select value={draft.itemType} onChange={(event) => setDraft({ ...draft, itemType: event.target.value as ItemType })}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Гарантія, км</span><input inputMode="numeric" value={draft.warrantyKm} onChange={(event) => setDraft({ ...draft, warrantyKm: event.target.value })}/></label>
        <label><span>Гарантія, днів</span><input inputMode="numeric" value={draft.warrantyDays} onChange={(event) => setDraft({ ...draft, warrantyDays: event.target.value })}/></label>
        <label><span>Статус перевірки</span><select value={draft.reviewStatus} onChange={(event) => setDraft({ ...draft, reviewStatus: event.target.value as ReviewStatus })}><option value="READY">READY</option><option value="NEEDS_REVIEW">Потрібна перевірка</option><option value="QUARANTINED">Карантин</option></select></label>
        <label className={styles.check}><input type="checkbox" checked={draft.vehicleCoefficientEnabled} onChange={(event) => setDraft({ ...draft, vehicleCoefficientEnabled: event.target.checked })}/><span>Застосовувати коефіцієнт типу авто</span></label>
        <label className={`${styles.full} ${styles.check}`}><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}/><span>Активна в бойовому прайсі оператора</span></label>
        <label className={`${styles.full} ${styles.check}`}><input type="checkbox" checked={draft.showToClient} onChange={(event) => setDraft({ ...draft, showToClient: event.target.checked })}/><span>Можна показувати клієнту</span></label>
        <label className={styles.full}><span>Причина / примітка перевірки</span><textarea value={draft.reviewReason} onChange={(event) => setDraft({ ...draft, reviewReason: event.target.value })}/></label>
      </div>
      {(editing.bodyPart || editing.payrollType !== "NONE") && <div className={styles.readOnly}><b>Структурні поля з джерела</b>{editing.bodyPart && <span>Кузов: {editing.bodyPart} · {editing.bodySide || "центр"} · {editing.calculatorOperation || "без операції"}</span>}{editing.payrollType !== "NONE" && <span>Payroll: {editing.payrollType}{editing.payrollCategory ? ` · ${editing.payrollCategory}` : ""}</span>}</div>}
      <footer><button type="button" onClick={() => { if (!saving) { setEditing(null); setDraft(null); } }}>Скасувати</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Зберігаю…" : "Зберегти"}</button></footer>
    </form></div>}
  </div>;
}

function Stat({ label, value, warn, danger }: { label: string; value: number; warn?: boolean; danger?: boolean }) { return <article className={`${styles.stat} ${warn ? styles.statWarn : ""} ${danger ? styles.statDanger : ""}`}><small>{label}</small><strong>{value.toLocaleString("uk-UA")}</strong></article>; }
function Status({ value }: { value: ReviewStatus }) { return <span className={`${styles.status} ${styles[`status_${value}`]}`}>{STATUS_LABEL[value]}</span>; }
