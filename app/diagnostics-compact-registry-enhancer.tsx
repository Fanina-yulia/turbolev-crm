"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DiagnosticProgress = {
  diagnosticCard?: { number?: string | null } | null;
  structured?: { inspections?: number; checked?: number } | null;
};

type DiagnosticsResponse = {
  ok?: boolean;
  diagnostics?: DiagnosticProgress[];
};

function isDiagnosticsRegistryVisible() {
  return Array.from(document.querySelectorAll("h1")).some((node) => node.textContent?.trim() === "Всі діагностики");
}

function statusKey(label: string) {
  const value = label.toLocaleLowerCase("uk-UA");
  if (value.includes("на перевірці")) return "review";
  if (value.includes("в роботі")) return "progress";
  if (value.includes("підтвердж")) return "confirmed";
  if (value.includes("скас")) return "cancelled";
  return "pending";
}

export function DiagnosticsCompactRegistryEnhancer() {
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.diagnosticsReference = "true";
    delete document.documentElement.dataset.diagnosticsDensity;

    let frame = 0;
    let disposed = false;
    const progressByCard = new Map<string, number>();

    const applyRows = () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label^="Відкрити діагностичну карту:"]'));
      for (const row of rows) {
        const status = row.querySelector<HTMLElement>(":scope > div:first-child")?.textContent?.trim() || "";
        row.dataset.diagnosticsState = statusKey(status);

        const cardMatch = row.textContent?.match(/ДК-\d{4}-\d+/u)?.[0];
        const ratio = cardMatch ? progressByCard.get(cardMatch) : undefined;
        row.style.setProperty("--diagnostics-progress", `${Math.max(0, Math.min(100, ratio ?? 0))}%`);
      }
    };

    const ensureHeader = () => {
      frame = 0;
      if (!isDiagnosticsRegistryVisible()) {
        setHeaderHost(null);
        return;
      }

      document.querySelectorAll('[data-diagnostics-density-host="true"]').forEach((node) => node.remove());
      const firstRow = document.querySelector<HTMLElement>('button[aria-label^="Відкрити діагностичну карту:"]');
      const list = firstRow?.parentElement instanceof HTMLElement ? firstRow.parentElement : null;
      if (!list) {
        setHeaderHost(null);
        return;
      }

      let host = list.querySelector<HTMLElement>(':scope > [data-diagnostics-header-host="true"]');
      if (!host) {
        host = document.createElement("div");
        host.dataset.diagnosticsHeaderHost = "true";
        list.prepend(host);
      }
      setHeaderHost((current) => current === host ? current : host);
      applyRows();
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(ensureHeader);
    };

    const loadProgress = async () => {
      try {
        const response = await fetch("/api/diagnostics?limit=500", { cache: "no-store", credentials: "include" });
        const data = await response.json() as DiagnosticsResponse;
        if (!response.ok || !data.ok || !Array.isArray(data.diagnostics)) return;
        for (const diagnostic of data.diagnostics) {
          const number = diagnostic.diagnosticCard?.number;
          const total = Number(diagnostic.structured?.inspections || 0);
          const checked = Number(diagnostic.structured?.checked || 0);
          if (!number || total <= 0) continue;
          progressByCard.set(number, (checked / total) * 100);
        }
        if (!disposed) schedule();
      } catch {
        // The native diagnostics page remains fully functional if enrichment cannot be loaded.
      }
    };

    ensureHeader();
    void loadProgress();

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("turbolev:data-changed", loadProgress as EventListener);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("turbolev:data-changed", loadProgress as EventListener);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll('[data-diagnostics-header-host="true"], [data-diagnostics-density-host="true"]').forEach((node) => node.remove());
      delete document.documentElement.dataset.diagnosticsReference;
    };
  }, []);

  return headerHost ? createPortal(
    <div className="diagnosticsCompactHeader" role="row">
      <span role="columnheader">Статус</span>
      <span role="columnheader">Авто / ДК</span>
      <span role="columnheader">Клієнт</span>
      <span role="columnheader">Механік</span>
      <span role="columnheader">Прогрес</span>
      <span role="columnheader">Візит</span>
      <span className="diagnosticsHeaderGear" role="columnheader" aria-label="Налаштування списку">⚙</span>
    </div>,
    headerHost,
  ) : null;
}
