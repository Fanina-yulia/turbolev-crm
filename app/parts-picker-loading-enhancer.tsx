"use client";

import { useEffect } from "react";

const PICKER_SELECTOR = '[class*="parts-selection-workspace-v4_picker__"]';
const PICKER_HEADER_SELECTOR = '[class*="parts-selection-workspace-v4_pickerHeader__"]';
const SEARCH_BAR_SELECTOR = '[class*="parts-selection-workspace-v4_searchBar__"]';
const TOOLBAR_SELECTOR = '[class*="parts-selection-workspace-v4_resultToolbar__"]';
const MANUAL_CONFIRM_SELECTOR = '[class*="parts-selection-workspace-v4_manualConfirm__"]';
const OFFER_AREA_SELECTOR = '[class*="parts-selection-workspace-v4_offerArea__"]';
const EMPTY_STATE_SELECTOR = '[class*="parts-selection-workspace-v4_empty__"]';
const LOADING_COPY = "Шукаю BM Parts, UniTrade";
const STYLE_ID = "turbolev-parts-picker-structure-v2";

const STRUCTURE_CSS = `
@media (min-width:1181px){
  [data-parts-picker-structure-v2="true"]{
    grid-template-columns:minmax(430px,1.45fr) minmax(300px,.82fr) minmax(420px,1.08fr)!important;
    grid-template-rows:auto auto auto minmax(0,1fr) auto auto!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_pickerHeader__"]{
    grid-column:1/-1!important;
    grid-row:1!important;
    align-items:center!important;
    padding:7px 12px!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_pickerHeader__"] > div:first-child{
    min-width:0!important;
    flex:1 1 auto!important;
  }

  [data-parts-picker-vehicle="true"]{
    display:grid!important;
    grid-template-columns:auto auto!important;
    align-items:center!important;
    gap:7px!important;
    margin-left:auto!important;
    margin-right:4px!important;
    min-width:0!important;
  }

  [data-parts-picker-vehicle="true"] > span{
    color:var(--muted)!important;
    font-size:10px!important;
    font-weight:700!important;
  }

  [data-parts-picker-vehicle="true"] > b{
    display:flex!important;
    align-items:center!important;
    min-height:30px!important;
    padding:0 8px!important;
    border:1px solid var(--line)!important;
    border-radius:7px!important;
    background:var(--panel-2)!important;
    color:var(--text)!important;
    font-size:12px!important;
    white-space:nowrap!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_searchBar__"]{
    grid-column:1!important;
    grid-row:2!important;
    grid-template-columns:minmax(0,1fr)!important;
    gap:0!important;
    padding:5px 8px 6px 12px!important;
    border-right:1px solid var(--line)!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_searchBar__"] > label:nth-child(2){
    display:none!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_resultToolbar__"]{
    grid-column:2!important;
    grid-row:2!important;
    display:grid!important;
    grid-template-columns:minmax(190px,1fr) auto!important;
    align-content:end!important;
    align-items:center!important;
    gap:8px!important;
    min-height:50px!important;
    padding:5px 8px 6px!important;
    border-right:1px solid var(--line)!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_resultToolbar__"] select{
    width:100%!important;
    max-width:none!important;
    min-width:0!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_resultToolbar__"] strong{
    margin:0!important;
    white-space:nowrap!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_resultToolbar__"] button{
    display:none!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_manualConfirm__"]{
    grid-column:3!important;
    grid-row:2!important;
    align-self:stretch!important;
    justify-self:stretch!important;
    width:auto!important;
    min-height:50px!important;
    padding:5px 12px!important;
    border-bottom:1px solid var(--line)!important;
    background:color-mix(in srgb,var(--orange) 6%,var(--panel))!important;
    white-space:normal!important;
  }

  [data-parts-picker-structure-v2="true"]:not(:has([class*="parts-selection-workspace-v4_manualConfirm__"])) [class*="parts-selection-workspace-v4_resultToolbar__"]{
    grid-column:2/-1!important;
    border-right:0!important;
  }

  [data-parts-column-header="true"]{
    grid-column:1/-1!important;
    grid-row:3!important;
    display:grid!important;
    grid-template-columns:minmax(250px,2fr) minmax(105px,.72fr) 78px minmax(120px,.82fr) minmax(135px,1fr) minmax(112px,.8fr) 106px!important;
    gap:6px!important;
    align-items:center!important;
    min-height:30px!important;
    padding:3px 12px!important;
    border-bottom:1px solid var(--line)!important;
    background:var(--panel-2)!important;
    color:var(--muted)!important;
    font-size:10px!important;
    font-weight:850!important;
  }

  [data-parts-column-header="true"] > span,
  [data-parts-column-header="true"] > button{
    min-width:0!important;
    overflow:hidden!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important;
    text-align:left!important;
  }

  [data-parts-column-header="true"] > button{
    height:24px!important;
    padding:0!important;
    border:0!important;
    background:transparent!important;
    color:inherit!important;
    font:inherit!important;
    cursor:pointer!important;
  }

  [data-parts-column-header="true"] > button:hover{
    color:var(--orange)!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_offerArea__"]{
    grid-column:1/-1!important;
    grid-row:4!important;
    padding:0 0 5px!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_offerGroup__"] h3{
    padding:5px 12px 4px!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_offerRow__"]{
    grid-template-columns:minmax(250px,2fr) minmax(105px,.72fr) 78px minmax(120px,.82fr) minmax(135px,1fr) minmax(112px,.8fr) 106px!important;
    gap:6px!important;
    padding:4px 12px!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_providerErrors__"]{
    grid-column:1/-1!important;
    grid-row:5!important;
  }

  [data-parts-picker-structure-v2="true"] [class*="parts-selection-workspace-v4_pickerFooter__"]{
    grid-column:1/-1!important;
    grid-row:6!important;
  }
}
`;

type ColumnDefinition = {
  label: string;
  sortPrefix?: "Наявність" | "Бренд" | "Ціна";
};

const COLUMNS: ColumnDefinition[] = [
  { label: "Деталь" },
  { label: "Наявність", sortPrefix: "Наявність" },
  { label: "Постачальник" },
  { label: "Бренд / артикул", sortPrefix: "Бренд" },
  { label: "Сумісність" },
  { label: "Закупка / продаж", sortPrefix: "Ціна" },
  { label: "Дія" },
];

function ensureStructureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STRUCTURE_CSS;
  document.head.appendChild(style);
}

function findSortButton(toolbar: HTMLElement | null, prefix: ColumnDefinition["sortPrefix"]) {
  if (!toolbar || !prefix) return null;
  return Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")).find((button) => (button.textContent || "").trim().startsWith(prefix)) || null;
}

function sortGlyph(button: HTMLButtonElement | null) {
  const text = button?.textContent || "";
  if (text.includes("↑")) return "↑";
  if (text.includes("↓")) return "↓";
  return "↕";
}

function syncVehicleBadge(picker: HTMLElement) {
  const header = picker.querySelector<HTMLElement>(PICKER_HEADER_SELECTOR);
  const searchBar = picker.querySelector<HTMLElement>(SEARCH_BAR_SELECTOR);
  const source = searchBar?.querySelector<HTMLElement>("label:nth-child(2) > b") || null;
  if (!header || !source) return;

  const plateText = (source.textContent || "").trim();
  let badge = header.querySelector<HTMLElement>('[data-parts-picker-vehicle="true"]');
  if (!badge) {
    badge = document.createElement("div");
    badge.dataset.partsPickerVehicle = "true";
    const label = document.createElement("span");
    label.textContent = "Автомобіль";
    const value = document.createElement("b");
    value.dataset.partsPickerVehicleValue = "true";
    badge.append(label, value);
    const closeButton = header.querySelector(":scope > button");
    header.insertBefore(badge, closeButton || null);
  }

  const value = badge.querySelector<HTMLElement>('[data-parts-picker-vehicle-value="true"]');
  if (value && value.textContent !== plateText) value.textContent = plateText;
}

function syncColumnHeader(picker: HTMLElement) {
  const toolbar = picker.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
  const offerArea = picker.querySelector<HTMLElement>(OFFER_AREA_SELECTOR);
  if (!toolbar || !offerArea) return;

  let header = picker.querySelector<HTMLElement>('[data-parts-column-header="true"]');
  if (!header) {
    header = document.createElement("div");
    header.dataset.partsColumnHeader = "true";
    for (const definition of COLUMNS) {
      const cell = definition.sortPrefix ? document.createElement("button") : document.createElement("span");
      if (cell instanceof HTMLButtonElement) {
        cell.type = "button";
        cell.dataset.partsSortPrefix = definition.sortPrefix || "";
        cell.addEventListener("click", () => {
          const currentPicker = cell.closest<HTMLElement>(PICKER_SELECTOR);
          const currentToolbar = currentPicker?.querySelector<HTMLElement>(TOOLBAR_SELECTOR) || null;
          findSortButton(currentToolbar, definition.sortPrefix)?.click();
        });
      }
      header.appendChild(cell);
    }
    picker.insertBefore(header, offerArea);
  }

  Array.from(header.children).forEach((cell, index) => {
    const definition = COLUMNS[index];
    if (!definition) return;
    const source = findSortButton(toolbar, definition.sortPrefix);
    const nextText = definition.sortPrefix ? `${definition.label} ${sortGlyph(source)}` : definition.label;
    if (cell.textContent !== nextText) cell.textContent = nextText;
  });
}

function syncPartsPickerStructure() {
  document.querySelectorAll<HTMLElement>(PICKER_SELECTOR).forEach((picker) => {
    picker.dataset.partsPickerStructureV2 = "true";
    syncVehicleBadge(picker);
    syncColumnHeader(picker);
  });
}

function syncPartsSearchLoadingState() {
  const emptyStates = document.querySelectorAll<HTMLElement>(`${OFFER_AREA_SELECTOR} > ${EMPTY_STATE_SELECTOR}`);

  emptyStates.forEach((node) => {
    const isSupplierSearchLoading = (node.textContent || "").includes(LOADING_COPY);

    if (isSupplierSearchLoading) {
      node.dataset.partsSearchLoading = "true";
      node.setAttribute("aria-busy", "true");
      node.setAttribute("role", "status");
      return;
    }

    delete node.dataset.partsSearchLoading;
    node.removeAttribute("aria-busy");
  });
}

export function PartsPickerLoadingEnhancer() {
  useEffect(() => {
    ensureStructureStyles();
    syncPartsPickerStructure();
    syncPartsSearchLoadingState();

    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncPartsPickerStructure();
        syncPartsSearchLoadingState();
      });
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
