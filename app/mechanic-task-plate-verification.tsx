"use client";

import { useState } from "react";
import styles from "./mechanic-execution-issue-form.module.css";

type Task = { id: string; vehicle: string; plate: string };

export function MechanicTaskPlateVerification({ task, onClose, onVerified }: { task: Task; onClose: () => void; onVerified: () => Promise<void> | void }) {
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function scan(file: File) {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/cabinet/mechanic/tasks/vehicle-scan", { method: "POST", credentials: "include", body: form });
      const body = await response.json().catch(() => null) as { recognition?: { plate?: string }; message?: string; error?: string } | null;
      if (!response.ok || !body?.recognition?.plate) throw new Error(body?.message || body?.error || "Номер не вдалося розпізнати. Введіть його вручну.");
      setPlate(body.recognition.plate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Номер не вдалося розпізнати.");
    } finally { setBusy(false); }
  }

  async function verify(method: "CAMERA" | "MANUAL") {
    if (!plate.trim()) { setError("Введіть або відскануйте номер автомобіля."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(task.id)}/verify-plate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recognizedPlate: plate, verificationMethod: method }) });
      const body = await response.json().catch(() => null) as { message?: string; error?: string; expectedPlate?: string } | null;
      if (!response.ok) throw new Error(body?.error === "PLATE_MISMATCH" ? `Це інший автомобіль. Очікується ${body.expectedPlate || task.plate}.` : body?.message || body?.error || "Не вдалося підтвердити номер.");
      await onVerified();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося підтвердити номер.");
    } finally { setBusy(false); }
  }

  return <div className={styles.backdrop} role="dialog" aria-modal="true">
    <section className={styles.sheet}>
      <div className={styles.head}><div><h2>Підтвердіть автомобіль</h2><p>{task.vehicle} · очікується {task.plate || "номер не вказано"}</p></div><button className={styles.close} type="button" onClick={onClose} aria-label="Закрити">×</button></div>
      <label className={styles.field}><span>Державний номер</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="AA 6919 YD" autoCapitalize="characters" autoComplete="off" /></label>
      <label className={styles.upload} style={{ width: "100%", height: 52, fontSize: 15 }}>📷 Сканувати камерою<input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void scan(file); }} /></label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submit} type="button" disabled={busy} onClick={() => void verify("MANUAL")}>{busy ? "Перевіряю…" : "Підтвердити та почати"}</button>
    </section>
  </div>;
}
