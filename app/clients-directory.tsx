"use client";

import { useEffect, useState } from "react";
import type { ClientDirectoryItem } from "@/src/lib/contracts/crm-core";
import {
  parseClientDirectoryItemPayload,
  parseClientDirectoryPayload,
  payloadMessage,
} from "@/src/lib/contracts/directory-payload.parsers";
import { CustomerCabinetCard } from "./customer-cabinet-card";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./directory-pages.module.css";

type Client = ClientDirectoryItem;

const PAGE_SIZE = 24;

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
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Client | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/clients?${params}`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        const data = parseClientDirectoryPayload(payload);
        if (!response.ok || !data) throw new Error(payloadMessage(payload, "Не вдалося завантажити клієнтів"));
        setClients(data.clients);
        setTotal(data.total);
        setPages(data.pages);
        if (data.page !== page) setPage(data.page);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка завантаження");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, page]);

  useEffect(() => {
    const syncFromRoute = () => setSelectedId(readCrmRoute().clientId || null);
    syncFromRoute();
    window.addEventListener("popstate", syncFromRoute);
    return () => window.removeEventListener("popstate", syncFromRoute);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setSelectedLoading(false);
      return;
    }
    const local = clients.find((client) => client.id === selectedId);
    if (local) {
      setSelected(local);
      setSelectedLoading(false);
      return;
    }

    const controller = new AbortController();
    setSelected(null);
    setSelectedLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/clients?id=${encodeURIComponent(selectedId)}`, { cache: "no-store", signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        const client = parseClientDirectoryItemPayload(payload);
        if (!response.ok || !client) throw new Error(payloadMessage(payload, "Не вдалося відкрити клієнта"));
        setSelected(client);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка картки клієнта");
      } finally {
        if (!controller.signal.aborted) setSelectedLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedId, clients]);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function openNewRequest() {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail: { source: "CLIENTS" } }));
  }

  function openClient(client: Client) {
    navigateCrm("Клієнти", { clientId: client.id });
  }

  function closeClient() {
    navigateCrm("Клієнти");
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · CRM-КЛІЄНТІВ</p>
        <h1>Клієнти</h1>
        <span>Лише реальні клієнти СТО: додано авто та створено запис у планувальнику</span>
      </div>
      <button className={styles.primary} onClick={openNewRequest}>+ Записати авто на СТО</button>
    </header>

    <div className={styles.toolbar}>
      <label className={styles.search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Пошук за ПІБ, телефоном, номером авто або VIN..." />
        {query && <button type="button" onClick={() => changeQuery("")} aria-label="Очистити пошук">×</button>}
      </label>
    </div>

    <div className={styles.summary}>Знайдено клієнтів: <b>{total}</b>{total > 0 && <span> · сторінка {page} з {pages}</span>}</div>
    {error && <div className={styles.error}>{error}</div>}
    {loading ? <div className={styles.state}>Завантажую клієнтів…</div> : !clients.length ? <div className={styles.state}>Немає клієнтів, які вже записані у планувальник.</div> : <div className={styles.grid}>
      {clients.map((client) => <button key={client.id} className={styles.card} onClick={() => openClient(client)}>
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

    {!loading && total > PAGE_SIZE && <nav className={styles.pagination} aria-label="Сторінки клієнтів">
      <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Назад</button>
      <span>Сторінка <b>{page}</b> з <b>{pages}</b></span>
      <button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Далі →</button>
    </nav>}

    {selectedId && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeClient(); }}>
      <aside className={styles.drawer}>
        {selectedLoading || !selected ? <div className={styles.state}>Завантажую картку клієнта…</div> : <>
          <header className={styles.drawerHeader}>
            <div className={styles.identity}>
              <span className={styles.avatar}>{initials(selected.name)}</span>
              <span className={styles.identityText}><small>КАРТКА КЛІЄНТА</small><strong>{displayName(selected)}</strong><span>{selected.phone}</span></span>
            </div>
            <button className={styles.close} onClick={closeClient}>×</button>
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
              {selected.vehicles.length ? <div className={styles.relatedList}>{selected.vehicles.map((vehicle) => <button key={vehicle.id} onClick={() => navigateCrm("Авто", { vehicleId: vehicle.id })}>
                <strong>{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</strong>
                <small>{vehicle.plateNumber || vehicle.vin || "Без номера"}</small>
                <span>›</span>
              </button>)}</div> : <div className={styles.emptyInline}>Автомобілі ще не додані.</div>}
            </section>
            <section className={styles.panel}>
              <CustomerCabinetCard clientId={selected.id} />
            </section>
            <section className={styles.panel}>
              <h3>Замовлення-наряди <span>{selected._count.workOrders}</span></h3>
              {selected.workOrders.length ? <div className={styles.relatedList}>{selected.workOrders.map((workOrder) => <button key={workOrder.id} onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: workOrder.id })}>
                <strong>{workOrder.status}</strong>
                <small>{dateText(workOrder.closedAt || workOrder.updatedAt || workOrder.createdAt)}</small>
                <span>›</span>
              </button>)}</div> : <div className={styles.emptyInline}>Замовлень-нарядів ще немає.</div>}
            </section>
          </div>
          <footer className={styles.drawerFooter}><button className={styles.primary} onClick={openNewRequest}>+ Нова заявка</button></footer>
        </>}
      </aside>
    </div>}
  </div>;
}
