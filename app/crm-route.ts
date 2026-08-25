"use client";

import { slugFromSection, type CrmSectionLabel } from "./crm-navigation";

export type CrmRouteParams = {
  status?: string;
  scope?: string;

  inquiryId?: string;
  clientId?: string;
  vehicleId?: string;
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
};

export const CRM_ROUTE_KEYS: Array<keyof CrmRouteParams> = [
  "status",
  "scope",
  "inquiryId",
  "clientId",
  "vehicleId",
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
];

export function readCrmRoute(): CrmRouteParams {
  if (typeof window === "undefined") return {};
  const params = new URL(window.location.href).searchParams;
  const result: CrmRouteParams = {};
  for (const key of CRM_ROUTE_KEYS) {
    const value = params.get(key);
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
      const { status: _status, workOrderId: _workOrderId, workOrderTab: _workOrderTab, ...context } = params;
      return { section: "Планувальник", params: { ...context, scope: "resources" } };
    }
    const next = { ...params };
    if (next.status === "WAITING_QC" && !next.workOrderTab) next.workOrderTab = "qc";
    if (next.status === "WAITING_PARTS" && !next.workOrderTab) next.workOrderTab = "parts";
    return { section: "Замовлення-наряди", params: next };
  }

  if (section === "Контроль якості") {
    const { scope, ...context } = params;
    let status = params.status;
    if (!status) {
      if (scope === "passed" || scope === "ready") status = "READY_FOR_PICKUP";
      else if (scope === "failed" || scope === "rework") status = "REWORK";
      else status = "WAITING_QC";
    }
    return { section: "Замовлення-наряди", params: { ...context, status, workOrderTab: params.workOrderTab || "qc" } };
  }

  if (section === "Гарантії") {
    return { section: "Замовлення-наряди", params: { ...params, workOrderTab: params.workOrderTab || "history" } };
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
