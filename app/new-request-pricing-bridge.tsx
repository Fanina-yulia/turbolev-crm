"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./new-request-pricing-bridge.module.css";

type VehicleSnapshot = {
  make:string; model:string; year:string; engine:string; engineVolume:string; fuelType:string;
  bodyType:string; grossWeight:string; driveType:string; vehicleType:string;
};
type RequestSnapshot = { customerName:string; phone:string; category:string; complaint:string };
type PricingMeta = { pricingVehicleType:string; pricingVehicleTypeLabel:string; coefficient:number; source?:string };
type WorkPriceItem = {
  id:string; code:string|null; category:string; name:string; unit:string; normHours:number|null;
  complexSurcharge:number|null; note:string; basePrice:number; coefficient:number; adjustedPrice:number;
};
type DraftLine = { id:string; code:string|null; category:string; name:string; unit:string; basePrice:number; quantity:number };
type CalculatedLine = DraftLine & {
  coefficient:number; subtotal:number; manualAdjustmentPercent:number; total:number;
  pricingVehicleType:string; pricingVehicleTypeLabel:string;
};
type Calculation = { pricing:PricingMeta; total:number; lines:CalculatedLine[] };
type WorkPriceResponse = { ok:boolean; pricing:PricingMeta; items:WorkPriceItem[]; error?:string };
type CalculationResponse = { ok:boolean; pricing:PricingMeta; total:number; lines:CalculatedLine[]; error?:string };

const REQUESTS_KEY="turbolev-manual-requests-v1";
const ESTIMATES_KEY="turbolev-request-estimates-v1";

const EMPTY_VEHICLE:VehicleSnapshot={make:"",model:"",year:"",engine:"",engineVolume:"",fuelType:"",bodyType:"",grossWeight:"",driveType:"",vehicleType:""};
const EMPTY_REQUEST:RequestSnapshot={customerName:"",phone:"",category:"",complaint:""};

function normalizedLabel(value:string){return value.replace(/\*/g,"").replace(/\s+/g," ").trim().toLocaleLowerCase("uk-UA");}
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
};}
function vehicleKey(value:VehicleSnapshot){return Object.values(value).join("|");}
function sameVehicle(a:VehicleSnapshot,b:VehicleSnapshot){return vehicleKey(a)===vehicleKey(b);}
function sameRequest(a:RequestSnapshot,b:RequestSnapshot){return Object.values(a).join("|")===Object.values(b).join("|");}
function stepNumber(root:HTMLElement){const text=root.querySelector(".requestStepTitle small")?.textContent||"";return Number(/(\d+)/.exec(text)?.[1]||0);}
function setNativeInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));}
function preliminaryInput(root:HTMLElement){for(const label of Array.from(root.querySelectorAll("label"))){if(normalizedLabel(label.querySelector("span")?.textContent||"").startsWith("попередня сума"))return label.querySelector("input") as HTMLInputElement|null;}return null;}
function escapeHtml(value:unknown){return String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]||char));}
function money(value:number){return new Intl.NumberFormat("uk-UA",{maximumFractionDigits:0}).format(value)+" грн";}

function printEstimate(kind:"diagnostic"|"proposal",request:RequestSnapshot,vehicle:VehicleSnapshot,calculation:Calculation){
  const title=kind==="diagnostic"?"Діагностична карта — чернетка":"Комерційна пропозиція";
  const note=kind==="diagnostic"?"Чернетка формується зі звернення та попередньо вибраних робіт. Остаточний технічний висновок заповнюється після огляду автомобіля.":"Розрахунок робіт сформовано автоматично за чинним прайсом і коефіцієнтом типу автомобіля з налаштувань CRM.";
  const rows=calculation.lines.map((line,index)=>`<tr><td>${index+1}</td><td><b>${escapeHtml(line.name)}</b><small>${escapeHtml(line.code||"")}</small></td><td>${money(line.basePrice)}</td><td>×${line.coefficient.toFixed(2)}</td><td>${line.quantity}</td><td><b>${money(line.total)}</b></td></tr>`).join("");
  const popup=window.open("","_blank","noopener,noreferrer,width=980,height=760");if(!popup)return;
  popup.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;margin:36px;color:#161616}header{display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:16px;margin-bottom:22px}h1{font-size:25px;margin:0}header b{font-size:18px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}.meta small,.note,td small{display:block;color:#666;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:10px 7px;text-align:left;font-size:12px}th{font-size:10px;text-transform:uppercase;color:#666}.total{text-align:right;font-size:22px;font-weight:800;margin-top:18px}.note{margin-top:22px;line-height:1.5}@media print{button{display:none}}</style></head><body><header><div><h1>${escapeHtml(title)}</h1><span>СТО «Turbo LEV»</span></div><div><small>Коефіцієнт робіт</small><b>×${calculation.pricing.coefficient.toFixed(2)}</b><small>${escapeHtml(calculation.pricing.pricingVehicleTypeLabel)}</small></div></header><div class="meta"><div><b>${escapeHtml(request.customerName||"Клієнт")}</b><small>${escapeHtml(request.phone||"Телефон не вказаний")}</small></div><div><b>${escapeHtml([vehicle.make,vehicle.model,vehicle.year].filter(Boolean).join(" ")||"Автомобіль")}</b><small>${escapeHtml([vehicle.engine,vehicle.bodyType].filter(Boolean).join(" · "))}</small></div><div><b>Звернення</b><small>${escapeHtml(request.category||"Без категорії")}</small></div><div><b>Скарга / потреба</b><small>${escapeHtml(request.complaint||"Не вказано")}</small></div></div><table><thead><tr><th>№</th><th>Робота</th><th>База</th><th>Коеф.</th><th>К-сть</th><th>Сума</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Разом: ${money(calculation.total)}</div><p class="note">${escapeHtml(note)}</p><button onclick="window.print()">Друк / PDF</button></body></html>`);
  popup.document.close();
}

export function NewRequestPricingBridge(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [step,setStep]=useState(0);
  const [vehicle,setVehicle]=useState<VehicleSnapshot>(EMPTY_VEHICLE);
  const [request,setRequest]=useState<RequestSnapshot>(EMPTY_REQUEST);
  const [pricing,setPricing]=useState<PricingMeta|null>(null);
  const [catalog,setCatalog]=useState<WorkPriceItem[]>([]);
  const [selected,setSelected]=useState<DraftLine[]>([]);
  const [calculation,setCalculation]=useState<Calculation|null>(null);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let wasOpen=false;
    const tick=()=>{
      const modal=document.querySelector(".requestModal") as HTMLElement|null;
      if(!modal){if(wasOpen){setHost(null);setStep(0);setVehicle(EMPTY_VEHICLE);setRequest(EMPTY_REQUEST);setPricing(null);setCatalog([]);setSelected([]);setCalculation(null);setQuery("");setCategory("");setError("");}wasOpen=false;return;}
      wasOpen=true;
      const body=modal.querySelector(".requestBody") as HTMLElement|null;if(!body)return;
      let target=body.querySelector("[data-turbolev-labor-estimate]") as HTMLElement|null;
      if(!target){target=document.createElement("div");target.dataset.turbolevLaborEstimate="true";body.appendChild(target);}setHost(current=>current===target?current:target);
      const currentStep=stepNumber(modal);setStep(current=>current===currentStep?current:currentStep);
      if(currentStep===1){const next={customerName:fieldValue(modal,"Ім’я клієнта"),phone:fieldValue(modal,"Телефон"),category:"",complaint:""};setRequest(current=>sameRequest(current,{...current,...next})?current:{...current,...next});}
      if(currentStep===2){const next=readVehicle(modal);setVehicle(current=>sameVehicle(current,next)?current:next);}
      if(currentStep===3){const next={...request,phone:(modal.querySelector(".phoneQuickLookup input") as HTMLInputElement|null)?.value||request.phone,category:fieldValue(modal,"Категорія звернення"),complaint:fieldValue(modal,"Проблема / побажання клієнта")};setRequest(current=>sameRequest(current,next)?current:next);}
      if(currentStep===4){const articles=Array.from(modal.querySelectorAll(".requestSummary article"));const client=articles.find(item=>item.querySelector("small")?.textContent?.includes("Клієнт"));const nextName=client?.querySelector("strong")?.textContent?.trim()||request.customerName;const nextPhone=client?.querySelector("span")?.textContent?.trim()||request.phone;setRequest(current=>{const next={...current,customerName:nextName,phone:nextPhone};return sameRequest(current,next)?current:next;});}
    };
    tick();const timer=window.setInterval(tick,220);return()=>window.clearInterval(timer);
  },[request]);

  const currentVehicleKey=useMemo(()=>vehicleKey(vehicle),[vehicle]);
  useEffect(()=>{
    if(!host||step<2||!vehicle.make||!vehicle.model)return;
    const controller=new AbortController();const timer=window.setTimeout(async()=>{setLoading(true);setError("");try{const params=new URLSearchParams();for(const [key,value] of Object.entries(vehicle))if(value)params.set(key,value);const response=await fetch(`/api/work-prices?${params.toString()}`,{cache:"no-store",signal:controller.signal});const data=await response.json() as WorkPriceResponse;if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося завантажити прайс робіт");setPricing(data.pricing);setCatalog(Array.isArray(data.items)?data.items:[]);}catch(reason){if((reason as Error).name!=="AbortError")setError(reason instanceof Error?reason.message:"Помилка прайсу");}finally{if(!controller.signal.aborted)setLoading(false);}},250);return()=>{controller.abort();window.clearTimeout(timer);};
  },[host,step,currentVehicleKey,vehicle]);

  useEffect(()=>{
    if(step!==2||!pricing)return;const timer=window.setInterval(()=>{const modal=document.querySelector(".requestModal") as HTMLElement|null;const box=modal?.querySelector(".vehicleCoefficient");if(!box)return;const small=box.querySelector("small"),strong=box.querySelector("b"),span=box.querySelector("span");if(small)small.textContent="Коефіцієнт робіт із Налаштувань";if(strong)strong.textContent=`×${pricing.coefficient.toFixed(2)}`;if(span)span.textContent=pricing.pricingVehicleTypeLabel;},250);return()=>window.clearInterval(timer);
  },[step,pricing]);

  const selectionKey=useMemo(()=>selected.map(line=>`${line.id}:${line.quantity}`).join("|"),[selected]);
  useEffect(()=>{
    if(!selected.length||!vehicle.make||!vehicle.model){setCalculation(null);return;}
    const controller=new AbortController();const timer=window.setTimeout(async()=>{try{const response=await fetch("/api/work-prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({vehicle,lines:selected,adjustmentPercent:0}),signal:controller.signal});const data=await response.json() as CalculationResponse;if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося перерахувати роботи");setCalculation({pricing:data.pricing,total:data.total,lines:data.lines});setPricing(data.pricing);}catch(reason){if((reason as Error).name!=="AbortError")setError(reason instanceof Error?reason.message:"Помилка розрахунку");}},160);return()=>{controller.abort();window.clearTimeout(timer);};
  },[selectionKey,currentVehicleKey,selected,vehicle]);

  useEffect(()=>{if(step!==4||!calculation?.total)return;const modal=document.querySelector(".requestModal") as HTMLElement|null;if(!modal)return;const input=preliminaryInput(modal);if(input&&input.value!==String(calculation.total))setNativeInputValue(input,String(calculation.total));},[step,calculation?.total]);

  useEffect(()=>{
    const save=(event:Event)=>{const custom=event as CustomEvent<Record<string,unknown>>;if(!custom.detail||!calculation?.lines.length)return;const estimate={pricing:calculation.pricing,total:calculation.total,lines:calculation.lines,vehicle,createdAt:new Date().toISOString()};custom.detail.priceCoefficient=calculation.pricing.coefficient.toFixed(2);custom.detail.preliminaryAmount=String(calculation.total);custom.detail.laborEstimate=estimate;try{const list=JSON.parse(window.localStorage.getItem(REQUESTS_KEY)||"[]") as Array<Record<string,unknown>>;const index=list.findIndex(item=>item.id===custom.detail.id);if(index>=0){list[index]={...list[index],...custom.detail};window.localStorage.setItem(REQUESTS_KEY,JSON.stringify(list));}const saved=JSON.parse(window.localStorage.getItem(ESTIMATES_KEY)||"{}") as Record<string,unknown>;if(typeof custom.detail.id==="string")saved[custom.detail.id]=estimate;window.localStorage.setItem(ESTIMATES_KEY,JSON.stringify(saved));}catch{ /* local persistence is best effort; the request itself is already created */ }};
    window.addEventListener("turbolev:new-request",save as EventListener);return()=>window.removeEventListener("turbolev:new-request",save as EventListener);
  },[calculation,vehicle]);

  const categories=useMemo(()=>Array.from(new Set(catalog.map(item=>item.category).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"uk")),[catalog]);
  const filtered=useMemo(()=>{const q=query.trim().toLocaleLowerCase("uk-UA");return catalog.filter(item=>(!category||item.category===category)&&(!q||`${item.code||""} ${item.name} ${item.category}`.toLocaleLowerCase("uk-UA").includes(q))).slice(0,20);},[catalog,query,category]);
  const selectedIds=useMemo(()=>new Set(selected.map(line=>line.id)),[selected]);
  const effectivePricing=calculation?.pricing||pricing;

  function add(item:WorkPriceItem){setSelected(current=>current.some(line=>line.id===item.id)?current:[...current,{id:item.id,code:item.code,category:item.category,name:item.name,unit:item.unit,basePrice:item.basePrice,quantity:1}]);}
  function quantity(id:string,value:number){const safe=Number.isFinite(value)&&value>0?Math.min(99,value):1;setSelected(current=>current.map(line=>line.id===id?{...line,quantity:safe}:line));}
  function remove(id:string){setSelected(current=>current.filter(line=>line.id!==id));}

  if(!host||step<3)return null;
  const panel=<section className={styles.panel}><div className={styles.head}><div><p>АВТОМАТИЧНИЙ КОШТОРИС</p><h4>{step===3?"Додай попередні роботи":"Розрахунок робіт"}</h4><span>Базовий прайс × коефіцієнт автомобіля з Налаштувань CRM.</span></div><div className={styles.pricingBadge}><small>Тип для розрахунку</small><strong>{effectivePricing?.pricingVehicleTypeLabel||"Визначаю…"}</strong><span>{effectivePricing?`коефіцієнт ×${effectivePricing.coefficient.toFixed(2)}`:"—"}</span></div></div><div className={styles.body}>{step===3&&<><div className={styles.searchRow}><input className={styles.search} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Пошук роботи за назвою або кодом…"/><button className={styles.secondary} type="button" onClick={()=>{setQuery("");setCategory("")}}>Очистити</button></div>{categories.length>0&&<div className={styles.categoryRow}><button type="button" className={`${styles.chip} ${!category?styles.chipActive:""}`} onClick={()=>setCategory("")}>Усі</button>{categories.slice(0,14).map(item=><button type="button" key={item} className={`${styles.chip} ${category===item?styles.chipActive:""}`} onClick={()=>setCategory(item)}>{item}</button>)}</div>}{loading?<div className={styles.empty}>Завантажую прайс і застосовую коефіцієнт авто…</div>:filtered.length?<div className={styles.catalog}>{filtered.map(item=><div className={styles.catalogItem} key={item.id}><div className={styles.catalogMain}><strong>{item.name}</strong><span>{item.code||"Без коду"} · {item.category||"Без категорії"} · база {money(item.basePrice)}</span></div><div className={styles.price}>{money(item.adjustedPrice)}</div><button type="button" className={styles.add} disabled={selectedIds.has(item.id)} onClick={()=>add(item)}>{selectedIds.has(item.id)?"Додано":"+ Додати"}</button></div>)}</div>:<div className={styles.empty}>Робіт за цим фільтром не знайдено.</div>}</>}
  <div className={styles.selected}><div className={styles.selectedTitle}><strong>Обрані роботи</strong><span>{selected.length} позицій</span></div>{selected.length?selected.map(line=>{const calculated=calculation?.lines.find(item=>item.id===line.id);return <div className={styles.line} key={line.id}><div className={styles.lineName}><strong>{line.name}</strong><span>{line.code||"—"} · база {money(line.basePrice)}{calculated?` · ×${calculated.coefficient.toFixed(2)}`:""}</span></div><input className={styles.qty} type="number" min={1} max={99} value={line.quantity} onChange={event=>quantity(line.id,Number(event.target.value))}/><div className={styles.lineTotal}>{money(calculated?.total??0)}</div><button type="button" className={styles.remove} onClick={()=>remove(line.id)} aria-label={`Прибрати ${line.name}`}>×</button></div>}):<div className={styles.empty}>Оберіть роботи з прайсу. CRM перерахує їх автоматично саме для цього автомобіля.</div>}</div>
  <div className={styles.footer}><div className={styles.total}><small>Попередня вартість робіт</small><strong>{money(calculation?.total??0)}</strong></div><div className={styles.actions}><button type="button" className={styles.secondary} disabled={!calculation?.lines.length} onClick={()=>calculation&&printEstimate("diagnostic",request,vehicle,calculation)}>Чернетка діагностичної карти</button><button type="button" className={styles.secondary} disabled={!calculation?.lines.length} onClick={()=>calculation&&printEstimate("proposal",request,vehicle,calculation)}>Комерційна пропозиція</button></div></div><div className={styles.note}>Це попередній кошторис робіт. Після фактичної діагностики перелік можна уточнити; остаточна ціна повинна формуватися тим самим серверним калькулятором.</div>{error&&<div className={styles.error}>{error}</div>}</div></section>;
  return createPortal(panel,host);
}
