"use client";

import { useEffect } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";

type FinanceState = {
  appointmentId: string;
  vehicleId: string | null;
  diagnosticId: string | null;
  isCurrentVisit: boolean;
  operationalLabel: string;
  source: "WORK_ORDER" | "WALK_IN_DIAGNOSTIC" | "ESTIMATE" | "NONE";
  actual: boolean;
  status: "NOT_FORMED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
  amount: number | null;
  paid: number;
  outstanding: number | null;
  estimatedAmount: number | null;
  lastPayment: { id: string; amount: number; occurredAt: string; method: "CASH" | "TERMINAL" | "ONLINE" | "OTHER" | null } | null;
  diagnostic: { reviewState: string | null; workflowLabel: string; total: number; checked: number; defects: number; completed: boolean } | null;
};

type AppointmentSnapshot = {
  id: string;
  clientId: string | null;
  phone: string | null;
  estimatedAmount: string | number | null;
  purpose: "DIAGNOSTICS" | "REPAIR" | null;
  finance: FinanceState | null;
};

type JsonRecord = Record<string, unknown>;

const COMPACT_CSS = `
[data-compact-appointment="true"] { width:min(700px,calc(100vw - 24px))!important;max-height:calc(100vh - 16px)!important;overflow:hidden!important; }
[data-compact-appointment="true"] [class*="detailsHead"] { padding:11px 16px 9px!important;gap:10px!important; }
[data-compact-appointment="true"] [class*="detailsHead"] p { margin-bottom:3px!important; }
[data-compact-appointment="true"] [class*="detailsHead"] h2 { font-size:19px!important; }
[data-compact-appointment="true"] [class*="detailsHead"] span { margin-top:3px!important; }
[data-compact-appointment="true"] [class*="detailsBody"] { gap:7px!important;padding:9px 16px 11px!important; }
[data-compact-appointment="true"] [class*="detailsVehicle"] { padding:9px 11px!important;border-radius:9px!important; }
[data-compact-appointment="true"] [class*="detailsGrid"] > div { padding:8px 10px!important;gap:2px!important; }
[data-compact-appointment="true"] [class*="detailsSection"] { padding:9px 11px!important;border-radius:9px!important; }
[data-compact-appointment="true"] [class*="detailsSection"] > p { margin-top:5px!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
[data-compact-appointment="true"] [class*="detailsSection"] > small { margin-top:4px!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
[data-compact-appointment="true"] [data-planner-client-link] { cursor:pointer;outline:none;transition:background .12s ease; }
[data-compact-appointment="true"] [data-planner-client-link]:hover,[data-compact-appointment="true"] [data-planner-client-link]:focus-visible { background:color-mix(in srgb,var(--orange) 7%,var(--panel))!important; }
[data-compact-appointment="true"] [data-planner-client-link] strong { color:var(--orange);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px; }
[data-compact-appointment="true"] [data-planner-visit-facts] { margin-top:7px;display:grid;gap:7px; }
[data-compact-appointment="true"] [data-planner-diagnostic-fact],[data-compact-appointment="true"] [data-planner-finance-fact] { padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:color-mix(in srgb,var(--panel) 94%,var(--text) 2%); }
[data-compact-appointment="true"] [data-planner-fact-head] { display:flex;align-items:center;justify-content:space-between;gap:10px; }
[data-compact-appointment="true"] [data-planner-fact-head] strong { font-size:13px; }
[data-compact-appointment="true"] [data-planner-diagnostic-link] { border:0;background:transparent;color:var(--orange);font:inherit;font-weight:800;cursor:pointer;padding:2px 0; }
[data-compact-appointment="true"] [data-planner-diagnostic-meta] { margin-top:4px;color:var(--muted);font-size:11px; }
[data-compact-appointment="true"] [data-planner-payment-badge] { display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:850;white-space:nowrap; }
[data-compact-appointment="true"] [data-planner-payment-badge="PAID"] { color:#07834c;background:color-mix(in srgb,#16a36a 12%,var(--panel)); }
[data-compact-appointment="true"] [data-planner-payment-badge="PARTIAL"] { color:#b96a00;background:color-mix(in srgb,#f59e0b 14%,var(--panel)); }
[data-compact-appointment="true"] [data-planner-payment-badge="UNPAID"],[data-compact-appointment="true"] [data-planner-payment-badge="OVERDUE"] { color:#c2410c;background:color-mix(in srgb,var(--orange) 12%,var(--panel)); }
[data-compact-appointment="true"] [data-planner-money-grid] { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:6px; }
[data-compact-appointment="true"] [data-planner-money-grid] span { display:flex;flex-direction:column;gap:1px; }
[data-compact-appointment="true"] [data-planner-money-grid] small { color:var(--muted);font-size:11px; }
[data-compact-appointment="true"] [data-planner-money-grid] b { font-size:13px; }
[data-compact-appointment="true"] [data-planner-last-payment] { display:block;margin-top:5px;color:var(--muted);font-size:11px; }
[data-compact-appointment="true"] [data-planner-estimate] { margin-top:7px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid color-mix(in srgb,var(--orange) 35%,var(--line));border-radius:8px;background:color-mix(in srgb,var(--orange) 6%,var(--panel)); }
[data-compact-appointment="true"] [data-planner-estimate] small { margin:0!important;color:var(--muted);font-size:11px;font-weight:850;letter-spacing:.06em;text-transform:uppercase; }
[data-compact-appointment="true"] [data-planner-estimate] strong { color:var(--orange);font-size:15px;white-space:nowrap; }
[data-compact-appointment="true"] [data-planner-hidden="true"],[data-compact-appointment="true"] [class*="detailsReadonly"],[data-compact-appointment="true"] [class*="detailsFoot"] { display:none!important; }
@media (max-height:760px) and (min-width:761px) {
 [data-compact-appointment="true"] [class*="detailsHead"] { padding-top:8px!important;padding-bottom:7px!important; }
 [data-compact-appointment="true"] [class*="detailsBody"] { gap:5px!important;padding-top:7px!important;padding-bottom:8px!important; }
 [data-compact-appointment="true"] [class*="detailsVehicle"] { padding-top:7px!important;padding-bottom:7px!important; }
 [data-compact-appointment="true"] [class*="detailsGrid"] > div { padding-top:6px!important;padding-bottom:6px!important; }
 [data-compact-appointment="true"] [class*="detailsSection"] { padding-top:7px!important;padding-bottom:7px!important; }
}
@media (max-width:760px) { [data-compact-appointment="true"] { width:100%!important;max-height:calc(100vh - 12px)!important;overflow:auto!important; } [data-compact-appointment="true"] [data-planner-money-grid] { grid-template-columns:1fr; } }
`;

function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringOrNull(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numericOrNull(value: unknown) { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) ? n : null; }
function money(value: number | null | undefined) { return value == null ? "—" : new Intl.NumberFormat("uk-UA",{style:"currency",currency:"UAH",maximumFractionDigits:0}).format(value); }
function paymentLabel(status: FinanceState["status"]) { return status === "PAID" ? "Оплачено" : status === "PARTIAL" ? "Частково оплачено" : status === "OVERDUE" ? "Прострочено" : status === "UNPAID" ? "Очікує оплату" : "Не сформовано"; }
function methodLabel(method: FinanceState["lastPayment"] extends infer T ? T extends {method: infer M} ? M : never : never) { return method === "CASH" ? "готівка" : method === "TERMINAL" ? "термінал" : method === "ONLINE" ? "онлайн" : method === "OTHER" ? "інший спосіб" : ""; }

function parseSnapshot(value: unknown, appointmentId: string): Omit<AppointmentSnapshot,"finance"> | null {
  if (!isRecord(value) || !Array.isArray(value.appointments)) return null;
  const row = value.appointments.find((item) => isRecord(item) && item.id === appointmentId);
  if (!isRecord(row)) return null;
  const purpose = row.purpose === "DIAGNOSTICS" || row.purpose === "REPAIR" ? row.purpose : null;
  return { id:appointmentId,clientId:stringOrNull(row.clientId),phone:stringOrNull(row.phone),estimatedAmount:typeof row.estimatedAmount === "number" || typeof row.estimatedAmount === "string" ? row.estimatedAmount : null,purpose };
}

function parseFinance(value: unknown): FinanceState | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.state)) return null;
  const row = value.state;
  const status = typeof row.status === "string" ? row.status : "NOT_FORMED";
  if (!["NOT_FORMED","UNPAID","PARTIAL","PAID","OVERDUE","CANCELLED"].includes(status)) return null;
  const diagnostic = isRecord(row.diagnostic) ? {
    reviewState:stringOrNull(row.diagnostic.reviewState),
    workflowLabel:stringOrNull(row.diagnostic.workflowLabel) || "Діагностика",
    total:Number(row.diagnostic.total)||0,
    checked:Number(row.diagnostic.checked)||0,
    defects:Number(row.diagnostic.defects)||0,
    completed:row.diagnostic.completed === true,
  } : null;
  const lastPayment = isRecord(row.lastPayment) && typeof row.lastPayment.id === "string" && typeof row.lastPayment.occurredAt === "string" ? {
    id:row.lastPayment.id,
    amount:Number(row.lastPayment.amount)||0,
    occurredAt:row.lastPayment.occurredAt,
    method:["CASH","TERMINAL","ONLINE","OTHER"].includes(String(row.lastPayment.method)) ? row.lastPayment.method as "CASH"|"TERMINAL"|"ONLINE"|"OTHER" : null,
  } : null;
  return {
    appointmentId:String(row.appointmentId||""),vehicleId:stringOrNull(row.vehicleId),diagnosticId:stringOrNull(row.diagnosticId),isCurrentVisit:row.isCurrentVisit === true,
    operationalLabel:stringOrNull(row.operationalLabel)||"Запис",source:(row.source as FinanceState["source"])||"NONE",actual:row.actual === true,status:status as FinanceState["status"],
    amount:numericOrNull(row.amount),paid:Number(row.paid)||0,outstanding:numericOrNull(row.outstanding),estimatedAmount:numericOrNull(row.estimatedAmount),lastPayment,diagnostic,
  };
}

function parseClientId(value: unknown) { return isRecord(value) && isRecord(value.client) ? stringOrNull(value.client.id) : null; }
function formatEstimate(value: AppointmentSnapshot["estimatedAmount"]) { const numeric=numericOrNull(value);return numeric==null?"Ще не розраховано":money(numeric); }
function detailsModal() { return document.querySelector('[role="dialog"][aria-label="Інформація про запис"]') as HTMLElement | null; }
function textOf(element: Element | null) { return element?.textContent?.replace(/\s+/g," ").trim()||""; }
function findSection(modal:HTMLElement,headings:string[]) { return Array.from(modal.querySelectorAll("section")).find(section=>headings.includes(textOf(section.querySelector("h3")))) as HTMLElement|undefined; }
function findClientCell(modal:HTMLElement) { const label=Array.from(modal.querySelectorAll("small")).find(node=>textOf(node)==="КЛІЄНТ");return label?.parentElement as HTMLElement|null; }

function hideNoise(modal:HTMLElement) { for(const heading of ["Фінанси","Стан роботи"]){const section=findSection(modal,[heading]);if(section)section.dataset.plannerHidden="true";} }

function applyHeaderStatus(modal:HTMLElement,finance:FinanceState|null) {
  if(!finance)return;
  const label=Array.from(modal.querySelectorAll("small")).find(node=>textOf(node)==="СТАТУС ЗАПИСУ");
  const status=label?.parentElement?.querySelector("em");
  if(status && status.textContent!==finance.operationalLabel)status.textContent=finance.operationalLabel;
}

function ensureVisitFacts(workSection:HTMLElement){
  let host=workSection.querySelector("[data-planner-visit-facts]") as HTMLElement|null;
  if(host)return host;
  host=document.createElement("div");host.dataset.plannerVisitFacts="true";
  const title=workSection.querySelector("[class*='detailsSectionTitle']");title?.insertAdjacentElement("afterend",host);if(!title)workSection.prepend(host);return host;
}

function renderFacts(modal:HTMLElement,snapshot:AppointmentSnapshot|null){
  const section=findSection(modal,["Діагностика","Роботи"]);if(!section)return;
  section.querySelector("[data-planner-estimate]")?.remove();
  const finance=snapshot?.finance||null;
  if(!finance){
    let estimate=section.querySelector("[data-planner-estimate]") as HTMLElement|null;
    if(!estimate){estimate=document.createElement("div");estimate.dataset.plannerEstimate="true";estimate.innerHTML="<small></small><strong></strong>";const title=section.querySelector("[class*='detailsSectionTitle']");title?.insertAdjacentElement("afterend",estimate);}
    const isRepair=snapshot?.purpose==="REPAIR"||textOf(section.querySelector("h3"))==="Роботи";
    const small=estimate?.querySelector("small");const strong=estimate?.querySelector("strong");if(small)small.textContent=isRepair?"Орієнтовна сума робіт":"Орієнтовна вартість діагностики";if(strong)strong.textContent=formatEstimate(snapshot?.estimatedAmount??null);return;
  }
  const host=ensureVisitFacts(section);host.replaceChildren();
  if(finance.diagnostic){
    const block=document.createElement("div");block.dataset.plannerDiagnosticFact="true";
    const head=document.createElement("div");head.dataset.plannerFactHead="true";const strong=document.createElement("strong");strong.textContent=finance.diagnostic.workflowLabel;head.append(strong);
    if(finance.diagnosticId){const button=document.createElement("button");button.type="button";button.dataset.plannerDiagnosticLink="true";button.dataset.diagnosticId=finance.diagnosticId;button.textContent="Відкрити ДК →";head.append(button);}block.append(head);
    const meta=document.createElement("div");meta.dataset.plannerDiagnosticMeta="true";meta.textContent=`${finance.diagnostic.checked}/${finance.diagnostic.total} перевірено · ${finance.diagnostic.defects} деф.`;block.append(meta);host.append(block);
  }
  const fin=document.createElement("div");fin.dataset.plannerFinanceFact="true";
  const head=document.createElement("div");head.dataset.plannerFactHead="true";const title=document.createElement("strong");title.textContent="Оплата";const badge=document.createElement("span");badge.dataset.plannerPaymentBadge=finance.status;badge.textContent=paymentLabel(finance.status);head.append(title,badge);fin.append(head);
  const grid=document.createElement("div");grid.dataset.plannerMoneyGrid="true";
  for(const [label,value] of [["Нараховано",money(finance.amount)],["Оплачено",money(finance.paid)],["Залишок",money(finance.outstanding)]] as const){const cell=document.createElement("span");const small=document.createElement("small");small.textContent=label;const b=document.createElement("b");b.textContent=value;cell.append(small,b);grid.append(cell);}fin.append(grid);
  if(finance.lastPayment){const last=document.createElement("small");last.dataset.plannerLastPayment="true";const date=new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(finance.lastPayment.occurredAt));last.textContent=`Остання оплата: ${money(finance.lastPayment.amount)}${finance.lastPayment.method?` · ${methodLabel(finance.lastPayment.method)}`:""} · ${date}`;fin.append(last);}host.append(fin);
}

function applyClientLink(modal:HTMLElement,clientId:string|null){const cell=findClientCell(modal);if(!cell)return;if(!clientId){delete cell.dataset.plannerClientLink;delete cell.dataset.clientId;cell.removeAttribute("role");cell.removeAttribute("tabindex");cell.removeAttribute("title");return;}cell.dataset.plannerClientLink="true";cell.dataset.clientId=clientId;cell.setAttribute("role","button");cell.setAttribute("tabindex","0");cell.setAttribute("title","Відкрити картку клієнта");}

async function resolveSnapshot(appointmentId:string,signal:AbortSignal):Promise<AppointmentSnapshot|null>{
  const now=Date.now();const params=new URLSearchParams({from:new Date(now-86_400_000).toISOString(),to:new Date(now+86_400_000).toISOString(),appointmentId});
  const [plannerResponse,financeResponse]=await Promise.all([
    fetch(`/api/planner?${params}`,{cache:"no-store",credentials:"include",signal}),
    fetch(`/api/visit-financial-state?appointmentId=${encodeURIComponent(appointmentId)}`,{cache:"no-store",credentials:"include",signal}),
  ]);
  const plannerPayload:unknown=await plannerResponse.json().catch(()=>null);const financePayload:unknown=await financeResponse.json().catch(()=>null);
  if(!plannerResponse.ok)return null;let base=parseSnapshot(plannerPayload,appointmentId);if(!base)return null;
  if(!base.clientId&&base.phone){const clientResponse=await fetch(`/api/client-card?phone=${encodeURIComponent(base.phone)}`,{cache:"no-store",credentials:"include",signal});const clientPayload:unknown=await clientResponse.json().catch(()=>null);if(clientResponse.ok)base={...base,clientId:parseClientId(clientPayload)};}
  return {...base,finance:financeResponse.ok?parseFinance(financePayload):null};
}

export function PlannerAppointmentWindowEnhancer(){
  useEffect(()=>{
    const cache=new Map<string,AppointmentSnapshot|null>();let activeAppointmentId="";let controller:AbortController|null=null;let stopped=false;
    const decorate=(modal:HTMLElement,snapshot:AppointmentSnapshot|null)=>{modal.dataset.compactAppointment="true";hideNoise(modal);renderFacts(modal,snapshot);applyHeaderStatus(modal,snapshot?.finance||null);applyClientLink(modal,snapshot?.clientId??null);};
    const tick=()=>{if(stopped)return;const modal=detailsModal();if(!modal){activeAppointmentId="";controller?.abort();controller=null;return;}const appointmentId=readCrmRoute().appointmentId||"";if(!appointmentId)return;const cached=cache.get(appointmentId);decorate(modal,cached??null);if(cache.has(appointmentId))return;if(activeAppointmentId===appointmentId&&controller)return;controller?.abort();controller=new AbortController();activeAppointmentId=appointmentId;void resolveSnapshot(appointmentId,controller.signal).then(snapshot=>{if(stopped||controller?.signal.aborted||activeAppointmentId!==appointmentId)return;cache.set(appointmentId,snapshot);const current=detailsModal();if(current&&readCrmRoute().appointmentId===appointmentId)decorate(current,snapshot);}).catch(error=>{if(error instanceof DOMException&&error.name==="AbortError")return;cache.set(appointmentId,null);});};
    const openTarget=(target:EventTarget|null)=>{if(!(target instanceof Element))return false;const client=target.closest("[data-planner-client-link]") as HTMLElement|null;if(client?.dataset.clientId){navigateCrm("Клієнти",{clientId:client.dataset.clientId});return true;}const diagnostic=target.closest("[data-planner-diagnostic-link]") as HTMLElement|null;if(diagnostic?.dataset.diagnosticId){const vehicleId=cache.get(readCrmRoute().appointmentId||"")?.finance?.vehicleId||undefined;navigateCrm("Діагностика",{diagnosticId:diagnostic.dataset.diagnosticId,vehicleId});return true;}return false;};
    const onClick=(event:MouseEvent)=>{if(openTarget(event.target))event.preventDefault();};const onKeyDown=(event:KeyboardEvent)=>{if(event.key!=="Enter"&&event.key!==" ")return;if(openTarget(event.target))event.preventDefault();};
    const refresh=()=>{const id=readCrmRoute().appointmentId||"";if(id)cache.delete(id);controller?.abort();controller=null;activeAppointmentId="";tick();};
    document.addEventListener("click",onClick,true);document.addEventListener("keydown",onKeyDown,true);window.addEventListener("popstate",tick);window.addEventListener("turbolev:data-changed",refresh as EventListener);
    const observer=new MutationObserver(tick);observer.observe(document.body,{childList:true,subtree:true});const timer=window.setInterval(tick,350);tick();
    return()=>{stopped=true;controller?.abort();document.removeEventListener("click",onClick,true);document.removeEventListener("keydown",onKeyDown,true);window.removeEventListener("popstate",tick);window.removeEventListener("turbolev:data-changed",refresh as EventListener);observer.disconnect();window.clearInterval(timer);};
  },[]);
  return <style dangerouslySetInnerHTML={{__html:COMPACT_CSS}}/>;
}
