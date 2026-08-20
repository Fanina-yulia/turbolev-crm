import styles from "./vehicle-plate.module.css";

type VehiclePlateSize = "xs" | "sm" | "md";

type VehiclePlateProps = {
  value?: string | null;
  size?: VehiclePlateSize;
  className?: string;
  title?: string;
};

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  І: "I",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  У: "Y",
};

export function normalizeVehiclePlate(value?: string | null) {
  const source = (value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-–—·.]/g, "");
  return [...source].map((char) => CYRILLIC_TO_LATIN[char] || char).join("");
}

export function formatVehiclePlate(value?: string | null) {
  const normalized = normalizeVehiclePlate(value);
  const standard = normalized.match(/^([A-Z]{2})(\d{4})([A-Z]{2})$/);
  if (standard) return `${standard[1]} ${standard[2]} ${standard[3]}`;
  return (value || "—").trim() || "—";
}

export function VehiclePlate({ value, size = "sm", className = "", title }: VehiclePlateProps) {
  const normalized = normalizeVehiclePlate(value);
  const display = formatVehiclePlate(value);
  const empty = !normalized || normalized === "—";

  if (empty) return <span className={`${styles.empty} ${className}`}>Без держномера</span>;

  return <span
    className={`${styles.plate} ${styles[size]} ${className}`}
    data-vehicle-plate="true"
    data-plate={normalized}
    title={title || `Державний номер ${display}`}
    aria-label={`Державний номер ${display}`}
  >
    <span className={styles.uaBand} aria-hidden="true"><i /><b>UA</b></span>
    <span className={styles.number}>{display}</span>
  </span>;
}
