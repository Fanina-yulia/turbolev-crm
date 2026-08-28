"use client";
import { useEffect, useState } from "react";
import styles from "./mechanic-execution-issue-form.module.css";

export type ExecutionIssueTask = { id: string; vehicle: string; plate: string; description: string };
const REASONS = [
  ["VEHICLE_NOT_PRESENT", "Автомобіль відсутній на СТО"], ["VEHICLE_NOT_HANDED_OVER", "Автомобіль не передано механіку"], ["BAY_OCCUPIED", "Пост зайнятий"], ["EQUIPMENT_UNAVAILABLE", "Немає обладнання"], ["EQUIPMENT_BROKEN", "Обладнання несправне"], ["PARTS_UNAVAILABLE", "Немає запчастин або матеріалів"], ["ASSISTANCE_REQUIRED", "Потрібна допомога іншого механіка"], ["ALREADY_IN_PROGRESS", "Роботу вже виконує інший механік"], ["INCORRECT_ASSIGNMENT_DATA", "У завданні неправильні дані"], ["LICENSE_PLATE_MISMATCH", "Державний номер не збігається"], ["TIME_UNAVAILABLE", "Не встигаю виконати вчасно"], ["OTHER", "Інша причина"],
] as const;
const REQUIRED = new Set(["INCORRECT_ASSIGNMENT_DATA", "LICENSE_PLATE_MISMATCH", "TIME_UNAVAILABLE", "OTHER"]);

export function MechanicExecutionIssueForm({ task, onClose, onSubmitted }: { task: ExecutionIssueTask; onClose: () => void; onSubmitted: (message: string) => void }) {
  const [reason, setReason] = useState(""); const [comment, setComment] = useState(""); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const draftKey = `turbolev:execution-issue-draft:${task.id}`;
  useEffect(() => {
    try { const draft = JSON.parse(window.localStorage.getItem(draftKey) || "null") as { reason?: string; comment?: string } | null; if (draft) { setReason(draft.reason || ""); setComment(draft.comment || ""); } } catch { /* malformed local draft is ignored */ }
  }, [draftKey]);
  useEffect(() => { window.localStorage.setItem(draftKey, JSON.stringify({ reason, comment })); }, [comment, draftKey, reason]);
  async function submit() {
    if (!reason || (REQUIRED.has(reason) && comment.trim().length < 3)) { setError("Виберіть причину та додайте короткий опис, якщо він обов’язковий."); return; }
    setBusy(true); setError("");
    try { const form = new FormData(); form.append("assignmentId", task.id); form.append("reasonCode", reason); form.append("comment", comment); files.forEach((file) => form.append("photos", file)); const response = await fetch("/api/cabinet/mechanic/execution-issues", { method: "POST", credentials: "include", body: form }); const body = await response.json().catch(() => null); if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося повідомити адміністратора"); window.localStorage.removeItem(draftKey); onSubmitted(body.message || "Адміністратора повідомлено."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося повідомити адміністратора"); } finally { setBusy(false); }
  }
  return <div className={styles.backdrop} role="dialog" aria-modal="true"><section className={styles.sheet}><div className={styles.head}><div><h2>Чому роботу неможливо виконати?</h2><p>{task.vehicle} · {task.plate} · {task.description}</p></div><button className={styles.close} type="button" onClick={onClose} aria-label="Закрити">×</button></div><div className={styles.reasons}>{REASONS.map(([code, text]) => <button type="button" key={code} className={`${styles.reason} ${reason === code ? styles.selected : ""}`} onClick={() => setReason(code)}>{text}</button>)}</div><label className={styles.field}><span>Коротко опишіть ситуацію{reason && REQUIRED.has(reason) ? " *" : ""}</span><textarea rows={4} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Що сталося?" /><small className={styles.count}>{comment.length}/500</small></label><div className={styles.field}><span>Фото підтвердження</span><div className={styles.photos}>{files.map((file, i) => <div className={styles.photo} key={`${file.name}-${i}`}><img src={URL.createObjectURL(file)} alt="" /><button type="button" onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}>×</button></div>)}{files.length < 5 && <label className={styles.upload}>＋<input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(e) => { const picked = Array.from(e.currentTarget.files ?? []).filter((file) => file.type.startsWith("image/") && file.size <= 2_800_000); setFiles((current) => [...current, ...picked].slice(0, 5)); e.currentTarget.value = ""; }} /></label>}</div></div>{error && <p className={styles.error}>{error}</p>}<button type="button" className={styles.submit} disabled={busy} onClick={() => void submit()}>{busy ? "Передаю…" : "Повідомити адміністратора"}</button></section></div>;
}
