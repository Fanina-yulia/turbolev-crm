"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { GlobalVehicleSearch } from "./global-vehicle-search";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmSectionLabel } from "./crm-navigation";

type DashboardData = {
  ok: boolean;
  kpis: { carsToday:number; inRepair:number; postsOccupied:number; booked:number; noShow:number; revenue:number|null; grossProfit:number|null };
  pipeline: { newLeads:number; booked:number; diagnostics:number; approval:number; waitingParts:number; inRepair:number; qcReady:number };
  blockers: { approval:number; waitingParts:number; noShow:number };
  attention: Array<{
    id:string;
    appointmentId:string;
    clientId:string|null;
    vehicleId:string|null;
    workOrderId:string|null;
    plate:string;
    vehicle:string;
    status:string;
    problem:string|null;
    plannedStartAt:string;
    plannedEndAt:string;
    post:string|null;
    mechanic:string|null;
    attentionLevel:"CRITICAL"|"HIGH"|"MEDIUM";
    attentionTitle:string;
    attentionReason:string;
    nextAction:string;
    attentionAt:string;
    issueCount:number;
    issues:Array<{code:string;title:string;reason:string;action:string;level:string;dueAt:string}>;
  }>;
};

type WorkflowRoute = { name:string; value:number|string; sub:string; section:CrmSectionLabel; params?:CrmRouteParams };

const statusLabels: Record<string,string> = {
  BOOKED:"Записаний",
  ARRIVED:"Прибув",
  DIAGNOSTICS:"Діагностика",
  WAITING_PARTS_SELECTION:"Підбір деталей",
  WAITING_CALCULATION:"Розрахунок",
  WAITING_APPROVAL:"Погодження",
  WAITING_PARTS:"Очікує деталі",
  READY_FOR_REPAIR:"Готовий до ремонту",
  IN_REPAIR:"У ремонті",
  WAITING_QC:"Контроль якості",
  WAITING_PAYMENT:"Очікує оплату",
  READY_FOR_PICKUP:"Готовий до видачі",
  WARRANTY:"Гарантія",
  PAUSED:"Пауза",
  NO_SHOW:"No-show",
};

function money(value:number|null){ return value == null ? "—" : new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(value); }
function parseVehicle(label:string){ const parts=label.trim().split(/\s+/).filter(Boolean); const yearToken=parts.find((x)=>/^20\d{2}$|^19\d{2}$/.test(x)); const year=yearToken?Number(yearToken):new Date().getFullYear(); const brand=parts[0]||"Авто"; const model=parts.slice(1).filter((x)=>x!==yearToken).join(" ")||""; return {brand,model,year}; }
function tone(level:DashboardData["attention"][number]["attentionLevel"]): AttentionCar["tone"] { if(level==="CRITICAL"||level==="HIGH")return "warn"; return "waiting"; }
function urgency(level:DashboardData["attention"][number]["attentionLevel"]){return level==="CRITICAL"?0:level==="HIGH"?1:2;}

function attentionRoute(item: DashboardData["attention"][number]): { section: CrmSectionLabel; params: CrmRouteParams } {
  if (["BOOKED", "NO_SHOW", "ARRIVED"].includes(item.status)) {
    return { section: "Планувальник", params: { appointmentId: item.appointmentId, status: item.status } };
  }
  if (item.status === "DIAGNOSTICS" && item.vehicleId && !item.workOrderId) {
    return { section: "Діагностика", params: { vehicleId: item.vehicleId } };
  }
  if (item.workOrderId) {
    const tab = item.status === "WAITING_PARTS" || item.status === "WAITING_PARTS_SELECTION"
      ? "parts"
      : item.status === "WAITING_QC"
        ? "qc"
        : item.status === "WAITING_PAYMENT"
          ? "payment"
          : ["WAITING_CALCULATION","WAITING_APPROVAL"].includes(item.status)
            ? "estimate"
            : "overview";
    return { section: "Замовлення-наряди", params: { workOrderId: item.workOrderId, workOrderTab: tab } };
  }
  if (item.vehicleId) return { section: "Авто", params: { vehicleId: item.vehicleId } };
  return { section: "Планувальник", params: { appointmentId: item.appointmentId } };
}

export function StationOverview(){
  const [data,setData]=useState<DashboardData|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const response=await fetch("/api/dashboard",{cache:"no-store"});const next=await response.json();if(!response.ok)throw new Error(next.error||"Не вдалося завантажити огляд");setData(next);}catch(e){setError(e instanceof Error?e.message:"Помилка огляду");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();const handler=()=>void load();window.addEventListener("turbolev:data-changed",handler);const timer=window.setInterval(()=>void load(),60_000);return()=>{window.removeEventListener("turbolev:data-changed",handler);window.clearInterval(timer);};},[load]);

  const pipeline=useMemo<WorkflowRoute[]>(()=>data?[
    {name:"Нові заявки",value:data.pipeline.newLeads,sub:"активні заявки Neon",section:"Ліди"},
    {name:"Записані",value:data.pipeline.booked,sub:"є запис у планувальнику",section:"Планувальник",params:{status:"BOOKED"}},
    {name:"На діагностиці",value:data.pipeline.diagnostics,sub:"активні заявки",section:"Діагностика"},
    {name:"Погодження",value:data.pipeline.approval,sub:"очікують рішення",section:"Замовлення-наряди",params:{status:"WAITING_APPROVAL"}},
    {name:"Очікують деталі",value:data.pipeline.waitingParts,sub:"блокер постачання",section:"Замовлення-наряди",params:{status:"WAITING_PARTS"}},
    {name:"В ремонті",value:data.pipeline.inRepair,sub:"активна робота",section:"Замовлення-наряди",params:{status:"IN_REPAIR"}},
    {name:"QC / готові",value:data.pipeline.qcReady,sub:"контроль / видача",section:"Замовлення-наряди",params:{scope:"qc"}},
  ]:[],[data]);

  const kpiRoutes=useMemo<WorkflowRoute[]>(()=>[
    {name:"Авто сьогодні",value:data?.kpis.carsToday??"—",sub:`${data?.kpis.booked??0} ще записані`,section:"Планувальник"},
    {name:"В роботі",value:data?.kpis.inRepair??"—",sub:`${data?.kpis.postsOccupied??0} постів зайнято`,section:"Замовлення-наряди",params:{status:"IN_REPAIR"}},
    {name:"Виручка сьогодні",value:money(data?.kpis.revenue??null),sub:"проведені платежі за сьогодні",section:"Фінансовий центр"},
    {name:"Валовий прибуток",value:money(data?.kpis.grossProfit??null),sub:"виручка мінус прямі витрати",section:"Фінансовий центр"},
  ],[data]);

  const cars=useMemo<AttentionCar[]>(()=>data?[...data.attention]
    .sort((a,b)=>urgency(a.attentionLevel)-urgency(b.attentionLevel)||new Date(a.attentionAt).getTime()-new Date(b.attentionAt).getTime())
    .map((item)=>{
      const car=parseVehicle(item.vehicle);
      const route=attentionRoute(item);
      const extra=item.issueCount>1?` · ще ${item.issueCount-1} ${item.issueCount-1===1?"проблема":"проблеми"}`:"";
      return {
        id:item.id,
        plate:item.plate,
        brand:car.brand,
        model:car.model,
        year:car.year,
        status:statusLabels[item.status]||item.status,
        action:item.nextAction,
        owner:item.mechanic||item.post||"Не призначено",
        problem:`${item.attentionReason}${extra}`,
        plannedStartAt:item.attentionAt,
        tone:tone(item.attentionLevel),
        section:route.section,
        routeParams:Object.fromEntries(Object.entries(route.params).filter((entry):entry is [string,string]=>typeof entry[1]==="string"&&Boolean(entry[1]))),
      };
    }):[],[data]);

  const blockers:WorkflowRoute[]=[
    {name:"Погодження клієнта",value:data?.blockers.approval??0,sub:"активних авто",section:"Замовлення-наряди",params:{status:"WAITING_APPROVAL"}},
    {name:"Очікування деталей",value:data?.blockers.waitingParts??0,sub:"авто заблоковано деталями",section:"Замовлення-наряди",params:{status:"WAITING_PARTS"}},
    {name:"Не приїхали / no-show",value:data?.blockers.noShow??0,sub:"потрібен контакт із клієнтом",section:"Планувальник",params:{status:"NO_SHOW"}},
  ];

  return <>
    <header className="topbar"><div><p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p><h1>Огляд станції</h1><span className="muted">{loading?"Синхронізую…":"живі дані Neon"}</span></div><div className="topActions"><GlobalVehicleSearch/></div></header>
    {error&&<div className="alert"><strong>Не вдалося оновити огляд</strong><span>{error}</span><button onClick={()=>void load()}>Повторити</button></div>}
    <section className="kpis">{kpiRoutes.map(item=><article className="dashboardClickCard" key={item.name} role="button" tabIndex={0} onClick={()=>navigateCrm(item.section,item.params)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();navigateCrm(item.section,item.params);}}}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>Відкрити →</em></article>)}</section>
    <section className="sectionBlock"><div className="sectionHead"><div><p className="eyebrow">ВІД ЗАЯВКИ ДО ГРОШЕЙ</p><h2>Живий маршрут станції</h2></div><span className="muted">сьогодні · Neon</span></div><div className="pipeline">{pipeline.map((item)=><button type="button" className="pipelineAction" key={item.name} onClick={()=>navigateCrm(item.section,item.params)}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>{item.section} →</em></button>)}</div></section>
    <section className="gridTwo"><WorkOrderCockpit cars={cars} onAll={()=>navigateCrm("Авто")} onOpen={car=>navigateCrm(car.section as CrmSectionLabel,car.routeParams as CrmRouteParams)}/><aside className="panel blockers"><div className="sectionHead"><div><p className="eyebrow">БЛОКЕРИ</p><h2>Що стопорить потік</h2></div></div><div className="blockerList">{blockers.map(item=><button type="button" className="blocker blockerAction" key={item.name} onClick={()=>navigateCrm(item.section,item.params)}><b>{item.name}</b><strong>{item.value}</strong><span>{item.sub}</span><em>{item.section} →</em></button>)}</div><div className="blockerHint">Блокер — це не просто статус. Тут мають залишатися тільки авто, де потік реально зупинено і потрібне рішення людини.</div></aside></section>
  </>;
}
