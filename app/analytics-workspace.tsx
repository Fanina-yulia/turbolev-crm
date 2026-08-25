"use client";

import { useEffect, useRef } from "react";
import { readCrmRoute } from "./crm-route";
import { AnalyticsDashboard } from "./analytics-dashboard";
import styles from "./analytics-workspace.module.css";

const TAB_LABELS: Record<string, string> = {
  overview: "Загальне",
  funnel: "Воронка",
  workshop: "СТО / Виробництво",
  diagnostics: "Діагностика",
  finance: "Фінанси",
  parts: "Запчастини",
};

const METRIC_TAB: Record<string, string> = {
  postUtilization: "workshop",
  overdue: "workshop",
  overdueNow: "workshop",
  activeNow: "workshop",
  readyNow: "workshop",
  grossRevenue: "finance",
  grossProfit: "finance",
  netProfit: "finance",
  receivables: "finance",
  payables: "finance",
  overdueReceivables: "finance",
  overduePayables: "finance",
  diagnostics: "diagnostics",
  conversionToWorkOrder: "diagnostics",
  parts: "parts",
  pendingParts: "parts",
};

const METRIC_TEXT: Record<string, string[]> = {
  postUtilization: ["Завантаження постів", "Завантаження"],
  overdue: ["Простроч", "Затрим"],
  overdueNow: ["Простроч", "Затрим"],
  activeNow: ["Активні зараз", "Активні"],
  readyNow: ["Готові", "Готово"],
  grossRevenue: ["Виручка"],
  grossProfit: ["Валовий прибуток", "Валова маржа"],
  netProfit: ["Чистий"],
  receivables: ["Дебіторка"],
  payables: ["Кредиторка"],
  overdueReceivables: ["Дебіторка"],
  overduePayables: ["Кредиторка"],
  diagnostics: ["Діагностика"],
  conversionToWorkOrder: ["Конверс", "Замовлення-наряд"],
  parts: ["Запчастини"],
  pendingParts: ["Очіку", "детал"],
};

function textOf(node: Element) {
  return String(node.textContent || "").replace(/\s+/g, " ").trim();
}

function setInputValue(input: HTMLInputElement, value: string) {
  if (!value || input.value === value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  if (!value || select.value === value || !Array.from(select.options).some((option) => option.value === value)) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickTab(tab: string) {
  const label = TAB_LABELS[tab];
  if (!label) return false;
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => textOf(item) === label || textOf(item).startsWith(label));
  if (!button) return false;
  button.click();
  return true;
}

function focusMetric(metric: string) {
  const needles = METRIC_TEXT[metric] || [];
  if (!needles.length) return;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("button,article,section,div"));
  const target = candidates.find((node) => {
    const text = textOf(node);
    return text.length > 0 && text.length < 500 && needles.every((needle) => text.toLocaleLowerCase("uk-UA").includes(needle.toLocaleLowerCase("uk-UA")));
  }) || candidates.find((node) => {
    const text = textOf(node).toLocaleLowerCase("uk-UA");
    return needles.some((needle) => text.includes(needle.toLocaleLowerCase("uk-UA")));
  });
  if (!target) return;
  document.querySelectorAll(`[data-analytics-route-focus="true"]`).forEach((node) => node.removeAttribute("data-analytics-route-focus"));
  target.setAttribute("data-analytics-route-focus", "true");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function AnalyticsRouteSynchronizer() {
  const applied = useRef("");

  useEffect(() => {
    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("section") !== "analytics") return;
        const route = readCrmRoute();
        const key = [route.analyticsTab, route.metric, route.from, route.to, route.locationId].join(":");
        if (!key.replace(/:/g, "") || applied.current === key) return;

        const tab = route.analyticsTab || (route.metric ? METRIC_TAB[route.metric] : "");
        if (tab) clickTab(tab);

        const dateInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
        if (route.from && dateInputs[0]) setInputValue(dateInputs[0], route.from);
        if (route.to && dateInputs[1]) setInputValue(dateInputs[1], route.to);

        if (route.locationId) {
          const locationSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) => Array.from(select.options).some((option) => option.value === route.locationId));
          if (locationSelect) setSelectValue(locationSelect, route.locationId);
        }

        window.setTimeout(() => {
          if (route.metric) focusMetric(route.metric);
          applied.current = key;
        }, 180);
      }, 80);
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const onPopState = () => { applied.current = ""; sync(); };
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

export function AnalyticsWorkspace() {
  return <div className={styles.root}>
    <AnalyticsRouteSynchronizer/>
    <AnalyticsDashboard/>
  </div>;
}
