"use client";

import { useEffect, useState } from "react";

export function CrmDataBridge() {
  const [toast, setToast] = useState<{ tone:"ok"|"error"|"busy"; text:string } | null>(null);

  useEffect(() => {
    const onNewRequest = async (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail) return;
      if (detail.serverSaved === true) {
        setToast({ tone:"ok", text:"Заявку збережено в Neon і додано в Планувальник." });
        window.setTimeout(()=>setToast(null),3000);
        return;
      }
      setToast({ tone:"busy", text:"Зберігаю заявку в Neon…" });
      try {
        const response = await fetch("/api/intake", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(detail) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не вдалося зберегти заявку в CRM");
        setToast({ tone:"ok", text:data.appointment ? "Заявку збережено в Neon і додано в Планувальник." : "Заявку збережено в Neon." });
        window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail:{ entity:"intake", ...data } }));
        window.setTimeout(()=>setToast(null),3500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Помилка синхронізації";
        console.error("CRM intake sync failed", error);
        setToast({ tone:"error", text:`Заявка не потрапила в серверну CRM: ${message}` });
        window.dispatchEvent(new CustomEvent("turbolev:data-error", { detail:{ entity:"intake", message } }));
      }
    };
    window.addEventListener("turbolev:new-request", onNewRequest);
    return () => window.removeEventListener("turbolev:new-request", onNewRequest);
  }, []);

  return toast ? <div className={`crmSyncToast crmSyncToast-${toast.tone}`}>{toast.text}</div> : null;
}
