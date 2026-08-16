"use client";

import { useEffect } from "react";
import { isStandardUkrainianPlate, normalizeUkrainianPlate } from "./ukrainian-license-plate";

const CANDIDATE_SELECTOR = "span,strong,b,small,p,div,td,th,a,button";
const SKIP_SELECTOR = "input,textarea,select,option,script,style,[contenteditable='true'],[data-ua-license-plate='true']";

function decorateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.matches(SKIP_SELECTOR) || element.closest("input,textarea,select,option,script,style,[contenteditable='true']")) return;
  if (element.children.length) return;
  const text = element.textContent?.trim() || "";
  if (!isStandardUkrainianPlate(text)) {
    if (element.classList.contains("uaLicensePlateAuto")) {
      element.classList.remove("uaLicensePlate", "uaLicensePlateAuto");
      delete element.dataset.uaLicensePlate;
      delete element.dataset.plateText;
      delete element.dataset.plateSize;
    }
    return;
  }
  element.classList.add("uaLicensePlate", "uaLicensePlateAuto");
  element.dataset.uaLicensePlate = "true";
  element.dataset.plateText = normalizeUkrainianPlate(text);
  element.dataset.plateSize = "sm";
  if (!element.getAttribute("aria-label")) element.setAttribute("aria-label", `Державний номер ${element.dataset.plateText}`);
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
