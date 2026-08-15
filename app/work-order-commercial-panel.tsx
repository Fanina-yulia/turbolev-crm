"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./work-order-commercial-panel.module.css";

type Line = {
  id:string; type:string; status:string; description:string; article:string|null; brand:string|null;
  currency:string; plannedQuantity:string; plannedUnitPrice:string; plannedUnitCost:string; plannedDiscount:string;
  requiredForRepair:boolean; mechanicId:string|null; supplierId:string|null; supplierQuoteId:string|null;
};
type Estimate = { id:string; revision:number; status:string; currency:string; subtotal:string; discountAmount:string; totalAmount:string; sentAt:string|null; approvedAt:string|null; approvedByName:string|null };
type PartItem = { id:string; workOrderLineId:string; description:string; article:string|null; brand:string|null; quantity:string; receivedQuantity:string; installedQuantity:string; currency:string; requiredForRepair:boolean; etaAt:string|null };
type PartsRequest = { id:string; status:string; paymentRequired:boolean; paymentConfirmedAt:string|null; items:PartItem[] };
type Commercial = {
  lines:Line[]; estimate:Estimate|null; partsRequest:PartsRequest|null; estimateIsCurrent:boolean; estimateApproved:boolean;
  requiredPartsCount:number; partsReady:boolean; mechanicAssigned:boolean; partsPaymentSatisfied:boolean;
};

function money(value:string|number|null|undefined,currency="UAH"){
  const n=Number(value||0);return new Intl.NumberFormat("uk-UA",{style:"currency",currency,maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);
}
function num(value:string|number|null|undefined){const n=Number(value||0);return Number.isFinite(n)?n:0}
function date(value:string|null|undefined){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("uk-UA",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d)}

export function WorkOrderCommercialPanel({workOrderId,onChanged}:{workOrderId:string;onChanged?:()=>void}){
  const [data,setData]=useState<Commercial|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [approvalName,setApprovalName]=useState("");
  const [draft,setDraft]=useState({type:"LABOR",description:"",quantity:"1",price:"",cost:"",article:""});

  const load=useCallback(async()=>{setLoading(true);try{const r=await fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`,{cache:"no-store"});const p=await r.json();if(!r.ok||!p.ok)throw new Error(p.error||"Не вдалося завантажити комерційний контур.");setData(p.commercial)}catch(e){setMessage(e instanceof Error?e.message:"Помилка завантаження.")}finally{setLoading(false)}},[workOrderId]);
  useEffect(()=>{void load()},[load]);

  async function act(key:string,url:string,method="POST",body:Record<string,unknown>={}){setBusy(key);setMessage("");try{const r=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const p=await r.json();if(!r.ok||!p.ok)throw new Error(p.error||"Дію не виконано.");await load();onChanged?.();return true}catch(e){setMessage(e instanceof Error?e.message:"Дію не виконано.");return false}finally{setBusy("")}}

  async function addLine(){if(!draft.description.trim())return;const ok=await act("line",`/api/work-orders/${encodeURIComponent(workOrderId)}/lines`,"POST",{type:draft.type,description:draft.description,plannedQuantity:draft.quantity||"1",plannedUnitPrice:draft.price||"0",plannedUnitCost:draft.cost||"0",article:draft.article||undefined,actorName:"CRM / WorkOrder Center"});if(ok)setDraft({type:"LABOR",description:"",quantity:"1",price:"",cost:"",article:""})}
  async function decide(decision:"APPROVE"|"REJECT"){await act(decision,`/api/work-orders/${encodeURIComponent(workOrderId)}/estimate/decision`,"POST",{decision,approvedByName:approvalName||undefined,source:"CRM",actorName:"CRM / WorkOrder Center"})}
  async function receive(item:PartItem){await act(`receive:${item.id}`,`/api/parts-requests/${encodeURIComponent(data!.partsRequest!.id)}/items/${encodeURIComponent(item.id)}`,"PATCH",{receivedQuantity:item.quantity,actorName:"CRM / Склад"})}
  async function advanceParts(status:string){if(!data?.partsRequest)return;await act(`parts:${status}`,`/api/parts-requests/${encodeURIComponent(data.partsRequest.id)}`,"PATCH",{status,actorName:"CRM / Підбір запчастин"})}

  const nextParts=useMemo(()=>{const s=data?.partsRequest?.status;return s==="NEW"?["SELECTING","Почати підбір"]:s==="SELECTING"?["SELECTED","Підбір завершено"]:s==="SELECTED"?["APPROVED","Погодити деталі"]:s==="APPROVED"?["ORDER_REQUIRED","Потрібне замовлення"]:s==="ORDER_REQUIRED"?["ORDERED","Замовлено"]:null},[data?.partsRequest?.status]);

  if(loading&&!data)return <div className={styles.empty}>Завантажую кошторис і запчастини…</div>;
  if(!data)return <div className={styles.notice}>{message||"Комерційний контур недоступний."}</div>;

  return <div className={styles.panel}>
    <div className={styles.gateGrid}>
      <div className={styles.gate}><span>Кошторис погоджено</span><strong className={data.estimateApproved?styles.ok:styles.bad}>{data.estimateApproved?"ТАК":"НІ"}</strong></div>
      <div className={styles.gate}><span>Обов'язкові деталі готові</span><strong className={data.partsReady?styles.ok:styles.bad}>{data.partsReady?"ТАК":"НІ"}</strong></div>
      <div className={styles.gate}><span>Автомеханік призначений</span><strong className={data.mechanicAssigned?styles.ok:styles.bad}>{data.mechanicAssigned?"ТАК":"НІ"}</strong></div>
    </div>

    <div>
      <div className={styles.lineList}>{data.lines.map(line=><div className={styles.line} key={line.id}><div><strong>{line.type==="LABOR"?"Робота":line.type==="PART"?"Деталь":line.type} · {line.description}</strong><small>{[line.brand,line.article].filter(Boolean).join(" · ")||line.status} · {num(line.plannedQuantity)} × {money(line.plannedUnitPrice,line.currency)}</small></div><span className={styles.amount}>{money(num(line.plannedQuantity)*num(line.plannedUnitPrice)-num(line.plannedDiscount),line.currency)}</span></div>)}</div>
      {!data.lines.length&&<div className={styles.empty}>Ще немає робіт або деталей. Додайте перший рядок наряду.</div>}
      <div className={styles.form}>
        <select value={draft.type} onChange={e=>setDraft(v=>({...v,type:e.target.value}))}><option value="LABOR">Робота</option><option value="PART">Деталь</option><option value="EXTERNAL">Стороння</option><option value="CONSUMABLE">Матеріал</option><option value="OTHER">Інше</option></select>
        <input placeholder="Назва роботи / деталі" value={draft.description} onChange={e=>setDraft(v=>({...v,description:e.target.value}))}/>
        <input placeholder="К-сть" value={draft.quantity} onChange={e=>setDraft(v=>({...v,quantity:e.target.value}))}/>
        <input placeholder="Продаж ₴" value={draft.price} onChange={e=>setDraft(v=>({...v,price:e.target.value}))}/>
        <input placeholder="Собіварт. ₴" value={draft.cost} onChange={e=>setDraft(v=>({...v,cost:e.target.value}))}/>
        <button className={styles.button} disabled={Boolean(busy)||!draft.description.trim()} onClick={()=>void addLine()}>+ Додати</button>
      </div>
    </div>

    <div className={styles.estimate}>
      <div className={styles.estimateTop}><div><strong>Кошторис {data.estimate?`№${data.estimate.revision}`:"не сформований"}</strong><small>{data.estimate?`${data.estimate.status} · ${money(data.estimate.totalAmount,data.estimate.currency)} · відправлено ${date(data.estimate.sentAt)}`:"Фіксує точний склад робіт, деталей і цін."}</small></div>{data.estimate&&<span className={styles.amount}>{data.estimateIsCurrent?"Актуальний":"Застарів"}</span>}</div>
      <div className={styles.toolbar} style={{marginTop:10}}><button className={styles.primary} disabled={Boolean(busy)||!data.lines.length||data.estimateApproved} onClick={()=>void act("send",`/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`,"POST",{actorName:"CRM / WorkOrder Center"})}>{busy==="send"?"Формую…":"Сформувати / відправити"}</button></div>
      {data.estimate?.status==="SENT"&&<div className={styles.decision}><input placeholder="Хто погодив (ім'я клієнта)" value={approvalName} onChange={e=>setApprovalName(e.target.value)}/><button className={styles.primary} disabled={Boolean(busy)} onClick={()=>void decide("APPROVE")}>Погоджено</button><button className={styles.danger} disabled={Boolean(busy)} onClick={()=>void decide("REJECT")}>Відхилено</button></div>}
    </div>

    <div className={styles.estimate}>
      <div className={styles.estimateTop}><div><strong>Запчастини</strong><small>{data.partsRequest?`${data.partsRequest.status} · ${data.partsRequest.items.length} позицій`:`У наряді ${data.requiredPartsCount} обов'язкових позицій`}</small></div></div>
      {!data.partsRequest&&<div className={styles.toolbar} style={{marginTop:10}}><button className={styles.button} disabled={Boolean(busy)||!data.lines.some(l=>l.type==="PART")} onClick={()=>void act("parts-open",`/api/work-orders/${encodeURIComponent(workOrderId)}/parts-request`,"POST",{actorName:"CRM / WorkOrder Center"})}>Відкрити PartsRequest</button></div>}
      {data.partsRequest&&<>
        <div className={styles.toolbar} style={{marginTop:10}}>{nextParts&&<button className={styles.button} disabled={Boolean(busy)} onClick={()=>void advanceParts(nextParts[0])}>{nextParts[1]}</button>}<label className={styles.check}><input type="checkbox" checked={data.partsRequest.paymentRequired} onChange={e=>void act("payment-required",`/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`,"PATCH",{paymentRequired:e.target.checked})}/>Передоплата деталей</label>{data.partsRequest.paymentRequired&&!data.partsRequest.paymentConfirmedAt&&<button className={styles.button} onClick={()=>void act("payment-confirm",`/api/parts-requests/${encodeURIComponent(data.partsRequest!.id)}`,"PATCH",{paymentConfirmed:true})}>Оплату підтверджено</button>}</div>
        <div className={styles.partList} style={{marginTop:10}}>{data.partsRequest.items.map(item=>{const p=Math.min(100,Math.round((num(item.receivedQuantity)/Math.max(.001,num(item.quantity)))*100));return <div className={styles.part} key={item.id}><div><strong>{item.brand?`${item.brand} `:""}{item.article||item.description}</strong><small>Отримано {num(item.receivedQuantity)} з {num(item.quantity)}</small><div className={styles.progress}><i style={{width:`${p}%`}}/></div></div><button className={styles.button} disabled={Boolean(busy)||p>=100} onClick={()=>void receive(item)}>{p>=100?"Отримано":"Прийняти все"}</button></div>})}</div>
      </>}
    </div>
    {message&&<div className={styles.notice}>{message}</div>}
  </div>
}
