"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { navigateCrm } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

const DESKTOP_QUERY = "(min-width: 761px)";
const LABEL_DELAY_MS = 360;
const ICON_SIZE = 24;
const EFFECT_RADIUS = 118;
const MAX_SCALE = 2.1;
const MAX_X = 32;
const POINTER_STIFFNESS = .27;
const POINTER_DAMPING = .7;
const ENGAGE_STIFFNESS = .23;
const ENGAGE_DAMPING = .72;

type Engine = { targetY:number; y:number; velocityY:number; targetEngagement:number; engagement:number; velocityEngagement:number; lastFrame:number|null };
type RouteContext = { filter:string; settingsTab:string; status:string; workOrderTab:string };
type FlyoutItem = { key:string; label:string; active?:boolean; onSelect:()=>void };

const SETTINGS = [
  ["schedule","Графік"],["personnel","Персонал"],["suppliers","Постачальники"],["warehouse","Склад"],
  ["workPrices","Прайс робіт"],["posts","Пости"],["markup","Націнка"],["cash","Каса"],
  ["integrations","Інтеграції"],["cameras","Камери"],["diagnosticTemplates","Шаблони діагностики"],
  ["appearance","Оформлення"],["workflow","Процеси та статуси"],["security","Ролі та доступи"],["partsCatalog","Каталог запчастин"],
] as const;

function labelOf(label:string){ return label === "Мої задачі" ? "Центр уваги" : label; }
function step(value:number, velocity:number, target:number, stiffness:number, damping:number, dt:number){
  let v = velocity + (target-value)*stiffness*dt;
  v *= Math.pow(damping,dt);
  return [value+v*dt,v] as const;
}
function lensInfluence(distance:number){
  const normalized=Math.min(1,Math.max(0,distance/EFFECT_RADIUS));
  const cosine=Math.cos(normalized*Math.PI/2);
  return Math.pow(cosine,4);
}

const DARK="#202a34";
const DARK_2="#3a4652";
const ORANGE="#ff7417";
const LIGHT="#f8fafc";

function DockIcon({slug}:{slug:string}){
  const p={viewBox:"0 0 32 32",fill:"none","aria-hidden":true};
  switch(slug){
    case "overview":return <svg {...p}><rect x="4" y="4" width="10" height="10" rx="2.6" fill={DARK}/><rect x="18" y="4" width="10" height="10" rx="2.6" fill={DARK_2}/><rect x="4" y="18" width="10" height="10" rx="2.6" fill={DARK_2}/><rect x="18" y="18" width="10" height="10" rx="2.6" fill={ORANGE}/></svg>;
    case "tasks":return <svg {...p}><rect x="7" y="5.5" width="18" height="22" rx="4" fill={DARK}/><rect x="11" y="3.5" width="10" height="5" rx="2.5" fill={ORANGE}/><path d="M11 13.5h10M11 18h7" stroke={LIGHT} strokeWidth="2" strokeLinecap="round"/><circle cx="22" cy="23" r="6" fill={ORANGE}/><path d="m19.2 23 1.9 1.9 3.7-4" stroke="white" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "communications":return <svg {...p}><path d="M13 8.5h9.5a6.5 6.5 0 0 1 0 13H20l-4 3 .7-3H13a6.5 6.5 0 1 1 0-13Z" fill={ORANGE}/><path d="M5.5 6h12a7 7 0 0 1 0 14H12l-5 3.7 1-4.1A7 7 0 0 1 5.5 6Z" fill={DARK}/><circle cx="10.5" cy="13" r="1.3" fill={LIGHT}/><circle cx="15.5" cy="13" r="1.3" fill={ORANGE}/><circle cx="20.5" cy="13" r="1.3" fill={LIGHT}/></svg>;
    case "planner":return <svg {...p}><rect x="4" y="6" width="24" height="22" rx="4.5" fill={LIGHT} stroke="#cad1d8" strokeWidth="1.4"/><path d="M4 11a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v3H4v-3Z" fill={ORANGE}/><rect x="9" y="3" width="3" height="7" rx="1.5" fill={DARK}/><rect x="20" y="3" width="3" height="7" rx="1.5" fill={DARK}/><circle cx="10" cy="19" r="2" fill={DARK}/><circle cx="16" cy="19" r="2" fill={DARK_2}/><circle cx="22" cy="19" r="2" fill={DARK}/><circle cx="10" cy="24" r="2" fill={DARK_2}/><circle cx="16" cy="24" r="2" fill={ORANGE}/><circle cx="22" cy="24" r="2" fill={DARK_2}/></svg>;
    case "clients":return <svg {...p}><circle cx="9" cy="12" r="4" fill={DARK}/><circle cx="23" cy="12" r="4" fill={DARK_2}/><circle cx="16" cy="9" r="5" fill={ORANGE}/><path d="M2.5 26c.5-5.3 3.2-8 7.2-8 3.7 0 6.3 2.5 6.8 8H2.5Z" fill={DARK}/><path d="M15.5 26c.5-5.3 3.2-8 7.2-8 4 0 6.7 2.7 7.2 8H15.5Z" fill={DARK_2}/><path d="M7 27c.6-7 4-10.5 9-10.5S24.4 20 25 27H7Z" fill={ORANGE}/></svg>;
    case "vehicles":return <svg {...p}><path d="m6 13 3.2-6h13.6l3.2 6 2.5 2.5v7.8a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3v-7.8L6 13Z" fill={DARK}/><path d="M9.8 9h12.4l2.1 4H7.7l2.1-4Z" fill="#576473"/><rect x="6.5" y="16" width="5" height="3" rx="1.5" fill={ORANGE}/><rect x="20.5" y="16" width="5" height="3" rx="1.5" fill={ORANGE}/><rect x="9" y="22" width="14" height="2.2" rx="1.1" fill="#0f151b"/></svg>;
    case "diagnostics":return <svg {...p}><path d="M7 7h5l2-3h7l2 3h3a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3h1Z" fill={DARK}/><rect x="1" y="12" width="4" height="9" rx="1.5" fill={DARK_2}/><rect x="27" y="12" width="4" height="9" rx="1.5" fill={DARK_2}/><path d="M6 17h5l2.2-5 3.1 10 2.4-7 2 3H26" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "parts":return <svg {...p}><path d="M14 2h4l1.2 3.5 3.4 1.4 3.2-1.6 2.8 2.8-1.6 3.2 1.4 3.4L32 16v4l-3.6 1.3-1.4 3.4 1.6 3.2-2.8 2.8-3.2-1.6-3.4 1.4L18 34h-4l-1.2-3.5-3.4-1.4-3.2 1.6-2.8-2.8L5 24.7l-1.4-3.4L0 20v-4l3.6-1.3L5 11.3 3.4 8.1l2.8-2.8 3.2 1.6 3.4-1.4L14 2Z" fill={DARK} transform="scale(.88) translate(2.2 1)"/><circle cx="16" cy="16" r="7" fill={ORANGE}/><circle cx="16" cy="16" r="3.2" fill="#512307"/></svg>;
    case "work-orders":return <svg {...p}><rect x="6" y="5" width="20" height="24" rx="4" fill={DARK}/><rect x="11" y="2.5" width="10" height="6" rx="2.6" fill={ORANGE}/><path d="M11 13h10M11 18h10M11 23h7" stroke={LIGHT} strokeWidth="2.1" strokeLinecap="round"/></svg>;
    case "warranties":return <svg {...p}><path d="M16 3 27 7.2v8.3c0 7.2-4.8 11.7-11 13.5C9.8 27.2 5 22.7 5 15.5V7.2L16 3Z" fill={DARK}/><path d="m10.5 16 3.5 3.5 7.5-8" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "procurement":return <svg {...p}><path d="M4 13 16 5l12 8v14H4V13Z" fill={DARK}/><path d="M8 14h16v13H8V14Z" fill={DARK_2}/><rect x="12" y="17" width="8" height="7" rx="1.5" fill={ORANGE}/><path d="M16 17v7M12 20.5h8" stroke="#b94e09" strokeWidth="1"/></svg>;
    case "finance":return <svg {...p}><ellipse cx="11" cy="23" rx="7" ry="3.2" fill="#10161c"/><rect x="4" y="15" width="14" height="8" fill={DARK}/><ellipse cx="11" cy="15" rx="7" ry="3.2" fill={DARK_2}/><ellipse cx="21" cy="20" rx="7" ry="3.2" fill="#c95308"/><rect x="14" y="9" width="14" height="11" fill={ORANGE}/><ellipse cx="21" cy="9" rx="7" ry="3.2" fill="#ff9a42"/><path d="M14 13c4.5 2.1 9.5 2.1 14 0M14 17c4.5 2.1 9.5 2.1 14 0" stroke="#c95308" strokeWidth="1.1"/></svg>;
    case "payments":return <svg {...p}><rect x="3" y="7" width="26" height="18" rx="4.5" fill={DARK}/><rect x="3" y="12" width="26" height="4" fill="#11181f"/><rect x="7" y="19" width="8" height="2.8" rx="1.4" fill={ORANGE}/><rect x="17" y="19" width="7" height="2.8" rx="1.4" fill="#768391"/></svg>;
    case "analytics":return <svg {...p}><rect x="4" y="18" width="6" height="10" rx="2" fill={DARK_2}/><rect x="13" y="11" width="6" height="17" rx="2" fill={DARK}/><rect x="22" y="5" width="6" height="23" rx="2" fill={ORANGE}/><path d="M3 8 9 4l7 5 7-4" stroke="#c5cbd2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case "settings":return <svg {...p}><path d="M14 2h4l1.2 3.5 3.4 1.4 3.2-1.6 2.8 2.8-1.6 3.2 1.4 3.4L32 16v4l-3.6 1.3-1.4 3.4 1.6 3.2-2.8 2.8-3.2-1.6-3.4 1.4L18 34h-4l-1.2-3.5-3.4-1.4-3.2 1.6-2.8-2.8L5 24.7l-1.4-3.4L0 20v-4l3.6-1.3L5 11.3 3.4 8.1l2.8-2.8 3.2 1.6 3.4-1.4L14 2Z" fill={DARK} transform="scale(.88) translate(2.2 1)"/><circle cx="16" cy="16" r="6.5" fill={ORANGE}/><circle cx="16" cy="16" r="2.8" fill="#512307"/></svg>;
    default:return <svg {...p}><circle cx="16" cy="16" r="11" fill={DARK}/><circle cx="16" cy="16" r="4" fill={ORANGE}/></svg>;
  }
}

export function SidebarRailV6(){
  const access=useCrmAccess();
  const dockRef=useRef<HTMLDivElement>(null);
  const labelTimer=useRef<number|null>(null);
  const candidate=useRef<string|null>(null);
  const raf=useRef<number|null>(null);
  const reduced=useRef(false);
  const engine=useRef<Engine>({targetY:0,y:0,velocityY:0,targetEngagement:0,engagement:0,velocityEngagement:0,lastFrame:null});
  const [active,setActive]=useState<CrmSectionLabel>("Огляд станції");
  const [visible,setVisible]=useState<string|null>(null);
  const [route,setRoute]=useState<RouteContext>({filter:"",settingsTab:"",status:"",workOrderTab:""});

  const items=useMemo(()=>CRM_NAV_GROUPS.flatMap(group=>group.items.map((item,index)=>({...item,group:group.label,groupStart:index===0}))).filter(item=>access.canOpenCabinet(item.slug)),[access.snapshot,access.loaded]);
  const settings=useMemo(()=>SETTINGS.filter(([id])=>{
    if(!access.enforced)return true;
    if(id==="personnel")return access.can(PERMISSIONS.PERSONNEL_READ);
    if(id==="cash")return access.can(PERMISSIONS.FINANCE_READ);
    if(id==="integrations")return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if(id==="security")return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  }),[access.enforced,access.snapshot,access.loaded]);

  useEffect(()=>{
    const sync=()=>{const u=new URL(window.location.href);setActive(sectionFromSlug(u.searchParams.get("section")));setRoute({filter:u.searchParams.get("filter")||"",settingsTab:u.searchParams.get("settingsTab")||"",status:u.searchParams.get("status")||"",workOrderTab:u.searchParams.get("workOrderTab")||""});};
    sync();window.addEventListener("popstate",sync);window.addEventListener("turbolev:navigate",sync as EventListener);
    return()=>{window.removeEventListener("popstate",sync);window.removeEventListener("turbolev:navigate",sync as EventListener);};
  },[]);
  useEffect(()=>{const m=window.matchMedia("(prefers-reduced-motion: reduce)");const sync=()=>{reduced.current=m.matches;};sync();m.addEventListener("change",sync);return()=>m.removeEventListener("change",sync);},[]);
  useEffect(()=>()=>{if(labelTimer.current)window.clearTimeout(labelTimer.current);if(raf.current)cancelAnimationFrame(raf.current);},[]);

  const clearTimer=()=>{if(labelTimer.current){window.clearTimeout(labelTimer.current);labelTimer.current=null;}};
  const hide=()=>{clearTimer();candidate.current=null;setVisible(null);};
  const schedule=(slug:string)=>{if(candidate.current===slug&&(labelTimer.current||visible===slug))return;clearTimer();candidate.current=slug;setVisible(null);labelTimer.current=window.setTimeout(()=>{labelTimer.current=null;if(candidate.current===slug)setVisible(slug);},LABEL_DELAY_MS);};

  const geometry=()=>{
    const root=dockRef.current;if(!root)return;
    const slots=Array.from(root.querySelectorAll<HTMLElement>("[data-dock-slot]"));if(!slots.length)return;
    const e=engine.current,engage=Math.max(0,Math.min(1,e.engagement));
    for(const slot of slots){
      const r=slot.getBoundingClientRect();
      const center=r.top+r.height/2;
      const influence=lensInfluence(Math.abs(center-e.y))*engage;
      const scale=1+(MAX_SCALE-1)*influence;
      const x=MAX_X*Math.pow(influence,1.35);
      slot.style.setProperty("--dock-scale",scale.toFixed(4));
      slot.style.setProperty("--dock-x",`${x.toFixed(2)}px`);
      slot.style.setProperty("--dock-lift",influence.toFixed(4));
      const button=slot.querySelector<HTMLElement>("[data-dock-item]");
      if(button)button.style.zIndex=String(20+Math.round(influence*180));
    }
  };
  const animate=(now:number)=>{
    raf.current=null;const e=engine.current,prev=e.lastFrame??now,dt=Math.max(.35,Math.min(2,(now-prev)/16.667));e.lastFrame=now;
    if(reduced.current){e.y=e.targetY;e.engagement=e.targetEngagement;e.velocityY=0;e.velocityEngagement=0;}
    else{[e.y,e.velocityY]=step(e.y,e.velocityY,e.targetY,POINTER_STIFFNESS,POINTER_DAMPING,dt);[e.engagement,e.velocityEngagement]=step(e.engagement,e.velocityEngagement,e.targetEngagement,ENGAGE_STIFFNESS,ENGAGE_DAMPING,dt);}
    geometry();
    const moving=Math.abs(e.targetY-e.y)>.05||Math.abs(e.velocityY)>.04||Math.abs(e.targetEngagement-e.engagement)>.002||Math.abs(e.velocityEngagement)>.002;
    if(moving&&!reduced.current)raf.current=requestAnimationFrame(animate);else e.lastFrame=null;
  };
  const kick=()=>{if(raf.current)return;engine.current.lastFrame=null;raf.current=requestAnimationFrame(animate);};
  const pointer=(y:number)=>{
    const root=dockRef.current;if(!root||!window.matchMedia(DESKTOP_QUERY).matches)return;
    const e=engine.current;e.targetY=y;if(e.engagement<.01&&e.y===0)e.y=y;e.targetEngagement=1;
    let slug:string|null=null,best=Infinity;
    for(const slot of root.querySelectorAll<HTMLElement>("[data-dock-slot]")){const r=slot.getBoundingClientRect(),d=Math.abs(r.top+r.height/2-y);if(d<best){best=d;slug=slot.dataset.slug||null;}}
    if(slug&&best<=32)schedule(slug);else if(candidate.current)hide();
    kick();
  };
  const leave=()=>{engine.current.targetEngagement=0;hide();kick();};
  const select=(fn:()=>void)=>{hide();engine.current.targetEngagement=0;fn();kick();};

  const flyout=(slug:string):FlyoutItem[]=>{
    if(slug==="communications")return[
      {key:"all",label:"Всі комунікації",active:!route.filter,onSelect:()=>navigateCrm("Комунікації")},
      {key:"new",label:"Нові звернення",active:route.filter==="NEW",onSelect:()=>navigateCrm("Комунікації",{filter:"NEW",filterLabel:"Нові"})},
      {key:"active",label:"Активні",active:route.filter==="ACTIVE",onSelect:()=>navigateCrm("Комунікації",{filter:"ACTIVE",filterLabel:"Активні"})},
    ];
    if(slug==="work-orders")return[
      {key:"orders",label:"Наряди та ремонт",active:!route.status&&!route.workOrderTab,onSelect:()=>navigateCrm("Наряди та ремонт")},
      {key:"estimate",label:"Комерційна пропозиція",active:route.workOrderTab==="estimate",onSelect:()=>navigateCrm("Комерційна пропозиція",{workOrderTab:"estimate"})},
      {key:"production",label:"Виробництво",active:route.status==="IN_REPAIR",onSelect:()=>navigateCrm("Виробництво",{status:"IN_REPAIR"})},
      {key:"qc",label:"Контроль якості",active:route.workOrderTab==="qc"||route.status==="WAITING_QC",onSelect:()=>navigateCrm("Контроль якості")},
    ];
    if(slug==="settings")return settings.map(([id,label])=>({key:id,label,active:route.settingsTab===id||(!route.settingsTab&&id==="schedule"),onSelect:()=>navigateCrm("Налаштування",{settingsTab:id})}));
    return[];
  };

  return <>
    <div ref={dockRef} className="crmDock6" aria-label="Основне меню Turbo LEV" onPointerMove={e=>{if(e.pointerType==="touch")return;const t=e.target;if(t instanceof Element&&t.closest(".crmDockFlyout6"))return;pointer(e.clientY);}} onPointerLeave={leave}>
      <div className="crmDockBrand6" aria-hidden="true"><span/></div>
      <nav className="crmDockItems6" aria-label="Розділи CRM">{items.map(item=>{const label=labelOf(item.label),sub=flyout(item.slug),show=visible===item.slug,isActive=active===item.label||(item.slug==="work-orders"&&["Комерційна пропозиція","Виробництво","Контроль якості"].includes(active));return <div key={item.slug} className={`crmDockSlot6 ${item.groupStart?"crmDockGroupStart6":""}`} data-dock-slot data-slug={item.slug}>
        <button type="button" data-dock-item className={`crmDockButton6 ${isActive?"crmDockActive6":""}`} aria-label={label} aria-current={isActive?"page":undefined} aria-haspopup={sub.length?"menu":undefined} aria-expanded={sub.length?show:undefined} onFocus={()=>setVisible(item.slug)} onBlur={e=>{const next=e.relatedTarget;if(!(next instanceof Node)||!e.currentTarget.parentElement?.contains(next))hide();}} onClick={()=>select(()=>navigateCrm(item.label))}><span className="crmDockGlyph6"><DockIcon slug={item.slug}/></span></button>
        {sub.length?<div className={`crmDockFlyout6 ${show?"crmDockFlyoutShow6":""}`} role="menu" aria-label={label} onPointerEnter={()=>{clearTimer();candidate.current=item.slug;setVisible(item.slug);}}><header><small>{item.group}</small><strong>{label}</strong></header><div>{sub.map(s=><button type="button" role="menuitem" key={s.key} className={s.active?"crmDockSubActive6":""} onClick={()=>select(s.onSelect)}>{s.label}</button>)}</div></div>:<span className={`crmDockTip6 ${show?"crmDockTipShow6":""}`} role="tooltip">{label}</span>}
      </div>;})}</nav>
      <div className="crmDockStatus6" aria-label="Станція онлайн"><span/></div>
    </div>
    <style jsx global>{`
      @media(min-width:761px){
        .shell:has(>.sidebar){--crm-sidebar-width:72px!important;grid-template-columns:72px minmax(0,1fr)!important}
        .shell:has(>.sidebar)>.workspace{grid-column:2!important;margin-left:0!important;border-left:0!important}
        .sidebar{width:72px!important;min-width:72px!important;max-width:72px!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;overflow:visible!important}
        .sidebar>*{visibility:hidden!important;pointer-events:none!important}
        .crmDock6{position:fixed;inset:4px auto 4px 4px;z-index:2450;box-sizing:border-box;width:68px;display:flex;flex-direction:column;align-items:center;padding:7px 5px 9px;background:color-mix(in srgb,var(--sidebar) 84%,transparent);border:0;border-radius:18px;box-shadow:0 14px 34px rgba(0,0,0,.13);backdrop-filter:blur(18px) saturate(1.16);-webkit-backdrop-filter:blur(18px) saturate(1.16);overflow:visible;user-select:none;contain:layout style}
        .crmDockBrand6{width:52px;height:42px;flex:0 0 42px;display:grid;place-items:center;margin-bottom:4px}.crmDockBrand6 span{display:block;width:36px;height:36px;background:url("/brand/turbo-lev-rail-light.png") center/contain no-repeat;filter:drop-shadow(0 1px 1px rgba(17,21,26,.08))}:root[data-theme="dark"] .crmDockBrand6 span{background-image:url("/brand/turbo-lev-rail-dark.png");filter:drop-shadow(0 1px 1px rgba(0,0,0,.28))}
        .crmDockItems6{width:100%;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:visible}.crmDockSlot6{--dock-scale:1;--dock-x:0px;--dock-lift:0;position:relative;width:56px;height:40px;flex:0 0 40px;display:grid;place-items:center;overflow:visible}.crmDockGroupStart6:not(:first-child)::before{content:"";position:absolute;top:-1px;left:20px;right:20px;height:1px;background:color-mix(in srgb,var(--line) 42%,transparent);opacity:.32}
        .crmDockButton6{position:relative;width:40px!important;min-width:40px!important;max-width:40px!important;height:40px!important;min-height:40px!important;display:grid!important;place-items:center!important;padding:0!important;margin:0!important;border:0!important;border-radius:12px!important;background:transparent!important;color:var(--muted)!important;overflow:visible!important;cursor:pointer;outline:none!important;transform:translate3d(var(--dock-x),0,0);transform-origin:center;will-change:transform;transition:filter 120ms ease}.crmDockGlyph6{position:relative;width:30px;height:30px;display:grid;place-items:center;transform:scale(var(--dock-scale));transform-origin:center;will-change:transform;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(10,17,24,.12))}.crmDockGlyph6::before{content:"";position:absolute;inset:0;border-radius:9px;background:linear-gradient(145deg,#fff 0%,#f2f4f7 62%,#e6e9ed 100%);border:1px solid rgba(176,185,194,.42);box-shadow:inset 0 1px 1px rgba(255,255,255,.95),inset 0 -1px 2px rgba(129,140,151,.14),0 2px 5px rgba(29,39,49,.13);z-index:0}.crmDockGlyph6 svg{position:relative;z-index:1;width:${ICON_SIZE}px;height:${ICON_SIZE}px;display:block;overflow:visible}.crmDockButton6:hover .crmDockGlyph6,.crmDockButton6:focus-visible .crmDockGlyph6{filter:drop-shadow(0 8px 14px rgba(0,0,0,.20))}.crmDockActive6 .crmDockGlyph6::before{border-color:rgba(255,116,23,.62);box-shadow:inset 0 1px 1px rgba(255,255,255,.95),0 0 0 2px rgba(255,116,23,.10),0 3px 8px rgba(255,116,23,.18)}.crmDockActive6::before{content:"";position:absolute;left:-8px;top:50%;width:5px;height:5px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px rgba(255,102,0,.11);transform:translateY(-50%)}
        .crmDockTip6,.crmDockFlyout6{position:absolute;left:calc(62px + var(--dock-x));top:50%;z-index:2800;color:var(--text);border:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--panel) 95%,transparent);box-shadow:0 16px 38px rgba(0,0,0,.20);backdrop-filter:blur(16px);opacity:0;visibility:hidden;transform:translate(-7px,-50%) scale(.97);transform-origin:left center;transition:opacity 110ms ease,transform 150ms cubic-bezier(.16,1,.3,1),visibility 110ms ease}.crmDockTip6{width:max-content;max-width:280px;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:700;line-height:1.2;white-space:nowrap;pointer-events:none}.crmDockTipShow6,.crmDockFlyoutShow6{opacity:1;visibility:visible;transform:translate(0,-50%) scale(1)}
        .crmDockFlyout6{width:250px;max-height:min(72vh,560px);padding:8px;border-radius:14px;overflow:auto;pointer-events:none}.crmDockFlyoutShow6{pointer-events:auto}.crmDockSlot6[data-slug="settings"] .crmDockFlyout6{top:auto;bottom:-30px;transform:translate(-7px,0) scale(.97);transform-origin:left bottom}.crmDockSlot6[data-slug="settings"] .crmDockFlyoutShow6{transform:translate(0,0) scale(1)}.crmDockFlyout6 header{display:grid;gap:2px;padding:5px 7px 8px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);margin-bottom:5px}.crmDockFlyout6 header small{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.crmDockFlyout6 header strong{font-size:13px;line-height:1.25}.crmDockFlyout6>div{display:grid;gap:2px}.crmDockFlyout6 button{width:100%;min-height:34px;padding:7px 9px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:var(--soft-text)!important;text-align:left!important;font-size:12px!important;font-weight:550!important;cursor:pointer}.crmDockFlyout6 button:hover,.crmDockFlyout6 button:focus-visible{background:var(--panel-2)!important;color:var(--text)!important;outline:none}.crmDockFlyout6 .crmDockSubActive6{background:rgba(255,102,0,.09)!important;color:var(--orange)!important;font-weight:700!important}
        .crmDockStatus6{width:50px;height:29px;flex:0 0 29px;display:grid;place-items:center;margin-top:3px;border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.crmDockStatus6 span{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 12%,transparent)}
      }
      @media(max-width:760px){.crmDock6{display:none!important}}
      @media(prefers-reduced-motion:reduce) and (min-width:761px){.crmDockTip6,.crmDockFlyout6{transition:none!important}}
    `}</style>
  </>;
}