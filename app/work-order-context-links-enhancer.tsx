"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { navigateCrm, readCrmRoute } from "./crm-route";

type WorkOrderContext = {
  id: string;
  diagnosticRequest: { id: string };
  appointment: { id: string } | null;
};

export function WorkOrderContextLinksEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [context, setContext] = useState<WorkOrderContext | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    const sync = () => {
      const url = new URL(window.location.href);
      const route = readCrmRoute();
      if (url.searchParams.get("section") !== "work-orders" || !route.workOrderId) {
        setContext(null);
        return;
      }
      controller?.abort();
      controller = new AbortController();
      void fetch(`/api/work-orders/${encodeURIComponent(route.workOrderId)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { ok?: boolean; workOrder?: WorkOrderContext } | null;
          if (response.ok && body?.ok && body.workOrder) setContext(body.workOrder);
          else setContext(null);
        })
        .catch((error) => { if ((error as Error).name !== "AbortError") setContext(null); });
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:data-changed", sync);
    return () => {
      controller?.abort();
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:data-changed", sync);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const resolve = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!context) return setHost(null);
        const tabs = document.querySelector<HTMLElement>('nav[aria-label="Розділи замовлення-наряду"]');
        if (!tabs) return setHost(null);
        const parent = tabs.parentElement;
        if (!parent) return setHost(null);
        let next = parent.querySelector<HTMLElement>(":scope > [data-work-order-context-links]");
        if (!next) {
          next = document.createElement("div");
          next.dataset.workOrderContextLinks = "1";
          tabs.insertAdjacentElement("afterend", next);
        }
        setHost(next);
      });
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [context]);

  if (!host || !context) return null;
  return createPortal(<div className="workOrderContextLinks">
    <span>Пов’язані етапи:</span>
    <button type="button" onClick={() => navigateCrm("Діагностика", { diagnosticId: context.diagnosticRequest.id })}>Відкрити повну ДК</button>
    {context.appointment ? <button type="button" onClick={() => navigateCrm("Планувальник", { appointmentId: context.appointment!.id })}>Відкрити запис</button> : null}
    <style jsx global>{`
      .workOrderContextLinks{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:9px}.workOrderContextLinks>span{font-size:12px;color:var(--muted);font-weight:700}.workOrderContextLinks button{border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--text);padding:7px 10px;font-size:12px;font-weight:750;cursor:pointer}.workOrderContextLinks button:hover{border-color:var(--orange);color:var(--orange)}
    `}</style>
  </div>, host);
}
