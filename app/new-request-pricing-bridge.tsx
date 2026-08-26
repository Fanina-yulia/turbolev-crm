"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./new-request-pricing-bridge.module.css";

type VehicleSnapshot = {
  make:string;
  model:string;
  year:string;
  engine:string;
  engineVolume:string;
  fuelType:string;
  bodyType:string;
  grossWeight:string;
  driveType:string;
  vehicleType:string;
};
type PricingMeta = {
  pricingVehicleType:string;
  pricingVehicleTypeLabel:string;
  coefficient:number;
  source?:string;
};
type WorkPriceItem = {
  id:string;
  code:string|null;
  category:string;
  name:string;
  unit:string;
  normHours:number|null;
  complexSurcharge:number|null;
  note:string;
  basePrice:number;
  coefficient:number;
  adjustedPrice:number;
};
type DraftLine = {
  id:string;
  code:string|null;
  category:string;
  name:string;
  unit:string;
  basePrice:number;
  quantity:number;
};
type CalculatedLine = DraftLine & {
  coefficient:number;
  subtotal:number;
  manualAdjustmentPercent:number;
  total:number;
  pricingVehicleType:string;
  pricingVehicleTypeLabel:string;
};
type Calculation = { pricing:PricingMeta; total:number; lines:CalculatedLine[] };
type WorkPriceResponse = { ok:boolean; pricing:PricingMeta; items:WorkPriceItem[]; error?:string };
type CalculationResponse = { ok:boolean; pricing:PricingMeta; total:number; lines:CalculatedLine[]; error?:string };
type ManualWork = { id:string; name:string };

const EMPTY_VEHICLE:VehicleSnapshot={make:"",model:"",year:"",engine:"",engineVolume:"",fuelType:"",bodyType:"",grossWeight:"",driveType:"",vehicleType:""};

function normalizedLabel(value:string){return value.replace(/\*/g,"").replace(/\s+/g," ").trim().toLocaleLowerCase("uk-UA")}
function fieldValue(root:HTMLElement,labelText:string){
  const wanted=normalizedLabel(labelText);
  for(const label of Array.from(root.querySelectorAll("label"))){
    const caption=label.querySelector("span")?.textContent||"";
    if(!normalizedLabel(caption).startsWith(wanted))continue;
    const control=label.querySelector("input,select,textarea") as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null;
    if(control)return control.value;
  }
  return "";
}
function readVehicle(root:HTMLElement):VehicleSnapshot{return{
  make:fieldValue(root,"Марка"),model:fieldValue(root,"Модель"),year:fieldValue(root,"Рік"),engine:fieldValue(root,"Двигун / модифікація"),engineVolume:fieldValue(root,"Об’єм двигуна"),fuelType:fieldValue(root,"Паливо"),bodyType:fieldValue(root,"Тип кузова"),grossWeight:fieldValue(root,"Повна маса"),driveType:fieldValue(root,"Привід"),vehicleType:fieldValue(root,"Тип ТЗ"),
}}
function vehicleKey(value:VehicleSnapshot){return Object.values(value).join("|")}
function sameVehicle(a:VehicleSnapshot,b:VehicleSnapshot){return vehicleKey(a)===vehicleKey(b)}
function stepNumber(root:HTMLElement){const text=root.querySelector(".requestStepTitle small")?.textContent||"";return Number(/(\d+)/.exec(text)?.[1]||0)}
function money(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:0}).format(value)+" грн"}

export function NewRequestPricingBridge(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [step,setStep]=useState(0);
  const [vehicle,setVehicle]=useState<VehicleSnapshot>(EMPTY_VEHICLE);
  const [pricing,setPricing]=useState<PricingMeta|null>(null);
  const [catalog,setCatalog]=useState<WorkPriceItem[]>([]);
  const [selected,setSelected]=useState<DraftLine[]>([]);
  const [manualWorks,setManualWorks]=useState<ManualWork[]>([]);
  const [manualInput,setManualInput]=useState("");
  const [calculation,setCalculation]=useState<Calculation|null>(null);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let wasOpen=false;
    const tick=()=>{
      const modal=(document.querySelector('[data-page="new-request"]')||document.querySelector(".requestModal")) as HTMLElement|null;
      if(!modal){
        if(wasOpen){setHost(null);setStep(0);setVehicle(EMPTY_VEHICLE);setPricing(null);setCatalog([]);setSelected([]);setManualWorks([]);setManualInput("");setCalculation(null);setQuery("");setCategory("");setError("")}
        wasOpen=false;
        return;
      }
      wasOpen=true;
      const body=modal.querySelector(".requestBody") as HTMLElement|null;if(!body)return;
      let target=body.querySelector("[data-turbolev-labor-estimate]") as HTMLElement|null;
      if(!target){target=document.createElement("div");target.dataset.turbolevLaborEstimate="true";body.appendChild(target)}
      setHost(current=>current===target?current:target);
      const currentStep=stepNumber(modal);setStep(current=>current===currentStep?current:currentStep);
      if(currentStep===2){const next=readVehicle(modal);setVehicle(current=>sameVehicle(current,next)?current:next)}
    };
    tick();const timer=window.setInterval(tick,180);return()=>window.clearInterval(timer);
  },[]);

  const currentVehicleKey=useMemo(()=>vehicleKey(vehicle),[vehicle]);
  useEffect(()=>{
    if(!host||step!==3||!vehicle.make||!vehicle.model){setCatalog([]);setPricing(null);return}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLoading(true);setError("");
      try{
        const params=new URLSearchParams();for(const [key,value] of Object.entries(vehicle))if(value)params.set(key,value);
        const response=await fetch(`/api/work-prices?${params.toString()}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json() as WorkPriceResponse;
        if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося завантажити прайс робіт");
        setPricing(data.pricing);setCatalog(Array.isArray(data.items)?data.items:[]);
      }catch(reason){if((reason as Error).name!=="AbortError")setError(reason instanceof Error?reason.message:"Помилка прайсу")}
      finally{if(!controller.signal.aborted)setLoading(false)}
    },220);
    return()=>{controller.abort();window.clearTimeout(timer)};
  },[host,step,currentVehicleKey,vehicle]);

  const selectionKey=useMemo(()=>selected.map(line=>`${line.id}:${line.quantity}`).join("|"),[selected]);
  useEffect(()=>{
    if(!selected.length||!vehicle.make||!vehicle.model){setCalculation(null);return}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      try{
        const response=await fetch("/api/work-prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vehicle,lines:selected,adjustmentPercent:0}),signal:controller.signal});
        const data=await response.json() as CalculationResponse;
        if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося перерахувати роботи");
        setCalculation({pricing:data.pricing,total:data.total,lines:data.lines});setPricing(data.pricing);
      }catch(reason){if((reason as Error).name!=="AbortError")setError(reason instanceof Error?reason.message:"Помилка розрахунку")}
    },140);
    return()=>{controller.abort();window.clearTimeout(timer)};
  },[selectionKey,currentVehicleKey,selected,vehicle]);

  useEffect(()=>{
    if(step!==3)return;
    const priced=selected.map(line=>{const calculated=calculation?.lines.find(item=>item.id===line.id);return{id:line.id,name:line.name,quantity:line.quantity,total:calculated?.total??0,manual:false}});
    const manual=manualWorks.map(item=>({id:item.id,name:item.name,quantity:1,total:0,manual:true}));
    window.dispatchEvent(new CustomEvent("turbolev:preliminary-works-change",{detail:{works:[...priced,...manual],total:calculation?.total??0}}));
  },[step,selected,manualWorks,calculation]);

  const categories=useMemo(()=>Array.from(new Set(catalog.map(item=>item.category).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"uk")),[catalog]);
  const filtered=useMemo(()=>{const q=query.trim().toLocaleLowerCase("uk-UA");return catalog.filter(item=>(!category||item.category===category)&&(!q||`${item.code||""} ${item.name} ${item.category}`.toLocaleLowerCase("uk-UA").includes(q))).slice(0,10)},[catalog,query,category]);
  const selectedIds=useMemo(()=>new Set(selected.map(line=>line.id)),[selected]);
  const effectivePricing=calculation?.pricing||pricing;

  function add(item:WorkPriceItem){setSelected(current=>current.some(line=>line.id===item.id)?current:[...current,{id:item.id,code:item.code,category:item.category,name:item.name,unit:item.unit,basePrice:item.basePrice,quantity:1}])}
  function quantity(id:string,value:number){const safe=Number.isFinite(value)&&value>0?Math.min(99,value):1;setSelected(current=>current.map(line=>line.id===id?{...line,quantity:safe}:line))}
  function remove(id:string){setSelected(current=>current.filter(line=>line.id!==id))}
  function addManual(){const name=manualInput.trim();if(!name)return;setManualWorks(current=>[...current,{id:`manual-${Date.now()}-${current.length}`,name}]);setManualInput("")}
  function removeManual(id:string){setManualWorks(current=>current.filter(item=>item.id!==id))}

  if(!host||step!==3)return null;

  const panel=<section className={styles.panel}>
    <div className={styles.head}><div><p>ПОПЕРЕДНІ РОБОТИ</p><h4>Додай попередні роботи</h4><span>Обери з прайсу або просто напиши роботу вручну.</span></div>{effectivePricing&&<div className={styles.pricingBadge}><small>Прайс для авто</small><strong>{effectivePricing.pricingVehicleTypeLabel}</strong><span>×{effectivePricing.coefficient.toFixed(2)}</span></div>}</div>
    <div className={styles.body}>
      <div className={styles.manualRow}><input value={manualInput} onChange={event=>setManualInput(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();addManual()}}} placeholder="Напишіть роботу вручну, напр. перевірити стук спереду"/><button type="button" onClick={addManual}>+ Додати</button></div>
      {vehicle.make&&vehicle.model? <>
        <div className={styles.searchRow}><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Пошук у прайсі…"/>{query&&<button type="button" onClick={()=>setQuery("")}>Очистити</button>}</div>
        {categories.length>0&&<div className={styles.categoryRow}><button type="button" className={!category?styles.chipActive:""} onClick={()=>setCategory("")}>Усі</button>{categories.slice(0,10).map(item=><button type="button" key={item} className={category===item?styles.chipActive:""} onClick={()=>setCategory(item)}>{item}</button>)}</div>}
        {loading?<div className={styles.empty}>Завантажую роботи…</div>:filtered.length?<div className={styles.catalog}>{filtered.map(item=><button type="button" className={styles.catalogItem} key={item.id} disabled={selectedIds.has(item.id)} onClick={()=>add(item)}><span><strong>{item.name}</strong><small>{item.category||"Робота"}{item.code?` · ${item.code}`:""}</small></span><b>{selectedIds.has(item.id)?"✓":money(item.adjustedPrice)}</b></button>)}</div>:<div className={styles.empty}>Нічого не знайдено — роботу можна написати вручну вище.</div>}
      </>:<div className={styles.helper}>Щоб побачити ціни з прайсу, уточніть марку та модель авто на кроці 2. Ручні роботи можна додавати вже зараз.</div>}
      {(selected.length>0||manualWorks.length>0)&&<div className={styles.selected}><div className={styles.selectedTitle}><strong>Додано до заявки</strong><span>{selected.length+manualWorks.length} поз.</span></div>{selected.map(line=>{const calculated=calculation?.lines.find(item=>item.id===line.id);return <div className={styles.line} key={line.id}><div><strong>{line.name}</strong><span>{calculated?money(calculated.total):"Розраховую…"}</span></div><input type="number" min={1} max={99} value={line.quantity} onChange={event=>quantity(line.id,Number(event.target.value))}/><button type="button" onClick={()=>remove(line.id)} aria-label={`Прибрати ${line.name}`}>×</button></div>})}{manualWorks.map(item=><div className={`${styles.line} ${styles.manualLine}`} key={item.id}><div><strong>{item.name}</strong><span>Вручну · ціну уточнити після діагностики</span></div><button type="button" onClick={()=>removeManual(item.id)} aria-label={`Прибрати ${item.name}`}>×</button></div>)}</div>}
      <div className={styles.footer}><div><small>Попередньо по роботах</small><strong>{money(calculation?.total??0)}</strong></div><span>Остаточний перелік і ціна — після діагностики.</span></div>
      {error&&<div className={styles.error}>{error}</div>}
    </div>
  </section>;
  return createPortal(panel,host);
}
