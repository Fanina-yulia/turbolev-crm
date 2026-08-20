"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  return blob ? new File([blob], "plate-scan.jpg", { type: "image/jpeg" }) : file;
}

function mechanicNav() {
  return document.querySelector<HTMLElement>('nav[aria-label="Навігація механіка"]');
}

function mechanicHero() {
  const notificationButton = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"] button[aria-label="Сповіщення"]');
  return notificationButton?.closest("header") as HTMLElement | null;
}

export function MechanicVehicleScanner() {
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const autoTriedRef = useRef(false);
  const scanAbortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [error, setError] = useState("");
  const [scanHint, setScanHint] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
  const [heroTarget, setHeroTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const syncTargets = () => {
      setNavTarget((current) => {
        const next = mechanicNav();
        return current === next ? current : next;
      });
      setHeroTarget((current) => {
        const next = mechanicHero();
        return current === next ? current : next;
      });
    };
    syncTargets();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const stopCamera = useCallback(() => {
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  function reset() {
    setResult(null);
    setError("");
    setScanHint("");
    setManual("");
    setManualMode(false);
    setBusy(false);
    setCameraError("");
    autoTriedRef.current = false;
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function show() {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    reset();
    setOpen(true);
  }

  function close() {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    stopCamera();
    setOpen(false);
    reset();
  }

  function openProfile() {
    const nav = mechanicNav();
    const profileButton = Array.from(nav?.querySelectorAll<HTMLButtonElement>("button") || [])
      .find((button) => button.textContent?.includes("Профіль"));
    profileButton?.click();
  }

  async function requestScan(input: File | string, confirm = false, existing?: ScanResult, silent = false) {
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setBusy(true);
    if (!silent) setError("");
    setScanHint("");
    try {
      let response: Response;
      if (input instanceof File && !confirm) {
        const prepared = await preparePhoto(input);
        const form = new FormData();
        form.append("image", prepared);
        response = await fetch("/api/cabinet/mechanic/tasks/vehicle-scan", {
          method: "POST",
          credentials: "include",
          body: form,
          signal: controller.signal,
        });
      } else {
        const plate = typeof input === "string" ? input : existing?.recognition?.plate || "";
        response = await fetch("/api/cabinet/mechanic/tasks/vehicle-scan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plate, confirm, source: existing?.recognition?.source || "MANUAL" }),
          signal: controller.signal,
        });
      }
      const body = await response.json().catch(() => null) as ScanResult | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося перевірити авто");
      if (controller.signal.aborted) return null;
      setResult(body);
      stopCamera();
      if (body.recognition?.plate) setManual(body.recognition.plate);
      return body;
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return null;
      const message = cause instanceof Error ? cause.message : "Не вдалося перевірити авто";
      if (silent) setScanHint(message);
      else setError(message);
      return null;
    } finally {
      if (scanAbortRef.current === controller) {
        scanAbortRef.current = null;
        setBusy(false);
      }
    }
  }

  const captureLiveFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReady || busy || result) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;

    const cropWidth = Math.round(sourceWidth * 0.86);
    const cropHeight = Math.min(Math.round(sourceHeight * 0.30), Math.round(cropWidth / 3.8));
    const sx = Math.max(0, Math.round((sourceWidth - cropWidth) / 2));
    const sy = Math.max(0, Math.round((sourceHeight - cropHeight) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1500, cropWidth);
    canvas.height = Math.max(220, Math.round(canvas.width * (cropHeight / cropWidth)));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return null;
    return new File([blob], "live-plate-scan.jpg", { type: "image/jpeg" });
  }, [busy, cameraReady, result]);

  const scanLiveFrame = useCallback(async (silent = false) => {
    const file = await captureLiveFrame();
    if (!file) {
      if (!silent) setScanHint("Камера ще не готова. Спробуйте ще раз.");
      return;
    }
    await requestScan(file, false, undefined, silent);
  }, [captureLiveFrame]);

  useEffect(() => {
    if (!open || result || manualMode) {
      stopCamera();
      return;
    }

    let cancelled = false;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Цей браузер не підтримує live-камеру. Скористайтеся галереєю або введіть номер вручну.");
        return;
      }
      try {
        setCameraError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setCameraReady(true);
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : "";
        setCameraError(name === "NotAllowedError"
          ? "Дозвольте доступ до камери в Safari, щоб сканувати номер у реальному часі."
          : "Не вдалося запустити камеру. Можна вибрати фото або ввести номер вручну.");
      }
    }
    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [manualMode, open, result, stopCamera]);

  useEffect(() => {
    if (!open || !cameraReady || result || busy || manualMode || autoTriedRef.current) return;
    autoTriedRef.current = true;
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null;
      void scanLiveFrame(true);
    }, 1800);
    return () => {
      if (autoTimerRef.current != null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, [busy, cameraReady, manualMode, open, result, scanLiveFrame]);

  useEffect(() => () => {
    scanAbortRef.current?.abort();
    stopCamera();
  }, [stopCamera]);

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

  const scanButton = <button type="button" className={styles.navScan} onClick={show} aria-label="Сканувати номер автомобіля">
    <span>▣</span><b>Сканувати</b>
  </button>;

  const profileButton = <button type="button" className={styles.profileTop} onClick={openProfile} aria-label="Профіль механіка" title="Профіль">
    <span>●</span>
  </button>;

  return <>
    {navTarget ? createPortal(scanButton, navTarget) : null}
    {heroTarget ? createPortal(profileButton, heroTarget) : null}

    {open && !result && <div className={styles.scannerScreen} role="dialog" aria-modal="true" aria-label="Сканування автомобіля">
      <video ref={videoRef} className={styles.liveVideo} playsInline muted autoPlay />
      <div className={styles.cameraShade} />

      <div className={styles.scannerTop}>
        <button type="button" className={styles.backButton} onClick={close} aria-label="Назад">‹</button>
        <label className={styles.galleryButton} aria-label="Вибрати фото з галереї">
          <span>▧</span>
          <input ref={galleryRef} type="file" accept="image/*" disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void requestScan(file);
          }} />
        </label>
      </div>

      <div className={styles.scannerInstruction}>
        Для розпізнавання наведіть камеру на<br />державний номер автомобіля
      </div>

      <div className={`${styles.scanWindow} ${busy ? styles.scanWindowBusy : ""}`} aria-hidden="true">
        <i /><i /><i /><i />
        {busy && <span className={styles.scanLine} />}
      </div>

      <div className={styles.cameraStatus}>
        {!cameraReady && !cameraError && <span>Запускаю камеру…</span>}
        {cameraReady && !busy && !scanHint && <span>Тримайте номер у рамці</span>}
        {busy && <span>Розпізнаю автомобіль…</span>}
        {scanHint && !busy && <>
          <span>{scanHint}</span>
          <button type="button" onClick={() => { setScanHint(""); autoTriedRef.current = true; void scanLiveFrame(false); }}>Сканувати ще раз</button>
        </>}
        {cameraError && <span className={styles.cameraError}>{cameraError}</span>}
      </div>

      <div className={styles.scannerBottom}>
        <button type="button" className={styles.manualLink} onClick={() => { setManualMode(true); setScanHint(""); }} disabled={busy}>Ввести номер вручну</button>
        <button type="button" className={styles.cancelCamera} onClick={close}>СКАСУВАТИ</button>
      </div>

      {manualMode && <div className={styles.manualOverlay}>
        <button type="button" className={styles.manualBack} onClick={() => { setManualMode(false); setError(""); }} disabled={busy}>← До камери</button>
        <div className={styles.manualCard}>
          <small>РУЧНИЙ ПОШУК</small>
          <h2>Введіть номер автомобіля</h2>
          <p>Наприклад: КА9962ТА</p>
          <form onSubmit={(event) => { event.preventDefault(); if (manual.trim()) void requestScan(manual.trim()); }}>
            <input autoFocus value={manual} onChange={(event) => setManual(event.target.value.toUpperCase())} placeholder="КА9962ТА" autoCapitalize="characters" />
            <button type="submit" disabled={busy || manual.trim().length < 5}>{busy ? "Перевіряю…" : "Знайти авто"}</button>
          </form>
          {error && <div className={styles.error}>{error}</div>}
        </div>
      </div>}
    </div>}

    {open && result && <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Результат сканування автомобіля">
      <section className={styles.sheet}>
        <header className={styles.head}>
          <div><small>КАБІНЕТ МЕХАНІКА</small><h2>Автомобіль розпізнано</h2><p>CRM перевірила номер і поточне призначення.</p></div>
          <button type="button" onClick={close} aria-label="Закрити">×</button>
        </header>

        {result.vehicle && <div className={styles.result}>
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
          <div className={styles.resultButtons}><button type="button" onClick={() => { reset(); setOpen(true); }}>Сканувати інше авто</button><button type="button" onClick={close}>Закрити</button></div>
        </div>}
      </section>
    </div>}
  </>;
}
