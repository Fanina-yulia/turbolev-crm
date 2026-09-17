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

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const TARGET_BYTES = 1.5 * 1024 * 1024;
const MAX_LONG_SIDE = 1600;

async function compressPhoto(file: File) {
  if (file.size <= TARGET_BYTES && file.type === "image/jpeg") return file;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Не вдалося підготувати фото до збереження.");
    context.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob | null = null;
    for (const quality of [0.82, 0.74, 0.66, 0.58]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (!blob) throw new Error("Не вдалося стиснути фото. Зробіть фото ще раз.");

    const baseName = file.name.replace(/\.[^.]+$/, "") || "completion-photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export function MechanicRepairCompletion({ task, onBack, onCompleted }: { task: Task; onBack: () => void; onCompleted: () => Promise<void> }) {
  const [files, setFiles] = useState<PhotoState>({ toolPhoto1: null, toolPhoto2: null, workspacePhoto: null });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
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
    if (file.size > MAX_SOURCE_BYTES) { setError("Фото завелике. Зробіть нове фото камерою телефону."); return; }
    setFiles((current) => ({ ...current, [key]: file }));
    setError("");
  }

  async function uploadOne(field: (typeof PHOTO_FIELDS)[number], index: number) {
    const original = files[field.key];
    if (!original) throw new Error("Додайте всі 3 фото перед завершенням роботи.");
    setProgress(`Підготовка фото ${index + 1}/3…`);
    const prepared = await compressPhoto(original);
    setProgress(`Зберігаю фото ${index + 1}/3…`);
    const form = new FormData();
    form.append(field.key, prepared);
    const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(task.id)}/completion-photos`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; count?: number; complete?: boolean; message?: string; error?: string } | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || `Не вдалося зберегти фото ${index + 1}.`);
    return body;
  }

  async function submit() {
    if (PHOTO_FIELDS.some((field) => !files[field.key])) { setError("Додайте всі 3 фото перед завершенням роботи."); return; }
    setBusy(true); setError(""); setProgress("");
    try {
      let last: { count?: number; complete?: boolean } | null = null;
      for (let index = 0; index < PHOTO_FIELDS.length; index += 1) {
        last = await uploadOne(PHOTO_FIELDS[index], index);
      }
      if (!last?.complete || last.count !== 3) throw new Error("Система не підтвердила комплект 3/3 фото. Спробуйте завершити ще раз.");
      setProgress("3/3 фото збережено. Завершую роботу…");
      await onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити роботу.");
    } finally { setBusy(false); setProgress(""); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><button type="button" onClick={onBack} aria-label="Назад">←</button><div><span>ЗАВЕРШЕННЯ РОБОТИ</span><h1>{task.vehicle}</h1><p>{task.plate} · {task.description}</p></div></header>
    <section className={styles.notice}><strong>Потрібні 3 фото робочого місця</strong><span>Два фото складеного інструменту та одне фото прибраної зони поста. Фото автоматично стискаються перед збереженням.</span></section>
    <section className={styles.grid}>{PHOTO_FIELDS.map((field) => <article className={styles.photoCard} key={field.key}>
      <div className={styles.preview}>{previews[field.key] ? <img src={previews[field.key]} alt={field.title} /> : <span>📷</span>}</div>
      <div><h2>{field.title}</h2><p>{field.hint}</p></div>
      <label className={styles.choose}>{files[field.key] ? "Замінити фото" : "Додати фото"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => { choose(field.key, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
    </article>)}</section>
    {progress && <p style={{ fontWeight: 800, textAlign: "center" }}>{progress}</p>}
    {error && <p className={styles.error}>{error}</p>}
    <div className={styles.actions}><button type="button" className={styles.back} onClick={onBack} disabled={busy}>Назад</button><button type="button" className={styles.submit} disabled={busy} onClick={() => void submit()}>{busy ? (progress || "Зберігаю фото…") : "Завершити роботу →"}</button></div>
  </main>;
}
