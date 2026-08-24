"use client";

import { useEffect, useState } from "react";
import { readCrmRoute } from "./crm-route";

type ClientContext = { id: string; name: string | null; phone: string };
type ClientResponse = ClientContext | { client?: ClientContext | null } | null;

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

function clientFromResponse(body: ClientResponse): ClientContext | null {
  if (!body) return null;
  if ("client" in body) return body.client?.id ? body.client : null;
  return body.id ? body : null;
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
          const body = await response.json().catch(() => null) as ClientResponse;
          if (!response.ok) return setClient(null);
          setClient(clientFromResponse(body));
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
