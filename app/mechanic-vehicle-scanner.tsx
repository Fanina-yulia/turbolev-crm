"use client";

import { useRef, useState } from "react";
import styles from "./mechanic-vehicle-scanner.module.css";

type ScanAction = {
  type: "DIAGNOSTIC" | "REPAIR" | "WAITING" | "NONE";
  label: string;
  diagnosticId?: string | null;
  taskId?: string | null;
  reason?: string | null;
};

type ScanResult = {
  ok: boolean;
  recognized?: boolean;
  recognition?: { raw: string; plate: string; confidence: number | null; source: string };
  vehicle?: { id: string | null; label: string; plate: string };
  appointment?: { id: string; status: string; post: string | null; plannedStartAt: string } | null;
  assignedToMe?: boolean;
  nextAction?: ScanAction;
  confirmed?: boolean;
  message?: string;
  error?: string;
};

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("IMAGE_READ_FAILED")); };
    image.src = url;
  });
}

async function preparePhoto(file: File) {
  const image = await loadImage(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  return blob ? new File([blob], "plate-scan.jpg", { type: "image/jpeg" }) : file;
}

export function MechanicVehicleScanner() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  function reset() {
    setResult(null);
    setError("");
    setManual("");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function show() {
    reset();
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  async function requestScan(input: File | string, confirm = false, existing?: ScanResult) {
    setBusy(true);
    setError("");
    try {
      let response: Response;
      if (input instanceof File && !confirm) {
        const prepared = await preparePhoto(input);
        const form = new FormData();
        form.append("image", prepared);
        response = await fetch("/api/cabinet/mechanic/tasks/vehicle-scan", { method: "POST", credentials: "include", body: form });
      } else {
        const plate = typeof input === "string" ? input : existing?.recognition?.plate || "";
        response = await fetch("/api/cabinet/mechanic/tasks/vehicle-scan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plate, confirm, source: existing?.recognition?.source || "MANUAL" }),
        });
      }
      const body = await response.json().catch(() => null) as ScanResult | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося перевірити авто");
      setResult(body);
      if (body.recognition?.plate) setManual(body.recognition.plate);
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося перевірити авто");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function confirmVehicle() {
    if (!result?.assignedToMe || !result.recognition?.plate || !result.nextAction) return;
    const confirmed = await requestScan(result.recognition.plate, true, result);
    if (!confirmed?.confirmed || !confirmed.nextAction) return;
    const action = confirmed.nextAction;
    setOpen(false);
    reset();
    if (action.type === "DIAGNOSTIC" && action.diagnosticId) {
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId: action.diagnosticId } }));
      return;
    }
    if (action.type === "REPAIR" && action.taskId) {
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-task", { detail: { taskId: action.taskId } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
  }

  return <>
    <button type="button" className={styles.fab} onClick={show} aria-label="Сканувати номер автомобіля">
      <span>▣</span><b>Сканувати авто</b>
    </button>
    {open && <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Сканування автомобіля" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.sheet}>
        <header className={styles.head}>
          <div><small>КАБІНЕТ МЕХАНІКА</small><h2>Розпізнати автомобіль</h2><p>Сфотографуйте номер або введіть його вручну.</p></div>
          <button type="button" onClick={close} aria-label="Закрити">×</button>
        </header>

        {!result && <>
          <label className={styles.cameraButton}>
            <span>📷</span>
            <strong>{busy ? "Розпізнаю номер…" : "Сфотографувати номер"}</strong>
            <small>Наведіть камеру ближче на номерний знак</small>
            <input ref={fileRef} disabled={busy} type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void requestScan(file); }} />
          </label>
          <div className={styles.or}><span>або</span></div>
          <form className={styles.manual} onSubmit={(event) => { event.preventDefault(); if (manual.trim()) void requestScan(manual.trim()); }}>
            <label><span>Номер автомобіля</span><input value={manual} onChange={(event) => setManual(event.target.value.toUpperCase())} placeholder="КА9962ТА" autoCapitalize="characters" /></label>
            <button type="submit" disabled={busy || manual.trim().length < 5}>{busy ? "Перевіряю…" : "Знайти авто"}</button>
          </form>
        </>}

        {error && <div className={styles.error}>{error}<button type="button" onClick={() => { setError(""); setResult(null); }}>Спробувати ще раз</button></div>}

        {result?.vehicle && <div className={styles.result}>
          <div className={styles.plateBlock}>
            <span className={styles.car}>🚗</span>
            <div><h3>{result.vehicle.label}</h3><strong>{result.recognition?.plate || result.vehicle.plate}</strong>{result.recognition?.confidence != null && <small>Розпізнавання: {result.recognition.confidence}%</small>}</div>
          </div>
          {result.appointment?.post && <div className={styles.fact}><span>Пост</span><b>{result.appointment.post}</b></div>}

          {result.assignedToMe ? <div className={styles.mine}><b>✓ Автомобіль закріплений за вами</b><span>CRM перевірила активне призначення механіка.</span></div> : <div className={styles.notMine}><b>⚠ Автомобіль не закріплений за вами</b><span>{result.nextAction?.reason || "Зверніться до сервіс-менеджера."}</span></div>}

          {result.assignedToMe && result.nextAction && <div className={styles.actionBox} data-kind={result.nextAction.type}>
            <small>НАСТУПНИЙ ЕТАП</small>
            <strong>{result.nextAction.label}</strong>
            {result.nextAction.reason && <span>{result.nextAction.reason}</span>}
          </div>}

          {result.assignedToMe && result.nextAction && ["DIAGNOSTIC", "REPAIR"].includes(result.nextAction.type) && <button type="button" className={styles.confirm} disabled={busy} onClick={() => void confirmVehicle()}>{busy ? "Підтверджую…" : `Підтвердити авто та ${result.nextAction.type === "DIAGNOSTIC" ? "перейти до діагностики" : "перейти до ремонту"} →`}</button>}
          {result.assignedToMe && result.nextAction?.type === "WAITING" && <div className={styles.waiting}>Дію поки заблоковано workflow CRM. Статус зміниться автоматично після наступного етапу.</div>}
          <div className={styles.resultButtons}><button type="button" onClick={reset}>Сканувати інше авто</button><button type="button" onClick={close}>Закрити</button></div>
        </div>}
      </section>
    </div>}
  </>;
}
