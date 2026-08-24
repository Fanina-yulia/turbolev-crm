"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./vehicle-render.module.css";

export type VehicleRenderSize = "mini" | "card" | "drawer" | "hero";

type VehicleRenderProps = {
  id: string;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  updatedAt?: string | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  exteriorColorConfirmed?: boolean;
  size?: VehicleRenderSize;
  eager?: boolean;
  className?: string;
  interactiveMissing?: boolean;
};

type LibraryState = {
  state?: "READY" | "MISSING" | "GENERATING" | "ERROR" | "NOT_CONFIGURED" | "MISSING_DATA";
  autoGenerate?: boolean;
  canGenerate?: boolean;
  error?: string | null;
  assetId?: string | null;
};

type VehicleImageApiPayload = {
  ok?: boolean;
  image?: { assetId?: string | null } | null;
  library?: LibraryState;
  generation?: { state?: string; assetId?: string | null };
  error?: string;
};

const PAINTS = ["Imagin-black","Imagin-grey","Imagin-white","Imagin-blue","Imagin-yellow","Imagin-red","Imagin-orange","Imagin-green"] as const;
type ThemePaint = typeof PAINTS[number];

function themePaintFromHex(value: string): ThemePaint {
  const raw = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(raw)) return "Imagin-orange";
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (lightness < .16) return "Imagin-black";
  if (lightness > .88 && delta < .1) return "Imagin-white";
  if (delta < .08) return "Imagin-grey";
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  if (hue < 18 || hue >= 345) return "Imagin-red";
  if (hue < 48) return "Imagin-orange";
  if (hue < 75) return "Imagin-yellow";
  if (hue < 170) return "Imagin-green";
  if (hue < 270) return "Imagin-blue";
  return "Imagin-red";
}

function readThemePaint(): ThemePaint {
  if (typeof window === "undefined") return "Imagin-orange";
  const root = document.documentElement;
  const explicit = root.dataset.vehiclePaint || root.dataset.accentColor || "";
  if (PAINTS.includes(explicit as ThemePaint)) return explicit as ThemePaint;
  const normalized = explicit ? `Imagin-${explicit.toLowerCase().replace(/^imagin-/, "")}` : "";
  if (PAINTS.includes(normalized as ThemePaint)) return normalized as ThemePaint;
  return themePaintFromHex(getComputedStyle(root).getPropertyValue("--orange").trim() || "#ff6600");
}

function vehicleTitle(props: VehicleRenderProps) {
  return [props.brand, props.model, props.year].filter(Boolean).join(" ") || "Автомобіль";
}

function placeholderTitle(state: LibraryState["state"], resolving: boolean, interactive: boolean) {
  if (resolving || state === "GENERATING") return "Генеруємо зображення…";
  if (state === "NOT_CONFIGURED") return "OpenAI не налаштовано";
  if (state === "MISSING_DATA") return "Недостатньо даних авто";
  if (state === "ERROR") return interactive ? "Помилка — натисніть повторно" : "Помилка зображення";
  return interactive ? "Натисніть, щоб додати зображення" : "Зображення ще немає";
}

export function VehicleRender(props: VehicleRenderProps) {
  const size = props.size || "card";
  const clickToResolve = props.interactiveMissing ?? size === "drawer";
  const [themePaint, setThemePaint] = useState<ThemePaint>("Imagin-orange");
  const [failed, setFailed] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [libraryState, setLibraryState] = useState<LibraryState["state"]>();
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [manualResolveEpoch, setManualResolveEpoch] = useState(0);
  const forcedRetryRef = useRef<string | null>(null);
  const activeVehicleRef = useRef(props.id);

  useEffect(() => {
    const sync = () => setThemePaint(readThemePaint());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent-color", "data-vehicle-paint", "style", "class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    activeVehicleRef.current = props.id;
    setLibraryState(undefined);
    setLibraryError(null);
    setResolving(false);
    setManualResolveEpoch(0);
  }, [props.id]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollAttempts = 0;

    const schedulePoll = (delayMs = 3000) => {
      if (cancelled) return;
      pollAttempts += 1;
      pollTimer = setTimeout(() => void inspect(), delayMs);
    };

    const inspect = async () => {
      try {
        const query = new URLSearchParams({ theme: themePaint });
        const response = await fetch(`/api/vehicles/${encodeURIComponent(props.id)}/image?${query.toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => null) as VehicleImageApiPayload | null;
        if (cancelled || !response.ok || !data?.ok) return;

        if (data.image) {
          setLibraryState("READY");
          setLibraryError(null);
          setResolving(false);
          setFailed(false);
          setLibraryVersion((value) => value + 1);
          return;
        }

        const library = data.library;
        const state = library?.state || "MISSING";
        setLibraryState(state);
        setLibraryError(library?.error || null);

        if (state === "GENERATING") {
          setResolving(clickToResolve ? true : resolving);
          if (pollAttempts < 40) schedulePoll(3000);
          else {
            setResolving(false);
            setLibraryError("Генерація триває довше очікуваного. Натисніть повторно через хвилину.");
          }
          return;
        }

        if (clickToResolve) {
          if (manualResolveEpoch > 0 && state === "MISSING" && pollAttempts < 10) {
            schedulePoll(1800);
            return;
          }
          setResolving(false);
          return;
        }

        const retryKey = `${props.id}:${themePaint}`;
        const retryFailedGeneration = state === "ERROR"
          && library?.autoGenerate
          && library.canGenerate
          && forcedRetryRef.current !== retryKey;
        const startMissingGeneration = state === "MISSING" && library?.autoGenerate && library.canGenerate;
        if (!retryFailedGeneration && !startMissingGeneration) return;
        if (retryFailedGeneration) forcedRetryRef.current = retryKey;

        const generation = await fetch(`/api/vehicles/${encodeURIComponent(props.id)}/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themePaint, force: retryFailedGeneration }),
        });
        const result = await generation.json().catch(() => null) as VehicleImageApiPayload | null;
        if (cancelled) return;
        if (generation.ok && result?.ok && result.image) {
          setLibraryState("READY");
          setLibraryError(null);
          setFailed(false);
          setLibraryVersion((value) => value + 1);
          return;
        }
        if (result?.generation?.state === "GENERATING") {
          setLibraryState("GENERATING");
          schedulePoll();
        }
      } catch {
        // Missing or unavailable renders must stay as a safe local silhouette.
      }
    };

    void inspect();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [props.id, props.updatedAt, themePaint, clickToResolve, manualResolveEpoch]);

  async function resolveMissingImage() {
    if (!clickToResolve || resolving || libraryState === "GENERATING") return;
    const requestedVehicleId = props.id;
    setResolving(true);
    setLibraryError(null);

    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(props.id)}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePaint, force: libraryState === "ERROR" }),
      });
      const data = await response.json().catch(() => null) as VehicleImageApiPayload | null;
      if (activeVehicleRef.current !== requestedVehicleId) return;

      if (!response.ok || !data?.ok) {
        setLibraryState(data?.library?.state || "ERROR");
        setLibraryError(data?.error || data?.library?.error || "Не вдалося отримати зображення автомобіля.");
        setResolving(false);
        return;
      }

      if (data.image) {
        setLibraryState("READY");
        setLibraryError(null);
        setFailed(false);
        setResolving(false);
        setLibraryVersion((value) => value + 1);
        return;
      }

      setLibraryState(data.library?.state === "READY" ? "READY" : "GENERATING");
      setManualResolveEpoch((value) => value + 1);
    } catch (cause) {
      if (activeVehicleRef.current !== requestedVehicleId) return;
      setLibraryError(cause instanceof Error ? cause.message : "Не вдалося отримати зображення автомобіля.");
      setResolving(false);
    }
  }

  const src = useMemo(() => {
    const params = new URLSearchParams({ theme: themePaint, lib: String(libraryVersion) });
    if (props.updatedAt) params.set("v", props.updatedAt);
    return `/api/vehicles/${encodeURIComponent(props.id)}/image/render?${params.toString()}`;
  }, [props.id, props.updatedAt, themePaint, libraryVersion]);

  useEffect(() => setFailed(false), [src]);

  const interactiveFallback = clickToResolve && !resolving && libraryState !== "GENERATING" && libraryState !== "NOT_CONFIGURED" && libraryState !== "MISSING_DATA";
  const fallbackText = placeholderTitle(libraryState, resolving, clickToResolve);

  return <span
    className={`${styles.root} ${styles[size]} ${failed ? styles.failed : ""} ${clickToResolve ? styles.clickToResolve : ""} ${resolving || libraryState === "GENERATING" ? styles.generating : ""} ${libraryState === "ERROR" ? styles.errorState : ""} ${props.className || ""}`}
    data-vehicle-render="true"
    data-vehicle-image-state={failed ? (libraryState || "missing").toLowerCase() : "ready"}
    aria-label={vehicleTitle(props)}
  >
    {!failed ? <img
      src={src}
      alt={vehicleTitle(props)}
      loading={props.eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => {
        setFailed(false);
        setLibraryState("READY");
        setLibraryError(null);
        setResolving(false);
      }}
      onError={() => setFailed(true)}
    /> : <span
      className={`${styles.localFallback} ${interactiveFallback ? styles.localFallbackInteractive : ""}`}
      role={interactiveFallback ? "button" : undefined}
      tabIndex={interactiveFallback ? 0 : undefined}
      aria-label={interactiveFallback ? `${fallbackText}. ${vehicleTitle(props)}` : undefined}
      title={libraryError || (interactiveFallback ? "CRM спочатку перевірить бібліотеку, а якщо зображення немає — запустить генерацію." : undefined)}
      onClick={(event) => {
        if (!interactiveFallback) return;
        event.preventDefault();
        event.stopPropagation();
        void resolveMissingImage();
      }}
      onKeyDown={(event) => {
        if (!interactiveFallback || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        event.stopPropagation();
        void resolveMissingImage();
      }}
    >
      <svg className={styles.carSilhouette} viewBox="0 0 180 82" aria-hidden="true">
        <path d="M19 53c3-9 9-15 18-17l20-5 14-15c4-4 9-6 15-6h33c7 0 12 2 17 7l13 14 15 4c8 2 13 8 14 16l1 8h-14a16 16 0 0 1-31 0H57a16 16 0 0 1-31 0H15l4-6Z"/>
        <path d="M65 31l12-13c2-2 5-3 9-3h13v16H65Zm40 0V15h14c4 0 7 1 10 4l11 12h-35Z"/>
        <circle cx="42" cy="59" r="10"/>
        <circle cx="149" cy="59" r="10"/>
      </svg>
      <strong>{fallbackText}</strong>
      <small>{libraryError || vehicleTitle(props)}</small>
    </span>}
    {props.exteriorColorConfirmed && props.exteriorColorName ? <span className={styles.realColor} title={`Підтверджений колір: ${props.exteriorColorName}`}><i className={styles.colorDot} style={props.exteriorColorHex ? { backgroundColor: props.exteriorColorHex } : undefined}/></span> : null}
  </span>;
}
