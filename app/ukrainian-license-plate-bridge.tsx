"use client";

import { useEffect } from "react";
import { isStandardUkrainianPlate, normalizeUkrainianPlate } from "./ukrainian-license-plate";

const CANDIDATE_SELECTOR = "span,strong,b,small,p,em,i,div,td,th";
const SKIP_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true'],[data-ua-license-plate='true']";
const SKIP_ANCESTOR_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true'],.uaPlate";
const LABELED_PREFIX = /^(?:держзнак|держномер|державний\s+номер|номер\s+авто)\s*[:№-]?$/iu;
const TRAILING_PLATE = /([A-ZА-ЯІЇЄ]{2}[\s-]*\d{4}[\s-]*[A-ZА-ЯІЇЄ]{2})\s*$/u;
const LEADING_PLATE = /^([A-ZА-ЯІЇЄ]{2}[\s-]*\d{4}[\s-]*[A-ZА-ЯІЇЄ]{2})(?:\s*[·|—–-]\s*)?(.+)$/u;

type PlateParts = { plate: string; prefix: string; suffix: string; placement: "leading" | "trailing" };

function extractPlate(text: string): PlateParts | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (isStandardUkrainianPlate(trimmed)) return { plate: normalizeUkrainianPlate(trimmed), prefix: "", suffix: "", placement: "trailing" };

  const trailing = trimmed.match(TRAILING_PLATE);
  if (trailing && trailing.index != null && isStandardUkrainianPlate(trailing[1])) {
    const rawPrefix = trimmed.slice(0, trailing.index).trim();
    if (rawPrefix.length <= 34) {
      return {
        plate: normalizeUkrainianPlate(trailing[1]),
        prefix: LABELED_PREFIX.test(rawPrefix) ? "" : rawPrefix,
        suffix: "",
        placement: "trailing",
      };
    }
  }

  const leading = trimmed.match(LEADING_PLATE);
  if (leading && isStandardUkrainianPlate(leading[1])) {
    const suffix = leading[2].trim();
    if (suffix.length <= 34) {
      return {
        plate: normalizeUkrainianPlate(leading[1]),
        prefix: "",
        suffix,
        placement: "leading",
      };
    }
  }
  return null;
}

function clearDecoration(element: HTMLElement) {
  if (!element.classList.contains("uaLicensePlateAuto")) return;
  element.classList.remove("uaLicensePlate", "uaLicensePlateAuto");
  delete element.dataset.uaLicensePlate;
  delete element.dataset.plateText;
  delete element.dataset.platePrefix;
  delete element.dataset.plateSuffix;
  delete element.dataset.platePlacement;
  delete element.dataset.plateSize;
}

function decorateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.matches(SKIP_SELECTOR) || element.closest(SKIP_ANCESTOR_SELECTOR)) return;
  const childElements = Array.from(element.children);
  const simpleLabelChild = childElements.length === 1 && ["B", "STRONG"].includes(childElements[0].tagName);
  if (childElements.length && !simpleLabelChild) return;

  const parts = extractPlate(element.textContent || "");
  if (!parts) return clearDecoration(element);

  element.classList.add("uaLicensePlate", "uaLicensePlateAuto");
  element.dataset.uaLicensePlate = "true";
  element.dataset.plateText = parts.plate;
  element.dataset.platePrefix = parts.prefix;
  element.dataset.plateSuffix = parts.suffix;
  element.dataset.platePlacement = parts.placement;
  element.dataset.plateSize = "sm";
  if (!element.getAttribute("aria-label")) {
    const context = parts.prefix || parts.suffix;
    element.setAttribute("aria-label", `${context ? `${context} ` : ""}Державний номер ${parts.plate}`);
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
