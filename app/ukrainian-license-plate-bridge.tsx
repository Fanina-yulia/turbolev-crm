"use client";

import { useEffect } from "react";
import { parseUkrainianPlateDisplay } from "./ukrainian-license-plate";

const CANDIDATE_SELECTOR = "span,strong,b,small,p,em,i,div,td,th";
const SKIP_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true']";
const SKIP_ANCESTOR_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true'],.uaPlate";

function clearDecoration(element: HTMLElement) {
  if (!element.classList.contains("uaLicensePlateAuto")) return;
  element.classList.remove("uaLicensePlate", "uaLicensePlateAuto");
  delete element.dataset.uaLicensePlate;
  delete element.dataset.plateText;
  delete element.dataset.platePrefix;
  delete element.dataset.plateSuffix;
  delete element.dataset.platePlacement;
  delete element.dataset.plateSize;
  if (element.dataset.plateAria === "auto") element.removeAttribute("aria-label");
  delete element.dataset.plateAria;
}

function decorateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.matches(SKIP_SELECTOR) || element.closest(SKIP_ANCESTOR_SELECTOR)) return;
  if (element.classList.contains("uaLicensePlate") && !element.classList.contains("uaLicensePlateAuto")) return;

  const childElements = Array.from(element.children);
  const simpleLabelChild = childElements.length === 1 && ["B", "STRONG"].includes(childElements[0].tagName);
  if (childElements.length && !simpleLabelChild) return clearDecoration(element);

  const parts = parseUkrainianPlateDisplay(element.textContent || "");
  if (!parts) return clearDecoration(element);

  element.classList.add("uaLicensePlate", "uaLicensePlateAuto");
  element.dataset.uaLicensePlate = "true";
  element.dataset.plateText = parts.plate;
  element.dataset.platePrefix = parts.prefix;
  element.dataset.plateSuffix = parts.suffix;
  element.dataset.platePlacement = parts.placement;
  element.dataset.plateSize = "sm";
  const context = parts.prefix || parts.suffix;
  const label = `${context ? `${context} ` : ""}Державний номер ${parts.plate}`;
  if (!element.getAttribute("aria-label") || element.dataset.plateAria === "auto") {
    element.setAttribute("aria-label", label);
    element.dataset.plateAria = "auto";
  }
}

function decorateTree(root: ParentNode) {
  if (root instanceof Element && root.matches(CANDIDATE_SELECTOR)) decorateElement(root);
  root.querySelectorAll(CANDIDATE_SELECTOR).forEach(decorateElement);
}

export function UkrainianLicensePlateBridge() {
  useEffect(() => {
    decorateTree(document.body);
    const observer = new MutationObserver((records) => {
      const roots = new Set<ParentNode>();
      for (const record of records) {
        if (record.type === "characterData") {
          if (record.target.parentElement) roots.add(record.target.parentElement);
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof DocumentFragment) roots.add(node);
          else if (node.parentElement) roots.add(node.parentElement);
        });
      }
      roots.forEach(decorateTree);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
