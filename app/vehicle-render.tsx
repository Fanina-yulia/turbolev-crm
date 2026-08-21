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
};

type LibraryState = {
  state?: "READY" | "MISSING" | "GENERATING" | "ERROR" | "NOT_CONFIGURED" | "MISSING_DATA";
  autoGenerate?: boolean;
  canGenerate?: boolean;
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

export function VehicleRender(props: VehicleRenderProps) {
  const size = props.size || "card";
  const [themePaint, setThemePaint] = useState<ThemePaint>("Imagin-orange");
  const [failed, setFailed] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const forcedRetryRef = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => setThemePaint(readThemePaint());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent-color", "data-vehicle-paint", "style", "class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const schedulePoll = () => {
      if (cancelled) return;
      pollTimer = setTimeout(() => void inspect(), 5000);
    };

    const inspect = async () => {
      try {
        const query = new URLSearchParams({ theme: themePaint });
        const response = await fetch(`/api/vehicles/${encodeURIComponent(props.id)}/image?${query.toString()}`, { cache: "no-store" });
        const data = await response.json() as { ok?: boolean; image?: unknown; library?: LibraryState };
        if (cancelled || !response.ok || !data.ok) return;
        if (data.image) {
          setLibraryVersion((value) => value + 1);
          return;
        }

        const library = data.library;
        if (library?.state === "GENERATING") {
          schedulePoll();
          return;
        }

        const retryKey = `${props.id}:${themePaint}`;
        const retryFailedGeneration = library?.state === "ERROR"
          && library.autoGenerate
          && library.canGenerate
          && forcedRetryRef.current !== retryKey;
        const startMissingGeneration = library?.state === "MISSING" && library.autoGenerate && library.canGenerate;
        if (!retryFailedGeneration && !startMissingGeneration) return;
        if (retryFailedGeneration) forcedRetryRef.current = retryKey;

        const generation = await fetch(`/api/vehicles/${encodeURIComponent(props.id)}/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themePaint, force: retryFailedGeneration }),
        });
        const result = await generation.json().catch(() => null) as { ok?: boolean; image?: unknown; generation?: { state?: string } } | null;
        if (cancelled) return;
        if (generation.ok && result?.ok && result.image) {
          setLibraryVersion((value) => value + 1);
          return;
        }
        if (result?.generation?.state === "GENERATING") schedulePoll();
      } catch {
        // Never replace a missing real asset with a fake vehicle illustration.
      }
    };

    void inspect();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [props.id, props.updatedAt, themePaint]);

  const src = useMemo(() => {
    const params = new URLSearchParams({ theme: themePaint, lib: String(libraryVersion) });
    if (props.updatedAt) params.set("v", props.updatedAt);
    return `/api/vehicles/${encodeURIComponent(props.id)}/image/render?${params.toString()}`;
  }, [props.id, props.updatedAt, themePaint, libraryVersion]);

  useEffect(() => setFailed(false), [src]);

  return <span
    className={`${styles.root} ${styles[size]} ${failed ? styles.failed : ""} ${props.className || ""}`}
    data-vehicle-render="true"
    data-vehicle-image-state={failed ? "missing" : "ready"}
    aria-label={vehicleTitle(props)}
  >
    {!failed ? <img src={src} alt={vehicleTitle(props)} loading={props.eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)}/> : null}
    {props.exteriorColorConfirmed && props.exteriorColorName ? <span className={styles.realColor} title={`Підтверджений колір: ${props.exteriorColorName}`}><i className={styles.colorDot} style={props.exteriorColorHex ? { backgroundColor: props.exteriorColorHex } : undefined}/></span> : null}
  </span>;
}
