"use client";

import { useCallback, useEffect, useState } from "react";
import { isCrmSection } from "./crm-navigation";
import { navigateCrm, type CrmRouteParams } from "./crm-route";
import styles from "./role-work-queues-panel.module.css";

type Level = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type QueueSignal = {
  id: string;
  title: string;
  description: string | null;
  reason: string;
  level: Level;
  dueAt: string | null;
  occurredAt: string;
  isOverdue: boolean;
  overdueMinutes: number;
  action: { label: string; section: string; params?: Record<string, string> } | null;
};

type RoleQueues = {
  primaryRole: string | null;
  actionRequired: QueueSignal[];
  attentionCenter: QueueSignal[];
  summary: {
    actionRequired: number;
    attentionCenter: number;
    criticalActions: number;
    overdueActions: number;
    criticalAttention: number;
  };
};

type Payload = { ok?: boolean; roleQueues?: RoleQueues; error?: string };

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Власник",
  EXECUTIVE_DIRECTOR: "Виконавчий директор",
  STATION_MANAGER: "Керівник станції",
  SERVICE_ADVISOR: "Сервіс-менеджер",
  MECHANIC: "Механік",
  PARTS_SPECIALIST: "Менеджер з запчастин",
  WAREHOUSE_KEEPER: "Комірник",
  HEAD_OF_SALES: "Керівник відділу продажів",
  SALES: "Менеджер з продажу",
  ACCOUNTANT: "Бухгалтер",
  MARKETING_DIRECTOR: "Директор з маркетингу",
  MARKETER: "Маркетолог",
  HR_MANAGER: "HR-менеджер",
  ADMINISTRATOR: "Адміністратор",
  CRM_ADMIN: "CRM-адміністратор",
};

function duration(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} хв`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} год ${Math.round(minutes % 60)} хв`;
  return `${Math.floor(minutes / 1440)} дн ${Math.floor((minutes % 1440) / 60)} год`;
}

function timeLabel(signal: QueueSignal) {
  if (signal.isOverdue) return `Прострочено ${duration(signal.overdueMinutes)}`;
  if (signal.dueAt) {
    const date = new Date(signal.dueAt);
    if (Number.isFinite(date.getTime())) {
      return `До ${date.toLocaleString("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  const occurred = new Date(signal.occurredAt);
  if (!Number.isFinite(occurred.getTime())) return "Активно";
  return `${duration(Math.max(1, Math.floor((Date.now() - occurred.getTime()) / 60_000)))} тому`;
}

function openSignal(signal: QueueSignal) {
  if (!signal.action || !isCrmSection(signal.action.section)) return;
  navigateCrm(signal.action.section, (signal.action.params ?? {}) as CrmRouteParams);
}

function levelLabel(level: Level) {
  if (level === "CRITICAL") return "Критично";
  if (level === "HIGH") return "Високий";
  if (level === "LOW") return "Низький";
  return "Середній";
}

function QueueCard({ signal, kind }: { signal: QueueSignal; kind: "action" | "attention" }) {
  const clickable = Boolean(signal.action && isCrmSection(signal.action.section));
  const className = `${styles.item} ${styles[`level${signal.level}`] ?? ""} ${signal.isOverdue ? styles.overdue : ""}`;
  const content = <>
    <div className={styles.itemTop}>
      <span className={styles.level}>{levelLabel(signal.level)}</span>
      <time>{timeLabel(signal)}</time>
    </div>
    <strong>{signal.title}</strong>
    <span className={styles.reason}>{signal.description || signal.reason}</span>
    <div className={styles.itemBottom}>
      <span>{kind === "action" ? "Відповідальність вашої ролі" : "Контроль / відхилення"}</span>
      {signal.action && <em>{signal.action.label} →</em>}
    </div>
  </>;

  return clickable
    ? <button type="button" className={className} onClick={() => openSignal(signal)}>{content}</button>
    : <article className={className}>{content}</article>;
}

export function RoleWorkQueuesPanel() {
  const [queues, setQueues] = useState<RoleQueues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const response = await fetch("/api/tasks", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !body?.ok || !body.roleQueues) throw new Error(body?.error || "Не вдалося завантажити рольові задачі");
      setQueues(body.roleQueues);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити рольові задачі");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("turbolev:attention-refresh", refresh);
    window.addEventListener("turbolev:data-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("turbolev:attention-refresh", refresh);
      window.removeEventListener("turbolev:data-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  if (loading && !queues) {
    return <section className={styles.loading} aria-label="Рольові задачі"><strong>Оновлюю задачі та контрольні сигнали…</strong></section>;
  }

  if (!queues) {
    return <section className={styles.error} aria-label="Рольові задачі"><strong>Рольові блоки тимчасово недоступні</strong><span>{error}</span><button type="button" onClick={() => void load(true)}>Повторити</button></section>;
  }

  const actions = queues.actionRequired.slice(0, 8);
  const attention = queues.attentionCenter.slice(0, 8);
  const roleLabel = queues.primaryRole ? ROLE_LABELS[queues.primaryRole] || queues.primaryRole : "Поточна роль";

  return <section className={styles.wrapper} aria-label="Рольові задачі та центр уваги">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>РОБОЧИЙ ФОКУС · {roleLabel}</span><h2>Що потрібно зробити і що тримати на контролі</h2></div>
      {error && <button type="button" className={styles.refresh} onClick={() => void load()}>Оновити</button>}
    </div>

    <div className={styles.grid}>
      <section className={`${styles.queue} ${styles.actionQueue}`} aria-label="Потрібна дія">
        <header>
          <div><span className={styles.eyebrow}>ПОТРІБНА ДІЯ</span><h3>Моя відповідальність зараз</h3></div>
          <span className={styles.counter}>{queues.summary.actionRequired}</span>
        </header>
        {(queues.summary.criticalActions > 0 || queues.summary.overdueActions > 0) && <div className={styles.summaryLine}>
          {queues.summary.criticalActions > 0 && <span>{queues.summary.criticalActions} критичних</span>}
          {queues.summary.overdueActions > 0 && <span>{queues.summary.overdueActions} прострочених</span>}
        </div>}
        {actions.length
          ? <div className={styles.items}>{actions.map((signal) => <QueueCard key={signal.id} signal={signal} kind="action" />)}</div>
          : <div className={styles.empty}><strong>Активних задач немає</strong><span>За вашою роллю зараз немає дій, які потребують виконання.</span></div>}
      </section>

      <section className={`${styles.queue} ${styles.attentionQueue}`} aria-label="Центр уваги">
        <header>
          <div><span className={styles.eyebrow}>ЦЕНТР УВАГИ</span><h3>Ризики та відхилення</h3></div>
          <span className={styles.counter}>{queues.summary.attentionCenter}</span>
        </header>
        {queues.summary.criticalAttention > 0 && <div className={styles.summaryLine}><span>{queues.summary.criticalAttention} критичних сигналів</span></div>}
        {attention.length
          ? <div className={styles.items}>{attention.map((signal) => <QueueCard key={signal.id} signal={signal} kind="attention" />)}</div>
          : <div className={styles.empty}><strong>Відхилень немає</strong><span>У вашій зоні контролю зараз немає активних ризиків.</span></div>}
      </section>
    </div>
  </section>;
}
