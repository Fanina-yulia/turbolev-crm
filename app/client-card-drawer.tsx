"use client";

import { useEffect, useMemo, useState } from "react";
import { VehicleBrandLogo } from "./vehicle-brand-logo";

type Vehicle = {
  id:string;
  plateNumber?:string|null;
  vin?:string|null;
  brand?:string|null;
  model?:string|null;
  year?:number|null;
  engineName?:string|null;
  fuelType?:string|null;
  driveType?:string|null;
  vehicleDataSource?:string|null;
  vehicleDataConfidence?:number|null;
};
type ClientPhone = { id:string; phone:string; phoneNormalized:string; label?:string|null; isPrimary:boolean };
type ServiceHistory = { id:string; vehicleId:string; status:string; createdAt:string; updatedAt:string; closedAt?:string|null };
type ClientCard = { id:string; name?:string|null; phone:string; phones:ClientPhone[]; vehicles:Vehicle[]; serviceHistory:ServiceHistory[] };
type Props = {
  open:boolean;
  name:string;
  phone?:string;
  channel?:string;
  existingLeadId?:string;
  onClose:()=>void;
  onCreateLead:()=>void;
};

function normalizePhone(value:string){
  let digits=value.replace(/\D/g,"");
  if(digits.startsWith("0"))digits=`38${digits}`;
  if(!digits.startsWith("380")&&digits.length===9)digits=`380${digits}`;
  return digits.slice(0,12);
}
function displayPhone(value:string){
  const digits=normalizePhone(value);
  if(digits.length!==12)return value;
  const local=digits.slice(3);
  return `+380 ${local.slice(0,2)} ${local.slice(2,5)} ${local.slice(5,7)} ${local.slice(7,9)}`.trim();
}
function displayDate(value:string){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "—";
  return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",year:"numeric"}).format(date);
}
function sourceLabel(channel?:string){
  return channel==="BINOTEL"?"Binotel":channel==="INSTAGRAM"?"Instagram":channel==="FACEBOOK"?"Facebook":channel==="TIKTOK"?"TikTok":channel==="OLX"?"OLX":channel==="WEBSITE"?"Сайт":"Інше";
}

export function ClientCardDrawer({open,name,phone,channel,existingLeadId,onClose,onCreateLead}:Props){
  const[client,setClient]=useState<ClientCard|null>(null);
  const[loading,setLoading]=useState(false);
  const[savingContact,setSavingContact]=useState(false);
  const[savingVehicle,setSavingVehicle]=useState(false);
  const[message,setMessage]=useState("");
  const[nameDraft,setNameDraft]=useState("");
  const[primaryPhoneDraft,setPrimaryPhoneDraft]=useState("");
  const[additionalPhoneDraft,setAdditionalPhoneDraft]=useState("");
  const[additionalPhoneId,setAdditionalPhoneId]=useState<string|null>(null);
  const[activeVehicleId,setActiveVehicleId]=useState("");
  const[addingVehicle,setAddingVehicle]=useState(false);
  const[plate,setPlate]=useState("");
  const[vin,setVin]=useState("");
  const[showVinFallback,setShowVinFallback]=useState(false);
  const[historyOpen,setHistoryOpen]=useState(false);

  function applyClient(next:ClientCard|null,fallbackName=name,fallbackPhone=phone||""){
    setClient(next);
    setNameDraft(next?.name||fallbackName||"");
    const primary=next?.phones?.find(item=>item.isPrimary);
    const additional=next?.phones?.find(item=>!item.isPrimary);
    setPrimaryPhoneDraft(displayPhone(primary?.phone||next?.phone||fallbackPhone));
    setAdditionalPhoneDraft(additional?.phone?displayPhone(additional.phone):"");
    setAdditionalPhoneId(additional?.id||null);
    setActiveVehicleId(current=>next?.vehicles?.some(vehicle=>vehicle.id===current)?current:next?.vehicles?.[0]?.id||"");
  }

  async function ensureContact(primaryPhone=primaryPhoneDraft,allowAutoCreate=false){
    const normalized=normalizePhone(primaryPhone);
    if(normalized.length!==12)throw new Error("Вкажіть коректний основний номер телефону.");
    const response=await fetch("/api/client-card",{
      method:"PUT",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        clientId:client?.id,
        name:nameDraft||name,
        primaryPhone,
        additionalPhone:additionalPhoneDraft,
        additionalPhoneId,
        sourceChannel:channel,
        autoCreate:allowAutoCreate,
      }),
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Не вдалося зберегти клієнта");
    applyClient(data.client,name,primaryPhone);
    window.dispatchEvent(new CustomEvent("turbolev:data-changed",{detail:{entity:"client",clientId:data.client.id}}));
    return data.client as ClientCard;
  }

  async function loadCard(){
    const incoming=phone||"";
    setLoading(true);
    try{
      if(normalizePhone(incoming).length!==12){applyClient(null,name,incoming);return}
      const response=await fetch(`/api/client-card?phone=${encodeURIComponent(incoming)}`,{cache:"no-store"});
      const data=await response.json();
      if(data.client){applyClient(data.client,name,incoming);return}
      applyClient(null,name,incoming);
      if(channel==="BINOTEL"){
        const created=await fetch("/api/client-card",{
          method:"PUT",headers:{"content-type":"application/json"},
          body:JSON.stringify({name,primaryPhone:incoming,sourceChannel:"BINOTEL",autoCreate:true}),
        });
        const createdData=await created.json();
        if(created.ok&&createdData.client)applyClient(createdData.client,name,incoming);
      }
    }catch{applyClient(null,name,incoming)}finally{setLoading(false)}
  }

  useEffect(()=>{
    if(!open)return;
    setMessage("");setAddingVehicle(false);setPlate("");setVin("");setShowVinFallback(false);setHistoryOpen(false);
    setNameDraft(name||"");setPrimaryPhoneDraft(phone?displayPhone(phone):"");setAdditionalPhoneDraft("");setAdditionalPhoneId(null);
    void loadCard();
  },[open,phone,channel]);

  const activeVehicle=useMemo(()=>client?.vehicles?.find(vehicle=>vehicle.id===activeVehicleId)||client?.vehicles?.[0]||null,[client,activeVehicleId]);
  const vehicleHistory=useMemo(()=>client?.serviceHistory?.filter(item=>item.vehicleId===activeVehicle?.id)||[],[client,activeVehicle]);
  const activeWorkOrder=vehicleHistory.find(item=>!item.closedAt&&!["CLOSED","CANCELLED"].includes(item.status))||null;

  if(!open)return null;

  async function saveContact(){
    setSavingContact(true);setMessage("");
    try{await ensureContact(primaryPhoneDraft);setMessage("Дані клієнта збережено.")}catch(error){setMessage(error instanceof Error?error.message:"Помилка збереження")}finally{setSavingContact(false)}
  }

  async function saveVehicle(){
    if(!plate.trim()&&!vin.trim())return setMessage("Вкажіть державний номер автомобіля.");
    setSavingVehicle(true);setMessage("");
    try{
      const savedClient=client||await ensureContact(primaryPhoneDraft);
      const response=await fetch("/api/client-card",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({name:nameDraft||name,phone:savedClient.phone||primaryPhoneDraft,plate:plate.trim(),vin:vin.trim()}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Не вдалося зберегти автомобіль");
      applyClient(data.client,name,savedClient.phone);
      setActiveVehicleId(data.vehicle?.id||data.client?.vehicles?.[0]?.id||"");
      if(data.vehicle?.vin){
        setPlate("");setVin("");setShowVinFallback(false);setAddingVehicle(false);
        setMessage(`Автомобіль розпізнано: ${[data.vehicle.brand,data.vehicle.model].filter(Boolean).join(" ")||data.vehicle.plateNumber||"авто"}.`);
      }else{
        setShowVinFallback(true);
        setMessage("Автомобіль збережено, але VIN автоматично не знайдено. За потреби введіть VIN вручну.");
      }
      window.dispatchEvent(new CustomEvent("turbolev:data-changed",{detail:{entity:"vehicle",vehicleId:data.vehicle?.id,clientId:data.client?.id}}));
    }catch(error){setMessage(error instanceof Error?error.message:"Помилка збереження автомобіля")}finally{setSavingVehicle(false)}
  }

  function openDiagnosticBooking(){
    if(!activeVehicle){setAddingVehicle(true);setMessage("Спочатку додайте автомобіль клієнта.");return}
    onClose();
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request",{detail:{
      name:nameDraft||client?.name||name,
      phone:primaryPhoneDraft||client?.phone||phone,
      source:sourceLabel(channel),
      plate:activeVehicle.plateNumber||"",
      vin:activeVehicle.vin||"",
    }}));
  }
  function navigate(section:string,filter?:string,filterLabel?:string){
    onClose();
    window.dispatchEvent(new CustomEvent("turbolev:navigate",{detail:filter?{section,filter,filterLabel}:section}));
  }
  function openHistory(){
    if(!activeVehicle)return setMessage("Оберіть автомобіль.");
    if(!vehicleHistory.length)return setMessage("Для цього автомобіля історії обслуговування ще немає.");
    navigate("Замовлення-наряди",activeVehicle.id,`Історія ${activeVehicle.plateNumber||activeVehicle.brand||"авто"}`);
  }
  function openCommercial(){
    if(!activeWorkOrder)return setMessage("Комерційна пропозиція доступна після підтвердженої діагностики та створення замовлення-наряду.");
    navigate("Замовлення-наряди",activeWorkOrder.id,"Комерційна пропозиція");
  }
  function openActive(){
    if(existingLeadId){navigate("Ліди",existingLeadId,"Активне звернення");return}
    onCreateLead();
  }

  const headerPhone=client?.phones?.find(item=>item.isPrimary)?.phone||client?.phone||primaryPhoneDraft||phone||"Телефон не вказано";
  return <div className="clientDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="clientDrawer clientWorkCenter">
      <div className="clientDrawerHead"><div><p>КАРТА КЛІЄНТА</p><h2>{client?.name||nameDraft||name||"Без імені"}</h2><span>{displayPhone(headerPhone)}{channel?` · ${sourceLabel(channel)}`:""}</span></div><button type="button" onClick={onClose}>×</button></div>
      <div className="clientDrawerBody">
        <section className="clientBlock contactCompact">
          <div className="clientBlockTitle"><b>Контакт</b><span>{channel==="BINOTEL"?"номер з Binotel зберігається автоматично":"можна редагувати"}</span></div>
          <label>Ім’я клієнта<input value={nameDraft} onChange={event=>setNameDraft(event.target.value)} placeholder="Без імені"/></label>
          <div className="twoPhones">
            <label><span>Основний номер</span><input value={primaryPhoneDraft} onChange={event=>setPrimaryPhoneDraft(event.target.value)} inputMode="tel" placeholder="+380 67 123 45 67"/></label>
            <label><span>Додатковий номер</span><input value={additionalPhoneDraft} onChange={event=>setAdditionalPhoneDraft(event.target.value)} inputMode="tel" placeholder="+380 67 123 45 67"/></label>
          </div>
          <button className="saveContact" type="button" disabled={savingContact||normalizePhone(primaryPhoneDraft).length!==12} onClick={()=>void saveContact()}>{savingContact?"Зберігаю…":"Зберегти дані клієнта"}</button>
          {message&&<div className="clientMessage">{message}</div>}
        </section>

        <section className="clientBlock vehiclesBlock">
          <div className="clientBlockTitle"><b>Автомобілі</b><button className="addVehicleToggle" type="button" onClick={()=>setAddingVehicle(value=>!value)}>{addingVehicle?"Скасувати":"+ Автомобіль"}</button></div>
          {loading?<div className="clientEmpty">Завантаження…</div>:client?.vehicles?.length?<div className="vehicleCards compact">{client.vehicles.map(vehicle=>{
            const selected=activeVehicle?.id===vehicle.id;
            const count=client.serviceHistory?.filter(item=>item.vehicleId===vehicle.id).length||0;
            return <button type="button" className={`vehicleChoice ${selected?"active":""}`} key={vehicle.id} onClick={()=>{setActiveVehicleId(vehicle.id);setHistoryOpen(false)}}>
              <VehicleBrandLogo brand={vehicle.brand} size={48}/>
              <span className="vehicleChoiceMain"><strong>{[vehicle.brand,vehicle.model].filter(Boolean).join(" ")||"Автомобіль"}</strong><small>{[vehicle.year,vehicle.plateNumber].filter(Boolean).join(" · ")||"Без держномера"}</small><span className="vehicleVin">VIN: {vehicle.vin||"не визначено"}</span><span className="vehicleFacts">{[vehicle.engineName,vehicle.fuelType,vehicle.driveType].filter(Boolean).join(" · ")||"Дані уточнюються"}</span></span>
              <span className="vehicleHistoryCount">{count} істор.</span>
            </button>;
          })}</div>:<div className="clientEmpty">Автомобілі ще не додані. Натисніть «+ Автомобіль».</div>}

          {addingVehicle&&<div className="vehicleAddCompact">
            <label>Державний номер<input value={plate} onChange={event=>setPlate(event.target.value.toUpperCase())} placeholder="BK 6098 CA"/></label>
            {showVinFallback&&<label>VIN вручну<input value={vin} onChange={event=>setVin(event.target.value.toUpperCase().replace(/\s/g,""))} maxLength={17} placeholder="17 символів VIN"/></label>}
            <button type="button" disabled={savingVehicle||(!plate.trim()&&!vin.trim())} onClick={()=>void saveVehicle()}>{savingVehicle?"Шукаю…":showVinFallback?"Зберегти VIN":"Знайти та додати авто"}</button>
            <small>Спочатку шукаємо авто за держномером і підтягуємо VIN, марку, модель та технічні дані. VIN вручну просимо лише якщо реєстр його не повернув.</small>
          </div>}
        </section>

        {activeVehicle&&<section className="clientBlock activeVehicleBlock">
          <div className="clientBlockTitle"><b>Активне авто</b><span>{activeVehicle.plateNumber||"без номера"}</span></div>
          <div className="activeVehicleSummary"><VehicleBrandLogo brand={activeVehicle.brand} size={58}/><div><strong>{[activeVehicle.brand,activeVehicle.model,activeVehicle.year].filter(Boolean).join(" · ")||"Автомобіль"}</strong><span>{activeVehicle.plateNumber||"Без держномера"}</span><small>VIN {activeVehicle.vin||"не визначено"}</small></div></div>
          {historyOpen&&<div className="inlineHistory">{vehicleHistory.length?vehicleHistory.map(item=><div key={item.id}><span>{displayDate(item.createdAt)}</span><strong>{item.status}</strong><button type="button" onClick={()=>navigate("Замовлення-наряди",item.id,"Історія обслуговування")}>Відкрити</button></div>):<p>Історії обслуговування ще немає.</p>}</div>}
        </section>}

        <section className="clientBlock actionsBlock">
          <div className="clientBlockTitle"><b>Наступна дія</b><span>для вибраного авто</span></div>
          <button className="nextAction" type="button" onClick={activeWorkOrder?()=>navigate("Замовлення-наряди",activeWorkOrder.id,"Поточний ремонт"):openDiagnosticBooking}>{activeWorkOrder?"Відкрити поточний ремонт":"Записати на діагностику"}</button>
          <div className="actionGrid">
            <button type="button" onClick={()=>{if(vehicleHistory.length)setHistoryOpen(value=>!value);else void openHistory()}}>Історія обслуговування</button>
            <button type="button" className={!activeWorkOrder?"softDisabled":""} onClick={openCommercial}>Комерційна пропозиція</button>
            <button type="button" onClick={onClose}>Комунікації</button>
            <button type="button" onClick={openActive}>{existingLeadId?"Відкрити в Активних":"+ Додати в Активні"}</button>
          </div>
          {!activeWorkOrder&&<small className="gateHint">КП з’являється після підтвердженої діагностики — Hard Gate бізнес-процесу не обходимо.</small>}
        </section>
      </div>
    </aside>
    <style jsx global>{`
      .clientDrawerBackdrop{position:fixed;inset:0;z-index:1200;background:rgba(8,12,18,.42);display:flex;justify-content:flex-end;backdrop-filter:blur(2px)}
      .clientDrawer{width:min(560px,96vw);height:100%;background:var(--surface);border-left:1px solid var(--line);box-shadow:-24px 0 60px rgba(0,0,0,.25);display:flex;flex-direction:column;color:var(--text)}
      .clientDrawerHead{display:flex;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line);background:var(--panel)}.clientDrawerHead p{margin:0;color:var(--orange);font-size:9px;font-weight:900;letter-spacing:.14em}.clientDrawerHead h2{margin:5px 0 3px;font-size:23px}.clientDrawerHead span{font-size:11px;color:var(--muted)}.clientDrawerHead>button{width:38px;height:38px;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--text);font-size:22px;cursor:pointer}
      .clientDrawerBody{padding:14px;overflow:auto;display:grid;gap:10px}.clientBlock{border:1px solid var(--line);border-radius:15px;background:var(--panel);padding:14px}.clientBlockTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.clientBlockTitle b{font-size:14px}.clientBlockTitle span{font-size:9px;color:var(--muted)}
      .contactCompact>label,.vehicleAddCompact label{display:grid;gap:5px;color:var(--muted);font-size:9px}.contactCompact input,.vehicleAddCompact input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);padding:10px 11px;font:inherit;font-size:11px;outline:none}.contactCompact input:focus,.vehicleAddCompact input:focus{border-color:var(--orange)}.twoPhones{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.twoPhones label{display:grid;gap:5px}.twoPhones label>span{font-size:9px;color:var(--muted)}.saveContact{width:100%;margin-top:9px;border:0;border-radius:10px;background:var(--orange);color:#111;padding:10px;font-weight:850;cursor:pointer}.saveContact:disabled{opacity:.45}.clientMessage{margin-top:9px;border-radius:9px;background:color-mix(in srgb,var(--orange) 10%,transparent);padding:8px 9px;font-size:9px}.clientEmpty{padding:15px;text-align:center;color:var(--muted);font-size:10px}
      .addVehicleToggle{border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);padding:6px 9px;font-size:9px;font-weight:800;cursor:pointer}.vehicleCards.compact{display:grid;gap:7px}.vehicleChoice{width:100%;display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:9px;align-items:center;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);padding:9px;text-align:left;cursor:pointer}.vehicleChoice.active{border-color:var(--orange);box-shadow:inset 3px 0 0 var(--orange);background:color-mix(in srgb,var(--orange) 5%,var(--surface))}.vehicleChoiceMain{min-width:0}.vehicleChoiceMain strong{display:block;font-size:12px}.vehicleChoiceMain small,.vehicleVin,.vehicleFacts{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:8px}.vehicleVin{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.vehicleHistoryCount{border:1px solid var(--line);border-radius:999px;padding:4px 6px;color:var(--muted);font-size:7px}.vehicleAddCompact{margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:grid;gap:8px}.vehicleAddCompact button{border:0;border-radius:10px;background:var(--orange);color:#111;padding:10px;font-size:10px;font-weight:850;cursor:pointer}.vehicleAddCompact button:disabled{opacity:.45}.vehicleAddCompact small{color:var(--muted);font-size:8px;line-height:1.45}
      .activeVehicleSummary{display:grid;grid-template-columns:62px 1fr;gap:10px;align-items:center}.activeVehicleSummary strong{display:block;font-size:14px}.activeVehicleSummary span,.activeVehicleSummary small{display:block;margin-top:3px;color:var(--muted);font-size:9px}.inlineHistory{margin-top:11px;border-top:1px solid var(--line);padding-top:8px;display:grid;gap:5px}.inlineHistory>div{display:grid;grid-template-columns:80px 1fr auto;gap:7px;align-items:center;border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:7px 8px;font-size:8px}.inlineHistory button{border:0;background:transparent;color:var(--orange);font-size:8px;font-weight:800;cursor:pointer}.inlineHistory p{margin:0;color:var(--muted);font-size:9px}
      .nextAction{width:100%;border:0;border-radius:11px;background:var(--orange);color:#111;padding:12px;font-size:11px;font-weight:900;cursor:pointer}.actionGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.actionGrid button{min-height:40px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);padding:8px;font-size:9px;font-weight:800;cursor:pointer}.actionGrid button:hover{border-color:var(--orange)}.actionGrid button.softDisabled{color:var(--muted);border-style:dashed}.gateHint{display:block;margin-top:8px;color:var(--muted);font-size:8px;line-height:1.45}
      @media(max-width:560px){.clientDrawer{width:100vw}.twoPhones,.actionGrid{grid-template-columns:1fr}.clientDrawerBody{padding:10px}}
    `}</style>
  </div>;
}
