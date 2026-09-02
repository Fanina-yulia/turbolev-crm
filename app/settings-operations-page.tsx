"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BinotelCallbacksSettings } from "./binotel-callbacks-settings";
import { AppearanceSettingsPanel } from "./appearance-settings-panel";
import type { SettingsTab } from "./settings-tabs";
import styles from "./settings-operations-page.module.css";

type OperationalTab = Exclude<SettingsTab, "personnel" | "cameras" | "workflow" | "security">;
type DirectoryCategory = "SUPPLIER" | "WAREHOUSE" | "WORK_PRICE" | "CASH";
type DirectoryItem = { id: string; category: string; name: string; code: string | null; data: Record<string, unknown> | null; isActive: boolean; sortOrder: number };
type Post = { id: string; name: string; sortOrder: number; isActive: boolean; capabilities: string[] };
type Mechanic = { id: string; name: string; sortOrder: number; isActive: boolean };
type Location = { id: string; name: string; timezone: string; openMinute: number; closeMinute: number; posts: Post[]; mechanics: Mechanic[] };
type ScheduleDay = { day: number; label: string; enabled: boolean; open: string; close: string };
type OperationsResponse = { ok: boolean; location: Location | null; settings: Record<string, unknown>; directory: DirectoryItem[]; error?: string };
type IntegrationField = { key: string; label: string; secret: boolean; required?: boolean; placeholder?: string };
type IntegrationItem = { provider: string; category: string; title: string; description: string; fields: IntegrationField[]; configured: boolean; configuredVia: string | null; status: string; masked: Record<string, string>; visible: Record<string, string> };
type PricePreview = { ok?: boolean; fileName: string; stats: { total: number; create: number; update: number }; rows: Array<{ code: string; category: string; name: string; unit: string; price: number; normHours: number | null }>; error?: string; message?: string };
type Draft = Record<string, string | boolean>;

const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const DEFAULT_SCHEDULE: ScheduleDay[] = DAYS.map((label, index) => ({ day: index + 1, label, enabled: true, open: "09:00", close: "21:00" }));
const POST_TYPES: Record<string, string> = { LIFT: "Підйомник", NO_LIFT: "Без підйомника", PIT: "Яма", ALIGNMENT: "Розвал-сходження" };
const VEHICLE_TYPES = [
  ["PASSENGER", "Легковий", 1], ["CROSSOVER", "Кросовер", 1.15], ["SUV", "SUV", 1.2], ["PICKUP", "Пікап", 1.2],
  ["MINIVAN", "Мінівен", 1.15], ["VAN_SMALL", "Малий бус", 1.2], ["VAN", "Бус", 1.35], ["VAN_LARGE", "Великий бус", 1.5], ["COMMERCIAL_HEAVY", "Важкий комерційний", 1.65],
] as const;

function obj(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(item: DirectoryItem, key: string) { const value = item.data?.[key]; return value == null ? "" : String(value); }
function parsePost(post: Post) { return { type: post.capabilities.find((value) => value.startsWith("TYPE:"))?.slice(5) || "LIFT", color: post.capabilities.find((value) => value.startsWith("COLOR:"))?.slice(6) || "#FF6600" }; }
function isSupplierIntegration(item: IntegrationItem) { return item.category.toUpperCase().includes("SUPPLIER") || /BM.?PARTS|UNIQUE|AUTONOVA|ATL|постач/i.test(`${item.provider} ${item.title}`); }
export function SettingsOperationsPage({ tab }: { tab: OperationalTab }) {
  const [ops, setOps] = useState<OperationsResponse | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDay[]>(DEFAULT_SCHEDULE);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [integrationValues, setIntegrationValues] = useState<Record<string, string>>({});
  const [priceFile, setPriceFile] = useState<File | null>(null);
  const [pricePreview, setPricePreview] = useState<PricePreview | null>(null);

  const load = useCallback(async () => {
    if (tab === "appearance") { setLoading(false); return; }
    setLoading(true); setMessage("");
    try {
      const needsIntegrations = tab === "suppliers" || tab === "integrations";
      const [operationsResponse, integrationsResponse] = await Promise.all([
        fetch("/api/settings/operations", { cache: "no-store" }),
        needsIntegrations ? fetch("/api/settings/integrations", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      const operations = await operationsResponse.json() as OperationsResponse;
      if (!operationsResponse.ok || !operations.ok) throw new Error(operations.error || "Не вдалося завантажити налаштування");
      setOps(operations);
      setSchedule(Array.isArray(operations.settings?.work_schedule) ? operations.settings.work_schedule as ScheduleDay[] : DEFAULT_SCHEDULE);
      if (integrationsResponse) {
        const integrationData = await integrationsResponse.json() as { integrations?: IntegrationItem[]; error?: string };
        if (!integrationsResponse.ok) throw new Error(integrationData.error || "Не вдалося завантажити інтеграції");
        setIntegrations(Array.isArray(integrationData.integrations) ? integrationData.integrations : []);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка завантаження"); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { void load(); setDraft({}); setEditingProvider(null); setIntegrationValues({}); setPricePreview(null); }, [load]);

  const directory = (category: DirectoryCategory) => (ops?.directory || []).filter((item) => item.category === category);
  const markup = obj(ops?.settings?.markup);
  const vehicleCoefficients = obj(markup.vehicleTypeCoefficients);

  async function action(payload: Record<string, unknown>, success: string) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/settings/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти");
      setMessage(success); setDraft({}); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка збереження"); }
    finally { setSaving(false); }
  }

  async function saveIntegration(item: IntegrationItem) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/settings/integrations/${item.provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: integrationValues }) });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти доступи");
      setEditingProvider(null); setIntegrationValues({}); setMessage(`${item.title}: доступи збережено.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка інтеграції"); }
    finally { setSaving(false); }
  }

  async function testIntegration(item: IntegrationItem) {
    setMessage("");
    try {
      const response = await fetch(`/api/settings/integrations/${item.provider}/test`, { method: "POST" });
      const data = await response.json() as { ok?: boolean; message?: string; error?: string };
      setMessage(data.message || data.error || (data.ok ? "З’єднання працює." : "Перевірка не пройшла.")); await load();
    } catch { setMessage("CRM не змогла перевірити інтеграцію."); }
  }

  async function priceImport(mode: "preview" | "import") {
    if (!priceFile) { setMessage("Оберіть XLSX-файл прайсу."); return; }
    setSaving(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", priceFile); form.set("mode", mode);
      const response = await fetch("/api/settings/work-prices/import", { method: "POST", body: form });
      const data = await response.json() as PricePreview;
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося прочитати прайс");
      if (mode === "preview") { setPricePreview(data); setMessage(`Розпізнано ${data.stats.total} позицій.`); }
      else { setPricePreview(null); setPriceFile(null); setMessage(data.message || "Прайс імпортовано."); await load(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка імпорту"); }
    finally { setSaving(false); }
  }

  if (tab === "appearance") return <AppearanceSettingsPanel/>;
  if (loading && !ops) return <SettingsFrame title="Налаштування" description="Завантажуємо дані…"><div className={styles.empty}>Завантаження…</div></SettingsFrame>;

  const integrationCards = (items: IntegrationItem[]) => <div className={styles.cards}>{items.map((item) => {
    const editing = editingProvider === item.provider;
    return <article className={styles.card} key={item.provider}>
      <div className={styles.cardHead}><div><strong>{item.title}</strong><small>{item.description}</small></div><Badge active={item.status === "CONNECTED"}>{item.status === "CONNECTED" ? "Підключено" : item.configured ? "Налаштовано" : "Не налаштовано"}</Badge></div>
      {editing && <div className={styles.formGrid}>{item.fields.map((field) => <label key={field.key}><span>{field.label}</span><input type={field.secret ? "password" : "text"} value={integrationValues[field.key] ?? item.visible[field.key] ?? ""} placeholder={field.secret ? item.masked[field.key] || field.placeholder : field.placeholder} onChange={(event) => setIntegrationValues((current) => ({ ...current, [field.key]: event.target.value }))}/></label>)}</div>}
      <div className={styles.actions}>{editing ? <><button disabled={saving} onClick={() => void saveIntegration(item)}>Зберегти</button><button className={styles.secondary} onClick={() => { setEditingProvider(null); setIntegrationValues({}); }}>Скасувати</button></> : <button onClick={() => { setEditingProvider(item.provider); setIntegrationValues({ ...item.visible }); }}>Налаштувати</button>}<button className={styles.secondary} disabled={!item.configured} onClick={() => void testIntegration(item)}>Перевірити</button></div>
    </article>;
  })}</div>;

  if (tab === "schedule") return <SettingsFrame title="Графік роботи" description="Робочі години локації. Планувальник використовує ці межі для доступних слотів." message={message}>
    <div className={styles.schedule}>{schedule.map((day, index) => <div className={styles.scheduleRow} key={day.day}><strong>{DAYS[index]}</strong><label className={styles.check}><input type="checkbox" checked={day.enabled} onChange={(event) => setSchedule((rows) => rows.map((row, i) => i === index ? { ...row, enabled: event.target.checked } : row))}/>Працюємо</label><input type="time" step={1800} disabled={!day.enabled} value={day.open} onChange={(event) => setSchedule((rows) => rows.map((row, i) => i === index ? { ...row, open: event.target.value } : row))}/><span>—</span><input type="time" step={1800} disabled={!day.enabled} value={day.close} onChange={(event) => setSchedule((rows) => rows.map((row, i) => i === index ? { ...row, close: event.target.value } : row))}/></div>)}</div>
    <FooterAction disabled={saving || !ops?.location} onClick={() => void action({ action: "SAVE_SCHEDULE", locationId: ops?.location?.id, schedule }, "Графік роботи збережено.")}>Зберегти графік</FooterAction>
  </SettingsFrame>;

  if (tab === "suppliers") {
    const suppliers = directory("SUPPLIER"); const supplierIntegrations = integrations.filter(isSupplierIntegration);
    return <SettingsFrame title="Постачальники" description="Довідник закупівель і API-доступи постачальників в одному місці." message={message}>
      <AddToggle label="+ Додати постачальника" open={draft.form === "supplier"} onClick={() => setDraft(draft.form === "supplier" ? {} : { form: "supplier", payment: "Передплата" })}/>
      {draft.form === "supplier" && <FormBox><div className={styles.formGrid}><Field label="Назва" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><Field label="Телефон" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })}/><Field label="Email" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })}/><Field label="Сайт" value={draft.website} onChange={(value) => setDraft({ ...draft, website: value })}/><Field label="Доставка, днів" value={draft.deliveryDays} onChange={(value) => setDraft({ ...draft, deliveryDays: value })}/><label><span>Оплата</span><select value={String(draft.payment || "Передплата")} onChange={(event) => setDraft({ ...draft, payment: event.target.value })}><option>Передплата</option><option>Післяплата</option><option>Відстрочка</option></select></label></div><div className={styles.actions}><button disabled={saving} onClick={() => void action({ action: "ADD_DIRECTORY", category: "SUPPLIER", name: draft.name, data: { phone: draft.phone, email: draft.email, website: draft.website, deliveryDays: draft.deliveryDays, payment: draft.payment } }, "Постачальника додано.")}>Зберегти</button></div></FormBox>}
      <SectionTitle>Довідник</SectionTitle><DirectoryCards items={suppliers} onToggle={(item) => void action({ action: "TOGGLE_DIRECTORY", id: item.id, isActive: !item.isActive }, "Статус постачальника змінено.")} facts={(item) => [text(item, "phone"), text(item, "payment")].filter(Boolean).join(" · ")}/>
      <SectionTitle>API постачальників</SectionTitle>{supplierIntegrations.length ? integrationCards(supplierIntegrations) : <div className={styles.empty}>API постачальників ще не налаштовані.</div>}
    </SettingsFrame>;
  }

  if (tab === "warehouse") {
    const items = directory("WAREHOUSE");
    return <SettingsFrame title="Склад" description="Склади, зони зберігання і відповідальні." message={message}><AddToggle label="+ Додати склад" open={draft.form === "warehouse"} onClick={() => setDraft(draft.form === "warehouse" ? {} : { form: "warehouse" })}/>{draft.form === "warehouse" && <FormBox><div className={styles.formGrid}><Field label="Назва" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><Field label="Локація" value={draft.location} onChange={(value) => setDraft({ ...draft, location: value })}/><Field label="Відповідальний" value={draft.responsible} onChange={(value) => setDraft({ ...draft, responsible: value })}/></div><div className={styles.actions}><button disabled={saving} onClick={() => void action({ action: "ADD_DIRECTORY", category: "WAREHOUSE", name: draft.name, data: { location: draft.location, responsible: draft.responsible } }, "Склад додано.")}>Зберегти</button></div></FormBox>}<DirectoryCards items={items} onToggle={(item) => void action({ action: "TOGGLE_DIRECTORY", id: item.id, isActive: !item.isActive }, "Статус складу змінено.")} facts={(item) => [text(item, "location"), text(item, "responsible")].filter(Boolean).join(" · ")}/></SettingsFrame>;
  }

  if (tab === "workPrices") return <SettingsFrame title="Прайс робіт" description="Імпорт та оновлення каталогу робіт. Перед імпортом можна переглянути, що буде створено або оновлено." message={message}><FormBox><label className={styles.file}><span>XLSX-файл</span><input type="file" accept=".xlsx" onChange={(event) => { setPriceFile(event.target.files?.[0] || null); setPricePreview(null); }}/></label><div className={styles.actions}><button disabled={!priceFile || saving} onClick={() => void priceImport("preview")}>Перевірити файл</button>{pricePreview && <button disabled={saving} onClick={() => void priceImport("import")}>Імпортувати</button>}</div></FormBox>{pricePreview && <div className={styles.preview}><div className={styles.stats}><Stat label="Всього" value={pricePreview.stats.total}/><Stat label="Нові" value={pricePreview.stats.create}/><Stat label="Оновлення" value={pricePreview.stats.update}/></div><div className={styles.previewRows}>{pricePreview.rows.slice(0, 30).map((row) => <div key={`${row.code}-${row.name}`}><b>{row.code || "—"}</b><span>{row.name}</span><strong>{row.price.toLocaleString("uk-UA")} ₴</strong></div>)}</div></div>}</SettingsFrame>;

  if (tab === "posts") return <SettingsFrame title="Пости" description="Робочі пости станції, їх тип і активність." message={message}><AddToggle label="+ Додати пост" open={draft.form === "post"} onClick={() => setDraft(draft.form === "post" ? {} : { form: "post", type: "LIFT", color: "#FF6600" })}/>{draft.form === "post" && <FormBox><div className={styles.formGrid}><Field label="Назва" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><label><span>Тип</span><select value={String(draft.type || "LIFT")} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{Object.entries(POST_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label><span>Колір</span><input type="color" value={String(draft.color || "#FF6600")} onChange={(event) => setDraft({ ...draft, color: event.target.value })}/></label></div><div className={styles.actions}><button disabled={saving || !ops?.location} onClick={() => void action({ action: "ADD_POST", locationId: ops?.location?.id, name: draft.name, type: draft.type, color: draft.color }, "Пост додано.")}>Зберегти</button></div></FormBox>}<div className={styles.cards}>{(ops?.location?.posts || []).map((post) => { const meta = parsePost(post); return <article className={styles.card} key={post.id}><div className={styles.cardHead}><div><strong>{post.name}</strong><small>{POST_TYPES[meta.type] || meta.type}</small></div><span className={styles.colorDot} style={{ background: meta.color }}/><Badge active={post.isActive}>{post.isActive ? "Активний" : "Вимкнений"}</Badge></div><div className={styles.actions}><button className={styles.secondary} onClick={() => void action({ action: "TOGGLE_POST", id: post.id, isActive: !post.isActive }, "Статус поста змінено.")}>{post.isActive ? "Вимкнути" : "Увімкнути"}</button></div></article>; })}</div></SettingsFrame>;

  if (tab === "markup") return <SettingsFrame title="Націнка" description="Правила націнки запчастин і коефіцієнти робіт за типом автомобіля." message={message}><div className={styles.formGrid}><Field label="Націнка на запчастини, %" value={draft.partsMarkup ?? markup.defaultPartsPercent ?? 40} onChange={(value) => setDraft({ ...draft, partsMarkup: value.replace(/[^0-9.]/g, "") })}/><Field label="Роботи з деталями клієнта, +%" value={draft.customerParts ?? markup.customerPartsLaborPercent ?? 20} onChange={(value) => setDraft({ ...draft, customerParts: value.replace(/[^0-9.]/g, "") })}/>{VEHICLE_TYPES.map(([key, label, fallback]) => <Field key={key} label={`Коефіцієнт: ${label}`} value={draft[`coef_${key}`] ?? vehicleCoefficients[key] ?? fallback} onChange={(value) => setDraft({ ...draft, [`coef_${key}`]: value.replace(",", ".").replace(/[^0-9.]/g, "") })}/>)}</div><FooterAction disabled={saving} onClick={() => void action({ action: "SAVE_SETTING", key: "markup", value: { ...markup, defaultPartsPercent: Number(draft.partsMarkup ?? markup.defaultPartsPercent ?? 40), customerPartsLaborPercent: Number(draft.customerParts ?? markup.customerPartsLaborPercent ?? 20), vehicleTypeCoefficients: Object.fromEntries(VEHICLE_TYPES.map(([key,, fallback]) => [key, Number(draft[`coef_${key}`] ?? vehicleCoefficients[key] ?? fallback) || fallback])) } }, "Націнку та коефіцієнти збережено.")}>Зберегти правила</FooterAction></SettingsFrame>;

  if (tab === "cash") { const items = directory("CASH"); return <SettingsFrame title="Каса" description="Довідник кас/рахунків операційних налаштувань. Фактичні оплати ведуться в модулі «Оплати»." message={message}><AddToggle label="+ Додати касу" open={draft.form === "cash"} onClick={() => setDraft(draft.form === "cash" ? {} : { form: "cash" })}/>{draft.form === "cash" && <FormBox><div className={styles.formGrid}><Field label="Назва" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })}/><Field label="Локація" value={draft.location} onChange={(value) => setDraft({ ...draft, location: value })}/></div><div className={styles.actions}><button disabled={saving} onClick={() => void action({ action: "ADD_DIRECTORY", category: "CASH", name: draft.name, data: { location: draft.location } }, "Касу додано.")}>Зберегти</button></div></FormBox>}<DirectoryCards items={items} onToggle={(item) => void action({ action: "TOGGLE_DIRECTORY", id: item.id, isActive: !item.isActive }, "Статус каси змінено.")} facts={(item) => text(item, "location")}/></SettingsFrame>; }

  if (tab === "integrations") { const general = integrations.filter((item) => !isSupplierIntegration(item)); return <SettingsFrame title="Інтеграції" description="Телефонія, месенджери та канали комунікацій." message={message}>{general.length ? integrationCards(general) : <div className={styles.empty}>Інтеграції ще не налаштовані.</div>}<SectionTitle>Binotel</SectionTitle><BinotelCallbacksSettings/></SettingsFrame>; }

  return <SettingsFrame title="Налаштування" description="Розділ недоступний."><div className={styles.empty}>Невідомий розділ.</div></SettingsFrame>;
}

function SettingsFrame({ title, description, message, children }: { title: string; description: string; message?: string; children: React.ReactNode }) { return <div className={styles.page}><header className={styles.header}><p>НАЛАШТУВАННЯ</p><h1>{title}</h1><span>{description}</span></header>{message && <div className={styles.message}>{message}</div>}{children}</div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <h2 className={styles.sectionTitle}>{children}</h2>; }
function FormBox({ children }: { children: React.ReactNode }) { return <div className={styles.formBox}>{children}</div>; }
function Field({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) { return <label><span>{label}</span><input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}/></label>; }
function Badge({ active, children }: { active: boolean; children: React.ReactNode }) { return <span className={`${styles.badge} ${active ? styles.badgeActive : ""}`}>{children}</span>; }
function AddToggle({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) { return <div className={styles.topAction}><button onClick={onClick}>{open ? "Скасувати" : label}</button></div>; }
function FooterAction({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) { return <div className={styles.footerAction}><button disabled={disabled} onClick={onClick}>{children}</button></div>; }
function Stat({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function DirectoryCards({ items, facts, onToggle }: { items: DirectoryItem[]; facts: (item: DirectoryItem) => string; onToggle: (item: DirectoryItem) => void }) { return items.length ? <div className={styles.cards}>{items.map((item) => <article className={styles.card} key={item.id}><div className={styles.cardHead}><div><strong>{item.name}</strong><small>{facts(item) || item.code || item.category}</small></div><Badge active={item.isActive}>{item.isActive ? "Активний" : "Вимкнений"}</Badge></div><div className={styles.actions}><button className={styles.secondary} onClick={() => onToggle(item)}>{item.isActive ? "Вимкнути" : "Увімкнути"}</button></div></article>)}</div> : <div className={styles.empty}>Записів ще немає.</div>; }
