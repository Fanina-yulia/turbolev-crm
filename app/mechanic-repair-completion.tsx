"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./mechanic-repair-completion.module.css";

type PhotoKey = "toolPhoto1" | "toolPhoto2" | "workspacePhoto";
type PhotoState = Record<PhotoKey, File | null>;
type Task = { id: string; vehicle: string; plate: string; description: string };

const PHOTO_FIELDS: Array<{ key: PhotoKey; title: string; hint: string }> = [
  { key: "toolPhoto1", title: "Інструменти — фото 1", hint: "Увесь інструмент складений та видно повністю" },
  { key: "toolPhoto2", title: "Інструменти — фото 2", hint: "Другий ракурс складеного інструменту" },
  { key: "workspacePhoto", title: "Зона поста", hint: "Пост прибраний, без сміття та зайвих предметів" },
];

export function MechanicRepairCompletion({ task, onBack, onCompleted }: { task: Task; onBack: () => void; onCompleted: () => Promise<void> }) {
  const [files, setFiles] = useState<PhotoState>({ toolPhoto1: null, toolPhoto2: null, workspacePhoto: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previews = useMemo(() => PHOTO_FIELDS.reduce<Record<string, string>>((result, field) => {
    const file = files[field.key];
    if (file) result[field.key] = URL.createObjectURL(file);
    return result;
  }, {}), [files]);

  useEffect(() => () => Object.values(previews).forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function choose(key: PhotoKey, file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Дозволені лише JPG, PNG або WEBP."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Розмір кожного фото не може перевищувати 8 МБ."); return; }
    setFiles((current) => ({ ...current, [key]: file }));
    setError("");
  }

  async function submit() {
    if (PHOTO_FIELDS.some((field) => !files[field.key])) { setError("Додайте всі 3 фото перед завершенням ремонту."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData();
      PHOTO_FIELDS.forEach((field) => { const file = files[field.key]; if (file) form.append(field.key, file); });
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(task.id)}/completion-photos`, { method: "POST", credentials: "include", body: form });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти фото.");
      await onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити ремонт.");
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><button type="button" onClick={onBack} aria-label="Назад">←</button><div><span>ЗАВЕРШЕННЯ РЕМОНТУ</span><h1>{task.vehicle}</h1><p>{task.plate} · {task.description}</p></div></header>
    <section className={styles.notice}><strong>Потрібні 3 фото робочого місця</strong><span>Два фото складеного інструменту та одне фото прибраної зони поста.</span></section>
    <section className={styles.grid}>{PHOTO_FIELDS.map((field) => <article className={styles.photoCard} key={field.key}>
      <div className={styles.preview}>{previews[field.key] ? <img src={previews[field.key]} alt={field.title} /> : <span>📷</span>}</div>
      <div><h2>{field.title}</h2><p>{field.hint}</p></div>
      <label className={styles.choose}>{files[field.key] ? "Замінити фото" : "Додати фото"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { choose(field.key, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
    </article>)}</section>
    {error && <p className={styles.error}>{error}</p>}
    <div className={styles.actions}><button type="button" className={styles.back} onClick={onBack}>Назад</button><button type="button" className={styles.submit} disabled={busy} onClick={() => void submit()}>{busy ? "Зберігаю фото…" : "Завершити ремонт →"}</button></div>
  </main>;
}
