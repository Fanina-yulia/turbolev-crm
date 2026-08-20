"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./qc-queue.module.css";

type Category = "WAITING" | "IN_PROGRESS" | "FAILED" | "PASSED";
type Card = {
  id: string;
  number: number | null;
  workOrderStatus: string;
  category: Category;
  plate: string;
  vehicle: string;
  vehicleId: string;
  problem: string | null;
  post: { id: string; name: string } | null;
  mechanic: { id: string; name: string } | null;
  plannedStartAt: string | null;
  attempt: number;
  qcStatus: string;
  performedByName: string | null;
  resultNote: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
type Response = {
  ok: boolean;
  error?: string;
  location: { id: string; name: string; timezone: string } | null;
  locations: Array<{ id: string; name: string; timezone: string }>;
  cards: Card[];
  canWrite: boolean;
};

const LANES: Array<[Category, string, string]> = [
  ["WAITING", "Очікує перевірки", "Нове QC або повторна перевірка"],
  ["IN_PROGRESS", "На перевірці", "Контроль якості вже розпочато"],
  ["FAILED", "Доопрацювання", "QC не пройдено або ЗН повернений у ремонт"],
  ["PASSED", "Пройдено сьогодні", "Авто пройшли контроль якості сьогодні"],
];

function formatDateTime(value: string | null, timezone = "Europe/Kyiv") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function statusTone(category: Category) {
  return category === "WAITING" ? styles.amber : category === "IN_PROGRESS" ? styles.blue : category === "FAILED" ? styles.red : styles.green;
}

export function QcQueue() {
  const route = readCrmRoute();
  const routeCategory = route.scope === "in-progress" ? "IN_PROGRESS" : route.scope === "failed" ? "FAILED" : route.scope === "passed" ? "PASSED" : route.scope === "waiting" ? "WAITING" : null;
  const [data, setData] = useState<Response | null>(null);
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<Category | null>(routeCategory);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextLocationId?: string) => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      const selected = nextLocationId ?? locationId;
      if (selected) params.set("locationId", selected);
      const response = await fetch(`/api/qc${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as Response;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити QC.");
      setData(payload);
      setLocationId(payload.location?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити QC.");
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const sync = () => {
      const next = readCrmRoute();
      setFocus(next.scope === "in-progress" ? "IN_PROGRESS" : next.scope === "failed" ? "FAILED" : next.scope === "passed" ? "PASSED" : next.scope === "waiting" ? "WAITING" : null);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("uk-UA");
    return (data?.cards || []).filter((card) => !focus || card.category === focus).filter((card) => {
      if (!q) return true;
      return [formatWorkOrderNumber(card.number), card.plate, card.vehicle, card.post?.name, card.mechanic?.name, card.performedByName, card.resultNote, card.problem]
        .filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(q);
    });
  }, [data?.cards, search, focus]);

  const counts = useMemo(() => Object.fromEntries(LANES.map(([category]) => [category, (data?.cards || []).filter((card) => card.category === category).length])) as Record<Category, number>, [data?.cards]);

  async function act(card: Card, action: string) {
    if (!data?.canWrite || busy) return;
    const key = `${card.id}:${action}`;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch("/api/qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: card.id, action, performedByName: reviewer || undefined, note: notes[card.id] || undefined }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Дію QC не виконано.");
      setMessage(payload.warning?.message || `${formatWorkOrderNumber(card.number)} · QC оновлено.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Дію QC не виконано.");
    } finally {
      setBusy("");
    }
  }

  function openWorkOrder(card: Card) {
    navigateCrm("Замовлення-наряди", { workOrderId: card.id, workOrderTab: "qc" });
  }

  if (loading && !data) return <div className={styles.state}>Завантажую чергу контролю якості…</div>;
  if (!data?.location) return <div className={styles.state}>{message || "Для Вашого профілю не визначена станція QC."}</div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>TURBO LEV · КОНТРОЛЬ ЯКОСТІ</p><h1>Черга QC</h1><span>{data.location.name} · одна черга поверх існуючих ЗН та QC-спроб</span></div>
      <div className={styles.headerActions}>
        {data.locations.length > 1 && <select value={locationId} onChange={(event) => void load(event.target.value)}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
      </div>
    </header>

    <section className={styles.kpis}>{LANES.map(([category, label]) => <button type="button" key={category} className={focus === category ? styles.kpiActive : ""} onClick={() => setFocus((current) => current === category ? null : category)}><span>{label}</span><strong>{counts[category]}</strong></button>)}</section>

    <section className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ЗН, авто, пост, механік або примітка…"/>{search && <button type="button" onClick={() => setSearch("")}>×</button>}</label>
      <label className={styles.reviewer}><span>Перевіряє</span><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="ПІБ контролера"/></label>
    </section>
    {message && <div className={styles.notice}>{message}</div>}

    <div className={styles.board}>
      {LANES.map(([category, title, subtitle]) => {
        if (focus && focus !== category) return null;
        const cards = visibleCards.filter((card) => card.category === category);
        return <section className={styles.lane} key={category}>
          <header><div><h2>{title}</h2><span>{subtitle}</span></div><b>{cards.length}</b></header>
          <div className={styles.cards}>{cards.length ? cards.map((card) => <article className={styles.card} key={card.id}>
            <div className={styles.cardTop}><div><span className={styles.wo}>{formatWorkOrderNumber(card.number)}</span><strong>{card.plate}</strong></div><span className={`${styles.status} ${statusTone(card.category)}`}>Спроба №{card.attempt} · {card.qcStatus}</span></div>
            <h3>{card.vehicle}</h3>
            <div className={styles.meta}><span><b>{card.post?.name || "Без поста"}</b><small>пост</small></span><span><b>{card.mechanic?.name || "Без механіка"}</b><small>механік</small></span><span><b>{formatDateTime(card.startedAt || card.plannedStartAt, data.location?.timezone)}</b><small>{card.startedAt ? "початок QC" : "план"}</small></span></div>
            {card.problem && <p className={styles.problem}>{card.problem}</p>}
            {card.resultNote && <div className={styles.result}><span>Примітка QC</span><p>{card.resultNote}</p></div>}
            {card.category === "IN_PROGRESS" && <textarea value={notes[card.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [card.id]: event.target.value }))} placeholder="Результат перевірки / що потрібно виправити" rows={3}/>} 
            {card.performedByName && <div className={styles.performed}>Перевіряв: <b>{card.performedByName}</b></div>}
            <footer>
              <button type="button" className={styles.secondary} onClick={() => openWorkOrder(card)}>Відкрити QC у ЗН</button>
              {data.canWrite && card.category === "WAITING" && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void act(card, "START")}>{busy === `${card.id}:START` ? "…" : "Почати перевірку"}</button>}
              {data.canWrite && card.category === "IN_PROGRESS" && <><button type="button" className={styles.pass} disabled={Boolean(busy)} onClick={() => void act(card, "PASS")}>{busy === `${card.id}:PASS` ? "…" : "Пройдено → до оплати"}</button><button type="button" className={styles.fail} disabled={Boolean(busy)} onClick={() => void act(card, "FAIL")}>{busy === `${card.id}:FAIL` ? "…" : "Не пройдено → доопрацювання"}</button></>}
              {data.canWrite && card.category === "FAILED" && card.workOrderStatus === "WAITING_QC" && <button type="button" className={styles.fail} disabled={Boolean(busy)} onClick={() => void act(card, "MOVE_REWORK")}>Передати на доопрацювання</button>}
              {card.category === "FAILED" && card.workOrderStatus === "REWORK" && <button type="button" className={styles.secondary} onClick={() => navigateCrm("Виробництво", { status: "REWORK" })}>Виробництво →</button>}
              {data.canWrite && card.category === "PASSED" && card.workOrderStatus === "WAITING_QC" && <button type="button" className={styles.pass} disabled={Boolean(busy)} onClick={() => void act(card, "MOVE_PAYMENT")}>Передати до оплати</button>}
            </footer>
          </article>) : <div className={styles.empty}>Черга порожня.</div>}</div>
        </section>;
      })}
    </div>
  </div>;
}
