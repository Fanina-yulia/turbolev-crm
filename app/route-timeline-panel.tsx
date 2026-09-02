"use client";

import { useEffect, useMemo, useState } from "react";
import { readCrmRoute, type CrmRouteParams } from "./crm-route";
import { ServiceTimeline } from "./service-timeline";
import styles from "./route-timeline-panel.module.css";

type Scope = { kind: "workOrder" | "client" | "vehicle"; id: string } | null;

function readScope(): { scope: Scope; autoOpen: boolean; section: string } {
  const route = readCrmRoute();
  const section = typeof window !== "undefined" ? new URL(window.location.href).searchParams.get("section") || "overview" : "overview";
  if (route.workOrderId) return { scope: { kind: "workOrder", id: route.workOrderId }, autoOpen: route.workOrderTab === "history", section };
  if (route.vehicleId) return { scope: { kind: "vehicle", id: route.vehicleId }, autoOpen: false, section };
  if (route.clientId) return { scope: { kind: "client", id: route.clientId }, autoOpen: false, section };
  return { scope: null, autoOpen: false, section };
}

function scopeKey(scope: Scope) {
  return scope ? `${scope.kind}:${scope.id}` : "none";
}

export function RouteTimelinePanel() {
  const [state, setState] = useState(() => readScope());
  const [open, setOpen] = useState(() => state.autoOpen);

  useEffect(() => {
    const sync = () => {
      const next = readScope();
      setState((current) => {
        const changed = scopeKey(current.scope) !== scopeKey(next.scope);
        if (next.autoOpen) setOpen(true);
        else if (changed) setOpen(false);
        return next;
      });
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const label = useMemo(() => state.scope?.kind === "workOrder" ? "Історія ЗН" : state.scope?.kind === "vehicle" ? "Історія авто" : "Історія клієнта", [state.scope?.kind]);
  if (!state.scope) return null;

  const timelineProps: CrmRouteParams = {};
  if (state.scope.kind === "workOrder") timelineProps.workOrderId = state.scope.id;
  if (state.scope.kind === "client") timelineProps.clientId = state.scope.id;
  if (state.scope.kind === "vehicle") timelineProps.vehicleId = state.scope.id;

  return <>
    {open && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <aside className={styles.panel} aria-label={label}>
        <header className={styles.header}>
          <div><small>ЄДИНА ХРОНОЛОГІЯ</small><h2>{label}</h2><span>Події сервісу зібрані з фактичних даних CRM, а не з ручних нотаток.</span></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Закрити хронологію">×</button>
        </header>
        <div className={styles.body}>
          <ServiceTimeline
            workOrderId={timelineProps.workOrderId}
            clientId={timelineProps.clientId}
            vehicleId={timelineProps.vehicleId}
            limit={state.scope.kind === "workOrder" ? 180 : 220}
          />
        </div>
      </aside>
    </div>}
  </>;
}
