"use client";

import { useEffect, useState } from "react";
import { VehiclePlate, VehicleVisual, vehicleIdentityTitle } from "./vehicle-identity";

type VehicleCard = {
  id: string;
  plateNumber: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  engineName: string | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  turboLevClass: string | null;
  vehicleDataSource: string | null;
  vehicleDataConfidence: number | null;
  updatedAt?: string | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  exteriorColorConfirmed?: boolean;
  client: { id: string; name: string | null; phone: string };
};

type Props = {
  vehicleId: string | null;
  onClose: () => void;
};

function vehicleTitle(vehicle: VehicleCard) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function engineText(vehicle: VehicleCard) {
  if (vehicle.engineName) return vehicle.engineName;
  if (vehicle.engineVolumeCm3) return `${(vehicle.engineVolumeCm3 / 1000).toFixed(1)} л`;
  return "—";
}

function displayPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `38${digits}`;
  if (!digits.startsWith("380") && digits.length === 9) digits = `380${digits}`;
  if (digits.length !== 12) return value;
  const local = digits.slice(3);
  return `+380 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
}

export function CommunicationsVehicleCardDrawer({ vehicleId, onClose }: Props) {
  const [vehicle, setVehicle] = useState<VehicleCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!vehicleId) {
      setVehicle(null);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setVehicle(null);
    void (async () => {
      try {
        const response = await fetch(`/api/vehicles/card?id=${encodeURIComponent(vehicleId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as { ok?: boolean; vehicle?: VehicleCard; error?: string };
        if (!response.ok || !data.ok || !data.vehicle) throw new Error(data.error || "Не вдалося відкрити картку автомобіля");
        setVehicle(data.vehicle);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Не вдалося відкрити картку автомобіля");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [vehicleId]);

  if (!vehicleId) return null;

  function openFullSection() {
    if (!vehicle) return;
    onClose();
    window.dispatchEvent(new CustomEvent("turbolev:navigate", {
      detail: {
        section: "Клієнти та авто",
        filter: vehicle.plateNumber || vehicle.vin || vehicle.id,
        filterLabel: vehicle.plateNumber || vehicleTitle(vehicle),
      },
    }));
  }

  return <div className="communicationVehicleBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="communicationVehicleDrawer">
      <header className="communicationVehicleHead">
        <div>
          <p>КАРТКА АВТОМОБІЛЯ</p>
          <h2>{loading ? "Завантаження…" : vehicle ? vehicleIdentityTitle(vehicle) : "Автомобіль"}</h2>
        </div>
        <button type="button" className="communicationVehicleClose" onClick={onClose} aria-label="Закрити">×</button>
      </header>

      <div className="communicationVehicleBody">
        {loading ? <div className="communicationVehicleState">Завантажую дані автомобіля…</div> : error ? <div className="communicationVehicleError">{error}</div> : vehicle ? <>
          <section className="communicationVehicleHero">
            <VehicleVisual vehicle={vehicle} variant="hero"/>
            <div className="communicationVehicleHeroCopy">
              <strong>{vehicleIdentityTitle(vehicle)}</strong>
              <VehiclePlate plateNumber={vehicle.plateNumber}/>
              <span>{[vehicle.year, engineText(vehicle) !== "—" ? engineText(vehicle) : null, vehicle.fuelType].filter(Boolean).join(" · ") || "Технічні дані уточнюються"}</span>
              {vehicle.vin ? <code>VIN {vehicle.vin}</code> : null}
            </div>
          </section>

          <section className="communicationVehicleBlock">
            <div className="communicationVehicleBlockTitle"><strong>Власник</strong><span>контакт у CRM</span></div>
            <div className="communicationVehicleOwner"><strong>{vehicle.client.name || "Клієнт без імені"}</strong><span>{displayPhone(vehicle.client.phone)}</span></div>
          </section>

          <section className="communicationVehicleBlock">
            <div className="communicationVehicleBlockTitle"><strong>Технічні дані</strong><span>{vehicle.vehicleDataSource || "CRM"}{vehicle.vehicleDataConfidence ? ` · ${vehicle.vehicleDataConfidence}%` : ""}</span></div>
            <div className="communicationVehicleFacts">
              <Fact label="VIN" value={vehicle.vin || "—"}/>
              <Fact label="Двигун" value={engineText(vehicle)}/>
              <Fact label="Паливо" value={vehicle.fuelType || "—"}/>
              <Fact label="Привід" value={vehicle.driveType || "—"}/>
              <Fact label="Кузов" value={vehicle.bodyType || "—"}/>
              <Fact label="Пробіг" value={vehicle.mileageKm ? `${vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}/>
              <Fact label="Клас Turbo LEV" value={vehicle.turboLevClass || "—"}/>
            </div>
          </section>
        </> : null}
      </div>

      {vehicle && <footer className="communicationVehicleActions"><button type="button" onClick={openFullSection}>Відкрити у «Клієнти та авто» →</button></footer>}
    </aside>
    <style jsx global>{`
      .communicationVehicleBackdrop{position:fixed;inset:0;z-index:1250;background:rgba(8,12,18,.42);display:flex;justify-content:flex-end;backdrop-filter:blur(2px)}
      .communicationVehicleDrawer{width:min(560px,96vw);height:100%;display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--line);box-shadow:-24px 0 60px rgba(0,0,0,.25);color:var(--text)}
      .communicationVehicleHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line);background:var(--panel)}
      .communicationVehicleHead p{margin:0;color:var(--orange);font-size:12px;font-weight:900;letter-spacing:.12em}.communicationVehicleHead h2{margin:5px 0 0;font-size:24px;line-height:1.15}
      .communicationVehicleClose{flex:none;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--text);font-size:24px;cursor:pointer}
      .communicationVehicleBody{min-height:0;flex:1;overflow:auto;padding:16px;display:grid;align-content:start;gap:12px}.communicationVehicleState,.communicationVehicleError{padding:28px;text-align:center;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--muted);font-size:13px}.communicationVehicleError{color:#dc2626}
      .communicationVehicleHero{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:14px;display:grid;gap:10px}.communicationVehicleHeroCopy{display:flex;flex-direction:column;align-items:flex-start;gap:7px}.communicationVehicleHeroCopy>strong{font-size:20px}.communicationVehicleHeroCopy>span{color:var(--muted);font-size:13px}.communicationVehicleHeroCopy code{color:var(--muted);font-size:12px}
      .communicationVehicleBlock{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:14px}.communicationVehicleBlockTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.communicationVehicleBlockTitle strong{font-size:14px}.communicationVehicleBlockTitle span{color:var(--muted);font-size:12px}.communicationVehicleOwner{display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:12px;background:var(--surface);border:1px solid var(--line);padding:12px}.communicationVehicleOwner strong{font-size:14px}.communicationVehicleOwner span{color:var(--muted);font-size:13px}
      .communicationVehicleFacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.communicationVehicleFact{border:1px solid var(--line);border-radius:11px;background:var(--surface);padding:10px}.communicationVehicleFact span{display:block;color:var(--muted);font-size:12px}.communicationVehicleFact strong{display:block;margin-top:4px;font-size:13px;overflow-wrap:anywhere}
      .communicationVehicleActions{padding:14px 18px;border-top:1px solid var(--line);background:var(--panel)}.communicationVehicleActions button{width:100%;height:44px;border:0;border-radius:11px;background:var(--orange);color:#111;font-weight:850;font-size:13px;cursor:pointer}
      @media(max-width:620px){.communicationVehicleFacts{grid-template-columns:1fr}.communicationVehicleHead{padding:16px}.communicationVehicleBody{padding:12px}}
    `}</style>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="communicationVehicleFact"><span>{label}</span><strong>{value}</strong></div>;
}