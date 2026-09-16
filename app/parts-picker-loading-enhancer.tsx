"use client";

import { useEffect } from "react";

const OFFER_AREA_SELECTOR = '[class*="parts-selection-workspace-v4_offerArea__"]';
const EMPTY_STATE_SELECTOR = '[class*="parts-selection-workspace-v4_empty__"]';
const LOADING_COPY = "Шукаю BM Parts, UniTrade";

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
    syncPartsSearchLoadingState();

    const observer = new MutationObserver(() => syncPartsSearchLoadingState());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
