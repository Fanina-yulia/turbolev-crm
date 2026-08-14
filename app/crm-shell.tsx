"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkOrderCockpit, type AttentionCar } from "@/src/components/work-order-cockpit";
import { NewRequestWizardV3 } from "./new-request-wizard-v3";
import { SettingsPanel } from "./settings-panel";
import { LeadsBoardV2 } from "./leads-board-v2";
import { CommunicationsHub } from "./communications-hub-server";
import { GlobalVehicleSearch } from "./global-vehicle-search";
import { PartsCatalog } from "./parts-catalog";
import { Planner } from "./planner";
import { CRM_NAV, isCrmSection, sectionFromSlug, slugFromSection, type CrmSectionLabel } from "./crm-navigation";
import { turboLevLogoDark, turboLevLogoLight } from "@/src/brand/logos";

const pipeline = [["Нові заявки", "7", "2 прострочені SLA"],["Записані", "11", "4 сьогодні"],["На діагностиці", "3", "1 очікує майстра"],["Погодження", "5", "₴ 48 700"],["Очікують деталі", "4", "2 ETA сьогодні"],["В ремонті", "6", "2 пости зайняті"],["QC / готові", "2", "1 до видачі"]];
const cars: AttentionCar[] = [
  { plate: "AA 4271 KI", brand: "Mazda", model: "6", year: 2016, status: "Погодження", action: "Погодити КП ₴18 450", owner: "Продавник", tone: "warn" },
  { plate: "KA 9180 CT", brand: "Volkswagen", model: "Caddy", year: 2012, status: "Ремонт", action: "Завершити передню підвіску", owner: "Автомеханік", tone: "active" },
  { plate: "AI 5523 PM", brand: "Ford", model: "S-Max", year: 2014, status: "Очікування деталей", action: "Контроль ETA постачальника", owner: "Підборщик", tone: "waiting" },
  { plate: "CB 1038 EA", brand: "BMW", model: "3", year: 2018, status: "Контроль якості", action: "Провести фінальний QC", owner: "Завідуючий", tone: "good" },
];

export function CrmShell({ initialSection }: { initialSection?: string }) {
  const [active, setActive] = useState<CrmSectionLabel>(() => sectionFromSlug(initialSection));
  const navigateTo = useCallback((next: CrmSectionLabel, historyMode: "push" | "replace" = "push") => {
    setActive(next);
    const url = new URL(window.location.href);
    const slug = slugFromSection(next);
    if (slug === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", slug);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (historyMode === "replace") window.history.replaceState({}, "", nextUrl); else window.history.pushState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    const navigate = (event: Event) => { const next = (event as CustomEvent<string>).detail; if (typeof next === "string" && isCrmSection(next)) navigateTo(next); };
    const restoreFromHistory = () => { const slug = new URL(window.location.href).searchParams.get("section"); setActive(sectionFromSlug(slug)); };
    window.addEventListener("turbolev:navigate", navigate); window.addEventListener("popstate", restoreFromHistory);
    return () => { window.removeEventListener("turbolev:navigate", navigate); window.removeEventListener("popstate", restoreFromHistory); };
  }, [navigateTo]);

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><div className="brandLogoWrap" aria-label="Turbo LEV"><img className="brandLogo brandLogoDark" src={turboLevLogoDark} alt="Turbo LEV" /><img className="brandLogo brandLogoLight" src={turboLevLogoLight} alt="Turbo LEV" /></div></div><nav>{CRM_NAV.map((item) => <button className={active === item.label ? "navActive" : ""} key={item.slug} onClick={() => navigateTo(item.label)}><span className="navDot" />{item.label}{item.label === "Комунікації" && <span style={{marginLeft:"auto",fontSize:9,color:"var(--orange)"}}>NEW</span>}</button>)}<SettingsPanel /></nav><div className="sidebarFoot"><span className="liveDot" /> Станція онлайн</div></aside>
    <section className="workspace">{active === "Комунікації" ? <CommunicationsHub /> : active === "Ліди" ? <LeadsBoardV2 /> : active === "Планувальник" ? <Planner /> : active === "Підбір запчастин" ? <PartsCatalog /> : active === "Огляд станції" ? <Overview /> : <div className="comingSoon"><p className="eyebrow">TURBO LEV CRM</p><h1>{active}</h1><p>Розділ буде реалізований наступним.</p></div>}</section>
  </main>;
}

function Overview() {
  return <>
    <header className="topbar"><div><p className="eyebrow">TURBO LEV · ОПЕРАЦІЙНИЙ ЦЕНТР</p><h1>Огляд станції</h1></div><div className="topActions"><GlobalVehicleSearch /><NewRequestWizardV3 /></div></header>
    <div className="alert"><strong>3 авто потребують дії</strong><span>CRM показує тільки те, що має відповідального, строк і наступний крок.</span><button onClick={() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Комунікації" }))}>Комунікації</button></div>
    <section className="kpis"><article><span>Авто сьогодні</span><strong>14</strong><small>+3 до вчора</small></article><article><span>В роботі</span><strong>6</strong><small>2 / 2 постів зайнято</small></article><article><span>Виручка сьогодні</span><strong>₴ 42 680</strong><small>роботи + деталі</small></article><article><span>Валовий прибуток</span><strong>₴ 17 240</strong><small>40,4% від виручки</small></article></section>
    <section className="sectionBlock"><div className="sectionHead"><div><p className="eyebrow">ВІД ЗАЯВКИ ДО ГРОШЕЙ</p><h2>Живий маршрут станції</h2></div><span className="muted">сьогодні · демо-дані</span></div><div className="pipeline">{pipeline.map(([name,value,sub]) => <article key={name}><span>{name}</span><strong>{value}</strong><small>{sub}</small></article>)}</div></section>
    <section className="gridTwo"><WorkOrderCockpit cars={cars} /><aside className="panel blockers"><div className="sectionHead"><div><p className="eyebrow">БЛОКЕРИ</p><h2>Що стопорить гроші</h2></div></div><div className="blocker"><b>Погодження клієнта</b><strong>₴ 48 700</strong><span>5 замовлень</span></div><div className="blocker"><b>Оплата деталей</b><strong>₴ 31 260</strong><span>3 замовлення</span></div><div className="blocker"><b>Очікування постачальника</b><strong>4 авто</strong><span>2 ризики строку видачі</span></div><div className="rule">Hard Gate #1: після заїзду створюється заявка на діагностику. Замовлення-наряд — тільки після підтвердженої діагностики.</div></aside></section>
  </>;
}
