"use client";

import { useEffect } from "react";

const VEHICLE_LIST_STYLE = `
[data-mechanic-vehicle-row="true"] {
  min-height:64px!important;
  align-items:center!important;
}
[data-mechanic-vehicle-row="true"] > div:first-child {
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto!important;
  gap:10px 14px!important;
  align-items:center!important;
  width:100%!important;
}
[data-mechanic-vehicle-row="true"] > div:first-child > strong,
[data-mechanic-vehicle-row="true"] > div:first-child > h3 {
  margin:0!important;
  min-width:0!important;
}
[data-mechanic-vehicle-row="true"] > div:first-child > small:first-of-type,
[data-mechanic-vehicle-row="true"] > div:first-child > b:first-of-type {
  margin:0!important;
  justify-self:end!important;
}
`;

function textOf(node: Element | null) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function canonicalPlate(value: string) {
  const lookalikes: Record<string, string> = {
    А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H",
    О: "O", Р: "P", С: "C", Т: "T", Х: "X",
  };
  return value
    .toUpperCase()
    .replace(/[АВЕІКМНОРСТХ]/g, (letter) => lookalikes[letter] || letter)
    .replace(/[^A-Z0-9]/g, "");
}

function vehicleKey(vehicle: string, plate: string) {
  const normalizedPlate = canonicalPlate(plate);
  if (normalizedPlate && !/^(БЕЗДЕРЖНОМЕРА|БЕЗНОМЕРА)$/.test(normalizedPlate)) return `plate:${normalizedPlate}`;
  return `vehicle:${vehicle.toUpperCase().replace(/\s+/g, " ").trim()}`;
}

function showOnlyVehicleIdentity(button: HTMLButtonElement, identityContainer: Element) {
  button.dataset.mechanicVehicleRow = "true";
  button.setAttribute("aria-label", textOf(identityContainer));

  for (const child of Array.from(button.children)) {
    if (child === identityContainer) continue;
    (child as HTMLElement).hidden = true;
  }

  const smalls = Array.from(identityContainer.querySelectorAll<HTMLElement>("small"));
  smalls.forEach((small, index) => { small.hidden = index > 0; });
}

function resetManagedRows(scope: Element) {
  for (const row of Array.from(scope.querySelectorAll<HTMLButtonElement>('[data-mechanic-vehicle-row="true"]'))) {
    row.hidden = false;
    delete row.dataset.mechanicVehicleDuplicate;
  }
}

function decorateHomeVehicleList(root: HTMLElement) {
  const heading = Array.from(root.querySelectorAll("h2")).find((node) => textOf(node) === "Мої роботи" || textOf(node) === "Мої автомобілі");
  const section = heading?.closest("section");
  if (!heading || !section) return;

  if (textOf(heading) !== "Мої автомобілі") heading.textContent = "Мої автомобілі";
  const subtitle = heading.parentElement?.querySelector("p");
  if (subtitle && textOf(subtitle) !== "Автомобілі у вашій роботі") subtitle.textContent = "Автомобілі у вашій роботі";

  const allButton = Array.from(section.querySelectorAll<HTMLButtonElement>("button")).find((button) => /^Всі(?: авто)? ›$/.test(textOf(button)));
  if (allButton && textOf(allButton) !== "Всі авто ›") allButton.textContent = "Всі авто ›";

  resetManagedRows(section);
  const rows = Array.from(section.querySelectorAll<HTMLButtonElement>("button")).filter((button) => {
    if (button === allButton) return false;
    return Boolean(button.querySelector("strong") && button.querySelector("small"));
  });

  const seen = new Set<string>();
  for (const row of rows) {
    const identity = row.querySelector(":scope > div:first-child");
    const vehicle = textOf(identity?.querySelector("strong") || null);
    const plate = textOf(identity?.querySelector("small") || null);
    if (!identity || !vehicle) continue;

    const key = vehicleKey(vehicle, plate);
    if (seen.has(key)) {
      row.dataset.mechanicVehicleRow = "true";
      row.dataset.mechanicVehicleDuplicate = "true";
      row.hidden = true;
      continue;
    }
    seen.add(key);
    showOnlyVehicleIdentity(row, identity);
  }
}

function decorateWorksVehicleList(root: HTMLElement) {
  const filterBar = root.querySelector('[aria-label="Фільтр робіт"]');
  const main = filterBar?.closest("main");
  if (!filterBar || !main) return;

  const topBarTitle = Array.from(root.querySelectorAll("header strong")).find((node) => textOf(node) === "Мої роботи" || textOf(node) === "Мої автомобілі");
  if (topBarTitle && textOf(topBarTitle) !== "Мої автомобілі") topBarTitle.textContent = "Мої автомобілі";

  const pageTitle = main.querySelector("h1");
  if (pageTitle && textOf(pageTitle) === "Мої роботи") {
    pageTitle.textContent = "Мої автомобілі";
    const description = pageTitle.parentElement?.querySelector("p");
    if (description) description.textContent = "Автомобілі, закріплені за вами.";
  }

  resetManagedRows(main);
  const rows = Array.from(main.querySelectorAll<HTMLButtonElement>("button")).filter((button) => Boolean(button.querySelector(":scope > div:first-child > h3")));
  const seen = new Set<string>();

  for (const row of rows) {
    const identity = row.querySelector(":scope > div:first-child");
    const vehicle = textOf(identity?.querySelector("h3") || null);
    const plate = textOf(identity?.querySelector("b") || null);
    if (!identity || !vehicle) continue;

    const key = vehicleKey(vehicle, plate);
    if (seen.has(key)) {
      row.dataset.mechanicVehicleRow = "true";
      row.dataset.mechanicVehicleDuplicate = "true";
      row.hidden = true;
      continue;
    }
    seen.add(key);
    showOnlyVehicleIdentity(row, identity);
  }
}

function decorate(root: HTMLElement) {
  decorateHomeVehicleList(root);
  decorateWorksVehicleList(root);
}

/**
 * Presentation bridge for the mechanic cabinet.
 *
 * The canonical cabinet still owns workflow and navigation. This layer only
 * converts task-line feeds into a vehicle-first list: one visible row per car.
 * Clicking the retained vehicle row keeps the existing handler, which opens the
 * representative work item; the work detail then shows the operations for it.
 */
export function MechanicVehicleListBridge() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
        if (root) decorate(root);
      });
    };

    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    run();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <style dangerouslySetInnerHTML={{ __html: VEHICLE_LIST_STYLE }} />;
}
