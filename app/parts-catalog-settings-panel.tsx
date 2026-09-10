"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./settings-operations-page.module.css";

type Part = { id: string; code: string; name: string; axis?: string | null; side?: string | null; position?: string | null; soldAs?: string; requiresVin?: boolean; reviewStatus?: string; aliases?: Array<{ aliasRaw: string }> };
type Kit = { id: string; code: string; name: string; items: Array<{ quantity: number; required: boolean; genericArticle: { code: string; name: string } }> };
type Data = { ok: boolean; parts: Part[]; kits: Kit[]; stats: { parts: number; pendingChanges: number; unrecognizedTerms: number }; error?: string };

export function PartsCatalogSettingsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", categoryCode: "", axis: "", side: "", position: "", soldAs: "PIECE", requiresVin: true });
  const load = useCallback(async () => {
    const response = await fetch(`/api/settings/parts-catalog?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const body = await response.json() as Data;
    if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося завантажити каталог");
    setData(body);
  }, [query]);
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Помилка завантаження")); }, [load]);
  async function post(action: string, extra: Record<string, unknown> = {}) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/settings/parts-catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const body = await response.json() as { ok?: boolean; error?: string; result?: { kits?: number } };
      if (!response.ok || !body.ok) throw new Error(body.error || "Операцію не виконано");
      setMessage(action === "SEED_REPAIR_KITS" ? `Комплекти синхронізовано: ${body.result?.kits || 0}.` : "Зміни збережено та відправлено на перевірку.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка збереження"); }
    finally { setSaving(false); }
  }
  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  return <div className={styles.page}>
    <header className={styles.header}><p>НАЛАШТУВАННЯ · ДОВІДНИК</p><h1>Каталог запчастин</h1><span>Канонічні деталі, синоніми, комплекти ремонту та контроль сумісності.</span></header>
    {message && <div className={styles.message}>{message}</div>}
    <div className={styles.stats}><Stat label="Деталей" value={data?.stats.parts || 0}/><Stat label="На перевірці" value={data?.stats.pendingChanges || 0}/><Stat label="Невідомих термінів" value={data?.stats.unrecognizedTerms || 0}/></div>
    <div className={styles.formBox}><h2 className={styles.sectionTitle}>Додати канонічну деталь</h2><div className={styles.formGrid}>
      <Field label="Код" value={form.code} onChange={(v) => update("code", v)}/><Field label="Назва" value={form.name} onChange={(v) => update("name", v)}/><Field label="Категорія" value={form.categoryCode} onChange={(v) => update("categoryCode", v)}/><Field label="Вісь" value={form.axis} onChange={(v) => update("axis", v)}/><Field label="Сторона" value={form.side} onChange={(v) => update("side", v)}/><Field label="Позиція" value={form.position} onChange={(v) => update("position", v)}/><label><span>Продаж</span><select value={form.soldAs} onChange={(e) => update("soldAs", e.target.value)}><option value="PIECE">Поштучно</option><option value="PAIR">Пара</option><option value="SET">Комплект</option><option value="KIT">Кіт</option><option value="ASSEMBLY">У зборі</option></select></label><label className={styles.check}><input type="checkbox" checked={form.requiresVin} onChange={(e) => update("requiresVin", e.target.checked)}/>Потрібна VIN-перевірка</label>
    </div><div className={styles.actions}><button disabled={saving || !form.code || !form.name} onClick={() => void post("UPSERT_PART", form)}>Створити на перевірку</button><button className={styles.secondary} disabled={saving} onClick={() => void post("SEED_REPAIR_KITS")}>Створити комплекти ремонту</button></div></div>
    <div className={styles.formBox}><label><span>Пошук по коду, назві або синоніму</span><input value={query} onChange={(e) => setQuery(e.target.value)}/></label></div>
    <h2 className={styles.sectionTitle}>Канонічні деталі</h2><div className={styles.cards}>{(data?.parts || []).map((part) => <article className={styles.card} key={part.id}><div className={styles.cardHead}><div><strong>{part.name}</strong><small>{part.code} · {[part.axis, part.side, part.position].filter(Boolean).join(" / ") || "позиція не задана"}</small></div><span className={styles.badge}>{part.reviewStatus || "DRAFT"}</span></div><small>{part.aliases?.map((alias) => alias.aliasRaw).join(", ") || "Синонімів ще немає"}</small></article>)}</div>
    <h2 className={styles.sectionTitle}>Комплекти ремонту</h2><div className={styles.cards}>{(data?.kits || []).map((kit) => <article className={styles.card} key={kit.id}><strong>{kit.name}</strong><small>{kit.code}</small><small>{kit.items.map((item) => `${item.genericArticle.name} × ${item.quantity}`).join(" · ")}</small></article>)}</div>
  </div>;
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)}/></label>; }
function Stat({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
