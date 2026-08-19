"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { NewRequestLauncher } from "./new-request-launcher";
import { SettingsPersonnelBridge } from "./settings-personnel-bridge";
import { useCrmAccess } from "./use-crm-access";
import { CRM_NAV_GROUPS, isCrmSection, resolveCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { CRM_ROUTE_KEYS, navigateCrm, type CrmRouteParams } from "./crm-route";
import { PERMISSIONS } from "@/src/security/permissions";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import shellStyles from "./crm-shell.module.css";

type NavigateDetail = string | { section: CrmSectionLabel; filter?: string; filterLabel?: string };
type SettingsTab = "schedule"|"personnel"|"suppliers"|"warehouse"|"workPrices"|"posts"|"markup"|"cash"|"integrations"|"cameras"|"appearance"|"workflow"|"security";
type LegacyRoute = { section: CrmSectionLabel; params: CrmRouteParams };

function SectionLoading() {
  return <div className={shellStyles.sectionLoading} role="status" aria-live="polite" aria-label="Завантаження розділу">
    <div className={shellStyles.sectionLoadingTitle}/>
    <div className={shellStyles.sectionLoadingGrid}>
      <div/><div/><div/>
    </div>
    <span className={shellStyles.srOnly}>Завантаження розділу…</span>
  </div>;
}

const SettingsPage = dynamic(() => import("./settings-page").then((mod) => mod.SettingsPage), { loading: SectionLoading });
const LeadsBoardV2 = dynamic(() => import("./leads-board-v2").then((mod) => mod.LeadsBoardV2), { loading: SectionLoading });
const CommunicationsHub = dynamic(() => import("./communications-hub-server").then((mod) => mod.CommunicationsHub), { loading: SectionLoading });
const ClientsDirectory = dynamic(() => import("./clients-directory").then((mod) => mod.ClientsDirectory), { loading: SectionLoading });
const VehiclesDirectory = dynamic(() => import("./vehicles-directory").then((mod) => mod.VehiclesDirectory), { loading: SectionLoading });
const PartsCatalog = dynamic(() => import("./parts-catalog").then((mod) => mod.PartsCatalog), { loading: SectionLoading });
const ProcurementQueue = dynamic(() => import("./procurement-queue").then((mod) => mod.ProcurementQueue), { loading: SectionLoading });
const PlannerV2 = dynamic(() => import("./planner-v2").then((mod) => mod.PlannerV2), { loading: SectionLoading });
const Diagnostics = dynamic(() => import("./diagnostics").then((mod) => mod.Diagnostics), { loading: SectionLoading });
const WorkOrders = dynamic(() => import("./work-orders").then((mod) => mod.WorkOrders), { loading: SectionLoading });
const ProductionBoard = dynamic(() => import("./production-board").then((mod) => mod.ProductionBoard), { loading: SectionLoading });
const QcQueue = dynamic(() => import("./qc-queue").then((mod) => mod.QcQueue), { loading: SectionLoading });
const RoleAwareOverview = dynamic(() => import("./role-cabinet").then((mod) => mod.RoleAwareOverview), { loading: SectionLoading });
const FinancialCenter = dynamic(() => import("./financial-center").then((mod) => mod.FinancialCenter), { loading: SectionLoading });

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

function clearTypedRouteParams(url:URL){
  for(const key of CRM_ROUTE_KEYS)url.searchParams.delete(key);
}

function legacyRoute(section:CrmSectionLabel,filter:string):LegacyRoute|null{
  const value=filter.trim();

  if(section==="Виробництво"){
    if(value==="in-repair"||value==="in_repair")return{section,params:{status:"IN_REPAIR"}};
    if(value==="ready"||value==="ready-for-repair"||value==="ready_for_repair")return{section,params:{status:"READY_FOR_REPAIR"}};
    if(value==="waiting-parts"||value==="waiting_parts")return{section,params:{status:"WAITING_PARTS"}};
    if(value==="qc-ready"||value==="waiting_qc")return{section,params:{status:"WAITING_QC"}};
    if(value==="mechanics"||value==="assigned")return{section,params:{scope:"mechanics"}};
    if(value==="posts")return{section,params:{scope:"posts"}};
    return value?{section,params:{}}:null;
  }

  if(section==="Контроль якості"){
    if(value==="ready"||value==="ready_for_pickup"||value==="passed")return{section,params:{scope:"passed"}};
    if(value==="in-progress"||value==="in_progress")return{section,params:{scope:"in-progress"}};
    if(value==="failed"||value==="rework")return{section,params:{scope:"failed"}};
    if(value==="qc-ready"||value==="waiting_qc"||value==="waiting")return{section,params:{scope:"waiting"}};
    return value?{section,params:{}}:null;
  }

  if(section==="Закупівлі та склад"){
    if(value==="selecting"||value==="assigned")return{section,params:{scope:"selecting"}};
    if(value==="approved"||value==="order-required"||value==="order_required")return{section,params:{scope:"approved"}};
    if(value==="ordered"||value==="in-transit"||value==="in_transit")return{section,params:{scope:"ordered"}};
    if(value==="partial"||value==="partially-received"||value==="partially_received")return{section,params:{scope:"partial"}};
    if(value==="received"||value==="installed")return{section,params:{scope:"received"}};
    return value?{section,params:{}}:null;
  }

  if(section==="Оплати"||section==="Аналітика")return{section:"Фінансовий центр",params:{}};
  if(section==="Гарантії")return{section:"Замовлення-наряди",params:{}};

  if(section==="Замовлення-наряди"){
    if(!value)return null;
    const statuses:Record<string,string>={
      approval:"WAITING_APPROVAL",
      waiting_approval:"WAITING_APPROVAL",
      "waiting-parts":"WAITING_PARTS",
      waiting_parts:"WAITING_PARTS",
      "in-repair":"IN_REPAIR",
      in_repair:"IN_REPAIR",
      ready:"READY_FOR_PICKUP",
      ready_for_pickup:"READY_FOR_PICKUP",
      "ready-for-repair":"READY_FOR_REPAIR",
      ready_for_repair:"READY_FOR_REPAIR",
    };
    if(value==="qc-ready"||value==="waiting_qc")return{section:"Контроль якості",params:{scope:"waiting"}};
    if(statuses[value])return{section,params:{status:statuses[value]}};
    if(value==="assigned")return{section,params:{}};
    if(/^[A-Z_]+$/.test(value)&&["PARTS_REVIEW","WAITING_APPROVAL","WAITING_PARTS","READY_FOR_REPAIR","IN_REPAIR","WAITING_QC","READY_FOR_PICKUP","CLOSED"].includes(value))return{section,params:{status:value}};
    return{section,params:{workOrderId:value}};
  }

  if(section==="Планувальник"){
    if(!value)return null;
    const statuses:Record<string,string>={booked:"BOOKED","no-show":"NO_SHOW",no_show:"NO_SHOW"};
    if(statuses[value])return{section,params:{status:statuses[value]}};
    if(value==="today"||value==="assigned"||value==="mechanics")return{section,params:{}};
  }

  if(section==="Підбір запчастин"&&["assigned","waiting-parts","waiting_parts"].includes(value))return{section,params:{}};
  if(section==="Діагностика"&&value==="active")return{section,params:{}};
  return null;
}

export function CrmShell({ initialSection, initialSettingsTab }: { initialSection?: string; initialSettingsTab?: string }) {
  const initialActive=sectionFromSlug(initialSection);
  const initialTab=(SETTINGS_SUBMENU.some(item=>item.id===initialSettingsTab)?initialSettingsTab:"schedule") as SettingsTab;
  const [active, setActive] = useState<CrmSectionLabel>(initialActive);
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [workflowFilterLabel, setWorkflowFilterLabel] = useState("");
  const [openGroup,setOpenGroup]=useState<string|null>(()=>groupForSection(initialActive));
  const [settingsTab,setSettingsTab]=useState<SettingsTab>(initialTab);
  const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const access=useCrmAccess();

  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push", filter = "", filterLabel = "") => {
    const resolved=resolveCrmSection(next);
    setActive(resolved); setOpenGroup(groupForSection(resolved)); setWorkflowFilter(filter); setWorkflowFilterLabel(filterLabel); setMobileNavOpen(false);
    const url = new URL(window.location.href); const slug = slugFromSection(resolved);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    clearTypedRouteParams(url);
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (filterLabel) url.searchParams.set("filterLabel", filterLabel); else url.searchParams.delete("filterLabel");
    if(resolved!=="Налаштування") url.searchParams.delete("settingsTab");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  const navigateSettings = useCallback((tab:SettingsTab,historyMode:"push"|"replace"="push")=>{
    setActive("Налаштування");setOpenGroup(groupForSection("Налаштування"));setWorkflowFilter("");setWorkflowFilterLabel("");setSettingsTab(tab);setMobileNavOpen(false);
    const url=new URL(window.location.href);url.searchParams.set("section","settings");url.searchParams.set("settingsTab",tab);url.searchParams.delete("filter");url.searchParams.delete("filterLabel");clearTypedRouteParams(url);
    const nextUrl=`${url.pathname}${url.search}${url.hash}`;
    if(historyMode==="replace")window.history.replaceState({},"",nextUrl);else window.history.pushState({},"",nextUrl);
    window.dispatchEvent(new CustomEvent("turbolev:settings-tab",{detail:tab}));
  },[]);

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      const next=sectionFromSlug(url.searchParams.get("section"));
      setActive(next);setOpenGroup(groupForSection(next));setWorkflowFilter(url.searchParams.get("filter") || "");setWorkflowFilterLabel(url.searchParams.get("filterLabel") || "");setMobileNavOpen(false);
      const tab=url.searchParams.get("settingsTab") as SettingsTab|null;setSettingsTab(tab&&SETTINGS_SUBMENU.some(item=>item.id===tab)?tab:"schedule");
    };
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<NavigateDetail>).detail;
      if(typeof detail==="string"){
        if(isCrmSection(detail))navigateTo(detail);
        return;
      }
      if(!detail||!isCrmSection(detail.section))return;
      const redirect=legacyRoute(detail.section,detail.filter||"");
      if(redirect){navigateCrm(redirect.section,redirect.params);return;}
      navigateTo(detail.section,"push",detail.filter||"",detail.filterLabel||"");
    };
    syncFromUrl(); window.addEventListener("turbolev:navigate", navigate); window.addEventListener("popstate", syncFromUrl);
    return () => { window.removeEventListener("turbolev:navigate", navigate); window.removeEventListener("popstate", syncFromUrl); };
  }, [navigateTo]);

  useEffect(()=>{
    if(!mobileNavOpen)return;
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==="Escape")setMobileNavOpen(false);};
    window.addEventListener("keydown",closeOnEscape);
    return()=>window.removeEventListener("keydown",closeOnEscape);
  },[mobileNavOpen]);

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
      <button
        type="button"
        className={shellStyles.mobileNavToggle}
        aria-label={mobileNavOpen?"Закрити меню CRM":"Відкрити меню CRM"}
        aria-expanded={mobileNavOpen}
        aria-controls="crm-primary-navigation"
        onClick={()=>setMobileNavOpen(open=>!open)}
      ><span aria-hidden="true">{mobileNavOpen?"×":"☰"}</span></button>
      <nav id="crm-primary-navigation" className={`groupedNav ${mobileNavOpen?shellStyles.mobileNavOpen:""}`}>{visibleGroups.map((group)=>{
        const containsActive=group.items.some(item=>item.label===active);const isOpen=openGroup===group.label;
        return <section className={`${shellStyles.navGroup} ${containsActive?shellStyles.navGroupCurrent:""}`} key={group.label}>
          <button type="button" className={shellStyles.navGroupHead} aria-expanded={isOpen} onClick={()=>setOpenGroup(current=>current===group.label?null:group.label)}><span>{group.label}</span><i className={`${shellStyles.navChevron} ${isOpen?shellStyles.navChevronOpen:""}`}>⌄</i></button>
          {isOpen&&<div className={shellStyles.navGroupItems}>{group.items.map(item=><div key={item.slug}>
            <button type="button" aria-current={active===item.label?"page":undefined} className={`${shellStyles.navItem} ${active===item.label?shellStyles.navItemActive:""}`} onClick={()=>item.label==="Налаштування"?navigateSettings(canSettingsTab(settingsTab)?settingsTab:visibleSettingsSubmenu[0]?.id||"schedule"):navigateTo(item.label)}><span className={shellStyles.navDot}/>{item.label==="Ліди"?"Активні":item.label}{item.label==="Комунікації"&&<span className={shellStyles.navBadge}>NEW</span>}</button>
            {item.label==="Налаштування"&&active==="Налаштування"&&<div className={shellStyles.settingsSubmenu}>{visibleSettingsSubmenu.map(sub=><button type="button" key={sub.id} className={settingsTab===sub.id?shellStyles.settingsSubActive:""} onClick={()=>navigateSettings(sub.id)}><span>{sub.label}</span></button>)}</div>}
          </div>)}</div>}
        </section>;
      })}</nav>
      <div className="sidebarFoot"><span className="liveDot"/> {access.enforced?(access.snapshot?.user?.name||"Захищений режим"):"Станція онлайн"}</div>
    </aside>
    <div className={active==="Огляд станції"?shellStyles.globalNewRequest:undefined}><NewRequestLauncher showButton={active==="Огляд станції"&&canCreateRequest}/></div>
    <section className={`workspace ${active==="Огляд станції"?shellStyles.workspaceWithFloatingAction:""}`}>{!activeAllowed?accessDenied:<>{active!=="Огляд станції"&&active!=="Налаштування"&&filterBanner}{active==="Комунікації"?<CommunicationsHub/>:active==="Ліди"?<LeadsBoardV2/>:active==="Клієнти"?<ClientsDirectory/>:active==="Авто"?<VehiclesDirectory/>:active==="Планувальник"?<PlannerV2/>:active==="Діагностика"?<Diagnostics/>:active==="Замовлення-наряди"?<WorkOrders/>:active==="Виробництво"?<ProductionBoard/>:active==="Контроль якості"?<QcQueue/>:active==="Підбір запчастин"?<PartsCatalog/>:active==="Закупівлі та склад"?<ProcurementQueue/>:active==="Фінансовий центр"?<FinancialCenter/>:active==="Налаштування"?<SettingsPage key={settingsTab}/>:active==="Огляд станції"?<RoleAwareOverview access={access.snapshot}/>:<div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1><p>Розділ тимчасово недоступний.</p></div>}</>}</section>
  </main>;
}