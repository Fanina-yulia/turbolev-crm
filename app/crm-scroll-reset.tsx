"use client";

import { useEffect } from "react";

function resetCrmScroll() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;

    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (workspace) {
      workspace.scrollTop = 0;
      workspace.scrollLeft = 0;
    }
  });
}

export function CrmScrollReset() {
  useEffect(() => {
    const onNavigation = () => resetCrmScroll();
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".sidebar nav button")) resetCrmScroll();
    };

    const nativePushState = window.history.pushState.bind(window.history);
    const nativeReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = (...args) => {
      nativePushState(...args);
      resetCrmScroll();
    };
    window.history.replaceState = (...args) => {
      nativeReplaceState(...args);
      resetCrmScroll();
    };

    window.addEventListener("turbolev:navigate", onNavigation as EventListener);
    window.addEventListener("turbolev:settings-tab", onNavigation as EventListener);
    window.addEventListener("popstate", onNavigation);
    document.addEventListener("click", onDocumentClick, true);

    resetCrmScroll();

    return () => {
      window.history.pushState = nativePushState;
      window.history.replaceState = nativeReplaceState;
      window.removeEventListener("turbolev:navigate", onNavigation as EventListener);
      window.removeEventListener("turbolev:settings-tab", onNavigation as EventListener);
      window.removeEventListener("popstate", onNavigation);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, []);

  return null;
}
