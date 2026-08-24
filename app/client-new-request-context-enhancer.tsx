"use client";

import { useEffect, useState } from "react";
import { readCrmRoute } from "./crm-route";

type ClientContext = { id: string; name: string | null; phone: string };

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

export function ClientNewRequestContextEnhancer() {
  const [client, setClient] = useState<ClientContext | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    const sync = () => {
      const clientId = readCrmRoute().clientId;
      if (!clientId) return setClient(null);
      controller?.abort();
      controller = new AbortController();
      void fetch(`/api/clients?id=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { client?: ClientContext } | ClientContext | null;
          if (!response.ok || !body) return setClient(null);
          const next = "client" in body ? body.client : body;
          setClient(next?.id ? next : null);
        })
        .catch((error) => { if ((error as Error).name !== "AbortError") setClient(null); });
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => { controller?.abort(); window.removeEventListener("popstate", sync); };
  }, []);

  useEffect(() => {
    if (!client) return;
    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!button || text(button) !== "+ Нова заявка" || !button.closest("aside")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail: {
        source: "CLIENTS",
        clientId: client.id,
        name: client.name || "",
        phone: client.phone,
      } }));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [client]);

  return null;
}
