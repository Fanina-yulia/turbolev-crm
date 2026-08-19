"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./schedule-settings-bridge.module.css";

type ScheduleDay={day:number;label:string;enabled:boolean;open:string;close:string};
type OperationsResponse={ok:boolean;location:{id:string;timezone?:string}|null;settings:Record<string,unknown>;error?:string};

type DayMeta={day:number;name:string;short:string};

const DAYS:DayMeta[]=[
  {day:1,name:"Понеділок",short:"Пн"},
  {day:2,name:"Вівторок",short:"Вт"},
  {day:3,name:"Середа",short:"Ср"},
  {day:4,name:"Четвер",short:"Чт"},
  {day:5,name:"П’ятниця",short:"Пт"},
  {day:6,name:"Субота",short:"Сб"},
  {day:7,name:"Неділя",short:"Нд"},
];

function defaultSchedule():ScheduleDay[]{
  return DAYS.map(item=>({day:item.day,label:item.short,enabled:true,open:"09:00",close:"21:00"}));
}

function normalizeSchedule(value:unknown):ScheduleDay[]{
  const source=Array.isArray(value)?value as Partial<ScheduleDay>[]:[];
  return DAYS.map(meta=>{
    const found=source.find(item=>Number(item.day)===meta.day);
    return {
      day:meta.day,
      label:meta.short,
      enabled:typeof found?.enabled==="boolean"?found.enabled:true,
      open:typeof found?.open==="string"&&/^\d{2}:\d{2}$/.test(found.open)?found.open:"09:00",
      close:typeof found?.close==="string"&&/^\d{2}:\d{2}$/.test(found.close)?found.close:"21:00",
    };
  });
}

function toMinutes(value:string){
  const [hours,minutes]=value.split(":").map(Number);
  return Math.min(1440,Math.max(0,(Number.isFinite(hours)?hours:0)*60+(Number.isFinite(minutes)?minutes:0)));
}

function toTime(value:number){
  const safe=Math.min(1440,Math.max(0,Math.round(value/30)*30));
  const hours=Math.floor(safe/60)%24;
  const minutes=safe%60;
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}`;
}

function cloneSchedule(schedule:ScheduleDay[]){return schedule.map(item=>({...item}));}

function currentRequestedTab(){
  if(typeof window==="undefined")return "schedule";
  return new URL(window.location.href).searchParams.get("settingsTab")||"schedule";
}

function findSettingsShell(){
  const heading=Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find(node=>(node.textContent||"").trim()==="Налаштування");
  const modal=heading?.closest<HTMLElement>("section")||null;
  const layout=modal?.querySelector<HTMLElement>('div[class*="layout"]')||null;
  const content=layout?.querySelector<HTMLElement>(":scope > main")||null;
  const maybeHead=heading?.parentElement?.parentElement as HTMLElement|null;
  const head=maybeHead&&modal&&maybeHead.parentElement===modal?maybeHead:null;
  return {modal,content,head};
}

export function ScheduleSettingsBridge(){
  const [active,setActive]=useState(false);
  const [portalHost,setPortalHost]=useState<HTMLElement|null>(null);
  const [schedule,setSchedule]=useState<ScheduleDay[]>(defaultSchedule);
  const [baseline,setBaseline]=useState<ScheduleDay[]>(defaultSchedule);
  const [locationId,setLocationId]=useState<string|null>(null);
  const [timezone,setTimezone]=useState("Europe/Kyiv");
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [showHelp,setShowHelp]=useState(false);

  useEffect(()=>{
    const sync=()=>setActive(currentRequestedTab()==="schedule");
    const onTab=(event:Event)=>setActive(((event as CustomEvent<string>).detail||"schedule")==="schedule");
    sync();
    window.addEventListener("popstate",sync);
    window.addEventListener("turbolev:settings-tab",onTab);
    return()=>{
      window.removeEventListener("popstate",sync);
      window.removeEventListener("turbolev:settings-tab",onTab);
    };
  },[]);

  useEffect(()=>{
    if(!active){setPortalHost(null);return;}
    let observer:MutationObserver|null=null;
    let host:HTMLElement|null=null;
    let hiddenHead:HTMLElement|null=null;

    const mount=()=>{
      const {content,head}=findSettingsShell();
      if(!content)return false;
      if(host?.isConnected&&host.parentElement===content)return true;
      if(host?.isConnected)host.remove();
      host=document.createElement("div");
      host.dataset.turbolevScheduleRoot="true";
      host.className=styles.portalHost;
      content.dataset.turbolevScheduleEnhanced="true";
      content.appendChild(host);
      if(head){
        hiddenHead=head;
        head.dataset.turbolevScheduleHidden="true";
      }
      setPortalHost(host);
      return true;
    };

    mount();
    observer=new MutationObserver(()=>mount());
    observer.observe(document.body,{childList:true,subtree:true});

    return()=>{
      observer?.disconnect();
      const {content}=findSettingsShell();
      if(content)delete content.dataset.turbolevScheduleEnhanced;
      if(hiddenHead)delete hiddenHead.dataset.turbolevScheduleHidden;
      host?.remove();
      setPortalHost(null);
    };
  },[active]);

  useEffect(()=>{
    if(!active)return;
    let cancelled=false;
    setLoading(true);
    setMessage("");
    fetch("/api/settings/operations",{cache:"no-store"})
      .then(async response=>{
        const data=await response.json() as OperationsResponse;
        if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося завантажити графік");
        if(cancelled)return;
        const normalized=normalizeSchedule(data.settings?.work_schedule);
        setSchedule(normalized);
        setBaseline(cloneSchedule(normalized));
        setLocationId(data.location?.id||null);
        setTimezone(data.location?.timezone||"Europe/Kyiv");
      })
      .catch(error=>{if(!cancelled)setMessage(error instanceof Error?error.message:"Помилка завантаження");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[active]);

  const dirty=useMemo(()=>JSON.stringify(schedule)!==JSON.stringify(baseline),[schedule,baseline]);

  function updateDay(index:number,patch:Partial<ScheduleDay>){
    setSchedule(current=>current.map((row,i)=>i===index?{...row,...patch}:row));
  }

  function applyWeekdayPreset(){
    setSchedule(current=>current.map(row=>({...row,enabled:row.day<=5,open:"09:00",close:"21:00"})));
  }

  function applyEverydayPreset(){
    setSchedule(current=>current.map(row=>({...row,enabled:true,open:"09:00",close:"21:00"})));
  }

  function resetChanges(){setSchedule(cloneSchedule(baseline));setMessage("");}

  async function save(){
    if(!locationId){setMessage("Не знайдено активну локацію СТО.");return;}
    setSaving(true);setMessage("");
    try{
      const response=await fetch("/api/settings/operations",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"SAVE_SCHEDULE",locationId,schedule}),
      });
      const data=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!data.ok)throw new Error(data.error||"Не вдалося зберегти графік");
      setBaseline(cloneSchedule(schedule));
      setMessage("Графік роботи збережено.");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Помилка збереження");
    }finally{setSaving(false);}
  }

  function setStart(index:number,value:number){
    const row=schedule[index];
    const close=toMinutes(row.close);
    const start=Math.min(value,Math.max(0,close-30));
    updateDay(index,{open:toTime(start)});
  }

  function setEnd(index:number,value:number){
    const row=schedule[index];
    const open=toMinutes(row.open);
    const end=Math.max(value,Math.min(1440,open+30));
    updateDay(index,{close:toTime(end)});
  }

  if(!active||!portalHost)return null;

  return createPortal(
    <div className={styles.page}>
      <div className={styles.breadcrumbRow}>
        <div className={styles.breadcrumb}><span className={styles.breadcrumbIcon}>⚙</span><span>Налаштування</span><b>›</b><strong>Графік роботи</strong></div>
        <button type="button" className={styles.helpButton} onClick={()=>setShowHelp(value=>!value)} aria-expanded={showHelp}>? <span>Довідка</span></button>
      </div>

      {showHelp&&<div className={styles.helpPanel}>Вкажіть години роботи для кожного дня. Планувальник використовує цей графік як доступний робочий час локації, а вимкнений день вважається вихідним.</div>}

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.clockTile}>◷</div>
          <div><h2>Графік роботи СТО</h2><p>Налаштуйте години роботи станції на кожен день тижня. Графік використовується планувальником та клієнтськими каналами.</p></div>
        </div>
        <div className={styles.presets}>
          <span>Швидкі пресети</span>
          <div className={styles.presetButtons}>
            <button type="button" className={styles.presetPrimary} onClick={applyWeekdayPreset}>Пн–Пт 09:00–21:00</button>
            <button type="button" onClick={applyEverydayPreset}>Без вихідних</button>
            <button type="button" onClick={resetChanges}>↻&nbsp; Скинути</button>
          </div>
        </div>
      </section>

      {loading?<div className={styles.loading}>Завантажуємо робочий графік…</div>:
      <section className={styles.scheduleCard} aria-label="Робочий графік СТО">
        {schedule.map((day,index)=>{
          const meta=DAYS[index];
          const open=toMinutes(day.open);
          const close=toMinutes(day.close);
          const fillLeft=`${open/1440*100}%`;
          const fillWidth=`${Math.max(0,close-open)/1440*100}%`;
          return <div className={`${styles.dayRow} ${!day.enabled?styles.dayRowDisabled:""}`} key={day.day}>
            <span className={styles.dragHandle} aria-hidden="true">⠿</span>
            <div className={styles.dayName}><strong>{meta.name}</strong><span>{meta.short}</span></div>
            <button type="button" className={`${styles.switch} ${day.enabled?styles.switchOn:""}`} onClick={()=>updateDay(index,{enabled:!day.enabled})} aria-label={`${day.enabled?"Вимкнути":"Увімкнути"} ${meta.name}`} aria-pressed={day.enabled}><span/></button>
            <div className={styles.timelineWrap}>
              <div className={styles.scaleLabels}><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
              <div className={styles.timeline}>
                <div className={styles.ticks}/>
                {day.enabled&&<div className={styles.rangeFill} style={{left:fillLeft,width:fillWidth}}/>}
                <input className={styles.rangeInput} type="range" min={0} max={1440} step={30} value={open} disabled={!day.enabled} onChange={event=>setStart(index,Number(event.target.value))} aria-label={`Початок роботи ${meta.name}`}/>
                <input className={styles.rangeInput} type="range" min={0} max={1440} step={30} value={close} disabled={!day.enabled} onChange={event=>setEnd(index,Number(event.target.value))} aria-label={`Кінець роботи ${meta.name}`}/>
              </div>
              {!day.enabled&&<div className={styles.closedLabel}>Вихідний день</div>}
            </div>
            <div className={styles.timeFields}>
              <label><span className={styles.srOnly}>Початок роботи {meta.name}</span><input type="time" step={1800} value={day.open} disabled={!day.enabled} onChange={event=>{const next=event.target.value;if(next&&toMinutes(next)<toMinutes(day.close))updateDay(index,{open:next});}}/></label>
              <span className={styles.dash}>–</span>
              <label><span className={styles.srOnly}>Кінець роботи {meta.name}</span><input type="time" step={1800} value={day.close} disabled={!day.enabled} onChange={event=>{const next=event.target.value;if(next&&toMinutes(next)>toMinutes(day.open))updateDay(index,{close:next});}}/></label>
            </div>
            <button type="button" className={styles.moreButton} aria-label={`Додаткові дії: ${meta.name}`}>⋮</button>
          </div>;
        })}
      </section>}

      <section className={styles.footerBar}>
        <div className={styles.footerInfo}><div className={styles.calendarTile}>▣</div><div><strong>Графік оновлюється після збереження</strong><span>Зміни одразу стають доступними для планувальника. Часовий пояс: {timezone}.</span></div></div>
        <div className={styles.footerActions}>
          <button type="button" className={styles.cancelButton} disabled={!dirty||saving} onClick={resetChanges}>Скасувати</button>
          <button type="button" className={styles.saveButton} disabled={!dirty||saving||!locationId} onClick={()=>void save()}>{saving?"Зберігаємо…":"▣  Зберегти графік"}</button>
        </div>
      </section>

      {message&&<div className={styles.statusMessage} role="status">{message}</div>}
    </div>,
    portalHost,
  );
}
