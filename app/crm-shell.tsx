"use client";

import { useCallback, useEffect, useState } from "react";
import { NewRequestLauncher } from "./new-request-launcher";
import { SettingsPage } from "./settings-page";
import { SettingsPersonnelBridge } from "./settings-personnel-bridge";
import { LeadsBoardV2 } from "./leads-board-v2";
import { CommunicationsHub } from "./communications-hub-server";
import { ClientsVehicles } from "./clients-vehicles";
import { PartsCatalog } from "./parts-catalog";
import { PlannerV2 } from "./planner-v2";
import { Diagnostics } from "./diagnostics";
import { StationOverview } from "./station-overview";
import { CRM_NAV_GROUPS, isCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import shellStyles from "./crm-shell.module.css";

type NavigateDetail = string | { section: CrmSectionLabel; filter?: string; filterLabel?: string };
type SettingsTab = "schedule"|"personnel"|"clients"|"suppliers"|"warehouse"|"workPrices"|"posts"|"markup"|"cash"|"integrations"|"appearance";

const SETTINGS_SUBMENU:Array<{id:SettingsTab;label:string}>=[
  {id:"schedule",label:"Графік"},{id:"personnel",label:"Персонал"},{id:"clients",label:"Клієнти"},{id:"suppliers",label:"Постачальники"},{id:"warehouse",label:"Склад"},{id:"workPrices",label:"Прайс робіт"},{id:"posts",label:"Пости"},{id:"markup",label:"Націнка"},{id:"cash",label:"Каса"},{id:"integrations",label:"Інтеграції"},{id:"appearance",label:"Оформлення"},
];

export function CrmShell({ initialSection }: { initialSection?: string }) {
  const [active, setActive] = useState<CrmSectionLabel>(() => sectionFromSlug(initialSection));
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [workflowFilterLabel, setWorkflowFilterLabel] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [settingsTab,setSettingsTab]=useState<SettingsTab>("schedule");

  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push", filter = "", filterLabel = "") => {
    setActive(next); setWorkflowFilter(filter); setWorkflowFilterLabel(filterLabel);
    const url = new URL(window.location.href); const slug = slugFromSection(next);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (filterLabel) url.searchParams.set("filterLabel", filterLabel); else url.searchParams.delete("filterLabel");
    if(next!=="Налаштування") url.searchParams.delete("settingsTab");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  const navigateSettings = useCallback((tab:SettingsTab,historyMode:"push"|"replace"="push")=>{
    setActive("Налаштування");setWorkflowFilter("");setWorkflowFilterLabel("");setSettingsTab(tab);
    const url=new URL(window.location.href);url.searchParams.set("section","settings");url.searchParams.set("settingsTab",tab);url.searchParams.delete("filter");url.searchParams.delete("filterLabel");
    const nextUrl=`${url.pathname}${url.search}${url.hash}`;
    if(historyMode==="replace")window.history.replaceState({},"",nextUrl);else window.history.pushState({},"",nextUrl);
    window.dispatchEvent(new CustomEvent("turbolev:settings-tab",{detail:tab}));
  },[]);

  useEffect(() => {
    const syncFromUrl = () => { const url = new URL(window.location.href); setActive(sectionFromSlug(url.searchParams.get("section"))); setWorkflowFilter(url.searchParams.get("filter") || ""); setWorkflowFilterLabel(url.searchParams.get("filterLabel") || ""); const tab=url.searchParams.get("settingsTab") as SettingsTab|null;if(tab&&SETTINGS_SUBMENU.some(item=>item.id===tab))setSettingsTab(tab); };
    const navigate = (event: Event) => { const detail = (event as CustomEvent<NavigateDetail>).detail; if (typeof detail === "string") { if (isCrmSection(detail)) navigateTo(detail); return; } if (detail && isCrmSection(detail.section)) navigateTo(detail.section, "push", detail.filter || "", detail.filterLabel || ""); };
    syncFromUrl(); window.addEventListener("turbolev:navigate", navigate); window.addEventListener("popstate", syncFromUrl);
    return () => { window.removeEventListener("turbolev:navigate", navigate); window.removeEventListener("popstate", syncFromUrl); };
  }, [navigateTo]);

  const clearWorkflowFilter = () => navigateTo(active, "replace");
  const filterBanner = workflowFilter ? <div className="routeFilterBanner"><span>Активний фільтр:</span><b>{workflowFilterLabel || workflowFilter}</b><button type="button" onClick={clearWorkflowFilter}>Скинути ×</button></div> : null;

  return <main className="shell">
    <SettingsPersonnelBridge/>
    <aside className="sidebar">
      <div className="brand"><div className="brandLogoWrap" aria-label="Turbo LEV"><img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV"/><img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV"/></div></div>
      <nav className="groupedNav">{CRM_NAV_GROUPS.map((group)=>{const containsActive=group.items.some((item)=>item.label===active);const hidden=Boolean(collapsed[group.label]&&!containsActive);return <section className="navGroup" key={group.label}><button type="button" className="navGroupHead" onClick={()=>setCollapsed((current)=>({...current,[group.label]:!current[group.label]}))}><span>{group.label}</span><i>{hidden?"+":"−"}</i></button>{!hidden&&<div className="navGroupItems">{group.items.map((item)=><div key={item.slug}>{<button className={active===item.label?"navActive":""} onClick={()=>item.label==="Налаштування"?navigateSettings(settingsTab):navigateTo(item.label)}><span className="navDot"/>{item.label}{item.label==="Комунікації"&&<span style={{marginLeft:"auto",fontSize:9,color:"var(--orange)"}}>NEW</span>}</button>}{item.label==="Налаштування"&&active==="Налаштування"&&<div className={shellStyles.settingsSubmenu}>{SETTINGS_SUBMENU.map(sub=><button type="button" key={sub.id} className={settingsTab===sub.id?shellStyles.settingsSubActive:""} onClick={()=>navigateSettings(sub.id)}><span>{sub.label}</span></button>)}</div>}</div>)}</div>}</section>;})}</nav>
      <div className="sidebarFoot"><span className="liveDot"/> Станція онлайн</div>
    </aside>
    {active==="Огляд станції"&&<div className={shellStyles.globalNewRequest}><NewRequestLauncher/></div>}
    <section className={`workspace ${active==="Огляд станції"?shellStyles.workspaceWithFloatingAction:""}`}>{active!=="Огляд станції"&&active!=="Налаштування"&&filterBanner}{active==="Комунікації"?<CommunicationsHub/>:active==="Ліди"?<LeadsBoardV2/>:active==="Клієнти та авто"?<ClientsVehicles/>:active==="Планувальник"?<PlannerV2/>:active==="Діагностика"?<Diagnostics/>:active==="Підбір запчастин"?<PartsCatalog/>:active==="Налаштування"?<SettingsPage/>:active==="Огляд станції"?<StationOverview/>:<div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1>{workflowFilter?<p>Показуємо зріз: <strong>{workflowFilterLabel||workflowFilter}</strong>.</p>:<p>Розділ буде реалізований наступним.</p>}</div>}</section>
  </main>;
}
