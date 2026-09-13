"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnalyticsQualityPanel } from "./analytics-quality-panel";

function analyticsRoot() {
  const heading = [...document.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Аналітика");
  if (!heading) return null;
  let current = heading.parentElement;
  while (current && current !== document.body) {
    if (current.querySelectorAll('input[type="date"]').length >= 2 && current.querySelector("nav")) return current as HTMLElement;
    current = current.parentElement;
  }
  return null;
}

function workshopActive(root: HTMLElement) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("nav button")].find((node) => node.textContent?.trim() === "СТО / Виробництво");
  return Boolean(button?.className);
}

function filters(root: HTMLElement) {
  const dates = [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  const selects = [...root.querySelectorAll<HTMLSelectElement>("select")];
  const location = selects.find((select) => [...select.options].some((option) => option.textContent?.includes("Усі СТО") || option.value === ""));
  return { from: dates[0]?.value || "", to: dates[1]?.value || "", locationId: location?.value || "" };
}

export function AnalyticsQualityBridge() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [scope, setScope] = useState({ from: "", to: "", locationId: "" });

  useEffect(() => {
    const resolve = () => setRoot((current) => {
      const next = analyticsRoot();
      return current === next ? current : next;
    });
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!root) return;
    const sync = () => {
      setVisible(workshopActive(root));
      const next = filters(root);
      setScope((current) => current.from === next.from && current.to === next.to && current.locationId === next.locationId ? current : next);
    };
    sync();
    const deferred = () => window.setTimeout(sync, 0);
    root.addEventListener("click", deferred);
    root.addEventListener("change", sync);
    return () => {
      root.removeEventListener("click", deferred);
      root.removeEventListener("change", sync);
    };
  }, [root]);

  if (!root || !visible || !scope.from || !scope.to) return null;
  return createPortal(<AnalyticsQualityPanel from={scope.from} to={scope.to} locationId={scope.locationId} />, root);
}
