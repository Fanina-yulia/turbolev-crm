"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MechanicWalkInForm } from "./mechanic-walk-in-form";
import styles from "./mechanic-vehicle-scanner.module.css";

type ScanScenario = "ASSIGNED" | "ASSIGNED_TO_OTHER" | "WALK_IN_EXISTING_VEHICLE" | "WALK_IN_NEW_VEHICLE";
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
  scenario?: ScanScenario;
  recognition?: { raw: string; plate: string; confidence: number | null; source: string };
  vehicle?: { id: string | null; label: string; plate: string; mileageKm?: number | null };
  appointment?: { id: string; status: string; post: string | null; plannedStartAt: string; mechanic?: string | null } | null;
  assignedToMe?: boolean;
  walkIn?: {
    eligible: boolean;
    existingVehicle: boolean;
    existingClient: { id: string; name: string | null; phone: string } | null;
    mileageKm: number | null;
  };
  nextAction?: ScanAction;
  confirmed?: boolean;
  arrivalApplied?: boolean;
  diagnosticRequestId?: string | null;
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

function mechanicScanSlot() {
  return document.querySelector<HTMLElement>('[data-mechanic-scan-slot]') || mechanicNav();
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
  const autoAdvanceRef = useRef("");
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [walkInMode, setWalkInMode] = useState(false);
  const [error, setError] = useState("");
  const [scanHint, setScanHint] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
  const [heroTarget, setHeroTarget] = useState<HTMLElement | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [expectedPlate, setExpectedPlate] = useState("");
  const [resumeTaskId, setResumeTaskId] = useState("");
  const [confirmUnassigned, setConfirmUnassigned] = useState(false);

  const awaitingVehicleConfirmation = result?.assignedToMe
    && result.nextAction?.type === "WAITING"
    && result.nextAction.label === "Очікує підтвердження авто";
  const autoAdvanceToDiagnostic = Boolean(
    result?.assignedToMe
    && result.recognition?.plate
    && result.nextAction
    && (result.nextAction.type === "DIAGNOSTIC" || awaitingVehicleConfirmation),
  );
  const walkInEligible = Boolean(
    result?.walkIn?.eligible
    && (result.scenario === "WALK_IN_EXISTING_VEHICLE" || result.scenario === "WALK_IN_NEW_VEHICLE"),
  );
  const assignedToOther = result?.scenario === "ASSIGNED_TO_OTHER" && Boolean(result.appointment);

  useEffect(() => {
    let cancelled = false;
    let frame: number | null = null;
    let boundNav: HTMLElement | null = null;

    const syncTargets = () => {
      const nextNav = mechanicScanSlot();
      const nextHero = mechanicHero();
      setNavTarget((current) => current === nextNav ? current : nextNav);
      setHeroTarget((current) => current === nextHero ? current : nextHero);
      return Boolean(nextNav);
    };

    const locateAfterNavigation = () => {
      let attempts = 0;
      const locate = () => {
        if (cancelled) return;
        syncTargets();
        attempts += 1;
        if (attempts < 20 && !mechanicHero()) frame = window.requestAnimationFrame(locate);
        else frame = null;
      };
      if (frame != null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(locate);
    };

    const onNavClick = () => locateAfterNavigation();
    let attempts = 0;
    const bind = () => {
      if (cancelled) return;
      const found = syncTargets();
      const nav = mechanicNav();
      if (nav && nav !== boundNav) {
        boundNav?.removeEventListener("click", onNavClick);
        boundNav = nav;
        boundNav.addEventListener("click", onNavClick);
      }
      attempts += 1;
      if (!found && attempts < 60) frame = window.requestAnimationFrame(bind);
      else frame = null;
    };
    bind();

    const onRefresh = () => locateAfterNavigation();
    window.addEventListener("turbolev:mechanic-refresh", onRefresh);
    return () => {
      cancelled = true;
      if (frame != null) window.cancelAnimationFrame(frame);
      boundNav?.removeEventListener("click", onNavClick);
      window.removeEventListener("turbolev:mechanic-refresh", onRefresh);
    };
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

  function stopAutoAdvance() {
    if (autoAdvanceTimerRef.current != null) {
      window.clearInterval(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }

  function reset() {
    stopAutoAdvance();
    setResult(null);
    setError("");
    setScanHint("");
    setManual("");
    setManualMode(false);
    setWalkInMode(false);
    setBusy(false);
    setCameraError("");
    setCountdown(null);
    setExpectedPlate("");
    setResumeTaskId("");
    setConfirmUnassigned(false);
    autoAdvanceRef.current = "";
    autoTriedRef.current = false;
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function show() {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    reset();
    setOpen(true);
  }

  useEffect(() => {
    function openRequestedScanner(event: Event) {
      const detail = (event as CustomEvent<{ expectedPlate?: string; resumeTaskId?: string }>).detail;
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
      reset();
      setExpectedPlate(detail?.expectedPlate?.trim() || "");
      setResumeTaskId(detail?.resumeTaskId?.trim() || "");
      setOpen(true);
    }

    window.addEventListener("turbolev:mechanic-open-scanner", openRequestedScanner);
    return () => window.removeEventListener("turbolev:mechanic-open-scanner", openRequestedScanner);
  }, []);

  function close() {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    stopAutoAdvance();
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

  async function requestScan(input: File | string, confirm = false, existing?: ScanResult, silent = false, continueExisting = false) {
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
        if (expectedPlate) form.append("expectedPlate", expectedPlate);
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
          body: JSON.stringify({ plate, confirm, continueExisting, source: existing?.recognition?.source || "MANUAL", expectedPlate: expectedPlate || undefined }),
          signal: controller.signal,
        });
      }
      const body = await response.json().catch(() => null) as ScanResult | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося перевірити авто");
      if (controller.signal.aborted) return null;
      setResult(body);
      setWalkInMode(false);
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
    stopAutoAdvance();
    stopCamera();
  }, [stopCamera]);

  async function confirmVehicle() {
    if (!result?.assignedToMe || !result.recognition?.plate || !result.nextAction) return;
    stopAutoAdvance();
    const confirmed = await requestScan(result.recognition.plate, true, result);
    if (!confirmed?.confirmed || !confirmed.nextAction) {
      setCountdown(null);
      return;
    }
    const action = confirmed.nextAction;
    const diagnosticId = action.diagnosticId || confirmed.diagnosticRequestId || null;
    const resumeId = resumeTaskId;
    const recognizedPlate = confirmed.recognition?.plate || result.recognition.plate;
    setOpen(false);
    reset();
    if (diagnosticId && (action.type === "DIAGNOSTIC" || action.type === "WAITING")) {
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId } }));
      return;
    }
    if (action.type === "REPAIR" && action.taskId) {
      if (resumeId && action.taskId === resumeId) {
        window.dispatchEvent(new CustomEvent("turbolev:mechanic-resume-task", { detail: { taskId: resumeId, recognizedPlate } }));
        return;
      }
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-task", { detail: { taskId: action.taskId } }));
      return;
    }
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
  }

  async function continueAssignedDiagnostic() {
    if (!result?.recognition?.plate || !assignedToOther) return;
    const continued = await requestScan(result.recognition.plate, true, result, false, true);
    if (!continued?.confirmed) return;
    const diagnosticId = continued.diagnosticRequestId || continued.nextAction?.diagnosticId || null;
    if (!diagnosticId) {
      setError("Не вдалося відкрити діагностичну карту цього автомобіля.");
      return;
    }
    setOpen(false);
    reset();
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId } }));
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
  }

  function openWalkInDiagnostic(diagnosticId: string) {
    setOpen(false);
    reset();
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId } }));
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
  }

  useEffect(() => {
    if (!open || !autoAdvanceToDiagnostic || busy || error || !result?.recognition?.plate || !result.nextAction) return;
    const key = `${result.recognition.plate}:${result.nextAction.type}:${result.nextAction.diagnosticId || "new"}`;
    if (autoAdvanceRef.current === key) return;
    autoAdvanceRef.current = key;

    let value = 3;
    setCountdown(value);
    const timer = window.setInterval(() => {
      value -= 1;
      if (value > 0) {
        setCountdown(value);
        return;
      }
      window.clearInterval(timer);
      if (autoAdvanceTimerRef.current === timer) autoAdvanceTimerRef.current = null;
      setCountdown(0);
      void confirmVehicle();
    }, 1000);
    autoAdvanceTimerRef.current = timer;

    return () => {
      if (autoAdvanceTimerRef.current === timer) {
        window.clearInterval(timer);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [autoAdvanceToDiagnostic, busy, error, open, result?.nextAction, result?.recognition?.plate]);

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
        {expectedPlate
          ? <>Підтвердіть автомобіль номером<br /><strong>{expectedPlate}</strong></>
          : <>Для розпізнавання наведіть камеру на<br />державний номер автомобіля</>}
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
          <div><small>КАБІНЕТ МЕХАНІКА</small><h2>{walkInMode ? "Позаплановий заїзд" : "Автомобіль розпізнано"}</h2><p>{walkInMode ? "Вкажіть мінімальні дані та одразу переходьте до діагностики." : "CRM перевірила номер і поточне призначення."}</p></div>
          <button type="button" onClick={close} aria-label="Закрити">×</button>
        </header>

        {result.vehicle && <div className={styles.result}>
          {walkInMode ? <MechanicWalkInForm
            plate={result.recognition?.plate || result.vehicle.plate}
            vehicleLabel={result.vehicle.label}
            existingClient={result.walkIn?.existingClient || null}
            mileageKm={result.walkIn?.mileageKm ?? result.vehicle.mileageKm ?? null}
            onCancel={() => setWalkInMode(false)}
            onStarted={openWalkInDiagnostic}
          /> : <>
            <div className={styles.plateBlock}>
              <span className={styles.car}>🚗</span>
              <div><h3>{result.vehicle.label}</h3><strong>{result.recognition?.plate || result.vehicle.plate}</strong>{result.recognition?.confidence != null && <small>Розпізнавання: {result.recognition.confidence}%</small>}</div>
            </div>
            {result.appointment?.post && <div className={styles.fact}><span>Пост</span><b>{result.appointment.post}</b></div>}

            {walkInEligible ? <div className={styles.walkInNotice}>
              <b>{result.scenario === "WALK_IN_EXISTING_VEHICLE" ? "✓ Автомобіль є в базі" : "＋ Новий автомобіль"}</b>
              <span>{result.scenario === "WALK_IN_EXISTING_VEHICLE"
                ? "Активного запису немає. Можна оформити позаплановий заїзд і почати діагностику."
                : "Автомобіля немає в базі та активних записах. Можна оформити позаплановий заїзд."}</span>
              {result.walkIn?.existingClient && <small>{result.walkIn.existingClient.name || "Клієнт"} · {result.walkIn.existingClient.phone}</small>}
            </div> : result.assignedToMe ? <div className={styles.mine}><b>✓ Автомобіль закріплений за вами</b><span>CRM перевірила активне призначення механіка.</span></div> : <div className={styles.notMine}><b>⚠ Автомобіль не закріплений за вами</b><span>{result.nextAction?.reason || "Зверніться до сервіс-менеджера."}</span></div>}

            {autoAdvanceToDiagnostic && !error && <div aria-live="polite" style={{ display: "grid", justifyItems: "center", gap: 12, padding: "22px 16px", borderRadius: 20, background: "rgba(255,101,0,.08)", border: "1px solid rgba(255,101,0,.28)", textAlign: "center" }}>
              <div style={{ width: 82, height: 82, borderRadius: 999, border: "5px solid #ff6500", display: "grid", placeItems: "center", boxShadow: "0 0 0 8px rgba(255,101,0,.10)", fontSize: 34, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{countdown && countdown > 0 ? countdown : "✓"}</div>
              <div><strong style={{ display: "block", fontSize: 18, color: "#f4f7fb" }}>Автомобіль закріплений за вами</strong><span style={{ display: "block", marginTop: 5, color: "#9aa6b2", fontSize: 14 }}>{busy ? "Підтверджую авто та створюю діагностику…" : "Автоматично відкриваю діагностику цього автомобіля…"}</span></div>
            </div>}

            {!autoAdvanceToDiagnostic && result.assignedToMe && result.nextAction && <div className={styles.actionBox} data-kind={result.nextAction.type}>
              <small>НАСТУПНИЙ ЕТАП</small>
              <strong>{result.nextAction.label}</strong>
              {result.nextAction.reason && <span>{result.nextAction.reason}</span>}
            </div>}

            {error && <div className={styles.error}>{error}</div>}

            {walkInEligible && <>
              <button type="button" className={styles.confirm} onClick={() => setWalkInMode(true)}>Продовжити діагностику →</button>
              <button type="button" className={`${styles.confirm} ${styles.confirmSecondary}`} onClick={() => setError("Прямий ремонт через кабінет механіка не запускається без офіційного запису та погоджених робіт. Зверніться до адміністратора або сервіс-менеджера.")}>Ремонт автомобіля →</button>
            </>}
            {!autoAdvanceToDiagnostic && result.assignedToMe && result.nextAction && ["DIAGNOSTIC", "REPAIR"].includes(result.nextAction.type) && <button type="button" className={styles.confirm} disabled={busy} onClick={() => void confirmVehicle()}>{busy ? "Підтверджую…" : `Підтвердити авто та ${result.nextAction.type === "DIAGNOSTIC" ? "перейти до діагностики" : "перейти до ремонту"} →`}</button>}
            {assignedToOther && result.nextAction?.type === "DIAGNOSTIC" && !confirmUnassigned && <button type="button" className={styles.confirm} disabled={busy} onClick={() => setConfirmUnassigned(true)}>Продовжити діагностику →</button>}
            {assignedToOther && result.nextAction?.type === "DIAGNOSTIC" && confirmUnassigned && <div className={styles.unassignedConfirm}>
              <strong>Автомобіль за Вами не закріплений. Продовжити?</strong>
              <div className={styles.confirmChoices}>
                <button type="button" className={styles.confirmSecondary} disabled={busy} onClick={() => setConfirmUnassigned(false)}>Скасувати</button>
                <button type="button" className={styles.confirm} disabled={busy} onClick={() => void continueAssignedDiagnostic()}>{busy ? "Відкриваю…" : "Так, продовжити"}</button>
              </div>
            </div>}
            {!result.assignedToMe && !walkInEligible && <button type="button" className={`${styles.confirm} ${styles.confirmSecondary}`} onClick={() => setError("Прямий ремонт через кабінет механіка не запускається без офіційного запису та погоджених робіт. Зверніться до адміністратора або сервіс-менеджера.")}>Ремонт автомобіля →</button>}
            {autoAdvanceToDiagnostic && error && <button type="button" className={styles.confirm} disabled={busy} onClick={() => { autoAdvanceRef.current = ""; setError(""); setCountdown(3); void confirmVehicle(); }}>{busy ? "Підтверджую…" : "Повторити перехід до діагностики →"}</button>}
            {result.assignedToMe && result.nextAction?.type === "WAITING" && !awaitingVehicleConfirmation && !autoAdvanceToDiagnostic && <div className={styles.waiting}>Дію поки заблоковано workflow CRM. Статус зміниться автоматично після наступного етапу.</div>}
            {!autoAdvanceToDiagnostic && <div className={styles.resultButtons}><button type="button" onClick={() => { reset(); setOpen(true); }}>Сканувати інше авто</button><button type="button" onClick={close}>Закрити</button></div>}
            {autoAdvanceToDiagnostic && error && <div className={styles.resultButtons}><button type="button" onClick={() => { reset(); setOpen(true); }}>Сканувати інше авто</button><button type="button" onClick={close}>Закрити</button></div>}
          </>}
        </div>}
      </section>
    </div>}
  </>;
}
