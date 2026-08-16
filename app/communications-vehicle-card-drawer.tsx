"use client";

import { useEffect, useState } from "react";
import { VehicleBrandLogo } from "./vehicle-brand-logo";

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
        <div className="communicationVehicleTitle">
          {vehicle ? <VehicleBrandLogo brand={vehicle.brand} size={50}/> : <div className="communicationVehicleLogoSkeleton"/>}
          <div>
            <p>КАРТКА АВТОМОБІЛЯ</p>
            <h2>{loading ? "Завантаження…" : vehicle ? vehicleTitle(vehicle) : "Автомобіль"}</h2>
            {vehicle && <span>{vehicle.plateNumber ? `ДержЗнак: ${vehicle.plateNumber}` : "ДержЗнак не вказано"}{vehicle.vin ? ` · VIN ${vehicle.vin}` : ""}</span>}
          </div>
        </div>
        <button type="button" className="communicationVehicleClose" onClick={onClose} aria-label="Закрити">×</button>
      </header>

      <div className="communicationVehicleBody">
        {loading ? <div className="communicationVehicleState">Завантажую дані автомобіля…</div> : error ? <div className="communicationVehicleError">{error}</div> : vehicle ? <>
          <section className="communicationVehicleBlock">
            <div className="communicationVehicleBlockTitle"><strong>Власник</strong><span>контакт у CRM</span></div>
            <div className="communicationVehicleOwner"><strong>{vehicle.client.name || "Клієнт без імені"}</strong><span>{vehicle.client.phone}</span></div>
          </section>
          <section className="communicationVehicleBlock">
            <div className="communicationVehicleBlockTitle"><strong>Технічні дані</strong><span>{vehicle.vehicleDataSource || "CRM"}{vehicle.vehicleDataConfidence ? ` · ${vehicle.vehicleDataConfidence}%` : ""}</span></div>
            <div className="communicationVehicleFacts">
              <Fact label="ДержЗнак" value={vehicle.plateNumber || "—"}/>
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
      .communicationVehicleBackdrop{position:fixed;inset:0;z-index:1250;background:rgba(8,12,18,.38);display:flex;justify-content:flex-end}
      .communicationVehicleDrawer{width:min(520px,96vw);height:100%;display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--line);box-shadow:-24px 0 60px rgba(0,0,0,.25);color:var(--text)}
      .communicationVehicleHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px;border-bottom:1px solid var(--line)}
      .communicationVehicleTitle{display:flex;align-items:center;gap:13px;min-width:0}.communicationVehicleTitle>div:last-child{min-width:0}.communicationVehicleTitle p{margin:0;color:var(--orange);font-size:9px;font-weight:900;letter-spacing:.14em}.communicationVehicleTitle h2{margin:5px 0 3px;font-size:23px;line-height:1.15}.communicationVehicleTitle span{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .communicationVehicleLogoSkeleton{width:50px;height:50px;border-radius:13px;background:var(--panel);border:1px solid var(--line)}
      .communicationVehicleClose{flex:none;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:var(--panel);color:var(--text);font-size:24px;cursor:pointer}
      .communicationVehicleBody{min-height:0;flex:1;overflow:auto;padding:18px;display:grid;align-content:start;gap:14px}.communicationVehicleState,.communicationVehicleError{padding:28px;text-align:center;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--muted);font-size:11px}.communicationVehicleError{color:#dc2626}
      .communicationVehicleBlock{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:15px}.communicationVehicleBlockTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.communicationVehicleBlockTitle strong{font-size:12px}.communicationVehicleBlockTitle span{color:var(--muted);font-size:9px}.communicationVehicleOwner{display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:12px;background:var(--surface);border:1px solid var(--line);padding:12px}.communicationVehicleOwner strong{font-size:13px}.communicationVehicleOwner span{color:var(--muted);font-size:10px}
      .communicationVehicleFacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.communicationVehicleFact{border:1px solid var(--line);border-radius:11px;background:var(--surface);padding:10px}.communicationVehicleFact span{display:block;color:var(--muted);font-size:8px}.communicationVehicleFact strong{display:block;margin-top:3px;font-size:11px;overflow-wrap:anywhere}
      .communicationVehicleActions{padding:14px 18px;border-top:1px solid var(--line);background:var(--panel)}.communicationVehicleActions button{width:100%;height:44px;border:0;border-radius:11px;background:var(--orange);color:#fff;font-weight:850;font-size:10px;cursor:pointer}
      @media(max-width:620px){.communicationVehicleFacts{grid-template-columns:1fr}.communicationVehicleHead{padding:16px}.communicationVehicleBody{padding:12px}}
    `}</style>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="communicationVehicleFact"><span>{label}</span><strong>{value}</strong></div>;
}
