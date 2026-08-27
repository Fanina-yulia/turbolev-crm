"use client";

import { VehicleBrandLogo } from "./vehicle-brand-logo";
import { VehicleRender } from "./vehicle-render";
import { VehiclePlate as SharedVehiclePlate } from "./vehicle-plate";
import styles from "./vehicle-identity.module.css";

export type VehicleIdentityData = {
  id: string;
  plateNumber?: string | null;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  engineName?: string | null;
  fuelType?: string | null;
  driveType?: string | null;
  updatedAt?: string | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  exteriorColorConfirmed?: boolean;
};

type VehicleIdentityProps = {
  vehicle: VehicleIdentityData;
  variant?: "summary" | "choice" | "hero";
  showVin?: boolean;
};

export function vehicleIdentityTitle(vehicle: VehicleIdentityData) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Автомобіль";
}

export function VehiclePlate({ plateNumber, compact = false }: { plateNumber?: string | null; compact?: boolean }) {
  return <SharedVehiclePlate value={plateNumber} size={compact ? "xs" : "sm"}/>;
}

export function VehicleVisual({ vehicle, variant = "summary" }: { vehicle: VehicleIdentityData; variant?: "summary" | "choice" | "hero" }) {
  const renderSize = variant === "hero" ? "hero" : variant === "choice" ? "card" : "mini";
  return <span className={`${styles.visual} ${styles[`visual_${variant}`]}`}>
    <span className={styles.brandFallback}><VehicleBrandLogo brand={vehicle.brand} size={variant === "hero" ? 72 : 42}/></span>
    <VehicleRender
      id={vehicle.id}
      brand={vehicle.brand}
      model={vehicle.model}
      year={vehicle.year}
      updatedAt={vehicle.updatedAt}
      exteriorColorName={vehicle.exteriorColorName}
      exteriorColorHex={vehicle.exteriorColorHex}
      exteriorColorConfirmed={vehicle.exteriorColorConfirmed}
      size={renderSize}
      eager={variant === "hero"}
      className={styles.render}
    />
  </span>;
}

export function VehicleIdentity({ vehicle, variant = "summary", showVin = false }: VehicleIdentityProps) {
  const meta = [vehicle.year, vehicle.engineName, vehicle.fuelType, vehicle.driveType].filter(Boolean).join(" · ");
  return <span className={`${styles.identity} ${styles[`identity_${variant}`]}`}>
    <VehicleVisual vehicle={vehicle} variant={variant}/>
    <span className={styles.copy}>
      <strong className={styles.title}>{vehicleIdentityTitle(vehicle)}</strong>
      <VehiclePlate plateNumber={vehicle.plateNumber} compact={variant !== "hero"}/>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {showVin && vehicle.vin ? <span className={styles.vin}>VIN {vehicle.vin}</span> : null}
    </span>
  </span>;
}
