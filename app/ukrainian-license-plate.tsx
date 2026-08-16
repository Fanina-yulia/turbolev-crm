import type { HTMLAttributes } from "react";

const UKRAINIAN_STANDARD_PLATE = /^[A-ZА-ЯІЇЄ]{2}\d{4}[A-ZА-ЯІЇЄ]{2}$/u;
const LABELED_PREFIX = /^(?:держзнак|держномер|державний\s+номер|номер\s+авто)\s*[:№-]?$/iu;
const TRAILING_PLATE = /([A-ZА-ЯІЇЄ]{2}[\s-]*\d{4}[\s-]*[A-ZА-ЯІЇЄ]{2})\s*$/u;
const LEADING_PLATE = /^([A-ZА-ЯІЇЄ]{2}[\s-]*\d{4}[\s-]*[A-ZА-ЯІЇЄ]{2})(?:\s*[·|—–-]\s*)?(.+)$/u;

export type UkrainianPlateDisplayParts = {
  plate: string;
  prefix: string;
  suffix: string;
  placement: "leading" | "trailing";
};

export function normalizeUkrainianPlate(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function isStandardUkrainianPlate(value?: string | null) {
  return UKRAINIAN_STANDARD_PLATE.test(normalizeUkrainianPlate(value));
}

export function parseUkrainianPlateDisplay(value?: string | null): UkrainianPlateDisplayParts | null {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (isStandardUkrainianPlate(trimmed)) {
    return { plate: normalizeUkrainianPlate(trimmed), prefix: "", suffix: "", placement: "trailing" };
  }

  const trailing = trimmed.match(TRAILING_PLATE);
  if (trailing && trailing.index != null && isStandardUkrainianPlate(trailing[1])) {
    const rawPrefix = trimmed.slice(0, trailing.index).trim();
    if (rawPrefix.length <= 34) {
      return {
        plate: normalizeUkrainianPlate(trailing[1]),
        prefix: LABELED_PREFIX.test(rawPrefix) ? "" : rawPrefix,
        suffix: "",
        placement: "trailing",
      };
    }
  }

  const leading = trimmed.match(LEADING_PLATE);
  if (leading && isStandardUkrainianPlate(leading[1])) {
    const suffix = leading[2].trim();
    if (suffix.length <= 34) {
      return {
        plate: normalizeUkrainianPlate(leading[1]),
        prefix: "",
        suffix,
        placement: "leading",
      };
    }
  }
  return null;
}

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  value?: string | null;
  size?: "sm" | "md" | "lg";
  fallback?: string;
};

export function UkrainianLicensePlate({ value, size = "md", fallback = "—", className = "", ...props }: Props) {
  const normalized = normalizeUkrainianPlate(value);
  if (!normalized) return <span className={className} {...props}>{fallback}</span>;
  if (!isStandardUkrainianPlate(normalized)) return <span className={className} {...props}>{String(value)}</span>;

  return <span
    {...props}
    className={`uaLicensePlate ${className}`.trim()}
    data-ua-license-plate="true"
    data-plate-text={normalized}
    data-plate-prefix=""
    data-plate-suffix=""
    data-plate-placement="trailing"
    data-plate-size={size}
    aria-label={`Державний номер ${normalized}`}
  >{normalized}</span>;
}
