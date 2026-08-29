import styles from "./vehicle-plate.module.css";
import { formatRegistrationPlate, normalizeRegistrationPlate } from "../src/domain/registration-plate";

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

  if (empty) return <span className={`${styles.empty} ${className}`}>Без держномера</span>;

  return <span
    className={`${styles.plate} ${styles[size]} ${className}`}
    data-vehicle-plate="true"
    data-plate-standard="turbo-lev-reference-v2"
    data-plate-aspect="4.98"
    data-plate={normalized}
    title={title || `Державний номер ${display}`}
    aria-label={`Державний номер ${display}`}
  >
    <span className={styles.uaBand} aria-hidden="true"><i /><b>UA</b></span>
    <span className={styles.number}>{display}</span>
  </span>;
}
