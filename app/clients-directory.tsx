"use client";

import { useEffect, useState } from "react";
import styles from "./directory-pages.module.css";

type Client = {
  id: string;
  name: string | null;
  phone: string;
  createdAt: string;
  updatedAt: string;
  _count: { vehicles: number; workOrders: number; diagnosticRequests: number };
  workOrders: Array<{ id: string; status: string; createdAt: string; updatedAt: string; closedAt: string | null }>;
  vehicles: Array<{ id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null }>;
};

type ListResponse = { ok: boolean; total: number; clients: Client[]; error?: string };

function initials(name: string | null) {
  const source = (name || "Клієнт").trim();
  return source.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function displayName(client: Client) {
  return client.name?.trim() || "Клієнт без імені";
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function lastVisit(client: Client) {
  const row = client.workOrders[0];
  return row ? dateText(row.closedAt || row.updatedAt || row.createdAt) : "—";
}

export function ClientsDirectory() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/clients-vehicles?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as ListResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити клієнтів");
        setClients(data.clients || []);
        setTotal(data.total || 0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Помилка завантаження");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  function openNewRequest() {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail: { source: "CLIENTS" } }));
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · CRM-КЛІЄНТІВ</p>
        <h1>Клієнти</h1>
        <span>Клієнтська база, контакти, звернення та історія взаємодії</span>
      </div>
      <button className={styles.primary} onClick={openNewRequest}>+ Додати клієнта</button>
    </header>

    <div className={styles.toolbar}>
      <label className={styles.search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за ПІБ або телефоном..." />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистити пошук">×</button>}
      </label>
    </div>

    <div className={styles.summary}>Знайдено клієнтів: <b>{total}</b></div>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Завантажую клієнтів…</div> : !clients.length ? <div className={styles.state}>Нічого не знайдено.</div> : <div className={styles.grid}>
      {clients.map((client) => <button key={client.id} className={styles.card} onClick={() => setSelected(client)}>
        <div className={styles.identity}>
          <span className={styles.avatar}>{initials(client.name)}</span>
          <span className={styles.identityText}><strong>{displayName(client)}</strong><small>{client.phone}</small></span>
          <span className={styles.chevron}>›</span>
        </div>
        <div className={styles.stats}>
          <span><small>Авто</small><b>{client._count.vehicles}</b></span>
          <span><small>Замовлення</small><b>{client._count.workOrders}</b></span>
          <span><small>Останній візит</small><b>{lastVisit(client)}</b></span>
        </div>
      </button>)}
    </div>}

    {selected && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <div className={styles.identity}>
            <span className={styles.avatar}>{initials(selected.name)}</span>
            <span className={styles.identityText}><small>КАРТКА КЛІЄНТА</small><strong>{displayName(selected)}</strong><span>{selected.phone}</span></span>
          </div>
          <button className={styles.close} onClick={() => setSelected(null)}>×</button>
        </header>
        <div className={styles.drawerBody}>
          <section className={styles.panel}>
            <h3>Основні дані</h3>
            <div className={styles.facts}>
              <span><small>Телефон</small><b>{selected.phone}</b></span>
              <span><small>Створено</small><b>{dateText(selected.createdAt)}</b></span>
              <span><small>Остання активність</small><b>{dateText(selected.updatedAt)}</b></span>
              <span><small>Останній візит</small><b>{lastVisit(selected)}</b></span>
            </div>
          </section>
          <section className={styles.panel}>
            <h3>Пов’язані автомобілі <span>{selected._count.vehicles}</span></h3>
            {selected.vehicles.length ? <div className={styles.relatedList}>{selected.vehicles.map((vehicle) => <button key={vehicle.id} onClick={() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Авто" }))}>
              <strong>{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</strong>
              <small>{vehicle.plateNumber || vehicle.vin || "Без номера"}</small>
              <span>›</span>
            </button>)}</div> : <div className={styles.emptyInline}>Автомобілі ще не додані.</div>}
          </section>
        </div>
        <footer className={styles.drawerFooter}><button className={styles.primary} onClick={openNewRequest}>+ Нова заявка</button></footer>
      </aside>
    </div>}
  </div>;
}
