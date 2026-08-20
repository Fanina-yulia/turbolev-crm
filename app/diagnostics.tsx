"use client";

import { useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
import { StructuredDiagnosticReviewPanel } from "./structured-diagnostic-review-panel";
import styles from "./diagnostics.module.css";

type DiagnosticStatus="PENDING"|"IN_PROGRESS"|"CONFIRMED"|"CANCELLED";
type WorkflowState=DiagnosticStatus|"SUBMITTED"|"RETURNED"|"CARD_SENT";
type Diagnostic={
  id:string;status:DiagnosticStatus;workflowState?:WorkflowState;reviewState?:string;technicalConclusion:string|null;confirmedAt:string|null;createdAt:string;updatedAt:string;
  client:{id:string;name:string|null;phone:string};
  vehicle:{id:string;brand:string|null;model:string|null;year:number|null;plateNumber:string|null;vin:string|null;mileageKm:number|null};
  lead:{id:string;need:string|null;comment:string|null;assignedUserId:string|null}|null;
  workOrder:{id:string;status:string;createdAt:string;updatedAt:string}|null;
  reportShare?:{id:string;active:boolean;createdAt:string;expiresAt:string|null;revokedAt:string|null}|null;
  structured?:{inspections:number;checked:number;defects:number;attention:number};
};
type ApiResponse={ok:boolean;diagnostics?:Diagnostic[];diagnostic?:Diagnostic;workOrder?:Diagnostic["workOrder"];error?:string;message?:string;workflowDecision?:{code:string;availableTargets?:string[]}};
type Filter="ALL"|DiagnosticStatus|"SUBMITTED"|"RETURNED"|"CARD_SENT";

const statusMeta:Record<WorkflowState,{label:string;note:string}>={
  PENDING:{label:"Очікує",note:"Авто підтверджене, діагностика готується до старту"},
  IN_PROGRESS:{label:"В роботі",note:"Механік проводить діагностику"},
  SUBMITTED:{label:"Завершена діагностика",note:"Механік завершив діагностику; сервіс-менеджер перевіряє результат"},
  RETURNED:{label:"Повернено механіку",note:"Сервіс-менеджер очікує уточнення"},
  CONFIRMED:{label:"ДК сформована",note:"Діагностику зафіксовано; очікується або перевіряється відправка ДК"},
  CARD_SENT:{label:"Надіслана ДК",note:"Діагностична карта доступна у кабінеті власника"},
  CANCELLED:{label:"Скасовано",note:"Діагностику закрито"},
};
const filters:Array<{value:Filter;label:string}>=[
  {value:"ALL",label:"Усі"},{value:"PENDING",label:"Очікують"},{value:"IN_PROGRESS",label:"В роботі"},{value:"SUBMITTED",label:"Завершені"},{value:"RETURNED",label:"Повернені"},{value:"CARD_SENT",label:"Надіслана ДК"},{value:"CONFIRMED",label:"ДК без відправки"},{value:"CANCELLED",label:"Скасовані"},
];
function vehicleName(row:Diagnostic){return [row.vehicle.brand,row.vehicle.model,row.vehicle.year].filter(Boolean).join(" ")||"Автомобіль";}
function dateTime(value:string|null){if(!value)return"—";return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
function workflowState(row:Diagnostic):WorkflowState{return row.workflowState||row.status;}
function stateClass(row:Diagnostic){const state=workflowState(row);if(state==="SUBMITTED")return styles.IN_PROGRESS;if(state==="RETURNED")return styles.PENDING;if(state==="CARD_SENT")return styles.CONFIRMED;return styles[row.status];}

export function Diagnostics(){
  const [rows,setRows]=useState<Diagnostic[]>([]);const [filter,setFilter]=useState<Filter>("ALL");const [selectedId,setSelectedId]=useState<string|null>(null);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");const [conclusion,setConclusion]=useState("");
  async function load(){setLoading(true);setError("");try{const response=await fetch("/api/diagnostics",{cache:"no-store",credentials:"include"});const data=await response.json() as ApiResponse;if(!response.ok||!data.ok||!data.diagnostics)throw new Error(data.message||data.error||"Не вдалося завантажити діагностики");setRows(data.diagnostics);setSelectedId(current=>current&&data.diagnostics!.some(item=>item.id===current)?current:data.diagnostics![0]?.id??null);}catch(e){setError(e instanceof Error?e.message:"Помилка завантаження");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  const visible=useMemo(()=>filter==="ALL"?rows:rows.filter(item=>{
    const state=workflowState(item);
    if(filter==="SUBMITTED"||filter==="RETURNED"||filter==="CARD_SENT")return state===filter;
    if(filter==="CONFIRMED")return item.status==="CONFIRMED"&&state!=="CARD_SENT";
    return item.status===filter;
  }),[rows,filter]);
  const selected=rows.find(item=>item.id===selectedId)??null;
  useEffect(()=>{setConclusion(selected?.technicalConclusion??"");setMessage("");},[selectedId,selected?.technicalConclusion]);
  const counts=useMemo(()=>({pending:rows.filter(x=>x.status==="PENDING").length,inProgress:rows.filter(x=>workflowState(x)==="IN_PROGRESS").length,submitted:rows.filter(x=>workflowState(x)==="SUBMITTED").length,cardSent:rows.filter(x=>workflowState(x)==="CARD_SENT").length}),[rows]);

  async function transition(status:DiagnosticStatus){if(!selected)return;setSaving(true);setError("");setMessage("");try{const response=await fetch(`/api/diagnostics/${selected.id}`,{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,technicalConclusion:conclusion})});const data=await response.json() as ApiResponse;if(!response.ok||!data.ok||!data.diagnostic)throw new Error(data.message||data.error||"Не вдалося змінити статус");await load();setMessage(status==="CONFIRMED"?"Діагностику зафіксовано. Створення ремонтного наряду відкладено до вибору наступного маршруту.":"Статус діагностики оновлено.");}catch(e){setError(e instanceof Error?e.message:"Помилка зміни статусу");}finally{setSaving(false);}}

  const filterCount=(value:Filter)=>{
    if(value==="ALL")return rows.length;
    if(value==="SUBMITTED"||value==="RETURNED"||value==="CARD_SENT")return rows.filter(row=>workflowState(row)===value).length;
    if(value==="CONFIRMED")return rows.filter(row=>row.status==="CONFIRMED"&&workflowState(row)!=="CARD_SENT").length;
    return rows.filter(row=>row.status===value).length;
  };

  return <div className={styles.page}>
    <header className={styles.head}><div><p className={styles.eyebrow}>СЕРВІС · ДІАГНОСТИКА</p><h1>Діагностика</h1><p>Заїзд підтверджує механік скануванням номера. Після завершення сервіс-менеджер перевіряє результат, створює ДК і лише потім обирає наступний маршрут.</p></div><button className={styles.refresh} onClick={()=>void load()} disabled={loading}>{loading?"Оновлюю…":"Оновити"}</button></header>
    <section className={styles.kpis}><div><span>Очікують</span><strong>{counts.pending}</strong></div><div><span>В роботі</span><strong>{counts.inProgress}</strong></div><div><span>Завершена діагностика</span><strong>{counts.submitted}</strong></div><div><span>Надіслана ДК</span><strong>{counts.cardSent}</strong></div></section>
    <nav className={styles.filters}>{filters.map(item=><button key={item.value} className={filter===item.value?styles.activeFilter:""} onClick={()=>setFilter(item.value)}>{item.label}<span>{filterCount(item.value)}</span></button>)}</nav>
    {error&&<div className={styles.error}>{error}</div>}{message&&<div className={styles.success}>{message}</div>}
    <div className={styles.layout}>
      <section className={styles.list}>{loading&&!rows.length?<div className={styles.empty}>Завантажую діагностики…</div>:visible.length?visible.map(row=>{const state=workflowState(row);return <button key={row.id} className={`${styles.row} ${selectedId===row.id?styles.selected:""}`} onClick={()=>setSelectedId(row.id)}><div className={styles.rowTop}><span className={`${styles.status} ${stateClass(row)}`}>{statusMeta[state].label}</span><time>{dateTime(row.updatedAt)}</time></div><strong>{vehicleName(row)}</strong><span className={styles.plate}>{row.vehicle.plateNumber||"Без номера"}</span><small>{row.client.name||row.client.phone}</small>{row.lead?.need&&<p>{row.lead.need}</p>}{row.structured&&row.structured.inspections>0&&<small>Чекліст: {row.structured.checked} перевірено · {row.structured.defects} деф. · {row.structured.attention} увага</small>}{row.workOrder&&<span className={styles.workOrderBadge}>Наряд · {row.workOrder.status}</span>}</button>}):<div className={styles.empty}>У цьому фільтрі діагностик немає.</div>}</section>
      <aside className={styles.detail}>{selected?<><div className={styles.detailHead}><div><span className={`${styles.status} ${stateClass(selected)}`}>{statusMeta[workflowState(selected)].label}</span><h2>{vehicleName(selected)}</h2><p>{selected.vehicle.plateNumber||"Без держномера"} · {selected.vehicle.vin||"VIN не вказано"}</p></div></div>
        <div className={styles.infoGrid}><div><span>Клієнт</span><strong>{selected.client.name||"Без імені"}</strong><small>{selected.client.phone}</small></div><div><span>Пробіг</span><strong>{selected.vehicle.mileageKm?`${selected.vehicle.mileageKm.toLocaleString("uk-UA")} км`:"—"}</strong></div><div><span>Створено</span><strong>{dateTime(selected.createdAt)}</strong></div><div><span>ДК</span><strong>{workflowState(selected)==="CARD_SENT"?"Надіслана":selected.status==="CONFIRMED"?"Сформована":"—"}</strong></div></div>
        {selected.lead?.need&&<div className={styles.problem}><span>Скарга / завдання</span><p>{selected.lead.need}</p></div>}
        <label className={styles.conclusion}><span>Технічний висновок</span><textarea rows={selected.structured?.inspections?5:8} value={conclusion} disabled={selected.status==="CANCELLED"||Boolean(selected.structured?.inspections)||workflowState(selected)==="CARD_SENT"} placeholder={selected.structured?.inspections?"Висновок перевіряється у структурованому звіті нижче.":"Опишіть підтверджені дефекти, результати перевірки та рекомендовані роботи…"} onChange={e=>setConclusion(e.target.value)}/><small>{selected.structured?.inspections?"Для структурованої діагностики висновок та ДК формуються у блоці нижче.":"Для старої діагностики заповніть висновок вручну."}</small></label>
        {selected.workOrder&&<div className={styles.woCard}><div><span>Замовлення-наряд</span><strong>{selected.workOrder.id}</strong></div><span className={styles.woStatus}>{selected.workOrder.status}</span></div>}
        {!selected.structured?.inspections&&["SUBMITTED","CONFIRMED"].includes(selected.reviewState||"")&&<DiagnosticReportSharePanel diagnosticId={selected.id} reviewState={selected.reviewState||workflowState(selected)} workOrder={selected.workOrder}/>} 
        {selected.structured?.inspections?<StructuredDiagnosticReviewPanel diagnosticId={selected.id} onChanged={load}/>:<div className={styles.actions}>{selected.status==="PENDING"&&<><button className={styles.primary} disabled={saving} onClick={()=>void transition("IN_PROGRESS")}>Почати стару діагностику</button><button className={styles.secondary} disabled={saving} onClick={()=>void transition("CANCELLED")}>Скасувати</button></>}{selected.status==="IN_PROGRESS"&&<><button className={styles.primary} disabled={saving||!conclusion.trim()} onClick={()=>void transition("CONFIRMED")}>{saving?"Зберігаю…":"Зафіксувати діагностику"}</button><button className={styles.secondary} disabled={saving} onClick={()=>void transition("CANCELLED")}>Скасувати</button></>}{selected.status==="CONFIRMED"&&<span className={styles.lockNote}>✓ Діагностику зафіксовано. Ремонтний наряд створюється тільки після вибору наступного маршруту.</span>}{selected.status==="CANCELLED"&&<span className={styles.lockNote}>Діагностику закрито. Для нового огляду потрібна нова заявка на діагностику.</span>}</div>}
      </>:<div className={styles.empty}>Оберіть діагностику зі списку.</div>}</aside>
    </div>
  </div>;
}