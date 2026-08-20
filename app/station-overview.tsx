"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { GlobalVehicleSearch } from "./global-vehicle-search";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import type { CrmSectionLabel } from "./crm-navigation";

type Lifecycle = { code:string; label:string; flags:string[] };
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
    lifecycle:Lifecycle|null;
    problem:string|null;
    plannedStartAt:string;
    post:string|null;
    mechanic:string|null;
  }>;
};

type WorkflowRoute = { name:string; value:number|string; sub:string; section:CrmSectionLabel; params?:CrmRouteParams };

const fallbackStatusLabels: Record<string,string> = { BOOKED:"Заплановано", ARRIVED:"В роботі", DIAGNOSTICS:"В роботі", WAITING_APPROVAL:"Очікує погодження", WAITING_PARTS:"Очікує деталі", IN_REPAIR:"У ремонті", WAITING_QC:"Контроль якості", WAITING_PAYMENT:"Очікує оплату", READY_FOR_PICKUP:"Готовий до видачі", NO_SHOW:"Скасовано" };
const lifecycleAction: Record<string,string> = {
  PLANNED:"Підтвердити заїзд скануванням",
  IN_WORK:"Продовжити роботу з авто",
  DIAGNOSTIC_COMPLETED:"Перевірити завершену діагностику",
  MANAGER_REVIEW:"Завершити перевірку менеджера",
  CLIENT_DECISION:"Отримати рішення клієнта",
  PARTS_SELECTION:"Завершити підбір деталей",
  WAITING_APPROVAL:"Отримати погодження клієнта",
  WAITING_PARTS:"Контроль надходження деталей",
  READY_FOR_REPAIR:"Передати авто в ремонт",
  IN_REPAIR:"Контроль виконання робіт",
  QUALITY_CONTROL:"Провести контроль якості",
  WAITING_PAYMENT:"Отримати оплату",
  READY_FOR_PICKUP:"Підготувати авто до видачі",
  CANCELLED:"Перевірити причину скасування",
};

function money(value:number|null){ return value == null ? "—" : new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(value); }
function parseVehicle(label:string){ const parts=label.trim().split(/\s+/).filter(Boolean); const yearToken=parts.find((x)=>/^20\d{2}$|^19\d{2}$/.test(x)); const year=yearToken?Number(yearToken):new Date().getFullYear(); const brand=parts[0]||"Авто"; const model=parts.slice(1).filter((x)=>x!==yearToken).join(" ")||""; return {brand,model,year}; }
function lifecycleCode(item:DashboardData["attention"][number]){return item.lifecycle?.code||(item.status==="BOOKED"?"PLANNED":item.status==="NO_SHOW"?"CANCELLED":item.status);}
function lifecycleLabel(item:DashboardData["attention"][number]){const base=item.lifecycle?.label||fallbackStatusLabels[item.status]||item.status;return item.lifecycle?.flags.includes("OVERDUE")?`Протерміновано · ${base}`:base;}
function tone(item:DashboardData["attention"][number]): AttentionCar["tone"] { const code=lifecycleCode(item); if(code==="CANCELLED"||item.lifecycle?.flags.includes("OVERDUE"))return"warn"; if(code==="IN_REPAIR"||code==="IN_WORK")return"active"; if(["CLIENT_DECISION","WAITING_APPROVAL","WAITING_PARTS","PARTS_SELECTION","MANAGER_REVIEW","DIAGNOSTIC_COMPLETED","WAITING_PAYMENT"].includes(code))return"waiting"; return"good"; }
function urgency(item:DashboardData["attention"][number]){const code=lifecycleCode(item);if(item.lifecycle?.flags.includes("OVERDUE"))return 0;if(code==="DIAGNOSTIC_COMPLETED"||code==="MANAGER_REVIEW")return 1;if(code==="CLIENT_DECISION"||code==="WAITING_APPROVAL")return 2;if(code==="WAITING_PARTS")return 3;if(code==="QUALITY_CONTROL")return 4;if(code==="WAITING_PAYMENT"||code==="READY_FOR_PICKUP")return 5;return 6;}

function attentionRoute(item: DashboardData["attention"][number]): { section: CrmSectionLabel; params: CrmRouteParams } {
  const code=lifecycleCode(item);
  if (["PLANNED","CANCELLED"].includes(code)) return { section: "Планувальник", params: { appointmentId: item.appointmentId } };
  if (["IN_WORK","DIAGNOSTIC_COMPLETED","MANAGER_REVIEW","CLIENT_DECISION"].includes(code)) return { section:"Діагностика",params:item.vehicleId?{vehicleId:item.vehicleId}:{plate:item.plate} };
  if (["PARTS_SELECTION","WAITING_PARTS"].includes(code)) return {section:"Підбір запчастин",params:{plate:item.plate}};
  if (item.workOrderId) return { section: "Замовлення-наряди", params: { workOrderId: item.workOrderId } };
  if (item.vehicleId) return { section: "Авто", params: { vehicleId: item.vehicleId } };
  return { section: "Планувальник", params: { appointmentId: item.appointmentId } };
}

export function StationOverview(){
  const [data,setData]=useState<DashboardData|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const response=await fetch("/api/dashboard",{cache:"no-store"});const next=await response.json();if(!response.ok)throw new Error(next.error||"Не вдалося завантажити огляд");setData(next);}catch(e){setError(e instanceof Error?e.message:"Помилка огляду");}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();const handler=()=>void load();window.addEventListener("turbolev:data-changed",handler);const timer=window.setInterval(()=>void load(),60_000);return()=>{window.removeEventListener("turbolev:data-changed",handler);window.clearInterval(timer);};},[load]);

  const pipeline=useMemo<WorkflowRoute[]>(()=>data?[
    {name:"Нові активні",value:data.pipeline.newLeads,sub:"звернення, взяті в роботу",section:"Активні"},
    {name:"Заплановано",value:data.pipeline.booked,sub:"майбутні заїзди",section:"Планувальник",params:{status:"PLANNED"}},
    {name:"В роботі / діагностика",value:data.pipeline.diagnostics,sub:"від заїзду до перевірки ДК",section:"Діагностика"},
    {name:"Рішення / погодження",value:data.pipeline.approval,sub:"очікується дія клієнта",section:"Замовлення-наряди"},
    {name:"Деталі",value:data.pipeline.waitingParts,sub:"підбір або очікування",section:"Підбір запчастин"},
    {name:"Ремонт",value:data.pipeline.inRepair,sub:"готові або в ремонті",section:"Замовлення-наряди"},
    {name:"QC / оплата / видача",value:data.pipeline.qcReady,sub:"фінальні етапи",section:"Замовлення-наряди",params:{scope:"qc"}},
  ]:[],[data]);

  const kpiRoutes=useMemo<WorkflowRoute[]>(()=>[
    {name:"Авто сьогодні",value:data?.kpis.carsToday??"—",sub:`${data?.kpis.booked??0} заплановано`,section:"Планувальник"},
    {name:"У ремонті",value:data?.kpis.inRepair??"—",sub:`${data?.kpis.postsOccupied??0} постів зайнято`,section:"Замовлення-наряди",params:{status:"IN_REPAIR"}},
    {name:"Виручка сьогодні",value:money(data?.kpis.revenue??null),sub:"проведені платежі за сьогодні",section:"Фінансовий центр"},
    {name:"Валовий прибуток",value:money(data?.kpis.grossProfit??null),sub:"виручка мінус прямі витрати",section:"Фінансовий центр"},
  ],[data]);

  const cars=useMemo<AttentionCar[]>(()=>data?[...data.attention].sort((a,b)=>urgency(a)-urgency(b)||new Date(a.plannedStartAt).getTime()-new Date(b.plannedStartAt).getTime()).map((item)=>{const car=parseVehicle(item.vehicle);const route=attentionRoute(item);const code=lifecycleCode(item);return{id:item.id,plate:item.plate,brand:car.brand,model:car.model,year:car.year,status:lifecycleLabel(item),action:lifecycleAction[code]||item.problem||"Відкрити картку",owner:item.mechanic||item.post||"Не призначено",problem:item.problem,plannedStartAt:item.plannedStartAt,tone:tone(item),section:route.section,routeParams:Object.fromEntries(Object.entries(route.params).filter((entry):entry is [string,string]=>typeof entry[1]==="string"&&Boolean(entry[1])))};}):[],[data]);

  const blockers:WorkflowRoute[]=[
    {name:"Рішення / погодження клієнта",value:data?.blockers.approval??0,sub:"активних авто",section:"Замовлення-наряди"},
    {name:"Очікування деталей",value:data?.blockers.waitingParts??0,sub:"авто заблоковано деталями",section:"Підбір запчастин"},
    {name:"Скасовані / не приїхали",value:data?.blockers.noShow??0,sub:"потрібен контакт із клієнтом",section:"Планувальник"},
  ];

  return <>
    <header className="topbar"><div><p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p><h1>Огляд станції</h1><span className="muted">{loading?"Синхронізую…":"єдиний статус авто · живі дані Neon"}</span></div><div className="topActions"><GlobalVehicleSearch/></div></header>
    {error&&<div className="alert"><strong>Не вдалося оновити огляд</strong><span>{error}</span><button onClick={()=>void load()}>Повторити</button></div>}
    <section className="kpis">{kpiRoutes.map(item=><article className="dashboardClickCard" key={item.name} role="button" tabIndex={0} onClick={()=>navigateCrm(item.section,item.params)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();navigateCrm(item.section,item.params);}}}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>Відкрити →</em></article>)}</section>
    <section className="sectionBlock"><div className="sectionHead"><div><p className="eyebrow">ВІД ЗАЯВКИ ДО ВИДАЧІ</p><h2>Живий маршрут станції</h2></div><span className="muted">сьогодні · канонічні статуси</span></div><div className="pipeline">{pipeline.map((item)=><button type="button" className="pipelineAction" key={item.name} onClick={()=>navigateCrm(item.section,item.params)}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>{item.section} →</em></button>)}</div></section>
    <section className="gridTwo"><WorkOrderCockpit cars={cars} onAll={()=>navigateCrm("Авто")} onOpen={car=>navigateCrm(car.section as CrmSectionLabel,car.routeParams as CrmRouteParams)}/><aside className="panel blockers"><div className="sectionHead"><div><p className="eyebrow">БЛОКЕРИ</p><h2>Що стопорить потік</h2></div></div><div className="blockerList">{blockers.map(item=><button type="button" className="blocker blockerAction" key={item.name} onClick={()=>navigateCrm(item.section,item.params)}><b>{item.name}</b><strong>{item.value}</strong><span>{item.sub}</span><em>{item.section} →</em></button>)}</div><div className="blockerHint">Блокер — супутня ознака, а не статус авто. Основний статус лишається незмінним.</div></aside></section>
  </>;
}
