"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnalyticsOwnerEconomics } from "./analytics-owner-economics";

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

function financeActive(root: HTMLElement) {
  const button = [...root.querySelectorAll<HTMLButtonElement>("nav button")].find((node) => node.textContent?.trim() === "Фінанси");
  return Boolean(button?.className);
}

function currentFilters(root: HTMLElement) {
  const dates = [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  const selects = [...root.querySelectorAll<HTMLSelectElement>("select")];
  return {
    from: dates[0]?.value || "",
    to: dates[1]?.value || "",
    locationId: selects[0]?.value || "",
  };
}

export function AnalyticsOwnerEconomicsBridge() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [filters, setFilters] = useState({ from: "", to: "", locationId: "" });

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
      setVisible(financeActive(root));
      const next = currentFilters(root);
      setFilters((current) => current.from === next.from && current.to === next.to && current.locationId === next.locationId ? current : next);
    };
    sync();
    const onClick = () => window.setTimeout(sync, 0);
    const onChange = () => sync();
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
    };
  }, [root]);

  if (!root || !visible || !filters.from || !filters.to) return null;
  return createPortal(
    <div data-owner-economics-analytics="true" style={{ display: "contents" }}>
      <AnalyticsOwnerEconomics from={filters.from} to={filters.to} locationId={filters.locationId} />
    </div>,
    root,
  );
}
