"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./camera-settings.module.css";

type CameraPurpose = "ENTRY" | "EXIT" | "TERRITORY" | "SERVICE_POST";
type CameraStatus = "NOT_TESTED" | "CONNECTED" | "ERROR" | "DISABLED";
type CameraConnectionMode = "EMAIL_EVENTS" | "UID_P2P" | "LOCAL";
type CameraRow = {
  id: string;
  name: string;
  provider: "REOLINK";
  maskedUid: string;
  username: string;
  purpose: CameraPurpose;
  connectionMode: CameraConnectionMode;
  status: CameraStatus;
  model: string | null;
  lastSeenAt: string | null;
  lastTestAt: string | null;
  lastTestMessage: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type CameraForm = {
  name: string;
  uid: string;
  username: string;
  password: string;
  purpose: CameraPurpose;
  connectionMode: CameraConnectionMode;
};

type CameraTestResponse = {
  ok?: boolean;
  pending?: boolean;
  message?: string;
  error?: string;
  snapshotDataUrl?: string | null;
};

type EmailSetup = {
  cameraName: string;
  cameraUid: string;
  ingestToken: string;
  crmBaseUrl: string;
};

const EMPTY_FORM: CameraForm = {
  name: "В'їзд",
  uid: "",
  username: "admin",
  password: "",
  purpose: "ENTRY",
  connectionMode: "EMAIL_EVENTS",
};

const PURPOSE_LABEL: Record<CameraPurpose, string> = {
  ENTRY: "В'їзд",
  EXIT: "Виїзд",
  TERRITORY: "Територія",
  SERVICE_POST: "Робочий пост",
};

const CONNECTION_LABEL: Record<CameraConnectionMode, string> = {
  EMAIL_EVENTS: "Email Events",
  UID_P2P: "UID / P2P",
  LOCAL: "Local",
};

function statusCopy(status: CameraStatus) {
  if (status === "CONNECTED") return { label: "Події надходять", className: styles.connected };
  if (status === "ERROR") return { label: "Помилка", className: styles.error };
  if (status === "DISABLED") return { label: "Вимкнено", className: "" };
  return { label: "Очікуємо першу подію", className: styles.pending };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function buildAppsScript(setup: EmailSetup) {
  const baseUrl = JSON.stringify(setup.crmBaseUrl.replace(/\/$/, ""));
  const uid = JSON.stringify(setup.cameraUid.trim().toUpperCase());
  const token = JSON.stringify(setup.ingestToken);
  return `const TURBOLEV_REOLINK = Object.freeze({
  CRM_BASE_URL: ${baseUrl},
  CAMERA_UID: ${uid},
  INGEST_TOKEN: ${token},
  MAX_MESSAGES_PER_RUN: 40,
  MAX_PROCESSED_IDS: 250,
});

function setupTurboLevReolink() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.filter(function(t) { return t.getHandlerFunction() === "syncReolinkAlerts"; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("syncReolinkAlerts").timeBased().everyMinutes(1).create();
  var email = Session.getEffectiveUser().getEmail();
  Logger.log("Вкажіть у Reolink як отримувача Email Alert: " + reolinkAlias_(email));
}

function syncReolinkAlerts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return;
  try {
    var alias = reolinkAlias_(Session.getEffectiveUser().getEmail());
    var query = "to:" + alias + " has:attachment newer_than:2d -in:trash -in:spam";
    var threads = GmailApp.search(query, 0, TURBOLEV_REOLINK.MAX_MESSAGES_PER_RUN);
    var processed = loadProcessedIds_();
    var messages = [];
    threads.forEach(function(thread) {
      thread.getMessages().forEach(function(message) { messages.push(message); });
    });
    messages.sort(function(a, b) { return a.getDate().getTime() - b.getDate().getTime(); });

    messages.forEach(function(message) {
      var messageId = message.getId();
      if (processed.indexOf(messageId) >= 0) return;
      var attachment = firstImageAttachment_(message);
      if (!attachment) { rememberProcessed_(processed, messageId); return; }
      var bytes = attachment.getBytes();
      if (!bytes || !bytes.length) { rememberProcessed_(processed, messageId); return; }

      var payload = {
        cameraUid: TURBOLEV_REOLINK.CAMERA_UID,
        token: TURBOLEV_REOLINK.INGEST_TOKEN,
        gmailMessageId: messageId,
        subject: message.getSubject() || "",
        from: message.getFrom() || "",
        to: message.getTo() || "",
        receivedAt: message.getDate().toISOString(),
        attachmentName: attachment.getName() || "reolink.jpg",
        attachmentContentType: attachment.getContentType() || "image/jpeg",
        attachmentBase64: Utilities.base64Encode(bytes),
      };

      var response = UrlFetchApp.fetch(TURBOLEV_REOLINK.CRM_BASE_URL + "/api/camera-events/email", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      var status = response.getResponseCode();
      if (status >= 200 && status < 300) rememberProcessed_(processed, messageId);
      else console.error("Turbo LEV ingest HTTP " + status + ": " + response.getContentText().slice(0, 500));
    });
    saveProcessedIds_(processed);
  } finally {
    lock.releaseLock();
  }
}

function testTurboLevReolinkBridge() { syncReolinkAlerts(); }

function firstImageAttachment_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  for (var i = 0; i < attachments.length; i++) {
    var type = (attachments[i].getContentType() || "").toLowerCase();
    var name = (attachments[i].getName() || "").toLowerCase();
    if (type.indexOf("image/") === 0 || /\\.(jpe?g|png|webp)$/i.test(name)) return attachments[i];
  }
  return null;
}

function reolinkAlias_(email) {
  var at = email.lastIndexOf("@");
  if (at < 1) throw new Error("Google account email is unavailable");
  return email.slice(0, at) + "+reolink" + email.slice(at);
}

function loadProcessedIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty("TURBOLEV_REOLINK_PROCESSED_IDS");
  if (!raw) return [];
  try { var values = JSON.parse(raw); return Array.isArray(values) ? values : []; }
  catch (e) { return []; }
}

function rememberProcessed_(values, messageId) {
  values.push(messageId);
  while (values.length > TURBOLEV_REOLINK.MAX_PROCESSED_IDS) values.shift();
}

function saveProcessedIds_(values) {
  PropertiesService.getScriptProperties().setProperty(
    "TURBOLEV_REOLINK_PROCESSED_IDS",
    JSON.stringify(values.slice(-TURBOLEV_REOLINK.MAX_PROCESSED_IDS))
  );
}`;
}

export function CameraSettingsPanel() {
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CameraForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [setup, setSetup] = useState<EmailSetup | null>(null);
  const [toast, setToast] = useState("");

  const connected = useMemo(() => cameras.filter((camera) => camera.status === "CONNECTED" && camera.isActive).length, [cameras]);
  const active = useMemo(() => cameras.filter((camera) => camera.isActive).length, [cameras]);

  useEffect(() => { void load(); }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function copy(text: string, message = "Скопійовано") {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify("Не вдалося скопіювати автоматично.");
    }
  }

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/cameras", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; cameras?: CameraRow[]; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити камери");
      setCameras(Array.isArray(data.cameras) ? data.cameras : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка завантаження камер");
    } finally {
      setLoading(false);
    }
  }

  async function addCamera() {
    setSaving(true);
    const submitted = { ...form };
    try {
      const response = await fetch("/api/settings/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json() as { ok?: boolean; error?: string; ingestToken?: string | null };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося додати камеру");
      if (submitted.connectionMode === "EMAIL_EVENTS" && data.ingestToken) {
        setSetup({
          cameraName: submitted.name,
          cameraUid: submitted.uid,
          ingestToken: data.ingestToken,
          crmBaseUrl: window.location.origin,
        });
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      notify(submitted.connectionMode === "EMAIL_EVENTS" ? "Камеру додано. Залишилось активувати Gmail-міст." : "Камеру додано.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка додавання камери");
    } finally {
      setSaving(false);
    }
  }

  async function regenerateSetup(camera: CameraRow) {
    setTestingId(camera.id);
    try {
      const response = await fetch(`/api/settings/cameras/${camera.id}/rotate-ingest-token`, { method: "POST" });
      const data = await response.json() as { ok?: boolean; error?: string; cameraUid?: string; ingestToken?: string };
      if (!response.ok || !data.ok || !data.cameraUid || !data.ingestToken) throw new Error(data.error || "Не вдалося створити новий ключ");
      setSetup({ cameraName: camera.name, cameraUid: data.cameraUid, ingestToken: data.ingestToken, crmBaseUrl: window.location.origin });
      notify("Новий ключ створено. Старий ключ уже недійсний.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка створення ключа");
    } finally {
      setTestingId(null);
    }
  }

  async function testCamera(camera: CameraRow) {
    setTestingId(camera.id);
    try {
      const response = await fetch(`/api/settings/cameras/${camera.id}/test`, { method: "POST" });
      const data = await response.json() as CameraTestResponse;
      notify(data.message || data.error || (data.ok ? "Камера відповідає" : "Перевірка не пройдена"));
      await load();
    } catch {
      notify("CRM не змогла виконати перевірку камери.");
    } finally {
      setTestingId(null);
    }
  }

  async function toggleCamera(camera: CameraRow) {
    try {
      const response = await fetch(`/api/settings/cameras/${camera.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !camera.isActive }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося змінити статус");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка");
    }
  }

  async function removeCamera(camera: CameraRow) {
    if (!window.confirm(`Видалити камеру «${camera.name}» з CRM?`)) return;
    try {
      const response = await fetch(`/api/settings/cameras/${camera.id}`, { method: "DELETE" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося видалити камеру");
      notify("Камеру видалено.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка видалення");
    }
  }

  const setupScript = setup ? buildAppsScript(setup) : "";

  return <div className={styles.page}>
    {toast ? <div className={styles.toast}>{toast}</div> : null}
    <div className={styles.header}>
      <div className={styles.headerCopy}>
        <h2>Камери відеоспостереження</h2>
        <p>Рекомендований режим — Email Events: Reolink надсилає фото в існуючий Gmail, а безкоштовний Apps Script передає подію в CRM. Окремий сервер не потрібен.</p>
      </div>
      <button className={styles.primary} type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Закрити" : "+ Додати камеру"}</button>
    </div>

    <div className={styles.summary}>
      <article><span>Усього камер</span><strong>{cameras.length}</strong></article>
      <article><span>Активні</span><strong>{active}</strong></article>
      <article><span>Події надходять</span><strong>{connected}</strong></article>
    </div>

    {setup ? <section className={styles.setupCard}>
      <div className={styles.formTitle}><div><strong>Gmail-міст для «{setup.cameraName}»</strong><span>Ключ показується лише для налаштування. Не публікуй цей код.</span></div><button className={styles.secondary} type="button" onClick={() => setSetup(null)}>Закрити</button></div>
      <ol className={styles.steps}>
        <li>Відкрий Google Apps Script у своєму поточному Google-акаунті та створи порожній проєкт.</li>
        <li>Видали стандартний код, встав скрипт нижче та запусти <code>setupTurboLevReolink</code> один раз. Google попросить дозвіл на Gmail і HTTP-запити.</li>
        <li>У журналі виконання скрипт покаже адресу з <code>+reolink</code>. Саме її вкажи в Reolink → Email Alerts → Recipient, Attachment = Picture, Smart Detection = Vehicle.</li>
      </ol>
      <div className={styles.scriptHead}><strong>Готовий Apps Script</strong><button className={styles.primary} type="button" onClick={() => void copy(setupScript, "Apps Script скопійовано")}>Скопіювати весь код</button></div>
      <textarea className={styles.scriptBox} readOnly value={setupScript} rows={12} onFocus={(event) => event.currentTarget.select()} />
    </section> : null}

    {showForm ? <section className={styles.formCard}>
      <div className={styles.formTitle}><div><strong>Додати Reolink</strong><span>Email Events працює без сервера та без нового акаунта.</span></div></div>
      <div className={styles.formGrid}>
        <label><span>Назва</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="В'їзд" /></label>
        <label><span>Призначення</span><select value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value as CameraPurpose }))}><option value="ENTRY">В'їзд</option><option value="EXIT">Виїзд</option><option value="TERRITORY">Територія</option><option value="SERVICE_POST">Робочий пост</option></select></label>
        <label><span>Спосіб підключення</span><select value={form.connectionMode} onChange={(event) => setForm((current) => ({ ...current, connectionMode: event.target.value as CameraConnectionMode }))}><option value="EMAIL_EVENTS">Email Events — рекомендовано, без сервера</option><option value="UID_P2P">UID / P2P Bridge — розширений</option></select></label>
        <label><span>Reolink UID</span><input autoCapitalize="characters" value={form.uid} onChange={(event) => setForm((current) => ({ ...current, uid: event.target.value.toUpperCase() }))} placeholder="UID камери" /></label>
        {form.connectionMode === "UID_P2P" ? <><label><span>Логін камери</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin" /></label><label><span>Пароль камери (якщо встановлений)</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Можна залишити порожнім" /></label></> : null}
        <p className={styles.hint}>{form.connectionMode === "EMAIL_EVENTS" ? "CRM створить окремий секретний ключ цієї камери. Gmail-пароль, Reolink-пароль і Google OAuth-ключі CRM не потрібні." : "UID і пароль не повертаються в інтерфейс після збереження; пароль зберігається зашифрованим."}</p>
      </div>
      <div className={styles.formActions}><button className={styles.secondary} type="button" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Скасувати</button><button className={styles.primary} type="button" disabled={saving} onClick={() => void addCamera()}>{saving ? "Зберігаю…" : "Зберегти камеру"}</button></div>
    </section> : null}

    {loading ? <div className={styles.empty}>Завантажую камери…</div> : cameras.length === 0 ? <div className={styles.empty}><strong>Камер ще немає</strong>Додай першу Reolink за UID.</div> : <div className={styles.list}>
      {cameras.map((camera) => {
        const status = statusCopy(camera.status);
        return <article className={styles.card} key={camera.id}>
          <div className={styles.cardTop}>
            <div className={styles.identity}><span className={styles.mark}>R</span><div><strong>{camera.name}</strong><span>{camera.model || "Reolink"} · {PURPOSE_LABEL[camera.purpose]}</span></div></div>
            <div className={styles.badges}><span className={`${styles.badge} ${status.className}`}>{status.label}</span><span className={styles.badge}>{CONNECTION_LABEL[camera.connectionMode]}</span></div>
          </div>
          <div className={styles.details}>
            <div><small>UID</small><code>{camera.maskedUid}</code></div>
            <div><small>Канал</small><strong>{CONNECTION_LABEL[camera.connectionMode]}</strong></div>
            <div><small>Остання подія / тест</small><strong>{formatDate(camera.lastTestAt)}</strong></div>
            <div><small>Останній зв'язок</small><strong>{formatDate(camera.lastSeenAt)}</strong></div>
          </div>
          {camera.lastTestMessage ? <p className={styles.message}>{camera.lastTestMessage}</p> : null}
          <div className={styles.actions}>
            {camera.connectionMode === "EMAIL_EVENTS" ? <button className={styles.small} type="button" disabled={!camera.isActive || testingId === camera.id} onClick={() => void regenerateSetup(camera)}>{testingId === camera.id ? "Створюю…" : "Apps Script / новий ключ"}</button> : <button className={styles.small} type="button" disabled={!camera.isActive || testingId === camera.id} onClick={() => void testCamera(camera)}>{testingId === camera.id ? "Підключаюсь…" : "Перевірити підключення"}</button>}
            <button className={styles.small} type="button" onClick={() => void toggleCamera(camera)}>{camera.isActive ? "Вимкнути" : "Увімкнути"}</button>
            <button className={styles.danger} type="button" onClick={() => void removeCamera(camera)}>Видалити</button>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}
