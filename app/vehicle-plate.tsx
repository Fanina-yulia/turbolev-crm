"use client";

import { useState } from "react";
import styles from "./vehicle-plate.module.css";
import { formatRegistrationPlate, normalizeRegistrationPlate } from "../src/domain/registration-plate";
import { plateSvgMarkup } from "./vehicle-plate-art";

type VehiclePlateSize = "xs" | "sm" | "md";

type VehiclePlateProps = {
  value?: string | null;
  size?: VehiclePlateSize;
  className?: string;
  title?: string;
};

export function normalizeVehiclePlate(value?: string | null) {
  return normalizeRegistrationPlate(value || "");
}

export function formatVehiclePlate(value?: string | null) {
  return formatRegistrationPlate(value);
}

export function VehiclePlate({ value, size = "sm", className = "", title }: VehiclePlateProps) {
  const normalized = normalizeVehiclePlate(value);
  const display = formatVehiclePlate(value);
  const empty = !normalized || normalized === "—";
  const [copied, setCopied] = useState(false);

  async function copyPlate() {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  if (empty) return <span className={`${styles.empty} ${className}`}>Без держномера</span>;

  return <span
    className={`${styles.plate} ${styles[size]} ${className}`}
    data-vehicle-plate="true"
    data-plate-standard="turbo-lev-reference-v2"
    data-plate-aspect="4.98"
    data-plate={normalized}
    title={copied ? "Держномер скопійовано" : title || `Скопіювати державний номер ${display}`}
    aria-label={copied ? "Держномер скопійовано" : `Скопіювати державний номер ${display}`}
    role="button"
    tabIndex={0}
    onClick={() => void copyPlate()}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void copyPlate(); } }}
    dangerouslySetInnerHTML={{ __html: plateSvgMarkup(display) }}
  />;
}
