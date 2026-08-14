"use client";

import { useEffect } from "react";

export function CrmDataBridge() {
  useEffect(() => {
    const onNewRequest = async (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail) return;
      try {
        const response = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detail),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не вдалося зберегти заявку в CRM");
        window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "intake", ...data } }));
      } catch (error) {
        console.error("CRM intake sync failed", error);
        window.dispatchEvent(new CustomEvent("turbolev:data-error", { detail: { entity: "intake", message: error instanceof Error ? error.message : "Помилка синхронізації" } }));
      }
    };
    window.addEventListener("turbolev:new-request", onNewRequest);
    return () => window.removeEventListener("turbolev:new-request", onNewRequest);
  }, []);

  return null;
}
