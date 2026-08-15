"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./diagnostics.module.css";

type DiagnosticStatus="PENDING"|"IN_PROGRESS"|"CONFIRMED"|"CANCELLED";
type Diagnostic={
  id:string;status:DiagnosticStatus;technicalConclusion:string|null;confirmedAt:string|null;createdAt:string;updatedAt:string;
  client:{id:string;name:string|null;phone:string};
  vehicle:{id:string;brand:string|null;model:string|null;year:number|null;plateNumber:string|null;vin:string|null;mileageKm:number|null};
  lead:{id:string;need:string|null;comment:string|null;assignedUserId:string|null}|null;
  workOrder:{id:string;status:string;createdAt:string;updatedAt:string}|null;
};
type ApiResponse={ok:boolean;diagnostics?:Diagnostic[];diagnostic?:Diagnostic;workOrder?:Diagnostic["workOrder"];error?:string;workflowDecision?:{code:string;availableTargets?:string[]}};

const statusMeta:Record<DiagnosticStatus,{label:string;note:string}>={
  PENDING:{label:"Очікує діагностики",note:"Авто прийняте, діагностика ще не розпочата"},
  IN_PROGRESS:{label:"Діагностика триває",note:"Автомеханік формує технічний висновок"},
  CONFIRMED:{label:"Підтверджено",note:"Hard Gate пройдено, WorkOrder може існувати"},
  CANCELLED:{label:"Скасовано",note:"Діагностику закрито без WorkOrder"},
};
const filters:Array<{value:"ALL"|DiagnosticStatus;label:string}>=[
  {value:"ALL",label:"Усі"},{value:"PENDING",label:"Очікують"},{value:"IN_PROGRESS",label:"В роботі"},{value:"CONFIRMED",label:"Підтверджені"},{value:"CANCELLED",label:"Скасовані"},
];
function vehicleName(row:Diagnostic){return [row.vehicle.brand,row.vehicle.model,row.vehicle.year].filter(Boolean).join(" ")||"Автомобіль";}
function dateTime(value:string|null){if(!value)return"—";return new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}

export function Diagnostics(){
  const [rows,setRows]=useState<Diagnostic[]>([]);const [filter,setFilter]=useState<"ALL"|DiagnosticStatus>("ALL");const [selectedId,setSelectedId]=useState<string|null>(null);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");const [conclusion,setConclusion]=useState("");
  async function load(){setLoading(true);setError("");try{const response=await fetch("/api/diagnostics",{cache:"no-store"});const data=await response.json() as ApiResponse;if(!response.ok||!data.ok||!data.diagnostics)throw new Error(data.error||"Не вдалося завантажити діагностики");setRows(data.diagnostics);setSelectedId(current=>current&&data.diagnostics!.some(item=>item.id===current)?current:data.diagnostics![0]?.id??null);}catch(e){setError(e instanceof Error?e.message:"Помилка завантаження");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  const visible=useMemo(()=>filter==="ALL"?rows:rows.filter(item=>item.status===filter),[rows,filter]);
  const selected=rows.find(item=>item.id===selectedId)??null;
  useEffect(()=>{setConclusion(selected?.technicalConclusion??"");setMessage("");},[selectedId,selected?.technicalConclusion]);
  const counts=useMemo(()=>({pending:rows.filter(x=>x.status==="PENDING").length,inProgress:rows.filter(x=>x.status==="IN_PROGRESS").length,confirmed:rows.filter(x=>x.status==="CONFIRMED").length,withWorkOrder:rows.filter(x=>Boolean(x.workOrder)).length}),[rows]);

  async function transition(status:DiagnosticStatus){if(!selected)return;setSaving(true);setError("");setMessage("");try{const response=await fetch(`/api/diagnostics/${selected.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,technicalConclusion:conclusion})});const data=await response.json() as ApiResponse;if(!response.ok||!data.ok||!data.diagnostic)throw new Error(data.error||"Не вдалося змінити статус");setRows(current=>current.map(item=>item.id===data.diagnostic!.id?data.diagnostic!:item));if(status==="CONFIRMED")setMessage(data.diagnostic.workOrder?`Діагностику підтверджено. WorkOrder ${data.diagnostic.workOrder.id.slice(-8)} створено/прив’язано.`:"Діагностику підтверджено.");else setMessage("Статус діагностики оновлено.");}catch(e){setError(e instanceof Error?e.message:"Помилка зміни статусу");}finally{setSaving(false);}}

  return <div className={styles.page}>
    <header className={styles.head}><div><p className={styles.eyebrow}>СЕРВІС · HARD GATE #1</p><h1>Діагностика</h1><p>WorkOrder створюється тільки після підтвердженого технічного висновку. Перехід статусів контролює Workflow Runtime.</p></div><button className={styles.refresh} onClick={()=>void load()} disabled={loading}>{loading?"Оновлюю…":"Оновити"}</button></header>
    <section className={styles.kpis}><div><span>Очікують</span><strong>{counts.pending}</strong></div><div><span>В роботі</span><strong>{counts.inProgress}</strong></div><div><span>Підтверджено</span><strong>{counts.confirmed}</strong></div><div><span>WorkOrder створено</span><strong>{counts.withWorkOrder}</strong></div></section>
    <nav className={styles.filters}>{filters.map(item=><button key={item.value} className={filter===item.value?styles.activeFilter:""} onClick={()=>setFilter(item.value)}>{item.label}<span>{item.value==="ALL"?rows.length:rows.filter(row=>row.status===item.value).length}</span></button>)}</nav>
    {error&&<div className={styles.error}>{error}</div>}{message&&<div className={styles.success}>{message}</div>}
    <div className={styles.layout}>
      <section className={styles.list}>{loading&&!rows.length?<div className={styles.empty}>Завантажую діагностики…</div>:visible.length?visible.map(row=><button key={row.id} className={`${styles.row} ${selectedId===row.id?styles.selected:""}`} onClick={()=>setSelectedId(row.id)}><div className={styles.rowTop}><span className={`${styles.status} ${styles[row.status]}`}>{statusMeta[row.status].label}</span><time>{dateTime(row.updatedAt)}</time></div><strong>{vehicleName(row)}</strong><span className={styles.plate}>{row.vehicle.plateNumber||"Без номера"}</span><small>{row.client.name||row.client.phone}</small>{row.lead?.need&&<p>{row.lead.need}</p>}{row.workOrder&&<span className={styles.workOrderBadge}>WO · {row.workOrder.status}</span>}</button>):<div className={styles.empty}>У цьому фільтрі діагностик немає.</div>}</section>
      <aside className={styles.detail}>{selected?<><div className={styles.detailHead}><div><span className={`${styles.status} ${styles[selected.status]}`}>{statusMeta[selected.status].label}</span><h2>{vehicleName(selected)}</h2><p>{selected.vehicle.plateNumber||"Без держномера"} · {selected.vehicle.vin||"VIN не вказано"}</p></div></div>
        <div className={styles.infoGrid}><div><span>Клієнт</span><strong>{selected.client.name||"Без імені"}</strong><small>{selected.client.phone}</small></div><div><span>Пробіг</span><strong>{selected.vehicle.mileageKm?`${selected.vehicle.mileageKm.toLocaleString("uk-UA")} км`:"—"}</strong></div><div><span>Створено</span><strong>{dateTime(selected.createdAt)}</strong></div><div><span>Підтверджено</span><strong>{dateTime(selected.confirmedAt)}</strong></div></div>
        {selected.lead?.need&&<div className={styles.problem}><span>Скарга / завдання</span><p>{selected.lead.need}</p></div>}
        <label className={styles.conclusion}><span>Технічний висновок</span><textarea rows={8} value={conclusion} disabled={selected.status==="CANCELLED"} placeholder="Опишіть підтверджені дефекти, результати перевірки та рекомендовані роботи…" onChange={e=>setConclusion(e.target.value)}/><small>Для статусу «Підтверджено» висновок обов’язковий.</small></label>
        {selected.workOrder&&<div className={styles.woCard}><div><span>Замовлення-наряд</span><strong>{selected.workOrder.id}</strong></div><span className={styles.woStatus}>{selected.workOrder.status}</span></div>}
        <div className={styles.actions}>{selected.status==="PENDING"&&<><button className={styles.primary} disabled={saving} onClick={()=>void transition("IN_PROGRESS")}>Почати діагностику</button><button className={styles.secondary} disabled={saving} onClick={()=>void transition("CANCELLED")}>Скасувати</button></>}{selected.status==="IN_PROGRESS"&&<><button className={styles.primary} disabled={saving||!conclusion.trim()} onClick={()=>void transition("CONFIRMED")}>{saving?"Підтверджую…":"Підтвердити та створити WorkOrder"}</button><button className={styles.secondary} disabled={saving} onClick={()=>void transition("CANCELLED")}>Скасувати</button></>}{selected.status==="CONFIRMED"&&<span className={styles.lockNote}>✓ Hard Gate пройдено. Діагностика зафіксована; WorkOrder не створюється повторно.</span>}{selected.status==="CANCELLED"&&<span className={styles.lockNote}>Діагностику закрито. Для нового огляду потрібен новий DiagnosticRequest.</span>}</div>
      </>:<div className={styles.empty}>Оберіть діагностику зі списку.</div>}</aside>
    </div>
  </div>;
}
