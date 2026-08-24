"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCommunicationConversations, type CommunicationInquiry } from "@/src/domain/communications-inbox";
import { readCrmRoute } from "./crm-route";

function setNativeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function text(value: Element | null | undefined) {
  return String(value?.textContent || "").replace(/\s+/g, " ").trim();
}

export function CommunicationsDeeplinkEnhancer() {
  const [items, setItems] = useState<CommunicationInquiry[]>([]);
  const conversations = useMemo(() => buildCommunicationConversations(items), [items]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const route = readCrmRoute();
      if (!route.inquiryId) return;
      try {
        const response = await fetch("/api/communications", { cache: "no-store" });
        const body = await response.json().catch(() => null) as { items?: CommunicationInquiry[] } | null;
        if (active && response.ok && Array.isArray(body?.items)) setItems(body!.items!);
      } catch {
        if (active) setItems([]);
      }
    };
    void load();
    const onRoute = () => void load();
    window.addEventListener("popstate", onRoute);
    return () => { active = false; window.removeEventListener("popstate", onRoute); };
  }, []);

  useEffect(() => {
    const route = readCrmRoute();
    const inquiryId = route.inquiryId;
    if (!inquiryId || !conversations.length) return;
    const conversation = conversations.find((item) => item.inquiryIds.includes(inquiryId));
    if (!conversation) return;

    let attempts = 0;
    let timer = 0;
    const focus = () => {
      attempts += 1;
      const heading = Array.from(document.querySelectorAll("h1")).find((item) => text(item) === "Комунікації");
      if (!heading) {
        if (attempts < 30) timer = window.setTimeout(focus, 100);
        return;
      }

      const inboxButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => text(button) === "Inbox");
      if (inboxButton) inboxButton.click();

      if (conversation.lifecycleState === "SPAM") {
        const spamButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".communicationsLifecycleFilters button")).find((button) => text(button).startsWith("Спам"));
        if (spamButton) spamButton.click();
      } else {
        const allButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => text(button).startsWith("Усі") && button.closest("nav"));
        if (allButton) allButton.click();
      }

      const query = conversation.phone || conversation.handle || conversation.displayName;
      const search = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find((input) => input.placeholder?.startsWith("Пошук: клієнт"));
      if (search && query) setNativeInput(search, query);

      timer = window.setTimeout(() => {
        const exact = document.querySelector<HTMLButtonElement>(`button[data-communication-conversation-key="${CSS.escape(conversation.key)}"]`);
        const fallback = Array.from(document.querySelectorAll<HTMLButtonElement>("aside button")).find((button) => {
          const rowText = text(button).toLocaleLowerCase("uk-UA");
          return Boolean(
            (conversation.phone && rowText.includes(conversation.phone.toLocaleLowerCase("uk-UA")))
            || (conversation.handle && rowText.includes(conversation.handle.toLocaleLowerCase("uk-UA")))
            || (conversation.displayName && rowText.includes(conversation.displayName.toLocaleLowerCase("uk-UA")))
          );
        });
        const target = exact || fallback || null;
        if (!target) {
          if (attempts < 30) timer = window.setTimeout(focus, 120);
          return;
        }
        target.click();
        target.dataset.communicationDeepLinked = "1";
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        window.setTimeout(() => { delete target.dataset.communicationDeepLinked; }, 1800);
        if (search) window.setTimeout(() => setNativeInput(search, ""), 120);
      }, 80);
    };

    focus();
    return () => window.clearTimeout(timer);
  }, [conversations]);

  return <style jsx global>{`
    button[data-communication-deep-linked="1"]{outline:2px solid var(--orange);outline-offset:-2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--orange) 16%,transparent)!important}
  `}</style>;
}
