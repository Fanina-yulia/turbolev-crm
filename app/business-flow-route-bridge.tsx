"use client";

import { useEffect, useRef } from "react";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import type { CrmSectionLabel } from "./crm-navigation";

type LegacyNavigateDetail = string | { section?: string; filter?: string; filterLabel?: string };
type CanonicalTarget = { section: CrmSectionLabel; params: CrmRouteParams };
type SearchPayload = {
  clients?: Array<{ id: string; name?: string | null; phone?: string | null }>;
  vehicles?: Array<{ id: string; plateNumber?: string | null; vin?: string | null; client?: { id: string } | null }>;
};
type DiagnosticListPayload = {
  diagnostics?: Array<{ id: string; vehicle?: { id?: string | null } | null }>;
};

const ENTITY_ID = /^[A-Za-z0-9_-]{12,}$/;
const PAYMENT_LABELS: Record<string, string> = {
  due: "До сплати",
  partial: "Частково",
  paidToday: "Оплачено сьогодні",
  debt: "Борги",
};

function buttonText(button: Element | null | undefined) {
  return String(button?.textContent || "").replace(/\s+/g, " ").trim();
}

function kyivDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function canonicalizeLegacy(detail: LegacyNavigateDetail): CanonicalTarget | null {
  if (typeof detail === "string") {
    if (detail === "Активні" || detail === "Ліди") return { section: "Комунікації", params: { filter: "ACTIVE", filterLabel: "Активні" } };
    if (detail === "Нові звернення") return { section: "Комунікації", params: { filter: "NEW", filterLabel: "Нові" } };
    if (detail === "Звернення") return { section: "Комунікації", params: {} };
    if (detail === "Виробництво") return { section: "Планувальник", params: { scope: "resources" } };
    if (detail === "Контроль якості") return { section: "Комерційна пропозиція", params: { status: "WAITING_QC", workOrderTab: "qc" } };
    if (detail === "Гарантії") return { section: "Комерційна пропозиція", params: { workOrderTab: "history" } };
    return null;
  }

  const section = detail.section || "";
  const filter = (detail.filter || "").trim();

  if (["Активні", "Ліди", "Звернення"].includes(section)) {
    return { section: "Комунікації", params: {} };
  }
  if (section === "Нові звернення") {
    return { section: "Комунікації", params: ENTITY_ID.test(filter) ? { inquiryId: filter } : {} };
  }
  if (section === "Планувальник" && filter === "today") {
    return { section: "Планувальник", params: { date: kyivDateKey(), scope: "day" } };
  }
  if (section === "Планувальник" && ENTITY_ID.test(filter)) {
    return { section: "Планувальник", params: { appointmentId: filter } };
  }
  if (section === "Діагностика" && ENTITY_ID.test(filter)) {
    return { section: "Діагностика", params: { diagnosticId: filter } };
  }
  if (section === "Діагностика" && filter.toUpperCase() === "SUBMITTED") {
    return { section: "Діагностика", params: { filter: "SUBMITTED", filterLabel: detail.filterLabel || "На перевірці" } };
  }
  if (section === "Комерційна пропозиція" && filter === "approval") {
    return { section: "Комерційна пропозиція", params: { status: "WAITING_APPROVAL", workOrderTab: "estimate" } };
  }
  if (section === "Комерційна пропозиція" && ENTITY_ID.test(filter)) {
    return { section: "Комерційна пропозиція", params: { workOrderId: filter } };
  }
  if (section === "Підбір запчастин" && filter === "waiting-parts") {
    return { section: "Закупівлі та склад", params: {} };
  }
  if (section === "Контроль якості") {
    return { section: "Комерційна пропозиція", params: { status: "WAITING_QC", workOrderTab: "qc" } };
  }
  if (section === "Гарантії") {
    return { section: "Комерційна пропозиція", params: ENTITY_ID.test(filter) ? { workOrderId: filter, workOrderTab: "history" } : { workOrderTab: "history" } };
  }
  if (section === "Виробництво") {
    if (["posts", "mechanics", "assigned"].includes(filter)) return { section: "Планувальник", params: { scope: "resources" } };
    const statuses: Record<string, string> = {
      "in-repair": "IN_REPAIR",
      in_repair: "IN_REPAIR",
      "waiting-parts": "WAITING_PARTS",
      waiting_parts: "WAITING_PARTS",
      "ready-for-repair": "READY_FOR_REPAIR",
      ready_for_repair: "READY_FOR_REPAIR",
      ready: "READY_FOR_PICKUP",
      waiting_qc: "WAITING_QC",
      "qc-ready": "WAITING_QC",
    };
    const status = statuses[filter];
    if (status === "WAITING_QC") return { section: "Комерційна пропозиція", params: { status, workOrderTab: "qc" } };
    if (status) return { section: "Комерційна пропозиція", params: { status, workOrderTab: status === "WAITING_PARTS" ? "parts" : "overview" } };
    return { section: "Планувальник", params: { scope: "resources" } };
  }
  return null;
}

async function resolveLegacyClientVehicle(detail: Exclude<LegacyNavigateDetail, string>) {
  const filter = (detail.filter || "").trim();
  const label = (detail.filterLabel || "").trim();
  const wantsClient = label.toLocaleLowerCase("uk-UA").startsWith("клієнт");
  if (!filter) {
    navigateCrm(wantsClient ? "Клієнти" : "Авто");
    return;
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(filter)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as SearchPayload | null;
    if (response.ok && payload) {
      if (wantsClient) {
        const client = payload.clients?.[0] || payload.vehicles?.[0]?.client;
        if (client?.id) {
          navigateCrm("Клієнти", { clientId: client.id });
          return;
        }
      } else {
        const vehicle = payload.vehicles?.[0];
        if (vehicle?.id) {
          navigateCrm("Авто", { vehicleId: vehicle.id });
          return;
        }
      }
    }
  } catch {
    // Compatibility fallback below keeps navigation usable if search is temporarily unavailable.
  }

  navigateCrm(wantsClient ? "Клієнти" : "Авто");
}

async function resolveDiagnosticVehicleRoute(vehicleId: string, lastApplied: { current: string }) {
  if (!vehicleId || lastApplied.current === vehicleId) return;
  lastApplied.current = vehicleId;
  try {
    const response = await fetch("/api/diagnostics?limit=500", { cache: "no-store", credentials: "include" });
    const payload = await response.json().catch(() => null) as DiagnosticListPayload | null;
    if (!response.ok || !Array.isArray(payload?.diagnostics)) return;
    const diagnostic = payload.diagnostics.find((item) => item.vehicle?.id === vehicleId);
    if (!diagnostic?.id) return;
    const current = readCrmRoute();
    if (current.diagnosticId || current.vehicleId !== vehicleId) return;
    navigateCrm("Діагностика", { ...current, diagnosticId: diagnostic.id });
  } catch {
    return;
  }
}

function setNativeInput(input: HTMLInputElement, value: string) {
  if (input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function syncPaymentRoute(lastApplied: { current: string }) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("section") !== "payments") return;
  const route = readCrmRoute();
  const key = `${route.scope || ""}:${route.workOrderId || ""}`;
  if (!key.replace(":", "") || lastApplied.current === key) return;

  const wanted = route.scope && PAYMENT_LABELS[route.scope];
  if (wanted) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => buttonText(item).startsWith(wanted));
    if (!button) return;
    button.click();
  }

  if (route.workOrderId) {
    try {
      const response = await fetch("/api/payments", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { rows?: Array<{ workOrderId: string; workOrderLabel: string; vehicle?: { plateNumber?: string | null } }> } | null;
      const row = data?.rows?.find((item) => item.workOrderId === route.workOrderId);
      if (!row) return;
      const input = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((item) => item.placeholder?.includes("ПІБ"));
      if (!input) return;
      setNativeInput(input, row.workOrderLabel || row.vehicle?.plateNumber || "");
    } catch {
      return;
    }
  }
  lastApplied.current = key;
}

function syncFinanceRoute(lastApplied: { current: string }) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("section") !== "finance") return;
  const route = readCrmRoute();
  const metric = route.metric || (route.scope === "payables" ? "payables" : route.scope === "receivables" ? "receivables" : "");
  if (!metric || lastApplied.current === metric) return;
  const labels: Record<string, string> = {
    revenue: "Виручка",
    grossProfit: "Валовий прибуток",
    netProfit: "Чистий управлінський прибуток",
    currentCash: "Гроші зараз",
    receivables: "Дебіторка",
    payables: "Кредиторка",
    overdueReceivables: "Дебіторка",
    overduePayables: "Кредиторка",
  };
  const wanted = labels[metric];
  if (!wanted) return;
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => buttonText(item).startsWith(wanted));
  if (!button) return;
  button.click();
  lastApplied.current = metric;
}

function currentSectionSlug() {
  return new URL(window.location.href).searchParams.get("section") || "overview";
}

export function BusinessFlowRouteBridge() {
  const previousSection = useRef("");
  const lastDiagnosticId = useRef("");
  const diagnosticVehicleApplied = useRef("");
  const paymentApplied = useRef("");
  const financeApplied = useRef("");

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<LegacyNavigateDetail>).detail;
      if (typeof detail !== "string" && detail?.section === "Клієнти та авто") {
        event.stopImmediatePropagation();
        void resolveLegacyClientVehicle(detail);
        return;
      }
      const target = canonicalizeLegacy(detail);
      if (!target) return;
      event.stopImmediatePropagation();
      navigateCrm(target.section, target.params);
    };
    window.addEventListener("turbolev:navigate", onNavigate, true);
    return () => window.removeEventListener("turbolev:navigate", onNavigate, true);
  }, []);

  useEffect(() => {
    const syncContext = () => {
      const section = currentSectionSlug();
      const route = readCrmRoute();
      if (section !== "diagnostics") diagnosticVehicleApplied.current = "";
      if (section === "diagnostics" && route.diagnosticId) lastDiagnosticId.current = route.diagnosticId;
      if (section === "diagnostics" && route.vehicleId && !route.diagnosticId) {
        void resolveDiagnosticVehicleRoute(route.vehicleId, diagnosticVehicleApplied);
      }
      if (section === "parts" && !route.diagnosticId && previousSection.current === "diagnostics" && lastDiagnosticId.current) {
        navigateCrm("Підбір запчастин", {
          ...route,
          diagnosticId: lastDiagnosticId.current,
        });
        return;
      }
      previousSection.current = section;
    };
    syncContext();
    window.addEventListener("popstate", syncContext);
    return () => window.removeEventListener("popstate", syncContext);
  }, []);

  useEffect(() => {
    const onAnchor = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      const section = url.searchParams.get("section");
      const filter = url.searchParams.get("filter") || "";
      if ((section === "workorders" || section === "work-orders") && ENTITY_ID.test(filter)) {
        event.preventDefault();
        navigateCrm("Комерційна пропозиція", { workOrderId: filter });
      }
    };
    document.addEventListener("click", onAnchor, true);
    return () => document.removeEventListener("click", onAnchor, true);
  }, []);

  useEffect(() => {
    let timer = 0;
    const onPopState = () => {
      paymentApplied.current = "";
      financeApplied.current = "";
      sync();
    };
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void syncPaymentRoute(paymentApplied);
        syncFinanceRoute(financeApplied);
      }, 80);
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", onPopState);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
