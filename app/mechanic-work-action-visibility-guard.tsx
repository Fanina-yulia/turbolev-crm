"use client";

import { useEffect } from "react";

const ACTION_LABELS = [
  "Додати фото / виявлений дефект",
  "Запросити запчастину",
  "Поставити питання менеджеру",
] as const;

const PRE_START_STATUSES = new Set([
  "Очікує погодження",
  "Готово до роботи",
  "Заплановано",
  "Скасовано",
]);

const STARTED_STATUSES = new Set([
  "В роботі",
  "Пауза",
  "СТОП — потребує уваги",
  "Доопрацювання",
  "Очікує запчастини",
  "Завершено",
  "Виконано",
]);

function text(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function findActionList(section: HTMLElement) {
  return Array.from(section.querySelectorAll<HTMLElement>(":scope > div")).find((candidate) => {
    const labels = Array.from(candidate.querySelectorAll("button")).map((button) => text(button));
    return ACTION_LABELS.every((label) => labels.some((value) => value.includes(label)));
  }) || null;
}

function selectedStatus(main: HTMLElement) {
  const summary = main.querySelector<HTMLElement>(":scope > section:first-of-type");
  if (!summary) return "";
  const known = new Set([...PRE_START_STATUSES, ...STARTED_STATUSES]);
  return Array.from(summary.querySelectorAll("span"))
    .map((node) => text(node))
    .find((value) => known.has(value)) || "";
}

function hasStartedControls(section: HTMLElement) {
  const buttons = Array.from(section.querySelectorAll("button")).map((button) => text(button));
  return buttons.some((value) => value.includes("Пауза") || value.includes("Продовжити") || value.includes("Завершити ремонт"));
}

function syncActionVisibility(root: HTMLElement) {
  const heading = Array.from(root.querySelectorAll("h2")).find((node) => text(node) === "Керування роботою");
  const section = heading?.closest<HTMLElement>("section");
  const main = section?.closest<HTMLElement>("main");
  if (!section || !main) return;

  const actionList = findActionList(section);
  if (!actionList) return;

  const status = selectedStatus(main);
  const workStarted = STARTED_STATUSES.has(status) || (!PRE_START_STATUSES.has(status) && hasStartedControls(section));
  const hidden = !workStarted;
  const ariaHidden = hidden ? "true" : "false";
  const startedValue = workStarted ? "true" : "false";

  if (actionList.hidden !== hidden) actionList.hidden = hidden;
  if (actionList.getAttribute("aria-hidden") !== ariaHidden) actionList.setAttribute("aria-hidden", ariaHidden);
  if (actionList.dataset.mechanicWorkStarted !== startedValue) actionList.dataset.mechanicWorkStarted = startedValue;
}

export function MechanicWorkActionVisibilityGuard() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
    if (!root) return;

    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => syncActionVisibility(root));
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
