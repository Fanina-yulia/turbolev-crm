"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./client-communication-actions.module.css";

type State = {
  ok?: boolean;
  clientId?: string;
  vehicleId?: string | null;
  phone?: string;
  viber?: { configured?: boolean; connected?: boolean; active?: boolean; href?: string | null; botHref?: string | null; fallbackDirect?: boolean; lastActivityAt?: string | null };
  telegram?: { configured?: boolean; connected?: boolean; active?: boolean; username?: string | null; lastActivityAt?: string | null };
  cabinet?: { available?: boolean; diagnosticId?: string | null; active?: boolean; lastVisitedAt?: string | null };
  phoneChannel?: { available?: boolean; active?: boolean; lastCallAt?: string | null };
};

type Props = { clientId?: string | null; vehicleId?: string | null; phone?: string | null };

function ViberIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 5.4C16.9 3.8 14.6 3 12 3 7.2 3 3.5 6.3 3.5 10.7c0 2.2.9 4.2 2.4 5.7L5 20.5l4.2-1.1c.9.3 1.8.4 2.8.4 4.8 0 8.5-3.3 8.5-7.7 0-2.6-.7-4.9-1.9-6.7Zm-6.5 12.9c-.9 0-1.8-.1-2.6-.4l-.4-.1-2.5.7.7-2.4-.3-.4c-1.3-1.3-2-3.1-2-5 0-3.6 3.1-6.3 7.1-6.3 2.1 0 4 .7 5.4 2 1 1.5 1.6 3.4 1.6 5.7 0 3.6-3 6.2-7 6.2Zm3.9-4.7c-.2-.1-1.2-.6-1.4-.7-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-1.4-.6-2.4-1.5-3.2-2.8-.2-.3 0-.4.1-.6.1-.1.2-.3.3-.4.1-.2.1-.3.2-.5 0-.2 0-.3-.1-.5l-.6-1.5c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.5 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>}
function TelegramIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.7 3.6 18.5 19c-.2 1.1-.8 1.4-1.7.9l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.4-.1-.6-.6-.2L6.3 12.8l-4.7-1.5c-1-.3-1-1 .2-1.5L20.2 2.7c.9-.3 1.7.2 1.5.9Z"/></svg>}
function QrIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm9-2h2v2h-2v-2Zm3 0h4v2h-2v2h-2v-4Zm-4 4h2v4h-2v-4Zm3 1h2v3h-2v-3Zm3-1h2v4h-2v-4Z"/></svg>}
function PhoneIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 2.8c.5-.3 1.2-.1 1.5.4l2 3.4c.3.5.2 1.1-.2 1.5L8.5 9.4c1 2.3 2.8 4.1 5.1 5.1l1.3-1.4c.4-.4 1-.5 1.5-.2l3.4 2c.5.3.7 1 .4 1.5l-1.1 2.1c-.4.8-1.3 1.3-2.2 1.2C9.7 19 5 14.3 4.3 7.1c-.1-.9.4-1.8 1.2-2.2l1.1-2.1Z"/></svg>}

export function ClientCommunicationActions({clientId,vehicleId,phone}:Props){
  const[state,setState]=useState<State|null>(null);
  const[busy,setBusy]=useState("");
  const[toast,setToast]=useState("");
  const query=useMemo(()=>{const p=new URLSearchParams();if(clientId)p.set("clientId",clientId);if(vehicleId)p.set("vehicleId",vehicleId);if(phone)p.set("phone",phone);return p.toString()},[clientId,vehicleId,phone]);
  const notify=(text:string)=>{setToast(text);window.setTimeout(()=>setToast(""),3200)};
  const load=useCallback(async()=>{if(!query)return;try{const r=await fetch(`/api/client-communication/status?${query}`,{cache:"no-store",credentials:"include"});const b=await r.json().catch(()=>null) as State|null;if(r.ok&&b?.ok)setState(b)}catch{}},[query]);
  useEffect(()=>{setState(null);void load()},[load]);
  async function audit(action:string){if(!state?.clientId)return;void fetch("/api/client-communication/action",{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({clientId:state.clientId,vehicleId:state.vehicleId,action})}).catch(()=>undefined)}
  async function viber(){const href=state?.viber?.href;if(!href)return notify("Для клієнта не вдалося сформувати Viber-перехід.");await audit("VIBER_OPEN");window.location.href=href}
  async function telegram(){if(!state?.clientId)return;if(state.telegram?.connected&&state.telegram.username){await audit("TELEGRAM_OPEN");window.open(`https://t.me/${encodeURIComponent(state.telegram.username)}`,"_blank","noopener,noreferrer");return}if(!state.telegram?.configured)return notify("Telegram Bot ще не налаштований у CRM.");setBusy("telegram");try{const r=await fetch(`/api/clients/${encodeURIComponent(state.clientId)}/telegram`,{method:"POST",credentials:"include"});const b=await r.json().catch(()=>null) as {ok?:boolean;link?:{url?:string};error?:string}|null;if(!r.ok||!b?.ok||!b.link?.url)throw new Error(b?.error||"Не вдалося створити Telegram-посилання");await navigator.clipboard.writeText(b.link.url);await audit("TELEGRAM_OPEN");notify("Клієнт ще не підключив Telegram. Персональне посилання скопійовано.");await load()}catch(e){notify(e instanceof Error?e.message:"Помилка Telegram")}finally{setBusy("")}}
  async function cabinet(){const diagnosticId=state?.cabinet?.diagnosticId;if(!diagnosticId)return notify("Кабінет стане доступним після передачі діагностики сервіс-менеджеру.");setBusy("cabinet");try{const r=await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`,{method:"POST",credentials:"include"});const b=await r.json().catch(()=>null) as {ok?:boolean;path?:string;message?:string;error?:string}|null;if(!r.ok||!b?.ok||!b.path)throw new Error(b?.message||b?.error||"Не вдалося створити посилання");const url=`${window.location.origin}${b.path}`;await navigator.clipboard.writeText(url);await audit("CABINET_LINK_COPIED");notify("Посилання на кабінет клієнта скопійовано.");await load()}catch(e){notify(e instanceof Error?e.message:"Помилка кабінету клієнта")}finally{setBusy("")}}
  async function phoneCall(){if(!state?.phone)return notify("Номер телефону не вказано.");setBusy("phone");try{await audit("BINOTEL_CALL_REQUESTED");const r=await fetch("/api/telephony/call",{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({phone:state.phone,clientId:state.clientId,vehicleId:state.vehicleId})});const b=await r.json().catch(()=>null) as {ok?:boolean;message?:string;error?:string}|null;if(!r.ok||!b?.ok)throw new Error(b?.message||b?.error||"Binotel не зміг почати дзвінок");notify(`Виклик на ${state.phone} передано в Binotel.`);await load()}catch(e){notify(e instanceof Error?e.message:"Помилка Binotel")}finally{setBusy("")}}
  const loading=!state;
  return <><div className={styles.actions} aria-label="Швидкий зв’язок із клієнтом">
    <button type="button" className={`${styles.action} ${state?.viber?.active?styles.activeViber:""}`} disabled={loading||!state?.viber?.href} onClick={e=>{e.stopPropagation();void viber()}} title={state?.viber?.connected?"Viber · клієнт підключений":state?.viber?.configured?"Написати у Viber Bot":"Відкрити Viber за номером"} aria-label="Viber"><ViberIcon/></button>
    <button type="button" className={`${styles.action} ${state?.cabinet?.active?styles.activeCabinet:""} ${busy==="cabinet"?styles.busy:""}`} disabled={loading||!state?.cabinet?.available||busy==="cabinet"} onClick={e=>{e.stopPropagation();void cabinet()}} title={state?.cabinet?.active?"Кабінет · клієнт уже відкривав":"Скопіювати посилання на кабінет"} aria-label="Кабінет клієнта"><QrIcon/></button>
    <button type="button" className={`${styles.action} ${state?.telegram?.active?styles.activeTelegram:""} ${busy==="telegram"?styles.busy:""}`} disabled={loading||!state?.telegram?.configured||busy==="telegram"} onClick={e=>{e.stopPropagation();void telegram()}} title={state?.telegram?.connected?"Telegram · клієнт підключений":"Підключити Telegram клієнта"} aria-label="Telegram"><TelegramIcon/></button>
    <button type="button" className={`${styles.action} ${state?.phoneChannel?.active?styles.activePhone:""} ${busy==="phone"?styles.busy:""}`} disabled={loading||!state?.phoneChannel?.available||busy==="phone"} onClick={e=>{e.stopPropagation();void phoneCall()}} title="Зателефонувати через Binotel" aria-label="Зателефонувати через Binotel"><PhoneIcon/></button>
  </div>{toast&&<div className={styles.toast} role="status">{toast}</div>}</>;
}
