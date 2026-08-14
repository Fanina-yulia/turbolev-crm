"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { NewRequestWizardV3 } from "./new-request-wizard-v3";
import { SettingsPanel } from "./settings-panel";
import { LeadsBoardV2 } from "./leads-board-v2";
import { CommunicationsHub } from "./communications-hub-server";
import { GlobalVehicleSearch } from "./global-vehicle-search";
import { PartsCatalog } from "./parts-catalog";
import { PlannerV2 } from "./planner-v2";
import { CRM_NAV, isCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";
import shellStyles from "./crm-shell.module.css";

type WorkflowRoute = {
  name: string;
  value: string;
  sub: string;
  section: CrmSectionLabel;
  filter: string;
  filterLabel: string;
};

type NavigateDetail = string | { section: CrmSectionLabel; filter?: string; filterLabel?: string };

const pipeline: WorkflowRoute[] = [
  { name: "Нові заявки", value: "7", sub: "2 прострочені SLA", section: "Ліди", filter: "new", filterLabel: "Нові" },
  { name: "Записані", value: "11", sub: "4 сьогодні", section: "Планувальник", filter: "booked", filterLabel: "Записані" },
  { name: "На діагностиці", value: "3", sub: "1 очікує майстра", section: "Діагностика", filter: "active", filterLabel: "Активна діагностика" },
  { name: "Погодження", value: "5", sub: "₴ 48 700", section: "Замовлення-наряди", filter: "approval", filterLabel: "Очікують погодження" },
  { name: "Очікують деталі", value: "4", sub: "2 ETA сьогодні", section: "Закупівлі та склад", filter: "waiting-parts", filterLabel: "Очікують деталі" },
  { name: "В ремонті", value: "6", sub: "2 пости зайняті", section: "Виробництво", filter: "in-repair", filterLabel: "В ремонті" },
  { name: "QC / готові", value: "2", sub: "1 до видачі", section: "Контроль якості", filter: "qc-ready", filterLabel: "QC / готові" },
];

const cars: AttentionCar[] = [
  { plate: "AA 4271 KI", brand: "Mazda", model: "6", year: 2016, status: "Погодження", action: "Погодити КП ₴18 450", owner: "Продавник", tone: "warn" },
  { plate: "KA 9180 CT", brand: "Volkswagen", model: "Caddy", year: 2012, status: "Ремонт", action: "Завершити передню підвіску", owner: "Автомеханік", tone: "active" },
  { plate: "AI 5523 PM", brand: "Ford", model: "S-Max", year: 2014, status: "Очікування деталей", action: "Контроль ETA постачальника", owner: "Підборщик", tone: "waiting" },
  { plate: "CB 1038 EA", brand: "BMW", model: "3", year: 2018, status: "Контроль якості", action: "Провести фінальний QC", owner: "Завідуючий", tone: "good" },
];

export function CrmShell({ initialSection }: { initialSection?: string }) {
  const [active, setActive] = useState<CrmSectionLabel>(() => sectionFromSlug(initialSection));
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [workflowFilterLabel, setWorkflowFilterLabel] = useState("");

  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push", filter = "", filterLabel = "") => {
    setActive(next);
    setWorkflowFilter(filter);
    setWorkflowFilterLabel(filterLabel);
    const url = new URL(window.location.href);
    const slug = slugFromSection(next);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    if (filter) url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
    if (filterLabel) url.searchParams.set("filterLabel", filterLabel); else url.searchParams.delete("filterLabel");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      setActive(sectionFromSlug(url.searchParams.get("section")));
      setWorkflowFilter(url.searchParams.get("filter") || "");
      setWorkflowFilterLabel(url.searchParams.get("filterLabel") || "");
    };
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<NavigateDetail>).detail;
      if (typeof detail === "string") {
        if (isCrmSection(detail)) navigateTo(detail);
        return;
      }
      if (detail && isCrmSection(detail.section)) navigateTo(detail.section, "push", detail.filter || "", detail.filterLabel || "");
    };
    syncFromUrl();
    window.addEventListener("turbolev:navigate", navigate);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("turbolev:navigate", navigate);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [navigateTo]);

  const clearWorkflowFilter = () => navigateTo(active, "replace");
  const filterBanner = workflowFilter ? <div className="routeFilterBanner"><span>Активний фільтр:</span><b>{workflowFilterLabel || workflowFilter}</b><button type="button" onClick={clearWorkflowFilter}>Скинути ×</button></div> : null;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><div className="brandLogoWrap" aria-label="Turbo LEV"><img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV" /><img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV" /></div></div><nav>{CRM_NAV.map((item) => <button className={active === item.label ? "navActive" : ""} key={item.slug} onClick={() => navigateTo(item.label)}><span className="navDot" />{item.label}{item.label === "Комунікації" && <span style={{marginLeft:"auto",fontSize:9,color:"var(--orange)"}}>NEW</span>}</button>)}<SettingsPanel /></nav><div className="sidebarFoot"><span className="liveDot" /> Станція онлайн</div></aside>
    <div className={shellStyles.globalNewRequest}><NewRequestWizardV3 /></div>
    <section className={`workspace ${shellStyles.workspaceWithFloatingAction}`}>{active !== "Огляд станції" && filterBanner}{active === "Комунікації" ? <CommunicationsHub /> : active === "Ліди" ? <LeadsBoardV2 /> : active === "Планувальник" ? <PlannerV2 /> : active === "Підбір запчастин" ? <PartsCatalog /> : active === "Огляд станції" ? <Overview /> : <div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1>{workflowFilter ? <p>Показуємо зріз: <strong>{workflowFilterLabel || workflowFilter}</strong>. Фільтр уже переданий цьому розділу через CRM route state.</p> : <p>Розділ буде реалізований наступним.</p>}</div>}</section>
  </main>;
}

function openWorkflow(item: WorkflowRoute) {
  window.dispatchEvent(new CustomEvent<NavigateDetail>("turbolev:navigate", { detail: { section: item.section, filter: item.filter, filterLabel: item.filterLabel } }));
}

function Overview() {
  return <>
    <header className="topbar"><div><p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p><h1>Огляд станції</h1></div><div className="topActions"><GlobalVehicleSearch /></div></header>
    <div className="alert"><strong>3 авто потребують дії</strong><span>CRM показує тільки те, що має відповідального, строк і наступний крок.</span><button onClick={() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Комунікації" }))}>Комунікації</button></div>
    <section className="kpis"><article><span>Авто сьогодні</span><strong>14</strong><small>+3 до вчора</small></article><article><span>В роботі</span><strong>6</strong><small>2 / 2 постів зайнято</small></article><article><span>Виручка сьогодні</span><strong>₴ 42 680</strong><small>роботи + деталі</small></article><article><span>Валовий прибуток</span><strong>₴ 17 240</strong><small>40,4% від виручки</small></article></section>
    <section className="sectionBlock"><div className="sectionHead"><div><p className="eyebrow">ВІД ЗАЯВКИ ДО ГРОШЕЙ</p><h2>Живий маршрут станції</h2></div><span className="muted">сьогодні · натисни на етап</span></div><div className="pipeline">{pipeline.map((item) => <button type="button" className="pipelineAction" key={item.name} onClick={() => openWorkflow(item)} aria-label={`${item.name}: відкрити ${item.section}, фільтр ${item.filterLabel}`}><span>{item.name}</span><strong>{item.value}</strong><small>{item.sub}</small><em>{item.section} →</em></button>)}</div></section>
    <section className="gridTwo"><WorkOrderCockpit cars={cars} /><aside className="panel blockers"><div className="sectionHead"><div><p className="eyebrow">БЛОКЕРИ</p><h2>Що стопорить гроші</h2></div></div><div className="blocker"><b>Погодження клієнта</b><strong>₴ 48 700</strong><span>5 замовлень</span></div><div className="blocker"><b>Оплата деталей</b><strong>₴ 31 260</strong><span>3 замовлення</span></div><div className="blocker"><b>Очікування постачальника</b><strong>4 авто</strong><span>2 ризики строку видачі</span></div><div className="rule">Hard Gate #1: після заїзду створюється заявка на діагностику. Замовлення-наряд — тільки після підтвердженої діагностики.</div></aside></section>
  </>;
}
