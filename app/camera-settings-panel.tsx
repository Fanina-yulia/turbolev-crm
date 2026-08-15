"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./camera-settings.module.css";

type CameraPurpose = "ENTRY" | "EXIT" | "TERRITORY" | "SERVICE_POST";
type CameraStatus = "NOT_TESTED" | "CONNECTED" | "ERROR" | "DISABLED";
type CameraRow = {
  id: string;
  name: string;
  provider: "REOLINK";
  maskedUid: string;
  username: string;
  purpose: CameraPurpose;
  connectionMode: "UID_P2P" | "LOCAL";
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
};

type CameraTestResponse = {
  ok?: boolean;
  pending?: boolean;
  message?: string;
  error?: string;
  snapshotDataUrl?: string | null;
};

const EMPTY_FORM: CameraForm = {
  name: "В'їзд",
  uid: "",
  username: "admin",
  password: "",
  purpose: "ENTRY",
};

const PURPOSE_LABEL: Record<CameraPurpose, string> = {
  ENTRY: "В'їзд",
  EXIT: "Виїзд",
  TERRITORY: "Територія",
  SERVICE_POST: "Робочий пост",
};

function statusCopy(status: CameraStatus) {
  if (status === "CONNECTED") return { label: "Підключено", className: styles.connected };
  if (status === "ERROR") return { label: "Помилка", className: styles.error };
  if (status === "DISABLED") return { label: "Вимкнено", className: "" };
  return { label: "Не перевірено", className: styles.pending };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function CameraSettingsPanel() {
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CameraForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");

  const connected = useMemo(() => cameras.filter((camera) => camera.status === "CONNECTED" && camera.isActive).length, [cameras]);
  const active = useMemo(() => cameras.filter((camera) => camera.isActive).length, [cameras]);

  useEffect(() => { void load(); }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
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
    try {
      const response = await fetch("/api/settings/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося додати камеру");
      setForm(EMPTY_FORM);
      setShowForm(false);
      notify("Камеру додано. Тепер можна перевірити підключення.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка додавання камери");
    } finally {
      setSaving(false);
    }
  }

  async function testCamera(camera: CameraRow) {
    setTestingId(camera.id);
    try {
      const response = await fetch(`/api/settings/cameras/${camera.id}/test`, { method: "POST" });
      const data = await response.json() as CameraTestResponse;
      if (data.snapshotDataUrl?.startsWith("data:image/jpeg;base64,")) {
        setSnapshots((current) => ({ ...current, [camera.id]: data.snapshotDataUrl! }));
      }
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
      setSnapshots((current) => {
        const next = { ...current };
        delete next[camera.id];
        return next;
      });
      notify("Камеру видалено.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Помилка видалення");
    }
  }

  return <div className={styles.page}>
    {toast ? <div className={styles.toast}>{toast}</div> : null}
    <div className={styles.header}>
      <div className={styles.headerCopy}>
        <h2>Камери відеоспостереження</h2>
        <p>Reolink підключаємо через UID/P2P. Спочатку можна перевірити UID із користувачем admin без пароля; якщо камера захищена, додамо її пароль.</p>
      </div>
      <button className={styles.primary} type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "Закрити" : "+ Додати камеру"}</button>
    </div>

    <div className={styles.summary}>
      <article><span>Усього камер</span><strong>{cameras.length}</strong></article>
      <article><span>Активні</span><strong>{active}</strong></article>
      <article><span>На зв'язку</span><strong>{connected}</strong></article>
    </div>

    {showForm ? <section className={styles.formCard}>
      <div className={styles.formTitle}><div><strong>Додати Reolink</strong><span>Для першого етапу використовуємо UID/P2P.</span></div></div>
      <div className={styles.formGrid}>
        <label><span>Назва</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="В'їзд" /></label>
        <label><span>Призначення</span><select value={form.purpose} onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value as CameraPurpose }))}><option value="ENTRY">В'їзд</option><option value="EXIT">Виїзд</option><option value="TERRITORY">Територія</option><option value="SERVICE_POST">Робочий пост</option></select></label>
        <label><span>Reolink UID</span><input autoCapitalize="characters" value={form.uid} onChange={(event) => setForm((current) => ({ ...current, uid: event.target.value.toUpperCase() }))} placeholder="9527XXXXXXXXXXXX" /></label>
        <label><span>Логін камери</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin" /></label>
        <label><span>Пароль камери (якщо встановлений)</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Можна залишити порожнім" /></label>
        <p className={styles.hint}>Повний UID і пароль не повертаються в інтерфейс після збереження. Якщо пароль введено, CRM зберігає його зашифрованим і передає Camera Bridge тільки сервер-сервер під час перевірки або підключення.</p>
      </div>
      <div className={styles.formActions}><button className={styles.secondary} type="button" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>Скасувати</button><button className={styles.primary} type="button" disabled={saving} onClick={() => void addCamera()}>{saving ? "Зберігаю…" : "Зберегти камеру"}</button></div>
    </section> : null}

    {loading ? <div className={styles.empty}>Завантажую камери…</div> : cameras.length === 0 ? <div className={styles.empty}><strong>Камер ще немає</strong>Додай першу Reolink за UID.</div> : <div className={styles.list}>
      {cameras.map((camera) => {
        const status = statusCopy(camera.status);
        const snapshot = snapshots[camera.id];
        return <article className={styles.card} key={camera.id}>
          <div className={styles.cardTop}>
            <div className={styles.identity}><span className={styles.mark}>R</span><div><strong>{camera.name}</strong><span>{camera.model || "Reolink"} · {PURPOSE_LABEL[camera.purpose]}</span></div></div>
            <div className={styles.badges}><span className={`${styles.badge} ${status.className}`}>{status.label}</span><span className={styles.badge}>UID / P2P</span></div>
          </div>
          {snapshot ? <div className={styles.snapshot}><img src={snapshot} alt={`Останній тестовий кадр: ${camera.name}`} /><span>Живий кадр із останньої успішної перевірки</span></div> : null}
          <div className={styles.details}>
            <div><small>UID</small><code>{camera.maskedUid}</code></div>
            <div><small>Користувач</small><strong>{camera.username}</strong></div>
            <div><small>Остання перевірка</small><strong>{formatDate(camera.lastTestAt)}</strong></div>
            <div><small>Останній зв'язок</small><strong>{formatDate(camera.lastSeenAt)}</strong></div>
          </div>
          {camera.lastTestMessage ? <p className={styles.message}>{camera.lastTestMessage}</p> : null}
          <div className={styles.actions}>
            <button className={styles.small} type="button" disabled={!camera.isActive || testingId === camera.id} onClick={() => void testCamera(camera)}>{testingId === camera.id ? "Підключаюсь…" : "Перевірити підключення"}</button>
            <button className={styles.small} type="button" onClick={() => void toggleCamera(camera)}>{camera.isActive ? "Вимкнути" : "Увімкнути"}</button>
            <button className={styles.danger} type="button" onClick={() => void removeCamera(camera)}>Видалити</button>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}
