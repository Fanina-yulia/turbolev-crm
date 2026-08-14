"use client";

import { useEffect, useState } from "react";

type Vehicle = { id: string; plateNumber?: string | null; vin?: string | null; brand?: string | null; model?: string | null; year?: number | null; engineName?: string | null; fuelType?: string | null; driveType?: string | null; vehicleDataSource?: string | null; vehicleDataConfidence?: number | null };
type ClientCard = { id: string; name?: string | null; phone: string; vehicles: Vehicle[] };
type Props = { open: boolean; name: string; phone?: string; existingLeadId?: string; onClose: () => void; onCreateLead: () => void };

export function ClientCardDrawer({ open, name, phone, existingLeadId, onClose, onCreateLead }: Props) {
  const [client, setClient] = useState<ClientCard | null>(null);
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadCard() {
    if (!phone) { setClient(null); return; }
    setLoading(true);
    try { const r = await fetch(`/api/client-card?phone=${encodeURIComponent(phone)}`, { cache: "no-store" }); const data = await r.json(); setClient(data.client || null); }
    catch { setClient(null); } finally { setLoading(false); }
  }
  useEffect(() => { if (open) { setPlate(""); setVin(""); setMessage(""); void loadCard(); } }, [open, phone]);
  if (!open) return null;

  async function saveVehicle() {
    if (!phone) return setMessage("Для створення карти клієнта потрібен номер телефону.");
    if (!plate.trim() && !vin.trim()) return setMessage("Вкажіть держномер або VIN автомобіля.");
    setSaving(true); setMessage("");
    try {
      const r = await fetch("/api/client-card", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, phone, plate: plate.trim(), vin: vin.trim() }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Не вдалося зберегти автомобіль");
      setClient(data.client); setPlate(""); setVin(""); setMessage(data.vehicle?.brand ? `Автомобіль додано: ${data.vehicle.brand} ${data.vehicle.model || ""}` : "Автомобіль додано до карти клієнта.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Помилка збереження"); } finally { setSaving(false); }
  }
  const go = (section: string) => { onClose(); window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: section })); };

  return <div className="clientDrawerBackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="clientDrawer"><div className="clientDrawerHead"><div><p>КАРТА КЛІЄНТА</p><h2>{client?.name || name || "Новий клієнт"}</h2><span>{phone || "Телефон не вказано"}</span></div><button onClick={onClose}>×</button></div>
      <div className="clientDrawerBody">
        <section className="clientBlock"><div className="clientBlockTitle"><b>Автомобілі клієнта</b><span>{client?.vehicles?.length || 0}</span></div>{loading ? <div className="clientEmpty">Завантаження…</div> : client?.vehicles?.length ? <div className="vehicleCards">{client.vehicles.map((v) => <article key={v.id}><strong>{[v.brand, v.model, v.year].filter(Boolean).join(" · ") || "Автомобіль"}</strong><small>{v.plateNumber || "Без держномера"}{v.vin ? ` · VIN ${v.vin}` : ""}</small><div className="vehicleMeta">{v.engineName && <span>{v.engineName}</span>}{v.fuelType && <span>{v.fuelType}</span>}{v.driveType && <span>{v.driveType}</span>}</div><footer>{v.vehicleDataSource || "CRM"}{v.vehicleDataConfidence ? ` · ${v.vehicleDataConfidence}%` : ""}</footer></article>)}</div> : <div className="clientEmpty">Автомобілі ще не додані.</div>}</section>
        <section className="clientBlock addVehicleBlock"><div className="clientBlockTitle"><b>Додати автомобіль</b><span>номер або VIN</span></div><label>Державний номер<input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="AA 1234 BB" /></label><div className="orLine"><span>або</span></div><label>VIN<input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={17} placeholder="17 символів VIN" /></label><button className="saveVehicle" disabled={saving || (!plate.trim() && !vin.trim())} onClick={() => void saveVehicle()}>{saving ? "Зберігаю…" : "+ Додати та розпізнати авто"}</button>{message && <div className="clientMessage">{message}</div>}</section>
        <section className="clientBlock processBlock"><div className="clientBlockTitle"><b>Далі по бізнес-процесу</b><span>контекст не губиться</span></div>{!existingLeadId ? <button className="processPrimary" onClick={onCreateLead}>Створити лід із цього звернення</button> : <button className="processPrimary" onClick={() => go("Ліди")}>Відкрити лід</button>}<button onClick={() => go("Планувальник")}>Записати на СТО</button><button onClick={() => go("Діагностика")}>Перейти до діагностики</button></section>
      </div>
    </aside>
    <style jsx global>{`.clientDrawerBackdrop{position:fixed;inset:0;z-index:1200;background:rgba(8,12,18,.38);display:flex;justify-content:flex-end}.clientDrawer{width:min(520px,96vw);height:100%;background:var(--surface);border-left:1px solid var(--line);box-shadow:-24px 0 60px rgba(0,0,0,.25);display:flex;flex-direction:column}.clientDrawerHead{display:flex;justify-content:space-between;gap:16px;padding:22px;border-bottom:1px solid var(--line)}.clientDrawerHead p{margin:0;color:var(--orange);font-size:10px;font-weight:800;letter-spacing:.14em}.clientDrawerHead h2{margin:5px 0 3px;font-size:24px}.clientDrawerHead span{font-size:12px;color:var(--muted)}.clientDrawerHead>button{width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:var(--panel);color:var(--text);font-size:24px}.clientDrawerBody{padding:18px;overflow:auto;display:grid;gap:14px}.clientBlock{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:15px}.clientBlockTitle{display:flex;justify-content:space-between;gap:10px;margin-bottom:12px}.clientBlockTitle span{font-size:11px;color:var(--muted)}.clientEmpty{padding:20px;text-align:center;color:var(--muted);font-size:12px}.vehicleCards{display:grid;gap:8px}.vehicleCards article{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px}.vehicleCards article strong{display:block;font-size:14px}.vehicleCards article small{display:block;margin-top:4px;color:var(--muted)}.vehicleMeta{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.vehicleMeta span{font-size:10px;border:1px solid var(--line);border-radius:999px;padding:4px 7px}.vehicleCards footer{margin-top:9px;font-size:9px;color:var(--muted)}.addVehicleBlock label{display:grid;gap:6px;font-size:11px;color:var(--muted)}.addVehicleBlock input{border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text);padding:12px;font:inherit}.orLine{display:flex;align-items:center;gap:8px;margin:10px 0;color:var(--muted);font-size:10px}.orLine:before,.orLine:after{content:'';height:1px;background:var(--line);flex:1}.saveVehicle,.processPrimary{width:100%;margin-top:12px;border:0;border-radius:11px;background:var(--orange);color:#111;padding:12px;font-weight:800}.saveVehicle:disabled{opacity:.4}.clientMessage{margin-top:10px;font-size:11px;color:var(--muted)}.processBlock{display:grid;gap:8px}.processBlock .clientBlockTitle{margin-bottom:2px}.processBlock button:not(.processPrimary){border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:11px;padding:11px;font-weight:700}.processBlock .processPrimary{margin-top:6px}`}</style>
  </div>;
}
