"use client";

import { useCallback, useEffect, useState } from "react";
import { NewRequestWizardV3 } from "./new-request-wizard-v3";
import { SettingsPanel } from "./settings-panel";
import { LeadsBoardV2 } from "./leads-board-v2";
import { CommunicationsHub } from "./communications-hub-server";
import { PartsCatalog } from "./parts-catalog";
import { PlannerV2 } from "./planner-v2";
import { StationOverview } from "./station-overview";
import { CRM_NAV_GROUPS, isCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import shellStyles from "./crm-shell.module.css";

type NavigateDetail = string | { section: CrmSectionLabel; filter?: string; filterLabel?: string };

export function CrmShell({ initialSection }: { initialSection?: string }) {
  const [active, setActive] = useState<CrmSectionLabel>(() => sectionFromSlug(initialSection));
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [workflowFilterLabel, setWorkflowFilterLabel] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push", filter = "", filterLabel = "") => {
    setActive(next); setWorkflowFilter(filter); setWorkflowFilterLabel(filterLabel);
    const url = new URL(window.location.href); const slug = slugFromSection(next);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (filterLabel) url.searchParams.set("filterLabel", filterLabel); else url.searchParams.delete("filterLabel");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => { const url = new URL(window.location.href); setActive(sectionFromSlug(url.searchParams.get("section"))); setWorkflowFilter(url.searchParams.get("filter") || ""); setWorkflowFilterLabel(url.searchParams.get("filterLabel") || ""); };
    const navigate = (event: Event) => { const detail = (event as CustomEvent<NavigateDetail>).detail; if (typeof detail === "string") { if (isCrmSection(detail)) navigateTo(detail); return; } if (detail && isCrmSection(detail.section)) navigateTo(detail.section, "push", detail.filter || "", detail.filterLabel || ""); };
    syncFromUrl(); window.addEventListener("turbolev:navigate", navigate); window.addEventListener("popstate", syncFromUrl);
    return () => { window.removeEventListener("turbolev:navigate", navigate); window.removeEventListener("popstate", syncFromUrl); };
  }, [navigateTo]);

  const clearWorkflowFilter = () => navigateTo(active, "replace");
  const filterBanner = workflowFilter ? <div className="routeFilterBanner"><span>Активний фільтр:</span><b>{workflowFilterLabel || workflowFilter}</b><button type="button" onClick={clearWorkflowFilter}>Скинути ×</button></div> : null;

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandLogoWrap" aria-label="Turbo LEV"><img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV"/><img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV"/></div></div>
      <nav className="groupedNav">{CRM_NAV_GROUPS.map((group)=>{const containsActive=group.items.some((item)=>item.label===active);const hidden=Boolean(collapsed[group.label]&&!containsActive);return <section className="navGroup" key={group.label}><button type="button" className="navGroupHead" onClick={()=>setCollapsed((current)=>({...current,[group.label]:!current[group.label]}))}><span>{group.label}</span><i>{hidden?"+":"−"}</i></button>{!hidden&&<div className="navGroupItems">{group.items.map((item)=><button className={active===item.label?"navActive":""} key={item.slug} onClick={()=>navigateTo(item.label)}><span className="navDot"/>{item.label}{item.label==="Комунікації"&&<span style={{marginLeft:"auto",fontSize:9,color:"var(--orange)"}}>NEW</span>}</button>)}</div>}</section>;})}<SettingsPanel/></nav>
      <div className="sidebarFoot"><span className="liveDot"/> Станція онлайн</div>
    </aside>
    <div className={shellStyles.globalNewRequest}><NewRequestWizardV3/></div>
    <section className={`workspace ${shellStyles.workspaceWithFloatingAction}`}>{active!=="Огляд станції"&&filterBanner}{active==="Комунікації"?<CommunicationsHub/>:active==="Ліди"?<LeadsBoardV2/>:active==="Планувальник"?<PlannerV2/>:active==="Підбір запчастин"?<PartsCatalog/>:active==="Огляд станції"?<StationOverview/>:<div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1>{workflowFilter?<p>Показуємо зріз: <strong>{workflowFilterLabel||workflowFilter}</strong>.</p>:<p>Розділ буде реалізований наступним.</p>}</div>}</section>
  </main>;
}
