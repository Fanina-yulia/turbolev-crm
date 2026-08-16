"use client";

import { useEffect } from "react";
import { isStandardUkrainianPlate, normalizeUkrainianPlate } from "./ukrainian-license-plate";

const CANDIDATE_SELECTOR = "span,strong,b,small,p,em,i";
const SKIP_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true'],[data-ua-license-plate='true']";
const LABELED_PREFIX = /^(?:держзнак|держномер|державний\s+номер|номер\s+авто)\s*[:№-]?$/iu;
const TRAILING_PLATE = /([A-ZА-ЯІЇЄ]{2}[\s-]*\d{4}[\s-]*[A-ZА-ЯІЇЄ]{2})\s*$/u;

type PlateParts = { plate: string; prefix: string };

function extractPlate(text: string): PlateParts | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (isStandardUkrainianPlate(trimmed)) return { plate: normalizeUkrainianPlate(trimmed), prefix: "" };

  const match = trimmed.match(TRAILING_PLATE);
  if (!match || match.index == null || !isStandardUkrainianPlate(match[1])) return null;
  const rawPrefix = trimmed.slice(0, match.index).trim();
  if (rawPrefix.length > 34) return null;
  return {
    plate: normalizeUkrainianPlate(match[1]),
    prefix: LABELED_PREFIX.test(rawPrefix) ? "" : rawPrefix,
  };
}

function clearDecoration(element: HTMLElement) {
  if (!element.classList.contains("uaLicensePlateAuto")) return;
  element.classList.remove("uaLicensePlate", "uaLicensePlateAuto");
  delete element.dataset.uaLicensePlate;
  delete element.dataset.plateText;
  delete element.dataset.platePrefix;
  delete element.dataset.plateSize;
}

function decorateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.matches(SKIP_SELECTOR) || element.closest("input,textarea,select,option,script,style,[contenteditable='true']")) return;
  if (element.children.length) return;

  const parts = extractPlate(element.textContent || "");
  if (!parts) return clearDecoration(element);

  element.classList.add("uaLicensePlate", "uaLicensePlateAuto");
  element.dataset.uaLicensePlate = "true";
  element.dataset.plateText = parts.plate;
  element.dataset.platePrefix = parts.prefix;
  element.dataset.plateSize = "sm";
  if (!element.getAttribute("aria-label")) element.setAttribute("aria-label", `${parts.prefix ? `${parts.prefix} ` : ""}Державний номер ${parts.plate}`);
}

function decorateTree(root: ParentNode) {
  if (root instanceof Element && root.matches(CANDIDATE_SELECTOR)) decorateElement(root);
  root.querySelectorAll(CANDIDATE_SELECTOR).forEach(decorateElement);
}

export function UkrainianLicensePlateBridge() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => decorateTree(document.body));
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
