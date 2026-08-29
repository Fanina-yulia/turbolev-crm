"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./mechanic-bottom-nav-restore.module.css";

type DiagnosticItem = {
  id: string;
  workflowState?: string | null;
  problem?: string | null;
  plannedStartAt?: string | null;
  post?: string | null;
  vehicle?: { label?: string | null; plateNumber?: string | null } | null;
};

function findMechanicNav() {
  return document.querySelector<HTMLElement>('nav[aria-label="Навігація механіка"]');
}

function findMechanicRoot() {
  return document.querySelector<HTMLElement>('[data-mechanic-cabinet="true"]');
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(value?: string | null) {
  if (value === "SUBMITTED") return "Передано менеджеру";
  if (value === "RETURNED") return "На доопрацюванні";
  if (value === "CONFIRMED") return "Завершено";
  if (value === "IN_PROGRESS") return "В роботі";
  return value || "Діагностика";
}

export function MechanicBottomNavRestore() {
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
  const [rootTarget, setRootTarget] = useState<HTMLElement | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const diagnosticsButtonRef = useRef<HTMLButtonElement | null>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let observer: MutationObserver | null = null;
    const sync = () => {
      const nav = findMechanicNav();
      const root = findMechanicRoot();
      setNavTarget((current) => current === nav ? current : nav);
      setRootTarget((current) => current === root ? current : root);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    sync();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    if (!navTarget) return;
    const home = navTarget.children.item(0) as HTMLElement | null;
    const works = navTarget.children.item(1) as HTMLElement | null;
    const scanSlot = navTarget.querySelector<HTMLElement>("[data-mechanic-scan-slot]");
    const diagnosticsButton = diagnosticsButtonRef.current;
    const notificationsButton = notificationsButtonRef.current;

    navTarget.dataset.mechanicFiveItemNav = "true";
    navTarget.style.setProperty("grid-template-columns", "repeat(5,minmax(0,1fr))", "important");
    navTarget.style.setProperty("overflow", "visible", "important");
    home?.style.setProperty("grid-column", "1", "important");
    works?.style.setProperty("grid-column", "2", "important");
    scanSlot?.style.setProperty("grid-column", "3", "important");
    scanSlot?.style.setProperty("grid-row", "1", "important");
    diagnosticsButton?.style.setProperty("display", "grid", "important");
    diagnosticsButton?.style.setProperty("grid-column", "4", "important");
    diagnosticsButton?.style.setProperty("grid-row", "1", "important");
    notificationsButton?.style.setProperty("display", "grid", "important");
    notificationsButton?.style.setProperty("grid-column", "5", "important");
    notificationsButton?.style.setProperty("grid-row", "1", "important");

    return () => {
      delete navTarget.dataset.mechanicFiveItemNav;
      navTarget.style.removeProperty("grid-template-columns");
      navTarget.style.removeProperty("overflow");
      home?.style.removeProperty("grid-column");
      works?.style.removeProperty("grid-column");
      scanSlot?.style.removeProperty("grid-column");
      scanSlot?.style.removeProperty("grid-row");
    };
  }, [navTarget]);

  const loadUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/cabinet/mechanic/notifications", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as { unreadCount?: number } | null;
      if (response.ok && typeof body?.unreadCount === "number") setUnreadCount(body.unreadCount);
    } catch {
      // The cabinet already owns notification error handling; the nav badge is best-effort.
    }
  }, []);

  useEffect(() => {
    void loadUnread();
    const timer = window.setInterval(() => void loadUnread(), 15000);
    const refresh = () => void loadUnread();
    window.addEventListener("focus", refresh);
    window.addEventListener("turbolev:mechanic-refresh", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("turbolev:mechanic-refresh", refresh);
    };
  }, [loadUnread]);

  async function openDiagnostics() {
    setDiagnosticsOpen(true);
    setDiagnosticsError("");
    setLoadingDiagnostics(true);
    try {
      const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as { ok?: boolean; items?: DiagnosticItem[]; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити діагностики");
      setDiagnostics(body.items ?? []);
    } catch (cause) {
      setDiagnosticsError(cause instanceof Error ? cause.message : "Не вдалося завантажити діагностики");
    } finally {
      setLoadingDiagnostics(false);
    }
  }

  function openDiagnosticDetail(diagnosticId: string) {
    setDiagnosticsOpen(false);
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-diagnostic", { detail: { diagnosticId } }));
  }

  function openNotifications() {
    setDiagnosticsOpen(false);
    const nav = findMechanicNav();
    const homeButton = nav?.querySelector<HTMLButtonElement>("button:nth-child(1)");
    homeButton?.click();

    let attempts = 0;
    const open = () => {
      const notificationButton = document.querySelector<HTMLButtonElement>('[data-mechanic-cabinet="true"] button[aria-label="Сповіщення"]');
      if (notificationButton) {
        notificationButton.click();
        void loadUnread();
        return;
      }
      attempts += 1;
      if (attempts < 20) requestAnimationFrame(open);
    };
    requestAnimationFrame(open);
  }

  const navExtras = navTarget ? createPortal(<>
    <button
      ref={diagnosticsButtonRef}
      type="button"
      className={`${styles.navButton} ${diagnosticsOpen ? styles.navActive : ""}`}
      data-mechanic-bottom-nav-extra="diagnostics"
      onClick={() => void openDiagnostics()}
    >
      <span aria-hidden="true">◇</span>
      <b>Діагностика</b>
    </button>
    <button
      ref={notificationsButtonRef}
      type="button"
      className={styles.navButton}
      data-mechanic-bottom-nav-extra="notifications"
      onClick={openNotifications}
    >
      <span className={styles.notificationIcon} aria-hidden="true">◉{unreadCount > 0 && <em>{Math.min(unreadCount, 99)}</em>}</span>
      <b>Сповіщення</b>
    </button>
  </>, navTarget) : null;

  const diagnosticsPanel = diagnosticsOpen && rootTarget ? createPortal(
    <section className={styles.diagnosticsPanel} aria-label="Мої діагностики">
      <header className={styles.panelHeader}>
        <button type="button" onClick={() => setDiagnosticsOpen(false)} aria-label="Назад">‹</button>
        <strong>Діагностика</strong>
        <span />
      </header>
      <main className={styles.panelContent}>
        <div className={styles.panelTitle}>
          <h1>Мої діагностики</h1>
          <p>Автомобілі, призначені цьому механіку.</p>
        </div>
        {loadingDiagnostics && <div className={styles.empty}>Завантажую діагностики…</div>}
        {!loadingDiagnostics && diagnosticsError && <div className={styles.error}>{diagnosticsError}</div>}
        {!loadingDiagnostics && !diagnosticsError && diagnostics.length === 0 && <div className={styles.empty}>Призначених діагностик немає.</div>}
        {!loadingDiagnostics && !diagnosticsError && diagnostics.length > 0 && <div className={styles.list}>
          {diagnostics.map((item) => <button type="button" key={item.id} className={styles.diagnosticCard} onClick={() => openDiagnosticDetail(item.id)}>
            <div className={styles.cardTop}>
              <strong>{item.vehicle?.label || "Автомобіль"}</strong>
              <span>{statusLabel(item.workflowState)}</span>
            </div>
            <b>{item.vehicle?.plateNumber || "Без номера"}</b>
            <p>{item.problem || "Планова діагностика"}</p>
            <small>{formatDate(item.plannedStartAt)} · {item.post || "Пост не вказано"}</small>
          </button>)}
        </div>}
      </main>
    </section>,
    rootTarget,
  ) : null;

  return <>{navExtras}{diagnosticsPanel}</>;
}
