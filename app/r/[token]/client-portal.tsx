"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientPortalMessage,
  ClientPortalSnapshot,
} from "@/src/services/client-portal.service";
import styles from "./client-portal.module.css";

const STATE_META: Record<string, { label: string; mark: string; className: string }> = {
  OK: { label: "Норма", mark: "✓", className: styles.stateOk },
  ATTENTION: { label: "Потребує уваги", mark: "!", className: styles.stateAttention },
  DEFECT: { label: "Дефект", mark: "×", className: styles.stateDefect },
};

const ESTIMATE_STATUS: Record<string, string> = {
  DRAFT: "Готується",
  SENT: "Очікує погодження",
  APPROVED: "Погоджено",
  REJECTED: "Відхилено",
  SUPERSEDED: "Замінено новою версією",
  CANCELLED: "Скасовано",
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function money(value: number, currency = "UAH") {
  try {
    return new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("uk-UA").format(value)} ${currency}`;
  }
}

function problemItems(snapshot: ClientPortalSnapshot["report"]) {
  return snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT")));
}

function messageAuthor(message: ClientPortalMessage) {
  if (message.direction === "IN") return "Ви";
  if (message.direction === "OUT") return "Сервіс-менеджер";
  return "Turbo LEV";
}

export function ClientPortal({ token, initialSnapshot }: { token: string; initialSnapshot: ClientPortalSnapshot }) {
  const [portal, setPortal] = useState(initialSnapshot);
  const [messages, setMessages] = useState(initialSnapshot.chat.messages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const issues = useMemo(() => problemItems(portal.report), [portal.report]);
  const estimate = portal.estimate;
  const estimateNeedsDecision = estimate?.status === "SENT";

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/public/diagnostic-report/${encodeURIComponent(token)}/messages`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok && Array.isArray(body.chat?.messages)) {
        setMessages(body.chat.messages);
      }
    } catch {
      // Chat polling is best-effort; the rest of the cabinet remains available offline from the initial snapshot.
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadMessages(), 12000);
    const onFocus = () => void loadMessages();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy("message");
    setError("");
    try {
      const response = await fetch(`/api/public/diagnostic-report/${encodeURIComponent(token)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || "Не вдалося надіслати повідомлення.");
      setMessages((current) => [...current, body.message]);
      setDraft("");
      setNotice("Повідомлення передано сервіс-менеджеру.");
      window.setTimeout(() => setNotice(""), 2800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося надіслати повідомлення.");
    } finally {
      setBusy("");
    }
  }

  async function decideEstimate(decision: "APPROVE" | "REJECT") {
    if (!estimate || busy) return;
    let note = "";
    if (decision === "REJECT") {
      note = window.prompt("За бажанням напишіть причину або питання сервіс-менеджеру:", "") || "";
      if (!window.confirm("Відхилити цей кошторис? Сервіс-менеджер отримає ваше рішення.")) return;
    } else if (!window.confirm(`Погодити кошторис на ${money(estimate.totalAmount, estimate.currency)}?`)) {
      return;
    }

    setBusy("estimate");
    setError("");
    try {
      const response = await fetch(`/api/public/diagnostic-report/${encodeURIComponent(token)}/estimate-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || "Не вдалося зафіксувати рішення.");
      setPortal(body.portal);
      setMessages(body.portal.chat.messages || []);
      setNotice(decision === "APPROVE" ? "Кошторис погоджено. Дякуємо." : "Відмову зафіксовано. Менеджер бачить ваш коментар.");
      window.setTimeout(() => setNotice(""), 3500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зафіксувати рішення.");
    } finally {
      setBusy("");
    }
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <div className={styles.logo}>TL</div>
          <div><strong>ТУРБО <b>ЛЕВ</b></strong><span>Особистий кабінет власника авто</span></div>
        </div>
        <span className={styles.secure}>● Захищене посилання</span>
      </header>

      <section className={styles.vehicleHero} id="home">
        <div className={styles.vehicleTitle}>
          <div>
            <p>ВАШ АВТОМОБІЛЬ</p>
            <h1>{portal.vehicle.label}{portal.vehicle.year ? ` ${portal.vehicle.year}` : ""}</h1>
            <div className={styles.vehicleMeta}>
              <span className={styles.plate}>🇺🇦 {portal.vehicle.plateNumber || "БЕЗ НОМЕРА"}</span>
              {portal.vehicle.mileageKm != null && <span>{new Intl.NumberFormat("uk-UA").format(portal.vehicle.mileageKm)} км</span>}
            </div>
          </div>
          <div className={styles.currentStatus}><small>Зараз</small><strong>{portal.service.statusLabel}</strong></div>
        </div>
        <div className={styles.serviceMeta}>
          <span>СТО <b>{portal.service.stationName || "Turbo LEV"}</b></span>
          <span>Пост <b>{portal.service.postName || "—"}</b></span>
          <span>Орієнтовно готово <b>{portal.service.plannedEndAt ? formatDateTime(portal.service.plannedEndAt) : "уточнюється"}</b></span>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}><div><p>СТАТУС РОБІТ</p><h2>Що відбувається з автомобілем</h2></div><span>{portal.service.stageIndex + 1}/{portal.service.stages.length}</span></div>
        <div className={styles.timeline}>
          {portal.service.stages.map((stage, index) => <div className={`${styles.timelineItem} ${stage.state === "DONE" ? styles.timelineDone : stage.state === "CURRENT" ? styles.timelineCurrent : ""}`} key={stage.key}>
            <div className={styles.timelineMark}>{stage.state === "DONE" ? "✓" : index + 1}</div>
            <span>{stage.label}</span>
          </div>)}
        </div>
        {(portal.service.mechanicName || portal.service.partsEtaAt) && <div className={styles.contextRow}>
          {portal.service.mechanicName && <span>Механік: <b>{portal.service.mechanicName}</b></span>}
          {portal.service.partsEtaAt && <span>Очікуємо деталі: <b>{formatDateTime(portal.service.partsEtaAt)}</b></span>}
        </div>}
      </section>

      {portal.action && <section className={`${styles.actionCard} ${portal.action.kind === "ESTIMATE_DECISION" ? styles.actionUrgent : ""}`}>
        <div className={styles.actionIcon}>{portal.action.kind === "ESTIMATE_DECISION" ? "!" : "✓"}</div>
        <div><p>ПОТРІБНА ВАША ДІЯ</p><h2>{portal.action.title}</h2><span>{portal.action.description}</span></div>
        {portal.action.kind === "ESTIMATE_DECISION" && <a href="#estimate">Переглянути кошторис ↓</a>}
      </section>}

      <section className={styles.card} id="diagnostics">
        <div className={styles.sectionHead}>
          <div><p>ДІАГНОСТИКА</p><h2>Стан автомобіля</h2></div>
          <span>{issues.length ? `${issues.length} зауважень` : "Без зауважень"}</span>
        </div>
        <div className={styles.diagnosticMetrics}>
          <div><b>{portal.report.counts.checked}</b><span>перевірено</span></div>
          <div className={styles.metricGood}><b>{portal.report.counts.ok}</b><span>норма</span></div>
          <div className={styles.metricWarn}><b>{portal.report.counts.attention}</b><span>увага</span></div>
          <div className={styles.metricBad}><b>{portal.report.counts.defect}</b><span>дефекти</span></div>
        </div>
        {(portal.report.technicalConclusion || portal.report.mechanicComment) && <div className={styles.conclusion}>
          {portal.report.technicalConclusion && <div><small>Технічний висновок</small><p>{portal.report.technicalConclusion}</p></div>}
          {portal.report.mechanicComment && <div><small>Коментар механіка</small><p>{portal.report.mechanicComment}</p></div>}
        </div>}
        {issues.length > 0 && <div className={styles.issueList}>
          {issues.slice(0, 4).map((item, index) => {
            const meta = STATE_META[item.state] || STATE_META.ATTENTION;
            return <div className={`${styles.issue} ${meta.className}`} key={`${item.name}-${index}`}>
              <div className={styles.issueMark}>{meta.mark}</div>
              <div><strong>{item.name}{item.position ? ` · ${item.position}` : ""}</strong><span>{item.finding?.text || item.note || meta.label}</span>{item.finding?.suggestedWorkName && <small>🔧 {item.finding.suggestedWorkName}</small>}</div>
            </div>;
          })}
        </div>}
        <details className={styles.fullReport}>
          <summary>Відкрити повний звіт діагностики</summary>
          <div className={styles.fullReportBody}>
            {portal.report.inspections.map((inspection, inspectionIndex) => <div className={styles.inspection} key={`${inspection.name}-${inspectionIndex}`}>
              <h3>{inspection.name}</h3>
              {inspection.sections.map((section, sectionIndex) => <div className={styles.reportSection} key={`${section.name}-${sectionIndex}`}>
                <strong>{section.name}</strong>
                {section.items.map((item, itemIndex) => {
                  const meta = STATE_META[item.state] || STATE_META.OK;
                  return <div className={styles.reportItem} key={`${item.name}-${itemIndex}`}>
                    <span className={`${styles.reportMark} ${meta.className}`}>{meta.mark}</span>
                    <div><b>{item.name}{item.position ? ` · ${item.position}` : ""}</b><small>{meta.label}{item.measurement ? ` · ${item.measurement}` : ""}</small>{(item.finding?.text || item.note) && <p>{item.finding?.text || item.note}</p>}{item.finding?.mediaIds.length ? <div className={styles.photos}>{item.finding.mediaIds.map((mediaId) => <a key={mediaId} href={`/api/public/diagnostic-report/${encodeURIComponent(token)}/media/${encodeURIComponent(mediaId)}`} target="_blank" rel="noreferrer"><img src={`/api/public/diagnostic-report/${encodeURIComponent(token)}/media/${encodeURIComponent(mediaId)}`} alt={`Фото: ${item.name}`} /></a>)}</div> : null}</div>
                  </div>;
                })}
              </div>)}
            </div>)}
          </div>
        </details>
      </section>

      <section className={styles.card} id="estimate">
        <div className={styles.sectionHead}><div><p>КОШТОРИС</p><h2>Роботи та запчастини</h2></div>{estimate && <span>{ESTIMATE_STATUS[estimate.status] || estimate.status}</span>}</div>
        {estimate ? <>
          <div className={styles.estimateLines}>
            {estimate.lines.map((line) => <div className={styles.estimateLine} key={line.id}>
              <div><strong>{line.description}</strong><small>{line.type === "LABOR" ? "Робота" : line.type === "PART" ? "Запчастина" : "Матеріал / послуга"}{line.brand ? ` · ${line.brand}` : ""}{line.article ? ` · ${line.article}` : ""}</small></div>
              <div><b>{money(line.total, estimate.currency)}</b><small>{line.quantity} {line.unit} × {money(line.unitPrice, estimate.currency)}</small></div>
            </div>)}
          </div>
          <div className={styles.estimateTotals}>
            <div><span>Роботи</span><b>{money(estimate.laborTotal, estimate.currency)}</b></div>
            <div><span>Запчастини</span><b>{money(estimate.partsTotal, estimate.currency)}</b></div>
            {estimate.discountAmount > 0 && <div><span>Знижка</span><b>− {money(estimate.discountAmount, estimate.currency)}</b></div>}
            <div className={styles.grandTotal}><span>Разом</span><strong>{money(estimate.totalAmount, estimate.currency)}</strong></div>
          </div>
          {estimateNeedsDecision ? <div className={styles.decisionBox}>
            <p>Після погодження рішення буде зафіксоване в CRM разом із цією ревізією та сумою кошторису.</p>
            <div className={styles.decisionButtons}>
              <button type="button" className={styles.approveButton} disabled={busy === "estimate"} onClick={() => void decideEstimate("APPROVE")}>✓ Погодити {money(estimate.totalAmount, estimate.currency)}</button>
              <button type="button" className={styles.rejectButton} disabled={busy === "estimate"} onClick={() => void decideEstimate("REJECT")}>Відмовитись / запитати</button>
            </div>
          </div> : estimate.status === "APPROVED" ? <div className={styles.approvedBox}>✓ Кошторис погоджено{estimate.approvedAt ? ` · ${formatDateTime(estimate.approvedAt)}` : ""}</div> : estimate.status === "REJECTED" ? <div className={styles.rejectedBox}>Кошторис відхилено. Менеджер бачить ваше рішення.</div> : null}
        </> : <div className={styles.emptyBlock}>
          <strong>{portal.share.requestedPricingAt ? "Кошторис готується" : "Кошторис ще не сформовано"}</strong>
          <p>{portal.share.requestedPricingAt ? "Запит уже передано сервіс-менеджеру." : "Можна попросити сервіс-менеджера порахувати вартість рекомендованих робіт."}</p>
          {!portal.share.requestedPricingAt && <form method="post" action={`/api/public/diagnostic-report/${encodeURIComponent(token)}/request-pricing`}><button type="submit" className={styles.primaryButton}>Попросити кошторис</button></form>}
        </div>}
      </section>

      <section className={styles.card} id="chat">
        <div className={styles.sectionHead}><div><p>ЗВ'ЯЗОК ІЗ СТО</p><h2>Чат із сервіс-менеджером</h2></div><span className={styles.liveDot}>● онлайн-канал</span></div>
        <p className={styles.chatIntro}>Повідомлення з цього кабінету потрапляють прямо в CRM менеджера. Його відповідь з'явиться тут автоматично.</p>
        <div className={styles.chatBox}>
          {messages.length ? messages.map((message) => <div className={`${styles.message} ${message.direction === "IN" ? styles.messageMine : message.direction === "OUT" ? styles.messageManager : styles.messageSystem}`} key={message.id}>
            <div><strong>{messageAuthor(message)}</strong><time>{formatDateTime(message.sentAt)}</time></div><p>{message.text}</p>
          </div>) : <div className={styles.chatEmpty}><b>Напишіть менеджеру</b><span>Наприклад: «Коли буде готове авто?» або «Чи можна поставити інший бренд запчастин?»</span></div>}
          <div ref={chatEndRef} />
        </div>
        <div className={styles.composer}>
          <textarea rows={2} maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ваше повідомлення…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} />
          <button type="button" disabled={!draft.trim() || busy === "message"} onClick={() => void sendMessage()}>{busy === "message" ? "…" : "➤"}</button>
        </div>
      </section>

      <section className={styles.card} id="documents">
        <div className={styles.sectionHead}><div><p>ДОКУМЕНТИ</p><h2>Документи сервісного випадку</h2></div><span>{portal.documents.length}</span></div>
        <div className={styles.documents}>
          {portal.documents.map((document) => <div key={document.key}><div className={styles.docIcon}>▤</div><div><strong>{document.title}</strong><span>{document.subtitle}</span></div><b>{document.status}</b></div>)}
        </div>
      </section>

      <section className={styles.vehicleInfo} id="vehicle">
        <div><span>VIN</span><strong>{portal.vehicle.vin || "Не вказано"}</strong></div>
        <div><span>Пробіг</span><strong>{portal.vehicle.mileageKm != null ? `${new Intl.NumberFormat("uk-UA").format(portal.vehicle.mileageKm)} км` : "Не вказано"}</strong></div>
        <div><span>Посилання діє до</span><strong>{portal.share.expiresAt ? formatDate(portal.share.expiresAt) : "без обмеження"}</strong></div>
      </section>

      <footer className={styles.footer}><strong>ТУРБО ЛЕВ</strong><p>Особистий кабінет показує актуальні дані цього сервісного випадку та зафіксований звіт діагностики. Якщо склад або ціна робіт зміняться, для погодження буде сформована нова ревізія кошторису.</p></footer>
    </div>

    {notice && <div className={styles.toastGood}>{notice}</div>}
    {error && <div className={styles.toastBad}><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}

    <nav className={styles.bottomNav} aria-label="Навігація особистого кабінету">
      <a href="#home"><span>⌂</span><b>Головна</b></a>
      <a href="#diagnostics"><span>◇</span><b>Авто</b></a>
      <a href="#chat"><span>●</span><b>Чат</b></a>
      <a href="#documents"><span>▤</span><b>Документи</b></a>
    </nav>
  </main>;
}
