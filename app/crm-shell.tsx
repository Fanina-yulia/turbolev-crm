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
import { WorkOrders } from "./work-orders";
import { StationOverview } from "./station-overview";
import { FinancialCenter } from "./financial-center";
import { useCrmAccess } from "./use-crm-access";
import { CRM_NAV_GROUPS, isCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { PERMISSIONS } from "@/src/security/permissions";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import shellStyles from "./crm-shell.module.css";

type NavigateDetail = string | { section: CrmSectionLabel; filter?: string; filterLabel?: string };
type SettingsTab = "schedule"|"personnel"|"suppliers"|"warehouse"|"workPrices"|"posts"|"markup"|"cash"|"integrations"|"cameras"|"appearance"|"workflow"|"security";

const SETTINGS_SUBMENU:Array<{id:SettingsTab;label:string}>=[
  {id:"schedule",label:"Графік"},
  {id:"personnel",label:"Персонал"},
  {id:"suppliers",label:"Постачальники"},
  {id:"warehouse",label:"Склад"},
  {id:"workPrices",label:"Прайс робіт"},
  {id:"posts",label:"Пости"},
  {id:"markup",label:"Націнка"},
  {id:"cash",label:"Каса"},
  {id:"integrations",label:"Інтеграції"},
  {id:"cameras",label:"Камери"},
  {id:"appearance",label:"Оформлення"},
  {id:"workflow",label:"Процеси та статуси"},
  {id:"security",label:"Ролі та доступи"},
];

function groupForSection(section:CrmSectionLabel){
  return CRM_NAV_GROUPS.find(group=>group.items.some(item=>item.label===section))?.label||null;
}

export function CrmShell({ initialSection }: { initialSection?: string }) {
  const initialActive=sectionFromSlug(initialSection);
  const [active, setActive] = useState<CrmSectionLabel>(initialActive);
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [workflowFilterLabel, setWorkflowFilterLabel] = useState("");
  const [openGroup,setOpenGroup]=useState<string|null>(()=>groupForSection(initialActive));
  const [settingsTab,setSettingsTab]=useState<SettingsTab>("schedule");
  const access=useCrmAccess();

  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push", filter = "", filterLabel = "") => {
    setActive(next); setOpenGroup(groupForSection(next)); setWorkflowFilter(filter); setWorkflowFilterLabel(filterLabel);
    const url = new URL(window.location.href); const slug = slugFromSection(next);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (filterLabel) url.searchParams.set("filterLabel", filterLabel); else url.searchParams.delete("filterLabel");
    if(next!=="Налаштування") url.searchParams.delete("settingsTab");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  const navigateSettings = useCallback((tab:SettingsTab,historyMode:"push"|"replace"="push")=>{
    setActive("Налаштування");setOpenGroup(groupForSection("Налаштування"));setWorkflowFilter("");setWorkflowFilterLabel("");setSettingsTab(tab);
    const url=new URL(window.location.href);url.searchParams.set("section","settings");url.searchParams.set("settingsTab",tab);url.searchParams.delete("filter");url.searchParams.delete("filterLabel");
    const nextUrl=`${url.pathname}${url.search}${url.hash}`;
    if(historyMode==="replace")window.history.replaceState({},"",nextUrl);else window.history.pushState({},"",nextUrl);
    window.dispatchEvent(new CustomEvent("turbolev:settings-tab",{detail:tab}));
  },[]);

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      const next=sectionFromSlug(url.searchParams.get("section"));
      setActive(next);setOpenGroup(groupForSection(next));setWorkflowFilter(url.searchParams.get("filter") || "");setWorkflowFilterLabel(url.searchParams.get("filterLabel") || "");
      const tab=url.searchParams.get("settingsTab") as SettingsTab|null;if(tab&&SETTINGS_SUBMENU.some(item=>item.id===tab))setSettingsTab(tab);
    };
    const navigate = (event: Event) => { const detail = (event as CustomEvent<NavigateDetail>).detail; if (typeof detail === "string") { if (isCrmSection(detail)) navigateTo(detail); return; } if (detail && isCrmSection(detail.section)) navigateTo(detail.section, "push", detail.filter || "", detail.filterLabel || ""); };
    syncFromUrl(); window.addEventListener("turbolev:navigate", navigate); window.addEventListener("popstate", syncFromUrl);
    return () => { window.removeEventListener("turbolev:navigate", navigate); window.removeEventListener("popstate", syncFromUrl); };
  }, [navigateTo]);

  const canSettingsTab=(tab:SettingsTab)=>{
    if(!access.enforced)return true;
    if(tab==="personnel")return access.can(PERMISSIONS.PERSONNEL_READ);
    if(tab==="cash")return access.can(PERMISSIONS.FINANCE_READ);
    if(tab==="integrations")return access.can(PERMISSIONS.SETTINGS_INTEGRATIONS);
    if(tab==="security")return access.can(PERMISSIONS.SECURITY_ACCESS_MANAGE);
    return access.can(PERMISSIONS.SETTINGS_READ);
  };
  const visibleSettingsSubmenu=SETTINGS_SUBMENU.filter(item=>canSettingsTab(item.id));
  const visibleGroups=CRM_NAV_GROUPS.map(group=>({
    ...group,
    items:group.items.filter(item=>item.slug==="settings"?visibleSettingsSubmenu.length>0:access.canOpenCabinet(item.slug)),
  })).filter(group=>group.items.length>0);

  useEffect(()=>{
    if(!access.loaded||!access.enforced)return;
    if(active==="Налаштування"){
      if(canSettingsTab(settingsTab))return;
      const fallback=visibleSettingsSubmenu[0];
      if(fallback){navigateSettings(fallback.id,"replace");return;}
    }else if(access.canOpenCabinet(slugFromSection(active)))return;
    const fallback=visibleGroups.flatMap(group=>group.items).find(item=>item.slug!=="settings"||visibleSettingsSubmenu.length>0);
    if(fallback){
      if(fallback.label==="Налаштування"&&visibleSettingsSubmenu[0])navigateSettings(visibleSettingsSubmenu[0].id,"replace");
      else navigateTo(fallback.label,"replace");
    }
  },[access.loaded,access.enforced,active,settingsTab]);

  const activeAllowed=!access.enforced||(active==="Налаштування"?canSettingsTab(settingsTab):access.canOpenCabinet(slugFromSection(active)));
  const canCreateRequest=!access.enforced||access.can(PERMISSIONS.LEADS_WRITE)||access.can(PERMISSIONS.PLANNER_WRITE);
  const clearWorkflowFilter = () => navigateTo(active, "replace");
  const filterBanner = workflowFilter ? <div className="routeFilterBanner"><span>Активний фільтр:</span><b>{workflowFilterLabel || workflowFilter}</b><button type="button" onClick={clearWorkflowFilter}>Скинути ×</button></div> : null;
  const accessDenied=<div className="comingSoon"><p className="eyebrow">TURBO LEV SECURITY</p><h1>Доступ не надано</h1><p>{access.snapshot?.provisioningState==="AUTHENTICATED_UNPROVISIONED"?"Ваш акаунт авторизований, але роль у CRM ще не призначена.":"Для цього кабінету або дії у Вашої ролі немає дозволу."}</p></div>;

  return <main className="shell">
    <SettingsPersonnelBridge/>
    <aside className="sidebar">
      <div className="brand"><div className="brandLogoWrap" aria-label="Turbo LEV"><img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV"/><img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV"/></div></div>
      <nav className="groupedNav">{visibleGroups.map((group)=>{
        const containsActive=group.items.some(item=>item.label===active);const isOpen=openGroup===group.label;
        return <section className={`${shellStyles.navGroup} ${containsActive?shellStyles.navGroupCurrent:""}`} key={group.label}>
          <button type="button" className={shellStyles.navGroupHead} aria-expanded={isOpen} onClick={()=>setOpenGroup(current=>current===group.label?null:group.label)}><span>{group.label}</span><i className={`${shellStyles.navChevron} ${isOpen?shellStyles.navChevronOpen:""}`}>⌄</i></button>
          {isOpen&&<div className={shellStyles.navGroupItems}>{group.items.map(item=><div key={item.slug}>
            <button type="button" aria-current={active===item.label?"page":undefined} className={`${shellStyles.navItem} ${active===item.label?shellStyles.navItemActive:""}`} onClick={()=>item.label==="Налаштування"?navigateSettings(canSettingsTab(settingsTab)?settingsTab:visibleSettingsSubmenu[0]?.id||"schedule"):navigateTo(item.label)}><span className={shellStyles.navDot}/>{item.label}{item.label==="Комунікації"&&<span className={shellStyles.navBadge}>NEW</span>}</button>
            {item.label==="Налаштування"&&active==="Налаштування"&&<div className={shellStyles.settingsSubmenu}>{visibleSettingsSubmenu.map(sub=><button type="button" key={sub.id} className={settingsTab===sub.id?shellStyles.settingsSubActive:""} onClick={()=>navigateSettings(sub.id)}><span>{sub.label}</span></button>)}</div>}
          </div>)}</div>}
        </section>;
      })}</nav>
      <div className="sidebarFoot"><span className="liveDot"/> {access.enforced?(access.snapshot?.user?.name||"Захищений режим"):"Станція онлайн"}</div>
    </aside>
    <div className={active==="Огляд станції"?shellStyles.globalNewRequest:undefined}><NewRequestLauncher showButton={active==="Огляд станції"&&canCreateRequest}/></div>
    <section className={`workspace ${active==="Огляд станції"?shellStyles.workspaceWithFloatingAction:""}`}>{!activeAllowed?accessDenied:<>{active!=="Огляд станції"&&active!=="Налаштування"&&filterBanner}{active==="Комунікації"?<CommunicationsHub/>:active==="Ліди"?<LeadsBoardV2/>:active==="Клієнти та авто"?<ClientsVehicles/>:active==="Планувальник"?<PlannerV2/>:active==="Діагностика"?<Diagnostics/>:active==="Замовлення-наряди"?<WorkOrders/>:active==="Підбір запчастин"?<PartsCatalog/>:active==="Фінансовий центр"?<FinancialCenter/>:active==="Налаштування"?<SettingsPage key={settingsTab}/>:active==="Огляд станції"?<StationOverview/>:<div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1>{workflowFilter?<p>Показуємо зріз: <strong>{workflowFilterLabel||workflowFilter}</strong>.</p>:<p>Розділ буде реалізований наступним.</p>}</div>}</>}</section>
  </main>;
}
