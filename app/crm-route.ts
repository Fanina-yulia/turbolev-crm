"use client";

import { slugFromSection, type CrmSectionLabel } from "./crm-navigation";

export type CrmRouteParams = {
  filter?: string;
  filterLabel?: string;
  status?: string;
  scope?: string;
  assignedUserId?: string;

  inquiryId?: string;
  clientId?: string;
  vehicleId?: string;
  vehiclePage?: "diagnostic-card" | "commercial-offer" | "service-history";
  appointmentId?: string;
  diagnosticId?: string;
  findingId?: string;
  vehicleIssueId?: string;

  workOrderId?: string;
  workOrderTab?: string;
  partsRequestId?: string;
  supplierOrderId?: string;

  plate?: string;
  vin?: string;
  date?: string;
  locationId?: string;

  analyticsTab?: string;
  metric?: string;
  from?: string;
  to?: string;

  settingsTab?: string;
  supplierId?: string;
  provider?: string;
  newRequest?: string;
  workflowFocus?: string;
};

export const CRM_ROUTE_KEYS: Array<keyof CrmRouteParams> = [
  "filter",
  "filterLabel",
  "status",
  "scope",
  "assignedUserId",
  "inquiryId",
  "clientId",
  "vehicleId",
  "vehiclePage",
  "appointmentId",
  "diagnosticId",
  "findingId",
  "vehicleIssueId",
  "workOrderId",
  "workOrderTab",
  "partsRequestId",
  "supplierOrderId",
  "plate",
  "vin",
  "date",
  "locationId",
  "analyticsTab",
  "metric",
  "from",
  "to",
  "settingsTab",
  "supplierId",
  "provider",
  "newRequest",
  "workflowFocus",
];

export function readCrmRoute(): CrmRouteParams {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  const result: CrmRouteParams = {};
  for (const key of CRM_ROUTE_KEYS) {
    const value = params.get(key);
    if (key === "vehiclePage") {
      if (value === "diagnostic-card" || value === "commercial-offer" || value === "service-history") result.vehiclePage = value;
      continue;
    }
    if (value) result[key] = value;
  }
  return result;
}

function canonicalNavigation(section: CrmSectionLabel, params: CrmRouteParams): { section: CrmSectionLabel; params: CrmRouteParams } {
  if (["Ліди", "Активні", "Звернення", "Нові звернення"].includes(section)) {
    return { section: "Комунікації", params };
  }

  if (section === "Виробництво") {
    if (["posts", "mechanics", "assigned", "resources"].includes(params.scope || "")) {
      const context: CrmRouteParams = { ...params };
      delete context.status;
      delete context.workOrderId;
      delete context.workOrderTab;
      context.scope = "resources";
      return { section: "Планувальник", params: context };
    }
    const next = { ...params };
    if (next.status === "WAITING_QC" && !next.workOrderTab) next.workOrderTab = "qc";
    if (next.status === "WAITING_PARTS" && !next.workOrderTab) next.workOrderTab = "parts";
    return { section: "Комерційна пропозиція", params: next };
  }

  if (section === "Контроль якості") {
    const context: CrmRouteParams = { ...params };
    const scope = context.scope;
    delete context.scope;
    if (!context.status) {
      if (scope === "passed" || scope === "ready") context.status = "READY_FOR_PICKUP";
      else if (scope === "failed" || scope === "rework") context.status = "REWORK";
      else context.status = "WAITING_QC";
    }
    context.workOrderTab = context.workOrderTab || "qc";
    return { section: "Комерційна пропозиція", params: context };
  }

  if (section === "Гарантії") {
    return { section: "Комерційна пропозиція", params: { ...params, workOrderTab: params.workOrderTab || "history" } };
  }

  return { section, params };
}

export function navigateCrm(section: CrmSectionLabel, params: CrmRouteParams = {}) {
  if (typeof window === "undefined") return;
  const target = canonicalNavigation(section, params);
  const url = new URL(window.location.href);
  const slug = slugFromSection(target.section);

  if (slug === "overview") url.searchParams.delete("section");
  else url.searchParams.set("section", slug);

  url.searchParams.delete("filter");
  url.searchParams.delete("filterLabel");
  for (const key of CRM_ROUTE_KEYS) url.searchParams.delete(key);

  for (const [key, raw] of Object.entries(target.params)) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) url.searchParams.set(key, value);
  }

  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
