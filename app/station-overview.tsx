"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { GlobalVehicleSearch } from "./global-vehicle-search";
import type { CrmSectionLabel } from "./crm-navigation";

type DashboardData = {
  ok: boolean;
  kpis: { carsToday:number; inRepair:number; postsOccupied:number; booked:number; noShow:number; revenue:number|null; grossProfit:number|null };
  pipeline: { newLeads:number; booked:number; diagnostics:number; approval:number; waitingParts:number; inRepair:number; qcReady:number };
  blockers: { approval:number; waitingParts:number; noShow:number };
  attention: Array<{ id:string; plate:string; vehicle:string; status:string; problem:string|null; plannedStartAt:string; post:string|null; mechanic:string|null }>;
};

type WorkflowRoute = { name:string; value:number; sub:string; section:CrmSectionLabel; filter:string; filterLabel:string };
type NavigateDetail = { section: CrmSectionLabel; filter?: string; filterLabel?: string };

const statusLabels: Record<string,string> = { BOOKED:"Записаний", WAITING_APPROVAL:"Погодження", WAITING_PARTS:"Очікує деталі", IN_REPAIR:"У ремонті", WAITING_QC:"Контроль якості", READY_FOR_PICKUP:"Готовий до видачі", NO_SHOW:"No-show" };
const statusAction: Record<string,string> = { BOOKED:"Підтвердити заїзд", WAITING_APPROVAL:"Отримати погодження", WAITING_PARTS:"Контроль ETA деталей", IN_REPAIR:"Контроль виконання робіт", WAITING_QC:"Провести QC", READY_FOR_PICKUP:"Підготувати до видачі", NO_SHOW:"Зв'язатися з клієнтом" };

function money(value:number|null){ return value == null ? "—" : new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(value); }
function parseVehicle(label:string){ const parts=label.trim().split(/\s+/).filter(Boolean); const yearToken=parts.find((x)=>/^20\d{2}$|^19\d{2}$/.test(x)); const year=yearToken?Number(yearToken):new Date().getFullYear(); const brand=parts[0]||"Авто"; const model=parts.slice(1).filter((x)=>x!==yearToken).join(" ")||""; return {brand,model,year}; }
function tone(status:string): AttentionCar["tone"] { if(status==="NO_SHOW") return "warn"; if(status==="IN_REPAIR") return "active"; if(status==="WAITING_PARTS"||status==="WAITING_APPROVAL") return "waiting"; return "good"; }
function navigate(item:WorkflowRoute){ window.dispatchEvent(new CustomEvent<NavigateDetail>("turbolev:navigate",{detail:{section:item.section,filter:item.filter,filterLabel:item.filterLabel}})); }

export function StationOverview(){
  const [data,setData]=useState<DashboardData|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const response=await fetch("/api/dashboard",{cache:"no-store"});const next=await response.json();if(!response.ok)throw new Error(next.error||"Не вдалося завантажити огляд");setData(next);}catch(e){setError(e instanceof Error?e.message:"Помилка огляду");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();const handler=()=>void load();window.addEventListener("turbolev:data-changed",handler);const timer=window.setInterval(()=>void load(),60_000);return()=>{window.removeEventListener("turbolev:data-changed",handler);window.clearInterval(timer);};},[load]);

  const pipeline=useMemo<WorkflowRoute[]>(()=>data?[
    {name:"Нові заявки",value:data.pipeline.newLeads,sub:"живі ліди Neon",section:"Ліди",filter:"new",filterLabel:"Нові"},
    {name:"Записані",value:data.pipeline.booked,sub:"є запис у планувальнику",section:"Планувальник",filter:"booked",filterLabel:"Записані"},
    {name:"На діагностиці",value:data.pipeline.diagnostics,sub:"активні заявки",section:"Діагностика",filter:"active",filterLabel:"Активна діагностика"},
    {name:"Погодження",value:data.pipeline.approval,sub:"очікують рішення",section:"Замовлення-наряди",filter:"approval",filterLabel:"Очікують погодження"},
    {name:"Очікують деталі",value:data.pipeline.waitingParts,sub:"блокер постачання",section:"Закупівлі та склад",filter:"waiting-parts",filterLabel:"Очікують деталі"},
    {name:"В ремонті",value:data.pipeline.inRepair,sub:"активна робота",section:"Виробництво",filter:"in-repair",filterLabel:"В ремонті"},
    {name:"QC / готові",value:data.pipeline.qcReady,sub:"контроль / видача",section:"Контроль якості",filter:"qc-ready",filterLabel:"QC / готові"},
  ]:[],[data]);

  const cars=useMemo<AttentionCar[]>(()=>data?data.attention.map((item)=>{const car=parseVehicle(item.vehicle);return{plate:item.plate,brand:car.brand,model:car.model,year:car.year,status:statusLabels[item.status]||item.status,action:statusAction[item.status]||item.problem||"Відкрити картку",owner:item.mechanic||item.post||"Не призначено",tone:tone(item.status)};}):[],[data]);

  return <>
    <header className="topbar"><div><p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p><h1>Огляд станції</h1><span className="muted">{loading?"Синхронізую…":"живі дані Neon"}</span></div><div className="topActions"><GlobalVehicleSearch/></div></header>
    {error&&<div className="alert"><strong>Не вдалося оновити огляд</strong><span>{error}</span><button onClick={()=>void load()}>Повторити</button></div>}
    <section className="kpis"><article><span>Авто сьогодні</span><strong>{data?.kpis.carsToday??"—"}</strong><small>{data?.kpis.booked??0} ще записані</small></article><article><span>В роботі</span><strong>{data?.kpis.inRepair??"—"}</strong><small>{data?.kpis.postsOccupied??0} постів зайнято</small></article><article><span>Виручка сьогодні</span><strong>{money(data?.kpis.revenue??null)}</strong><small>з'явиться після модуля оплат</small></article><article><span>Валовий прибуток</span><strong>{money(data?.kpis.grossProfit??null)}</strong><small>без вигаданих цифр</small></article></section>
    <section className="sectionBlock"><div className="sectionHead"><div><p className="eyebrow">ВІД ЗАЯВКИ ДО ГРОШЕЙ</p><h2>Живий маршрут станції</h2></div><span className="muted">сьогодні · Neon</span></div><div className="pipeline">{pipeline.map((item)=><button type="button" className="pipelineAction" key={item.name} onClick={()=>navigate(item)}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>{item.section} →</em></button>)}</div></section>
    <section className="gridTwo"><WorkOrderCockpit cars={cars}/><aside className="panel blockers"><div className="sectionHead"><div><p className="eyebrow">БЛОКЕРИ</p><h2>Що стопорить потік</h2></div></div><div className="blocker"><b>Погодження клієнта</b><strong>{data?.blockers.approval??0}</strong><span>активних авто</span></div><div className="blocker"><b>Очікування деталей</b><strong>{data?.blockers.waitingParts??0}</strong><span>авто заблоковано деталями</span></div><div className="blocker"><b>No-show</b><strong>{data?.blockers.noShow??0}</strong><span>потрібен контакт із клієнтом</span></div><div className="rule">Dashboard більше не містить demo-цифр: якщо даних немає, CRM показує «—», а не вигаданий результат.</div></aside></section>
  </>;
}
