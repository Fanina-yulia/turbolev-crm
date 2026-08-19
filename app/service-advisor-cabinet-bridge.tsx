"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./service-advisor-cabinet.module.css";

type Finding = {
  id: string;
  workOrderId: string;
  status: string;
  urgency: string;
  findingText: string;
  recommendation: string | null;
  submittedAt: string;
  mechanic: string;
  workDescription: string;
  plate: string;
  vehicle: string;
  media: Array<{ id: string; fileName: string; mimeType: string; fileSize: number; url: string }>;
};

type Data = {
  ok: boolean;
  linked: boolean;
  station?: { id: string; name: string };
  kpis?: { today: number; arrived: number; approval: number; waitingParts: number; inRepair: number; mechanicFindings: number };
  appointments?: Array<{ id: string; status: string; start: string; plate: string; vehicle: string; problem: string | null; post: string | null; mechanic: string | null }>;
  diagnostics?: Array<{ id: string; status: string; plate: string; vehicle: string; client: string }>;
  mechanicFindings?: Finding[];
};

function nav(section: string, filter = "", label = "") {
  window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: { section, filter, filterLabel: label } }));
}

function time(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(new Date(value));
}

function urgencyLabel(value: string) {
  return value === "CRITICAL" ? "Критично" : value === "SOON" ? "Найближчим часом" : "Рекомендація";
}

function Dashboard({ data }: { data: Data }) {
  const k = data.kpis!;
  const appointments = data.appointments || [];
  const diagnostics = data.diagnostics || [];
  const findings = data.mechanicFindings || [];

  return <div className={styles.page}>
    <header className={styles.head}>
      <div><span className={styles.eyebrow}>TURBO LEV · КАБІНЕТ СЕРВІС-МЕНЕДЖЕРА</span><h1>Приймання та супровід ремонту</h1><p>{data.station?.name} · клієнт → діагностика → кошторис → погодження → ремонт</p></div>
      <button className={styles.primary} onClick={() => nav("Планувальник")}>Планувальник →</button>
    </header>

    <section className={styles.kpis}>
      <button onClick={() => nav("Планувальник", "today", "Сьогодні")}><span>Авто сьогодні</span><strong>{k.today}</strong><small>у плані станції</small></button>
      <button onClick={() => nav("Діагностика", "active", "На діагностиці")}><span>Приймання / діагностика</span><strong>{k.arrived}</strong><small>потребують уваги</small></button>
      <button onClick={() => nav("Замовлення-наряди", "approval", "Очікують погодження")}><span>Погодження</span><strong>{k.approval}</strong><small>кошториси клієнтів</small></button>
      <button onClick={() => nav("Підбір запчастин", "waiting-parts", "Очікують деталі")}><span>Запчастини</span><strong>{k.waitingParts}</strong><small>у підборі / очікуванні</small></button>
      <button onClick={() => nav("Виробництво", "in-repair", "Ремонт")}><span>У ремонті</span><strong>{k.inRepair}</strong><small>готові або в роботі</small></button>
      <button className={k.mechanicFindings ? styles.alertKpi : ""}><span>Виявлено механіком</span><strong>{k.mechanicFindings}</strong><small>нові зауваження</small></button>
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>СЬОГОДНІ</span><h2>Черга автомобілів</h2></div></div>
        <div className={styles.list}>{appointments.length ? appointments.map((a) => <button key={a.id} className={styles.row} onClick={() => nav("Планувальник", a.id, `${a.plate} · ${a.vehicle}`)}><time>{time(a.start)}</time><div><b>{a.plate} · {a.vehicle}</b><span>{a.problem || "Без опису звернення"}</span><small>{a.post || "Без поста"}{a.mechanic ? ` · ${a.mechanic}` : ""}</small></div><em className={styles.badge}>{a.status}</em></button>) : <div className={styles.empty}>Записів на сьогодні немає.</div>}</div>
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>ВИЯВЛЕНО МЕХАНІКОМ</span><h2>Потребує рішення</h2></div></div>
        <div className={styles.findingList}>{findings.length ? findings.map((finding) => <article className={styles.findingRow} key={finding.id}>
          <button className={styles.findingMain} type="button" onClick={() => nav("Замовлення-наряди", finding.workOrderId, `${finding.plate} · ${finding.vehicle}`)}>
            <div className={styles.findingTop}><b>{finding.plate} · {finding.vehicle}</b><em data-urgency={finding.urgency}>{urgencyLabel(finding.urgency)}</em></div>
            <span>{finding.workDescription}</span><strong>{finding.findingText}</strong>{finding.recommendation && <small>Рекомендація: {finding.recommendation}</small>}<small>{finding.mechanic} · {time(finding.submittedAt)}</small>
          </button>
          {finding.media.length > 0 && <div className={styles.findingPhotos}>{finding.media.map((media) => <a key={media.id} href={media.url} target="_blank" rel="noreferrer" title={media.fileName}><img src={media.url} alt="Фото виявленої несправності" /></a>)}</div>}
        </article>) : <div className={styles.empty}>Нових зауважень від механіків немає.</div>}</div>

        <div className={styles.panelHead}><div><span className={styles.eyebrow}>ДІАГНОСТИКА</span><h2>Потребує опрацювання</h2></div></div>
        <div className={styles.list}>{diagnostics.length ? diagnostics.map((d) => <button key={d.id} className={styles.row} onClick={() => nav("Діагностика", d.id, `${d.plate} · ${d.vehicle}`)}><div><b>{d.plate}</b></div><div><b>{d.vehicle}</b><small>{d.client}</small></div><em className={styles.badge}>{d.status}</em></button>) : <div className={styles.empty}>Активних діагностик немає.</div>}</div>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>ШВИДКІ ДІЇ</span></div></div>
        <div className={styles.quick}><button onClick={() => nav("Діагностика")}>Діагностика</button><button onClick={() => nav("Замовлення-наряди")}>Кошториси</button><button onClick={() => nav("Підбір запчастин")}>Запчастини</button><button onClick={() => nav("Клієнти")}>Клієнти</button></div>
      </aside>
    </div>
  </div>;
}

export function ServiceAdvisorCabinetBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const url = new URL(window.location.href);
      const overview = !url.searchParams.get("section") || url.searchParams.get("section") === "overview";
      if (!overview) { setActive(false); return; }
      try {
        const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
        const roles = Array.isArray(me.roles) ? me.roles as Array<{ isPrimary?: boolean; code?: string }> : [];
        const primary = roles.find((r) => r.isPrimary) || roles[0];
        const should = me.enforcementMode === "ENFORCED" && me.provisioningState === "ACTIVE" && primary?.code === "SERVICE_ADVISOR";
        if (cancelled || !should) { setActive(false); return; }
        const workspace = document.querySelector<HTMLElement>(".workspace");
        if (workspace) { workspace.style.position = "relative"; setTarget(workspace); }
        setActive(true);
        const response = await fetch("/api/cabinet/service-advisor", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося завантажити кабінет");
        if (!cancelled) { setData(body); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Помилка кабінету");
      }
    };

    void sync();
    const timer = window.setInterval(() => { void sync(); }, 15000);
    const observer = new MutationObserver(() => {
      if (active && !target) {
        const workspace = document.querySelector<HTMLElement>(".workspace");
        if (workspace) { workspace.style.position = "relative"; setTarget(workspace); }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", sync);
    window.addEventListener("turbolev:navigate", sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      observer.disconnect();
      window.removeEventListener("popstate", sync);
      window.removeEventListener("turbolev:navigate", sync);
    };
  }, [active, target]);

  if (!active || !target) return null;
  return createPortal(<div style={{ position: "absolute", inset: 0, zIndex: 25, overflow: "auto", background: "var(--bg)", padding: "24px" }}>{error ? <div>{error}</div> : data?.linked && data.kpis ? <Dashboard data={data} /> : <div>Завантажую кабінет сервіс-менеджера…</div>}</div>, target);
}
