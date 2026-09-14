"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DiagnosticsDensity = "compact" | "detailed";

const STORAGE_KEY = "turbolev:diagnostics-density:v1";

function savedDensity(): DiagnosticsDensity {
  if (typeof window === "undefined") return "compact";
  return window.localStorage.getItem(STORAGE_KEY) === "detailed" ? "detailed" : "compact";
}

function isDiagnosticsRegistryVisible() {
  return Array.from(document.querySelectorAll("h1")).some((node) => node.textContent?.trim() === "Всі діагностики");
}

export function DiagnosticsCompactRegistryEnhancer() {
  const [density, setDensity] = useState<DiagnosticsDensity>("compact");
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setDensity(savedDensity());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.diagnosticsDensity = density;
    try {
      window.localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // Local storage can be unavailable in hardened browser contexts.
    }
  }, [density]);

  useEffect(() => {
    let frame = 0;

    const ensureHosts = () => {
      frame = 0;
      if (!isDiagnosticsRegistryVisible()) {
        setToolbarHost(null);
        setHeaderHost(null);
        return;
      }

      const filterNav = document.querySelector<HTMLElement>('nav[aria-label="Фільтр за етапом"]');
      const firstRow = document.querySelector<HTMLElement>('button[aria-label^="Відкрити діагностичну карту:"]');
      const list = firstRow?.parentElement instanceof HTMLElement ? firstRow.parentElement : null;

      if (filterNav) {
        let host = filterNav.querySelector<HTMLElement>('[data-diagnostics-density-host="true"]');
        if (!host) {
          host = document.createElement("span");
          host.dataset.diagnosticsDensityHost = "true";
          filterNav.appendChild(host);
        }
        setToolbarHost((current) => current === host ? current : host);
      } else {
        setToolbarHost(null);
      }

      if (list) {
        let host = list.querySelector<HTMLElement>(':scope > [data-diagnostics-header-host="true"]');
        if (!host) {
          host = document.createElement("div");
          host.dataset.diagnosticsHeaderHost = "true";
          list.prepend(host);
        }
        setHeaderHost((current) => current === host ? current : host);
      } else {
        setHeaderHost(null);
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(ensureHosts);
    };

    ensureHosts();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelectorAll('[data-diagnostics-density-host="true"], [data-diagnostics-header-host="true"]').forEach((node) => node.remove());
    };
  }, []);

  return <>
    {toolbarHost ? createPortal(
      <div className="diagnosticsDensityControl" aria-label="Щільність списку діагностик">
        <span>Вигляд:</span>
        <button type="button" className={density === "compact" ? "isActive" : ""} aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>Компактно</button>
        <button type="button" className={density === "detailed" ? "isActive" : ""} aria-pressed={density === "detailed"} onClick={() => setDensity("detailed")}>Детально</button>
      </div>,
      toolbarHost,
    ) : null}
    {headerHost && density === "compact" ? createPortal(
      <div className="diagnosticsCompactHeader" role="row">
        <span role="columnheader">Статус</span>
        <span role="columnheader">Автомобіль / ДК</span>
        <span role="columnheader">Клієнт</span>
        <span role="columnheader">Механік</span>
        <span role="columnheader">Прогрес</span>
        <span role="columnheader">Візит</span>
        <span role="columnheader">Дії</span>
      </div>,
      headerHost,
    ) : null}
  </>;
}
