"use client";

import { useEffect, useMemo, useState } from "react";

type Props = { brand?: string | null; size?: number; className?: string };

const BRAND_SLUGS: Record<string, string> = {
  AUDI: "audi", BMW: "bmw", MERCEDES: "mercedes", MERCEDESBENZ: "mercedes", BENZ: "mercedes",
  VOLKSWAGEN: "volkswagen", VW: "volkswagen", VOLVO: "volvo", FORD: "ford", TOYOTA: "toyota",
  LEXUS: "lexus", HONDA: "honda", ACURA: "acura", NISSAN: "nissan", INFINITI: "infiniti",
  MAZDA: "mazda", MITSUBISHI: "mitsubishi", SUBARU: "subaru", SUZUKI: "suzuki", HYUNDAI: "hyundai",
  KIA: "kia", SKODA: "skoda", ŠKODA: "skoda", RENAULT: "renault", DACIA: "dacia", PEUGEOT: "peugeot",
  CITROEN: "citroen", CITROËN: "citroen", OPEL: "opel", FIAT: "fiat", SEAT: "seat", CUPRA: "cupra",
  PORSCHE: "porsche", TESLA: "tesla", JEEP: "jeep", LANDROVER: "landrover", RANGEROVER: "landrover",
  JAGUAR: "jaguar", CHEVROLET: "chevrolet", CADILLAC: "cadillac", CHRYSLER: "chrysler", DODGE: "dodge",
  GMC: "gmc", ALFAROMEO: "alfaromeo", MINI: "mini", SMART: "smart", BENTLEY: "bentley", FERRARI: "ferrari",
  LAMBORGHINI: "lamborghini", MASERATI: "maserati", ASTONMARTIN: "astonmartin", ROLLSROYCE: "rollsroyce",
  BYD: "byd", GEELY: "geely", NIO: "nio", POLESTAR: "polestar", RIVIAN: "rivian",
};

function normalizeBrand(value: string) {
  return value.toUpperCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
}

export function VehicleBrandLogo({ brand, size = 42, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const label = (brand || "AUTO").trim() || "AUTO";
  const normalized = normalizeBrand(label);
  const slug = useMemo(() => BRAND_SLUGS[normalized] || normalized.toLowerCase(), [normalized]);
  const src = `https://cdn.simpleicons.org/${encodeURIComponent(slug)}?viewbox=auto`;

  useEffect(() => setFailed(false), [src]);

  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className={`vehicleBrandLogo ${className}`} style={{ width: size, height: size }} title={label}>
    {!failed ? <img src={src} alt={`${label} logo`} width={size - 14} height={size - 14} onError={() => setFailed(true)} /> : <b>{initials || "A"}</b>}
  </span>;
}
