"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./production-board.module.css";

type Resource = { id: string; name: string; sortOrder?: number };
type Card = {
  id: string;
  number: number | null;
  status: string;
  statusLabel: string;
  plate: string;
  vehicle: string;
  vehicleId: string;
  problem: string | null;
  post: { id: string; name: string } | null;
  mechanic: { id: string; name: string } | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualStartAt: string | null;
  partsReady: boolean;
  partsRequestStatus: string | null;
  works: Array<{ id: string; description: string; status: string }>;
  workCount: number;
  completedWorkCount: number;
  updatedAt: string;
};
type BoardResponse = {
  ok: boolean;
  error?: string;
  location: { id: string; name: string; timezone: string } | null;
  locations: Array<{ id: string; name: string }>;
  posts: Resource[];
  mechanics: Resource[];
  cards: Card[];
  canWrite: boolean;
  role: "MECHANIC" | "STATION_MANAGER" | "OPERATIONS";
};
type GroupMode = "posts" | "mechanics";

const FILTERS = [
  ["ALL", "Усі"],
  ["READY_FOR_REPAIR", "Готові"],
  ["IN_REPAIR", "У ремонті"],
  ["BLOCKED", "Блокери / пауза"],
  ["PAUSED", "Пауза"],
  ["REWORK", "Доопрацювання"],
  ["WAITING_PARTS", "Очікують деталі"],
  ["WAITING_QC", "На QC"],
] as const;
const BLOCKED_STATUSES = new Set(["WAITING_PARTS", "PAUSED", "REWORK"]);

function matchesProductionFilter(card: Card, filter: string) {
  if (filter === "ALL") return true;
  if (filter === "BLOCKED") return BLOCKED_STATUSES.has(card.status);
  return card.status === filter;
}

function formatTime(value: string | null, timezone = "Europe/Kyiv") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function actionLabel(action: string) {
  return action === "START" ? "Почати"
    : action === "PAUSE" ? "Пауза"
      : action === "RESUME" ? "Продовжити"
        : action === "REWORK_START" ? "У роботу"
          : action === "FINISH" ? "Завершити → QC"
            : action;
}

function actionsFor(card: Card) {
  if (card.status === "READY_FOR_REPAIR") return ["START"];
  if (card.status === "IN_REPAIR") return ["PAUSE", "FINISH"];
  if (card.status === "PAUSED") return ["RESUME"];
  if (card.status === "REWORK") return ["REWORK_START"];
  return [];
}

function tone(status: string) {
  return status === "IN_REPAIR" ? styles.orange
    : status === "READY_FOR_REPAIR" ? styles.green
      : status === "WAITING_PARTS" || status === "PAUSED" ? styles.amber
        : status === "REWORK" ? styles.red
          : status === "WAITING_QC" ? styles.blue
            : "";
}

export function ProductionBoard() {
  const route = readCrmRoute();
  const initialStatus = route.status && FILTERS.some(([code]) => code === route.status) ? route.status : "ALL";
  const initialGroup: GroupMode = route.scope === "mechanics" ? "mechanics" : "posts";
  const [data, setData] = useState<BoardResponse | null>(null);
  const [locationId, setLocationId] = useState("");
  const [filter, setFilter] = useState(initialStatus);
  const [groupMode, setGroupMode] = useState<GroupMode>(initialGroup);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (nextLocationId?: string) => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      const selected = nextLocationId ?? locationId;
      if (selected) params.set("locationId", selected);
      const response = await fetch(`/api/production${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as BoardResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити виробництво.");
      setData(payload);
      setLocationId(payload.location?.id || "");
      if (payload.role === "MECHANIC") setGroupMode("mechanics");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити виробництво.");
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
      setFilter(next.status && FILTERS.some(([code]) => code === next.status) ? next.status : "ALL");
      if (next.scope === "mechanics") setGroupMode("mechanics");
      else if (next.scope === "posts") setGroupMode("posts");
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const cards = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("uk-UA");
    return (data?.cards || []).filter((card) => matchesProductionFilter(card, filter)).filter((card) => {
      if (!q) return true;
      return [formatWorkOrderNumber(card.number), card.plate, card.vehicle, card.mechanic?.name, card.post?.name, card.problem, ...card.works.map((work) => work.description)]
        .filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(q);
    });
  }, [data?.cards, filter, search]);

  const resources = useMemo(() => {
    const base = groupMode === "posts" ? data?.posts || [] : data?.mechanics || [];
    return [...base, { id: "__UNASSIGNED__", name: groupMode === "posts" ? "Без поста" : "Без механіка" }];
  }, [data?.posts, data?.mechanics, groupMode]);

  const byResource = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const resource of resources) map.set(resource.id, []);
    for (const card of cards) {
      const id = groupMode === "posts" ? card.post?.id || "__UNASSIGNED__" : card.mechanic?.id || "__UNASSIGNED__";
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(card);
    }
    return map;
  }, [cards, resources, groupMode]);

  const counts = useMemo(() => ({
    ready: (data?.cards || []).filter((card) => card.status === "READY_FOR_REPAIR").length,
    repair: (data?.cards || []).filter((card) => card.status === "IN_REPAIR").length,
    blocked: (data?.cards || []).filter((card) => BLOCKED_STATUSES.has(card.status)).length,
    qc: (data?.cards || []).filter((card) => card.status === "WAITING_QC").length,
  }), [data?.cards]);

  async function runAction(card: Card, action: string) {
    if (!data?.canWrite || busy) return;
    setBusy(`${card.id}:${action}`);
    setMessage("");
    try {
      const response = await fetch("/api/production", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: card.id, action }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Дію не виконано.");
      setMessage(`${formatWorkOrderNumber(card.number)} · ${actionLabel(action)} — виконано.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Дію не виконано.");
    } finally {
      setBusy("");
    }
  }

  function openWorkOrder(card: Card) {
    navigateCrm("Комерційна пропозиція", { workOrderId: card.id, workOrderTab: "works" });
  }

  if (loading && !data) return <div className={styles.state}>Завантажую виробничу дошку…</div>;
  if (!data?.location) return <div className={styles.state}>{message || "Для Вашого профілю не визначена станція виробництва."}</div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>TURBO LEV · ВИРОБНИЦТВО</p><h1>{data.role === "MECHANIC" ? "Мої роботи" : "Виробнича дошка"}</h1><span>{data.location.name} · живий стан ремонтів без фінансових даних</span></div>
      <div className={styles.headerActions}>
        {data.locations.length > 1 && <select value={locationId} onChange={(event) => void load(event.target.value)}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
      </div>
    </header>

    <section className={styles.kpis}>
      <button type="button" onClick={() => setFilter("READY_FOR_REPAIR")}><span>Готові до ремонту</span><strong>{counts.ready}</strong></button>
      <button type="button" onClick={() => setFilter("IN_REPAIR")}><span>У ремонті</span><strong>{counts.repair}</strong></button>
      <button type="button" onClick={() => setFilter("BLOCKED")}><span>Блокери / пауза</span><strong>{counts.blocked}</strong></button>
      <button type="button" onClick={() => setFilter("WAITING_QC")}><span>Передано на QC</span><strong>{counts.qc}</strong></button>
    </section>

    <section className={styles.toolbar}>
      <div className={styles.segmented}>
        <button type="button" className={groupMode === "posts" ? styles.active : ""} disabled={data.role === "MECHANIC"} onClick={() => setGroupMode("posts")}>Пости</button>
        <button type="button" className={groupMode === "mechanics" ? styles.active : ""} onClick={() => setGroupMode("mechanics")}>Механіки</button>
      </div>
      <label className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ЗН, авто, пост, механік або робота…"/>{search && <button type="button" onClick={() => setSearch("")}>×</button>}</label>
    </section>

    <nav className={styles.filters}>{FILTERS.map(([code, label]) => <button type="button" key={code} className={filter === code ? styles.activeFilter : ""} onClick={() => setFilter(code)}>{label}<b>{data.cards.filter((card) => matchesProductionFilter(card, code)).length}</b></button>)}</nav>
    {message && <div className={styles.notice}>{message}</div>}

    <div className={styles.board}>
      {resources.map((resource) => {
        const items = byResource.get(resource.id) || [];
        if (resource.id === "__UNASSIGNED__" && !items.length) return null;
        return <section className={styles.lane} key={resource.id}>
          <header><div><span>{groupMode === "posts" ? "ПОСТ" : "МЕХАНІК"}</span><h2>{resource.name}</h2></div><b>{items.length}</b></header>
          <div className={styles.cards}>{items.length ? items.map((card) => <article className={styles.card} key={card.id}>
            <div className={styles.cardHead}><div><span className={styles.wo}>{formatWorkOrderNumber(card.number)}</span><strong>{card.plate}</strong></div><span className={`${styles.status} ${tone(card.status)}`}>{card.statusLabel}</span></div>
            <h3>{card.vehicle}</h3>
            <div className={styles.meta}>
              <span><b>{card.post?.name || "Без поста"}</b><small>пост</small></span>
              <span><b>{card.mechanic?.name || "Не призначений"}</b><small>механік</small></span>
              <span><b>{formatTime(card.plannedStartAt, data.location?.timezone)}</b><small>план</small></span>
            </div>
            <div className={`${styles.parts} ${card.partsReady ? styles.partsReady : styles.partsBlocked}`}><span>{card.partsReady ? "✓ Деталі готові" : "! Деталі не готові"}</span>{card.partsRequestStatus && <small>{card.partsRequestStatus}</small>}</div>
            <div className={styles.works}>{card.works.length ? card.works.map((work) => <div key={work.id}><span>{work.status === "COMPLETED" ? "✓" : "•"}</span><p>{work.description}</p></div>) : <p className={styles.problem}>{card.problem || "Роботи не деталізовані"}</p>}</div>
            <div className={styles.progress}><div><i style={{ width: `${card.workCount ? Math.round(card.completedWorkCount / card.workCount * 100) : 0}%` }}/></div><span>{card.completedWorkCount}/{card.workCount} робіт</span></div>
            <footer>
              <button type="button" className={styles.secondary} onClick={() => openWorkOrder(card)}>Роботи ЗН</button>
              {data.canWrite && actionsFor(card).map((action) => <button type="button" key={action} className={action === "FINISH" ? styles.finish : styles.primary} disabled={Boolean(busy)} onClick={() => void runAction(card, action)}>{busy === `${card.id}:${action}` ? "…" : actionLabel(action)}</button>)}
            </footer>
          </article>) : <div className={styles.empty}>Немає активних робіт.</div>}</div>
        </section>;
      })}
    </div>
  </div>;
}