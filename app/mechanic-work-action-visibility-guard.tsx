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
  const actionButton = Array.from(section.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    ACTION_LABELS.some((label) => text(button).includes(label)),
  );
  const candidate = actionButton?.parentElement;
  if (!(candidate instanceof HTMLElement)) return null;

  const labels = Array.from(candidate.querySelectorAll("button")).map((button) => text(button));
  return ACTION_LABELS.every((label) => labels.some((value) => value.includes(label))) ? candidate : null;
}

function selectedStatus(main: HTMLElement) {
  const summary = main.querySelector<HTMLElement>(":scope > section:first-of-type");
  if (!summary) return "";
  const known = new Set([...PRE_START_STATUSES, ...STARTED_STATUSES]);
  return Array.from(summary.querySelectorAll("span"))
    .map((node) => text(node))
    .find((value) => known.has(value)) || "";
}

function hasButton(section: HTMLElement, label: string) {
  return Array.from(section.querySelectorAll("button")).some((button) => text(button).includes(label));
}

function hasStartedControls(section: HTMLElement) {
  return ["Пауза", "Продовжити", "Завершити ремонт"].some((label) => hasButton(section, label));
}

function syncActionVisibility(root: HTMLElement) {
  const heading = Array.from(root.querySelectorAll("h2")).find((node) => text(node) === "Керування роботою");
  const section = heading?.closest<HTMLElement>("section");
  const main = section?.closest<HTMLElement>("main");
  if (!section || !main) return;

  const actionList = findActionList(section);
  if (!actionList) return;

  const status = selectedStatus(main);
  const startButtonVisible = hasButton(section, "Почати роботу");
  const workStarted = !startButtonVisible && (STARTED_STATUSES.has(status) || hasStartedControls(section));
  const hidden = !workStarted;
  const display = hidden ? "none" : "";
  const ariaHidden = hidden ? "true" : "false";
  const startedValue = workStarted ? "true" : "false";

  if (actionList.hidden !== hidden) actionList.hidden = hidden;
  if (actionList.style.display !== display) actionList.style.display = display;
  if (actionList.getAttribute("aria-hidden") !== ariaHidden) actionList.setAttribute("aria-hidden", ariaHidden);
  if (actionList.dataset.mechanicWorkStarted !== startedValue) actionList.dataset.mechanicWorkStarted = startedValue;

  for (const button of actionList.querySelectorAll<HTMLButtonElement>("button")) {
    const nextTabIndex = hidden ? -1 : 0;
    if (button.tabIndex !== nextTabIndex) button.tabIndex = nextTabIndex;
    if (button.disabled !== hidden) button.disabled = hidden;
  }
}

export function MechanicWorkActionVisibilityGuard() {
  useEffect(() => {
    let frame = 0;
    let root: HTMLElement | null = null;
    let rootObserver: MutationObserver | null = null;
    let bootstrapObserver: MutationObserver | null = null;

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nextRoot = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
        if (!nextRoot) return;

        if (root !== nextRoot) {
          rootObserver?.disconnect();
          root = nextRoot;
          rootObserver = new MutationObserver(schedule);
          rootObserver.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class", "hidden", "aria-hidden"],
          });
        }

        syncActionVisibility(nextRoot);

        if (bootstrapObserver) {
          bootstrapObserver.disconnect();
          bootstrapObserver = null;
        }
      });
    };

    bootstrapObserver = new MutationObserver(schedule);
    bootstrapObserver.observe(document.body, { subtree: true, childList: true });
    schedule();

    return () => {
      bootstrapObserver?.disconnect();
      rootObserver?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
