"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PERMISSIONS } from "@/src/security/permissions";
import { CRM_NAV_GROUPS, sectionFromSlug, type CrmSectionLabel } from "../crm-navigation";
import { navigateCrm } from "../crm-route";
import { useCrmAccess } from "../use-crm-access";

const DESKTOP_QUERY = "(min-width: 761px)";
const LABEL_DELAY_MS = 360;
const ICON_SIZE = 28;
const EFFECT_RADIUS = 160;
const MAX_SCALE = 2.7;
const MAX_X = 46;
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

function DockIcon({slug}:{slug:string}){
  const p={viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.85,strokeLinecap:"round" as const,strokeLinejoin:"round" as const,"aria-hidden":true};
  switch(slug){
    case "overview":return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
    case "tasks":return <svg {...p}><path d="M9 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9"/><path d="m3 5 2 2 4-4M9 12h8M9 16h6"/></svg>;
    case "communications":return <svg {...p}><path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.4-4.2A8 8 0 1 1 21 12Z"/><path d="M8 10h8M8 14h5"/></svg>;
    case "planner":return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3v3H8z"/></svg>;
    case "clients":return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "vehicles":return <svg {...p}><path d="m5 17-2-1v-5l2-5h14l2 5v5l-2 1M5 17h14M7 17v2M17 17v2M6 11h12"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></svg>;
    case "diagnostics":return <svg {...p}><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M9 3h6v4H9zM7 12l2 2 4-4"/><circle cx="18" cy="9" r="3"/><path d="m20.2 11.2 2.3 2.3"/></svg>;
    case "parts":return <svg {...p}><circle cx="10" cy="10" r="5"/><path d="m14 14 6 6M10 7v6M7 10h6M18 3h3v3"/></svg>;
    case "work-orders":return <svg {...p}><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-3-3L14.7 6.3ZM14 18h7M17.5 14.5V21"/></svg>;
    case "warranties":return <svg {...p}><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>;
    case "procurement":return <svg {...p}><path d="m12 2 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 14l8 4 8-4M4 18l8 4 8-4"/></svg>;
    case "finance":return <svg {...p}><path d="M4 5h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M16 10h6v5h-6a2.5 2.5 0 0 1 0-5Z"/><circle cx="16" cy="12.5" r=".6"/></svg>;
    case "payments":return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/></svg>;
    case "analytics":return <svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2M4 7l5-4 6 5 5-4"/></svg>;
    case "settings":return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1Z"/></svg>;
    default:return <svg {...p}><circle cx="12" cy="12" r="8"/></svg>;
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
        .crmDockButton6{position:relative;width:40px!important;min-width:40px!important;max-width:40px!important;height:40px!important;min-height:40px!important;display:grid!important;place-items:center!important;padding:0!important;margin:0!important;border:0!important;border-radius:12px!important;background:transparent!important;color:var(--muted)!important;overflow:visible!important;cursor:pointer;outline:none!important;transform:translate3d(var(--dock-x),0,0);transform-origin:center;will-change:transform;transition:filter 120ms ease}.crmDockGlyph6{width:${ICON_SIZE}px;height:${ICON_SIZE}px;display:grid;place-items:center;transform:scale(var(--dock-scale));transform-origin:center;will-change:transform;pointer-events:none}.crmDockGlyph6 svg{width:${ICON_SIZE}px;height:${ICON_SIZE}px;display:block;overflow:visible;vector-effect:non-scaling-stroke}.crmDockButton6:hover,.crmDockButton6:focus-visible{color:var(--text)!important}.crmDockButton6:hover .crmDockGlyph6,.crmDockButton6:focus-visible .crmDockGlyph6{filter:drop-shadow(0 10px 16px rgba(0,0,0,.22))}.crmDockActive6{color:var(--orange)!important}.crmDockActive6::before{content:"";position:absolute;left:-8px;top:50%;width:5px;height:5px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 3px rgba(255,102,0,.11);transform:translateY(-50%)}
        .crmDockTip6,.crmDockFlyout6{position:absolute;left:calc(66px + var(--dock-x));top:50%;z-index:2800;color:var(--text);border:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--panel) 95%,transparent);box-shadow:0 16px 38px rgba(0,0,0,.20);backdrop-filter:blur(16px);opacity:0;visibility:hidden;transform:translate(-7px,-50%) scale(.97);transform-origin:left center;transition:opacity 110ms ease,transform 150ms cubic-bezier(.16,1,.3,1),visibility 110ms ease}.crmDockTip6{width:max-content;max-width:280px;padding:7px 11px;border-radius:10px;font-size:12px;font-weight:700;line-height:1.2;white-space:nowrap;pointer-events:none}.crmDockTipShow6,.crmDockFlyoutShow6{opacity:1;visibility:visible;transform:translate(0,-50%) scale(1)}
        .crmDockFlyout6{width:250px;max-height:min(72vh,560px);padding:8px;border-radius:14px;overflow:auto;pointer-events:none}.crmDockFlyoutShow6{pointer-events:auto}.crmDockSlot6[data-slug="settings"] .crmDockFlyout6{top:auto;bottom:-30px;transform:translate(-7px,0) scale(.97);transform-origin:left bottom}.crmDockSlot6[data-slug="settings"] .crmDockFlyoutShow6{transform:translate(0,0) scale(1)}.crmDockFlyout6 header{display:grid;gap:2px;padding:5px 7px 8px;border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent);margin-bottom:5px}.crmDockFlyout6 header small{color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.crmDockFlyout6 header strong{font-size:13px;line-height:1.25}.crmDockFlyout6>div{display:grid;gap:2px}.crmDockFlyout6 button{width:100%;min-height:34px;padding:7px 9px!important;border:0!important;border-radius:9px!important;background:transparent!important;color:var(--soft-text)!important;text-align:left!important;font-size:12px!important;font-weight:550!important;cursor:pointer}.crmDockFlyout6 button:hover,.crmDockFlyout6 button:focus-visible{background:var(--panel-2)!important;color:var(--text)!important;outline:none}.crmDockFlyout6 .crmDockSubActive6{background:rgba(255,102,0,.09)!important;color:var(--orange)!important;font-weight:700!important}
        .crmDockStatus6{width:50px;height:29px;flex:0 0 29px;display:grid;place-items:center;margin-top:3px;border-top:1px solid color-mix(in srgb,var(--line) 55%,transparent)}.crmDockStatus6 span{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px color-mix(in srgb,var(--green) 12%,transparent)}
      }
      @media(max-width:760px){.crmDock6{display:none!important}}
      @media(prefers-reduced-motion:reduce) and (min-width:761px){.crmDockTip6,.crmDockFlyout6{transition:none!important}}
    `}</style>
  </>;
}
