"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./voice-note-input.module.css";

type VoiceNoteInputProps = {
  value: string;
  onChange: (value: string) => void;
  endpoint: string;
  disabled?: boolean;
  maxDurationMs?: number;
  onBusyChange?: (busy: boolean) => void;
};

type RecorderState = "IDLE" | "RECORDING" | "PROCESSING";

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function VoiceNoteInput({ value, onChange, endpoint, disabled = false, maxDurationMs = 180_000, onBusyChange }: VoiceNoteInputProps) {
  const [state, setState] = useState<RecorderState>("IDLE");
  const [elapsed, setElapsed] = useState(0);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    onBusyChange?.(state !== "IDLE");
  }, [onBusyChange, state]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function transcribe(blob: Blob) {
    setState("PROCESSING");
    setError("");
    try {
      const form = new FormData();
      const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", new File([blob], `mechanic-voice-note.${extension}`, { type: blob.type || "audio/webm" }));
      form.append("language", "uk");

      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const body = await response.json().catch(() => null) as { text?: string; message?: string; error?: string } | null;
      if (!response.ok || !body?.text?.trim()) throw new Error(body?.message || body?.error || "Не вдалося розпізнати голос");
      setPendingText(body.text.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося розпізнати голос");
    } finally {
      setState("IDLE");
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recorder.stop();
  }

  async function startRecording() {
    setError("");
    setPendingText("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Цей браузер не підтримує запис голосу. Введіть текст вручну.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
        recorderRef.current = null;
        stopStream();
        if (blob.size === 0) {
          setState("IDLE");
          setError("Запис порожній. Надиктуйте текст ще раз.");
          return;
        }
        void transcribe(blob);
      };
      recorder.start(250);
      setState("RECORDING");
      timerRef.current = window.setInterval(() => {
        const nextElapsed = Date.now() - startedAtRef.current;
        setElapsed(nextElapsed);
        if (nextElapsed >= maxDurationMs) stopRecording();
      }, 250);
    } catch (cause) {
      stopStream();
      setState("IDLE");
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Доступ до мікрофона заборонений. Дозвольте його в налаштуваннях браузера або введіть текст вручну."
        : "Не вдалося отримати доступ до мікрофона. Введіть текст вручну або спробуйте ще раз.");
    }
  }

  function applyPending(mode: "append" | "replace") {
    if (!pendingText) return;
    onChange(mode === "replace" || !value.trim() ? pendingText : `${value.trim()}\n${pendingText}`);
    setPendingText("");
    setError("");
  }

  const isRecording = state === "RECORDING";
  const isProcessing = state === "PROCESSING";
  const controlDisabled = disabled || isProcessing;

  return <div className={styles.root}>
    <div className={styles.fieldWrap}>
      <textarea
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="За потреби додайте коротке уточнення"
        aria-label="Примітка механіка"
      />
      <button
        type="button"
        className={`${styles.micButton} ${isRecording ? styles.recording : ""}`}
        disabled={controlDisabled || isRecording}
        onClick={() => void startRecording()}
        aria-label="Надиктувати примітку"
        title="Надиктувати примітку"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></svg>
      </button>
    </div>

    {isRecording && <div className={styles.recordingBar}><span className={styles.dot} /> Запис триває {formatDuration(elapsed)} <button type="button" onClick={stopRecording}>Зупинити</button></div>}
    {isProcessing && <div className={styles.processing}>Розпізнаю голос…</div>}
    {pendingText && <div className={styles.preview}>
      <span className={styles.previewLabel}>Розпізнаний текст</span>
      <p>{pendingText}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => applyPending("append")}>Додати до тексту</button>
        <button type="button" onClick={() => applyPending("replace")}>Замінити</button>
        <button type="button" className={styles.cancel} onClick={() => setPendingText("")}>Скасувати</button>
      </div>
    </div>}
    {error && <div className={styles.error}>{error}</div>}
    {!disabled && !isRecording && !isProcessing && <small className={styles.hint}>Натисніть на мікрофон і надиктуйте висновок. Текст можна відредагувати перед передачею.</small>}
  </div>;
}
