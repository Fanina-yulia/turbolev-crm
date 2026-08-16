import type { HTMLAttributes } from "react";

const UKRAINIAN_STANDARD_PLATE = /^[A-ZА-ЯІЇЄ]{2}\d{4}[A-ZА-ЯІЇЄ]{2}$/u;

export function normalizeUkrainianPlate(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function isStandardUkrainianPlate(value?: string | null) {
  return UKRAINIAN_STANDARD_PLATE.test(normalizeUkrainianPlate(value));
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
    data-plate-size={size}
    aria-label={`Державний номер ${normalized}`}
  >{normalized}</span>;
}
