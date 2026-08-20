"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BinotelCallbacksSettings } from "./binotel-callbacks-settings";
import { VehicleGenerationCatalogPanel } from "./vehicle-generation-catalog-panel";
import { VehicleImageLibrarySettingsPanel } from "./vehicle-image-library-settings-panel";
import styles from "./integrations-settings-hub.module.css";

type Provider = "BINOTEL" | "TELEGRAM" | "META" | "TIKTOK" | "OLX" | "VEHICLE_IMAGES";
type IntegrationField = { key: string; label: string; secret: boolean; required?: boolean; placeholder?: string };
type IntegrationItem = {
  provider: string;
  category: string;
  title: string;
  description: string;
  fields: IntegrationField[];
  configured: boolean;
  configuredVia: string | null;
  status: string;
  masked: Record<string, string>;
  visible: Record<string, string>;
  lastTestAt?: string | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
};

type TestResult = { ok?: boolean; message?: string; error?: string; checkedAt?: string; latencyMs?: number };

const PROVIDERS: Provider[] = ["BINOTEL", "TELEGRAM", "META", "TIKTOK", "OLX", "VEHICLE_IMAGES"];

const COPY: Record<Provider, { title: string; description: string; mark: string }> = {
  BINOTEL: { title: "Binotel", description: "Телефонія, дзвінки, записи розмов і callbacks.", mark: "B" },
  TELEGRAM: { title: "Telegram", description: "Безкоштовний бот для двостороннього чату, статусів авто та клієнтського сервісу.", mark: "✈" },
  META: { title: "Facebook + Instagram", description: "Messenger, Instagram Direct та Meta Lead Ads.", mark: "M" },
  TIKTOK: { title: "TikTok", description: "TikTok Business, акаунт та lead/webhook інтеграція.", mark: "♪" },
  OLX: { title: "OLX", description: "Повідомлення, оголошення та звернення з OLX.", mark: "O" },
  VEHICLE_IMAGES: { title: "OpenAI", description: "Генерація та власна бібліотека зображень автомобілів.", mark: "AI" },
};

const EDITABLE_FIELDS: Record<Provider, string[]> = {
  BINOTEL: ["apiKey", "apiSecret", "companyId", "wsKey", "wsSecret"],
  TELEGRAM: ["botToken", "botUsername"],
  META: ["appId", "appSecret"],
  TIKTOK: ["clientKey", "clientSecret"],
  OLX: ["clientId", "clientSecret", "apiKey", "notificationSecret"],
  VEHICLE_IMAGES: ["apiKey", "model", "quality", "imageSize", "autoGenerate", "requireApproval", "reuseLibrary"],
};

const FIELD_LABELS: Record<string, string> = {
  apiKey: "API key",
  apiSecret: "API secret",
  companyId: "Company ID",
  wsKey: "WebSocket key",
  wsSecret: "WebSocket secret",
  botToken: "Bot token",
  botUsername: "Bot username",
  appId: "Meta App ID",
  appSecret: "Meta App Secret",
  clientKey: "TikTok Client Key",
  clientSecret: "Client Secret",
  clientId: "Client ID",
  notificationSecret: "Notification secret",
  model: "Модель зображень",
  quality: "Якість",
  imageSize: "Розмір",
  autoGenerate: "Автогенерація",
  requireApproval: "Підтвердження перед використанням",
  reuseLibrary: "Повторно використовувати бібліотеку",
};

function statusView(item: IntegrationItem | undefined) {
  const status = item?.status || "NOT_CONFIGURED";
  if (status === "CONNECTED") return { label: "Підключено", tone: "good" };
  if (status === "AUTHORIZATION_REQUIRED") return { label: "Потрібна авторизація", tone: "warn" };
  if (status === "TOKEN_EXPIRED") return { label: "Токен прострочено", tone: "error" };
  if (status === "DEGRADED") return { label: "Працює з обмеженнями", tone: "warn" };
  if (status === "ERROR") return { label: "Помилка", tone: "error" };
  if (status === "CONFIGURED" || item?.configured) return { label: "Налаштовано", tone: "configured" };
  return { label: "Не налаштовано", tone: "muted" };
}

function defaultValue(provider: Provider, key: string) {
  if (provider === "VEHICLE_IMAGES") {
    if (key === "model") return "gpt-image-2";
    if (key === "quality") return "medium";
    if (key === "imageSize") return "1536x1024";
    if (key === "autoGenerate" || key === "requireApproval" || key === "reuseLibrary") return "ON";
  }
  return "";
}

function humanDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
}

export function IntegrationsSettingsHub() {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Provider | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/integrations", { cache: "no-store" });
      const payload = await response.json() as { integrations?: IntegrationItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити інтеграції");
      setItems((payload.integrations || []).filter((item) => PROVIDERS.includes(item.provider as Provider)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("integration")?.toUpperCase();
    if (provider === "META" || provider === "TIKTOK" || provider === "OLX" || provider === "TELEGRAM") setActive(provider);
    const status = query.get("integrationStatus");
    const oauthMessage = query.get("integrationMessage");
    if (status === "connected") setMessage("Авторизацію завершено. Виконайте перевірку з’єднання.");
    if (status === "error") setMessage(oauthMessage || "Авторизація провайдера не завершена.");
  }, []);

  const activeItem = useMemo(() => items.find((item) => item.provider === active), [items, active]);

  function openProvider(provider: Provider) {
    const item = items.find((candidate) => candidate.provider === provider);
    const next: Record<string, string> = {};
    for (const key of EDITABLE_FIELDS[provider]) next[key] = item?.visible?.[key] || defaultValue(provider, key);
    setValues(next);
    setMessage("");
    setLibraryOpen(false);
    setActive(provider);
  }

  async function save() {
    if (!active) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/settings/integrations/${active}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; webhook?: { url?: string } | null };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося зберегти налаштування");
      setMessage(active === "TELEGRAM" ? "Telegram збережено, webhook встановлено автоматично." : "Налаштування збережено.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Помилка збереження"); }
    finally { setSaving(false); }
  }

  async function test() {
    if (!active) return;
    setTesting(true); setMessage("");
    try {
      const response = await fetch(`/api/settings/integrations/${active}/test`, { method: "POST" });
      const payload = await response.json() as TestResult;
      setMessage(payload.message || payload.error || (payload.ok ? "З’єднання працює." : "Перевірка не пройшла."));
      await load();
    } catch { setMessage("CRM не змогла перевірити інтеграцію."); }
    finally { setTesting(false); }
  }

  async function disconnect() {
    if (!active || !window.confirm(`Відключити ${COPY[active].title} та видалити збережені доступи з CRM?`)) return;
    const response = await fetch(`/api/settings/integrations/${active}`, { method: "DELETE" });
    if (!response.ok) { setMessage("Не вдалося відключити інтеграцію."); return; }
    setActive(null); setValues({}); setMessage(""); await load();
  }

  function oauth(provider: "META" | "TIKTOK" | "OLX") {
    window.location.assign(`/api/integrations/${provider.toLowerCase()}/connect`);
  }

  const webhookUrl = (provider: "TELEGRAM" | "META" | "TIKTOK" | "OLX") => {
    if (typeof window === "undefined") return "";
    return provider === "TELEGRAM"
      ? `${window.location.origin}/api/integrations/telegram/webhook`
      : `${window.location.origin}/api/webhooks/${provider.toLowerCase()}`;
  };

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Скопійовано.");
  }

  return <section className={styles.page}>
    <header className={styles.pageHeader}>
      <div className={styles.eyebrow}>НАЛАШТУВАННЯ</div>
      <h1>Інтеграції</h1>
      <p>Підключення зовнішніх сервісів. Натисніть сервіс, щоб відкрити його налаштування.</p>
    </header>

    {message && !active ? <div className={styles.notice}>{message}</div> : null}

    <div className={styles.cards} aria-busy={loading}>
      {PROVIDERS.map((provider) => {
        const item = items.find((candidate) => candidate.provider === provider);
        const status = statusView(item);
        return <button type="button" key={provider} className={styles.card} onClick={() => openProvider(provider)}>
          <span className={styles.brand}>{COPY[provider].mark}</span>
          <span className={styles.cardText}><strong>{COPY[provider].title}</strong><small>{COPY[provider].description}</small></span>
          <span className={`${styles.status} ${styles[status.tone]}`}>{loading ? "…" : status.label}</span>
          <span className={styles.arrow}>›</span>
        </button>;
      })}
    </div>

    {active ? <div className={styles.backdrop} onMouseDown={() => setActive(null)}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Налаштування ${COPY[active].title}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerTitle}><span className={styles.brand}>{COPY[active].mark}</span><div><span>ІНТЕГРАЦІЯ</span><h2>{COPY[active].title}</h2><p>{COPY[active].description}</p></div></div>
          <button className={styles.close} type="button" onClick={() => setActive(null)} aria-label="Закрити">×</button>
        </div>

        <div className={styles.drawerBody}>
          <section className={styles.section}>
            <div className={styles.sectionHead}><div><h3>Підключення</h3><p>Секретні значення зберігаються на сервері та не повертаються у відкритому вигляді.</p></div>{activeItem ? <span className={`${styles.status} ${styles[statusView(activeItem).tone]}`}>{statusView(activeItem).label}</span> : null}</div>
            <div className={styles.formGrid}>{EDITABLE_FIELDS[active].map((key) => {
              const field = activeItem?.fields.find((candidate) => candidate.key === key);
              const secret = field?.secret ?? /secret|token|apiKey|apiSecret|wsKey|wsSecret/i.test(key);
              const masked = activeItem?.masked?.[key];
              const select = active === "VEHICLE_IMAGES" && ["model", "quality", "imageSize", "autoGenerate", "requireApproval", "reuseLibrary"].includes(key);
              return <label key={key} className={key === "apiKey" && active === "VEHICLE_IMAGES" ? styles.wide : undefined}><span>{FIELD_LABELS[key] || field?.label || key}</span>{select ? <select value={values[key] || defaultValue(active, key)} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>
                {key === "model" && <><option value="gpt-image-2">gpt-image-2</option></>}
                {key === "quality" && <><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="auto">auto</option></>}
                {key === "imageSize" && <><option value="1536x1024">1536×1024</option><option value="1024x1024">1024×1024</option><option value="1024x1536">1024×1536</option></>}
                {["autoGenerate", "requireApproval", "reuseLibrary"].includes(key) && <><option value="ON">ON</option><option value="OFF">OFF</option></>}
              </select> : <input type={secret ? "password" : "text"} value={values[key] || ""} placeholder={secret ? (masked || field?.placeholder || "Залиште порожнім, щоб не змінювати") : field?.placeholder} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}/>}</label>;
            })}</div>
            {active === "VEHICLE_IMAGES" ? <div className={styles.fixedFacts}><span>Формат: <b>PNG</b></span><span>Фон: <b>прозорий</b></span><span>Master prompt: <b>керується CRM</b></span></div> : null}
            <div className={styles.rowActions}><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Збереження…" : "Зберегти"}</button><button type="button" className={styles.secondary} onClick={() => void test()} disabled={testing || !activeItem?.configured}>{testing ? "Перевіряємо…" : "Перевірити"}</button></div>
          </section>

          {(active === "META" || active === "TIKTOK" || active === "OLX") ? <section className={styles.section}>
            <h3>Авторизація акаунта</h3>
            <p className={styles.help}>Спочатку збережіть App/Client credentials вище, потім авторизуйте бізнес-акаунт. Access та refresh tokens CRM отримає і збереже сама.</p>
            <button type="button" className={styles.oauthButton} disabled={!activeItem?.configured} onClick={() => oauth(active)}>{activeItem?.status === "CONNECTED" ? "Перепідключити акаунт" : `Підключити ${COPY[active].title}`}</button>
            {activeItem?.visible?.externalAccountName || activeItem?.visible?.pageName ? <div className={styles.accountBox}><b>{activeItem.visible.externalAccountName || activeItem.visible.pageName}</b><span>{activeItem.visible.externalAccountId || activeItem.visible.pageId || activeItem.visible.openId || ""}</span></div> : null}
            {active === "TIKTOK" ? <div className={styles.warning}>OAuth підключає TikTok account. Lead Generation через TikTok Business/Marketing API працюватиме після надання відповідних дозволів вашому TikTok Business app.</div> : null}
          </section> : null}

          {(active === "TELEGRAM" || active === "META" || active === "TIKTOK" || active === "OLX") ? <section className={styles.section}>
            <h3>Webhook</h3>
            <p className={styles.help}>{active === "TELEGRAM" ? "Webhook встановлюється автоматично після збереження Bot token." : "Production URL створюється CRM. Додайте його в кабінеті провайдера."}</p>
            <div className={styles.copyField}><code>{webhookUrl(active)}</code><button type="button" className={styles.secondary} onClick={() => void copy(webhookUrl(active))}>Копіювати</button></div>
            {active === "TELEGRAM" ? <div className={styles.metaList}><span>Telegram Bot API: без платного посередника</span><span>Захист: X-Telegram-Bot-Api-Secret-Token</span></div> : null}
            {active === "META" ? <div className={styles.metaList}><span>Перевірка: verify token зберігається в CRM</span><span>Підпис: X-Hub-Signature-256</span></div> : null}
            {active === "TIKTOK" ? <div className={styles.metaList}><span>Підпис: TikTok-Signature / HMAC-SHA256</span><span>Захист від повторної доставки: event id + timestamp</span></div> : null}
            {active === "OLX" ? <div className={styles.metaList}><span>Підпис: x-signature / HMAC-SHA1</span><span>Ідентифікатор дубля: transaction_id</span></div> : null}
          </section> : null}

          {active === "BINOTEL" ? <section className={styles.section}><h3>Callbacks та синхронізація</h3><BinotelCallbacksSettings/></section> : null}

          {active === "VEHICLE_IMAGES" ? <section className={styles.section}>
            <VehicleGenerationCatalogPanel/>
          </section> : null}

          {active === "VEHICLE_IMAGES" ? <section className={styles.section}>
            <div className={styles.sectionHead}><div><h3>Бібліотека зображень авто</h3><p>Перегляд, затвердження, перегенерація та ручна заміна.</p></div><button type="button" className={styles.secondary} onClick={() => setLibraryOpen((value) => !value)}>{libraryOpen ? "Сховати" : "Відкрити бібліотеку"}</button></div>
            {libraryOpen ? <div className={styles.library}><VehicleImageLibrarySettingsPanel/></div> : null}
          </section> : null}

          <section className={styles.section}>
            <h3>Діагностика</h3>
            <div className={styles.diagnostics}><span>Остання перевірка <b>{humanDate(activeItem?.lastTestAt)}</b></span><span>Результат <b>{activeItem?.lastTestMessage || "Ще не перевірялась"}</b></span></div>
          </section>

          {message ? <div className={styles.notice}>{message}</div> : null}
          {activeItem?.configured ? <button type="button" className={styles.disconnect} onClick={() => void disconnect()}>Відключити інтеграцію</button> : null}
        </div>
      </aside>
    </div> : null}
  </section>;
}