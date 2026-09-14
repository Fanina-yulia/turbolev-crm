"use client";

import { useEffect } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";

const PLANNER_DIALOG = '[role="dialog"][aria-label="Інформація про запис"]';

function closeAppointment() {
  const route = readCrmRoute();
  if (!route.appointmentId) return;
  const { appointmentId: _appointmentId, ...rest } = route;
  navigateCrm("Планувальник", rest);
}

export function PlannerModalCloseBehavior() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (!document.querySelector(PLANNER_DIALOG)) return;
      closeAppointment();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
