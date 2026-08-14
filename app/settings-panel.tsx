"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ThemeMode = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";
type SettingsTab = "appearance" | "integrations";
type IntegrationCategory = "COMMUNICATIONS" | "SUPPLIERS";
type Provider = "BINOTEL" | "META" | "TIKTOK" | "OLX" | "BM_PARTS" | "UNIQUE_TRADE" | "AUTONOVA_D";

type IntegrationField = {
  key: string;
  label: string;
  secret: boolean;
  required?: boolean;
  placeholder?: string;
};

type IntegrationItem = {
  provider: Provider;
  category: IntegrationCategory;
  title: string;
  description: string;
  fields: IntegrationField[];
  configured: boolean;
  configuredVia: "CRM" | "ENV" | null;
  status: string;
  masked: Record<string, string>;
  visible: Record<string, string>;
  lastTestAt?: string | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
};

type TestResult = { ok: boolean; message?: string; error?: string; latencyMs?: number; checkedAt?: string };

const categoryCopy: Record<IntegrationCategory, { label: string; description: string }> = {
  COMMUNICATIONS: { label: "Комунікації", description: "Телефонія, соцмережі, месенджери та lead forms" },
  SUPPLIERS: { label: "Постачальники", description: "API запчастин, закупівельні ціни та залишки" },
};

const providerMarks: Record<Provider, string> = {
  BINOTEL: "☎",
  META: "M",
  TIKTOK: "♪",
  OLX: "O",
  BM_PARTS: "BM",
  UNIQUE_TRADE: "UT",
  AUTONOVA_D: "AD",
};

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
}

function statusBadge(item: IntegrationItem) {
  if (item.status === "CONNECTED") return { text: "Підключено", tone: "good" };
  if (item.status === "ERROR") return { text: "Помилка", tone: "error" };
  if (item.configured) return { text: "Налаштовано", tone: "configured" };
  return { text: "Не налаштовано", tone: "muted" };
}

export function SettingsPanel() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [category, setCategory] = useState<IntegrationCategory>("COMMUNICATIONS");
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [tests, setTests] = useState<Partial<Record<Provider, TestResult>>>({});
  const [oneTime, setOneTime] = useState<{ title: string; value: string } | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setMounted(true);
    const saved = window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null;
    const legacy = window.localStorage.getItem("turbolev-theme") as "light" | "dark" | null;
    const initial: ThemeMode = saved ?? legacy ?? "auto";
    setMode(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      const current = (window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null) ?? initial;
      if (current === "auto") applyTheme("auto");
    };
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    if (open && tab === "integrations" && !integrations.length && !loading) void loadIntegrations();
  }, [open, tab]);

  const visibleIntegrations = useMemo(
    () => integrations.filter((item) => item.category === category),
    [integrations, category],
  );

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function selectMode(next: ThemeMode) {
    setMode(next);
    window.localStorage.setItem("turbolev-theme-mode", next);
    window.localStorage.removeItem("turbolev-theme");
    applyTheme(next);
  }

  async function loadIntegrations() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/integrations", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; integrations?: IntegrationItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Помилка завантаження");
      setIntegrations(Array.isArray(data.integrations) ? data.integrations : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося завантажити інтеграції");
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }

  function startEdit(item: IntegrationItem) {
    setEditing(item.provider);
    setValues({ ...item.visible });
    setOneTime(null);
  }

  async function save(item: IntegrationItem) {
    setSaving(item.provider);
    setOneTime(null);
    try {
      const response = await fetch(`/api/settings/integrations/${item.provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; generated?: Record<string, string> };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти доступи");

      if (item.provider === "BINOTEL" && data.generated?.webhookToken) {
        const url = `${window.location.origin}/api/telephony/binotel-webhook?token=${encodeURIComponent(data.generated.webhookToken)}`;
        setOneTime({ title: "Webhook URL Binotel — скопіюй зараз", value: url });
      } else if (item.provider === "META" && data.generated?.verifyToken) {
        setOneTime({ title: "Meta verify token — скопіюй зараз", value: data.generated.verifyToken });
      }

      notify(`${item.title}: доступи збережено`);
      setEditing(null);
      setValues({});
      await loadIntegrations();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка збереження");
    } finally {
      setSaving(null);
    }
  }

  async function test(item: IntegrationItem) {
    setTesting(item.provider);
    try {
      const response = await fetch(`/api/settings/integrations/${item.provider}/test`, { method: "POST" });
      const data = await response.json() as TestResult;
      setTests((current) => ({ ...current, [item.provider]: data }));
      notify(data.message || data.error || (data.ok ? "З'єднання працює" : "Перевірка не пройшла"));
      await loadIntegrations();
    } catch {
      setTests((current) => ({ ...current, [item.provider]: { ok: false, message: "CRM не змогла виконати перевірку." } }));
    } finally {
      setTesting(null);
    }
  }

  async function disconnect(item: IntegrationItem) {
    if (!window.confirm(`Видалити збережені в CRM доступи ${item.title}?`)) return;
    try {
      const response = await fetch(`/api/settings/integrations/${item.provider}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Не вдалося видалити доступи");
      setEditing(null);
      setValues({});
      notify(`${item.title}: доступи видалено`);
      await loadIntegrations();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка");
    }
  }

  async function copyOneTime() {
    if (!oneTime) return;
    try {
      await navigator.clipboard.writeText(oneTime.value);
      notify("Скопійовано");
    } catch {
      notify("Не вдалося скопіювати автоматично");
    }
  }

  const modal = open ? (
    <div className="settingsBackdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      {toast ? <div className="settingsToast">{toast}</div> : null}
      <section className="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settingsHeader">
          <div><p className="eyebrow">СИСТЕМА</p><h2 id="settingsTitle">Налаштування</h2></div>
          <button className="settingsClose" type="button" aria-label="Закрити налаштування" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className="settingsLayout">
          <aside className="settingsTabs" aria-label="Розділи налаштувань">
            <button className={tab === "appearance" ? "settingsTab settingsTabActive" : "settingsTab"} type="button" onClick={() => setTab("appearance")}>
              <span>◐</span><span><strong>Оформлення</strong><small>Тема CRM</small></span>
            </button>
            <button className={tab === "integrations" ? "settingsTab settingsTabActive" : "settingsTab"} type="button" onClick={() => setTab("integrations")}>
              <span>⌘</span><span><strong>Інтеграції</strong><small>Комунікації та постачальники</small></span>
            </button>
          </aside>

          <div className="settingsContent">
            {tab === "appearance" ? (
              <div className="settingsSection settingsSectionFlush">
                <div className="settingsSectionCopy"><strong>Оформлення</strong><span>Вибери тему CRM. Автоматична тема повторює налаштування Windows або браузера.</span></div>
                <div className="themeOptions" role="radiogroup" aria-label="Тема CRM">
                  <button className={mode === "light" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "light"} onClick={() => selectMode("light")}><span className="themePreview themePreviewLight" aria-hidden="true" /><span><strong>Світла</strong><small>Завжди світлий інтерфейс</small></span></button>
                  <button className={mode === "dark" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "dark"} onClick={() => selectMode("dark")}><span className="themePreview themePreviewDark" aria-hidden="true" /><span><strong>Темна</strong><small>Завжди темний інтерфейс</small></span></button>
                  <button className={mode === "auto" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "auto"} onClick={() => selectMode("auto")}><span className="themePreview themePreviewAuto" aria-hidden="true" /><span><strong>Автоматична</strong><small>Як у системі</small></span></button>
                </div>
              </div>
            ) : (
              <div className="settingsSection settingsSectionFlush integrationSettings">
                <div className="settingsSectionCopy integrationSettingsHead">
                  <div><strong>Інтеграції</strong><span>Доступи вводяться тут і зберігаються на сервері в зашифрованому вигляді. Після збереження CRM не повертає секретні значення назад у браузер.</span></div>
                  <button className="supplierRefresh" type="button" onClick={() => void loadIntegrations()} disabled={loading}>{loading ? "Оновлення…" : "Оновити"}</button>
                </div>

                <div className="integrationCategoryTabs">
                  {(Object.keys(categoryCopy) as IntegrationCategory[]).map((key) => <button key={key} type="button" className={category === key ? "active" : ""} onClick={() => { setCategory(key); setEditing(null); setOneTime(null); }}><strong>{categoryCopy[key].label}</strong><span>{categoryCopy[key].description}</span></button>)}
                </div>

                {oneTime ? <div className="integrationOneTime"><div><strong>{oneTime.title}</strong><span>Це значення показується лише після генерації. Збережи його у кабінеті відповідного сервісу.</span><code>{oneTime.value}</code></div><button type="button" onClick={() => void copyOneTime()}>Копіювати</button></div> : null}

                {loading && !integrations.length ? <div className="supplierEmpty">Завантажую інтеграції…</div> : null}

                <div className="integrationSettingsList">
                  {visibleIntegrations.map((item) => {
                    const badge = statusBadge(item);
                    const check = tests[item.provider];
                    const isEditing = editing === item.provider;
                    return <article className="integrationSettingsCard" key={item.provider}>
                      <div className="integrationSettingsTop">
                        <div className="integrationSettingsIdentity"><span className="integrationSettingsMark">{providerMarks[item.provider]}</span><div><strong>{item.title}</strong><span>{item.description}</span></div></div>
                        <div className="integrationSettingsBadges"><span className={`supplierStatus supplierStatus-${badge.tone}`}>{badge.text}</span>{item.configuredVia ? <span className="integrationSource">{item.configuredVia === "CRM" ? "CRM" : "legacy ENV"}</span> : null}</div>
                      </div>

                      {Object.keys(item.masked).length || Object.keys(item.visible).length ? <div className="integrationCredentialSummary">
                        {item.fields.filter((field) => item.masked[field.key] || item.visible[field.key]).map((field) => <div key={field.key}><small>{field.label}</small><code>{field.secret ? item.masked[field.key] : item.visible[field.key]}</code></div>)}
                      </div> : null}

                      {isEditing ? <div className="integrationEditor">
                        <div className="integrationFields">{item.fields.map((field) => <label key={field.key}><span>{field.label}{field.required ? <b>*</b> : null}</span><input type={field.secret ? "password" : "text"} autoComplete="off" value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.secret && item.configured ? `Збережено: ${item.masked[field.key] || "••••••"} — залиш порожнім, щоб не змінювати` : field.placeholder || ""} /></label>)}</div>
                        <div className="integrationEditorActions"><button className="integrationSave" type="button" disabled={saving === item.provider} onClick={() => void save(item)}>{saving === item.provider ? "Зберігаю…" : item.configuredVia === "ENV" ? "Перенести в CRM" : "Зберегти"}</button><button type="button" onClick={() => { setEditing(null); setValues({}); }}>Скасувати</button></div>
                      </div> : null}

                      {check || item.lastTestMessage ? <div className={(check?.ok ?? item.lastTestStatus === "CONNECTED") ? "supplierCheck supplierCheckOk" : "supplierCheck"}><strong>{check?.message || item.lastTestMessage}</strong>{typeof check?.latencyMs === "number" ? <span>{check.latencyMs} мс</span> : null}</div> : null}

                      <div className="integrationSettingsActions">
                        <button type="button" onClick={() => isEditing ? setEditing(null) : startEdit(item)}>{isEditing ? "Закрити" : item.configured ? "Змінити доступи" : "Налаштувати"}</button>
                        <button type="button" disabled={!item.configured || testing === item.provider} onClick={() => void test(item)}>{testing === item.provider ? "Перевіряю…" : "Перевірити з'єднання"}</button>
                        {item.configuredVia === "CRM" ? <button className="danger" type="button" onClick={() => void disconnect(item)}>Відключити</button> : null}
                      </div>
                    </article>;
                  })}
                </div>

                <div className="supplierSecurityNote"><strong>Безпека доступів</strong><span>API-ключі та паролі шифруються сервером перед записом у Neon. У GitHub секретів немає. У відповідях CRM секретні поля повертаються лише як маска. До появи ролей доступ до цього розділу має бути тільки у власника/адміністратора CRM.</span></div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  ) : null;

  return <><button className="settingsNavButton" type="button" onClick={() => setOpen(true)}><span className="navDot" />Налаштування</button>{mounted && modal ? createPortal(modal, document.body) : null}</>;
}
