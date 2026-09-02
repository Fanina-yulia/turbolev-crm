"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientVehiclePortalDetail } from "@/src/services/client-portal-vehicle.service";
import { CopyableValue } from "@/app/copyable-value";
import { VehiclePlate } from "@/app/vehicle-plate";
import { VehicleRender } from "@/app/vehicle-render";
import styles from "./vehicle-detail.module.css";

type Decision = "APPROVE" | "REJECT";

function money(value: number, currency = "UAH") {
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${new Intl.NumberFormat("uk-UA").format(value)} ${currency}`;
  }
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function lineType(value: string) {
  if (value === "LABOR") return "Робота";
  if (value === "PART") return "Запчастина";
  if (value === "CONSUMABLE") return "Матеріал";
  if (value === "EXTERNAL") return "Стороння робота";
  return "Інше";
}

function urgency(value: string) {
  if (value === "CRITICAL") return "Критично";
  if (value === "WARNING") return "Потребує уваги";
  return "Інформація";
}

function statusClass(tone: ClientVehiclePortalDetail["vehicle"]["status"]["tone"]) {
  if (tone === "success") return styles.statusSuccess;
  if (tone === "warning") return styles.statusWarning;
  if (tone === "danger") return styles.statusDanger;
  if (tone === "info") return styles.statusInfo;
  return styles.statusNeutral;
}

function statusDotClass(tone: ClientVehiclePortalDetail["vehicle"]["status"]["tone"]) {
  if (tone === "success") return styles.dotSuccess;
  if (tone === "warning") return styles.dotWarning;
  if (tone === "danger") return styles.dotDanger;
  return styles.dotNeutral;
}

export function VehicleDetailClient({ initialDetail }: { initialDetail: ClientVehiclePortalDetail }) {
  const [detail, setDetail] = useState(initialDetail);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(
    initialDetail.estimate?.lines.filter((line) => line.decision).map((line) => [line.id, line.decision as Decision]) || [],
  ));
  const [note, setNote] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatRef = useRef<HTMLElement | null>(null);

  const estimate = detail.estimate;
  const selectedCount = estimate ? estimate.lines.filter((line) => Boolean(decisions[line.id])).length : 0;
  const allSelected = Boolean(estimate?.lines.length && selectedCount === estimate.lines.length);
  const approvedSum = useMemo(() => estimate
    ? estimate.lines.reduce((sum, line) => decisions[line.id] === "APPROVE" ? sum + line.total : sum, 0)
    : 0, [estimate, decisions]);

  useEffect(() => {
    const vehicleId = detail.vehicle.id;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/public/diagnostic-report/client-session/vehicles/${encodeURIComponent(vehicleId)}/messages`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as { ok?: boolean; chat?: ClientVehiclePortalDetail["chat"] } | null;
        if (response.ok && body?.ok && body.chat) setDetail((current) => ({ ...current, chat: body.chat! }));
      } catch {
        // Background polling stays silent; explicit send surfaces errors.
      }
    }, 12000);
    return () => window.clearInterval(timer);
  }, [detail.vehicle.id]);

  function choose(lineId: string, decision: Decision) {
    if (estimate?.selectionSubmitted || estimate?.status !== "SENT") return;
    setDecisions((current) => ({ ...current, [lineId]: decision }));
    setDecisionError("");
  }

  function chooseAll(decision: Decision) {
    if (!estimate || estimate.selectionSubmitted || estimate.status !== "SENT") return;
    setDecisions(Object.fromEntries(estimate.lines.map((line) => [line.id, decision])));
    setDecisionError("");
  }

  async function submitDecisions() {
    if (!estimate || decisionBusy || estimate.selectionSubmitted || estimate.status !== "SENT") return;
    if (!allSelected) {
      setDecisionError("Оберіть «Погодити» або «Відмовитись» для кожної позиції.");
      return;
    }
    const approved = estimate.lines.filter((line) => decisions[line.id] === "APPROVE").length;
    const rejected = estimate.lines.length - approved;
    const summary = rejected === 0
      ? `Погодити всі ${approved} позицій на ${money(estimate.totalAmount, estimate.currency)}?`
      : approved === 0
        ? `Відмовитись від усіх ${rejected} позицій кошторису?`
        : `Надіслати менеджеру вибір: погоджено ${approved}, відмовлено ${rejected}?`;
    if (!window.confirm(summary)) return;

    setDecisionBusy(true);
    setDecisionError("");
    try {
      const response = await fetch(`/api/public/diagnostic-report/client-session/vehicles/${encodeURIComponent(detail.vehicle.id)}/estimate-decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimateId: estimate.id,
          decisions: estimate.lines.map((line) => ({ lineId: line.id, decision: decisions[line.id] })),
          note,
        }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; detail?: ClientVehiclePortalDetail; message?: string } | null;
      if (!response.ok || !body?.ok || !body.detail) throw new Error(body?.message || "Не вдалося зберегти Ваш вибір.");
      setDetail(body.detail);
      setDecisions(Object.fromEntries(body.detail.estimate?.lines.filter((line) => line.decision).map((line) => [line.id, line.decision as Decision]) || []));
      setNote("");
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "Не вдалося зберегти Ваш вибір.");
    } finally {
      setDecisionBusy(false);
    }
  }

  function askAboutLine(description: string) {
    setChatText(`Питання щодо позиції «${description}»: `);
    window.setTimeout(() => chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function sendMessage() {
    const text = chatText.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatError("");
    try {
      const response = await fetch(`/api/public/diagnostic-report/client-session/vehicles/${encodeURIComponent(detail.vehicle.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, workOrderId: detail.service.workOrderId }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: ClientVehiclePortalDetail["chat"]["messages"][number]; messageText?: string } | null;
      if (!response.ok || !body?.ok || !body.message) throw new Error((body as { message?: string } | null)?.message || "Не вдалося надіслати повідомлення.");
      setDetail((current) => ({ ...current, chat: { ...current.chat, messages: [...current.chat.messages, body.message!] } }));
      setChatText("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Не вдалося надіслати повідомлення.");
    } finally {
      setChatBusy(false);
    }
  }

  return <main className={styles.page} data-crm-surface="public">
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><img className={styles.logo} data-crm-logo-slot="public" data-crm-default-src="/brand/turbolev-logo.png" src="/brand/turbolev-logo.png" alt="Turbo LEV" /><div><strong>ТУРБО <b>ЛЕВ</b></strong><span>Моє авто</span></div></div>
        <a className={styles.back} href="/my">← До списку автомобілів</a>
      </header>

      <section className={styles.vehicleCard}>
        <div className={styles.vehiclePhoto}>
          <VehicleRender
            id={detail.vehicle.id}
            brand={detail.vehicle.brand}
            model={detail.vehicle.model}
            year={detail.vehicle.year}
            updatedAt={detail.vehicle.updatedAt}
            size="hero"
            eager
            interactiveMissing
          />
        </div>
        <div className={styles.vehicleSummary}>
          <p className={styles.vehicleEyebrow}>КАРТКА АВТОМОБІЛЯ</p>
          <h1>{detail.vehicle.label}{detail.vehicle.year ? ` ${detail.vehicle.year}` : ""}</h1>
          <div className={styles.vehicleIdentifiers}>
            <VehiclePlate value={detail.vehicle.plateNumber} size="md" />
            {detail.vehicle.vin ? <span className={styles.vinValue}>VIN <CopyableValue value={detail.vehicle.vin} label="VIN" /></span> : null}
          </div>
          <span className={`${styles.status} ${statusClass(detail.vehicle.status.tone)}`}>{detail.vehicle.status.label}</span>
        </div>
        <nav className={styles.vehicleTabs} aria-label="Розділи картки автомобіля">
          <a className={styles.tabActive} href="#diagnostics"><span className={`${styles.tabDot} ${statusDotClass(detail.vehicle.status.tone)}`} />Діагностична карта</a>
          <a className={styles.tabCommercial} href="#estimate"><span className={styles.tabDot} />Комерційна пропозиція</a>
          <a className={styles.tabHistory} href="#history"><span className={styles.tabDot} />Сервісна історія</a>
        </nav>
      </section>

      <section className={styles.ownerSection}>
        <div className={styles.sectionTitle}><p>ВЛАСНИК</p><h2>Контактна інформація</h2></div>
        <div className={styles.ownerCard}>
          <div className={styles.ownerCopy}>
            <strong>{detail.client.name || "Власник не вказаний"}</strong>
            <span>{detail.client.phoneMasked || "Телефон не вказаний"}</span>
          </div>
          <span className={styles.ownerArrow} aria-hidden="true">›</span>
          <div className={styles.ownerActions}>
            <a href="#chat" aria-label="Написати менеджеру" title="Написати менеджеру">💬</a>
            <a href="#documents" aria-label="Відкрити документи" title="Документи">▤</a>
            <a href="#history" aria-label="Відкрити сервісну історію" title="Сервісна історія">◷</a>
          </div>
        </div>
      </section>

      <section className={styles.technicalSection}>
        <div className={styles.sectionTitle}><p>ДАНІ АВТОМОБІЛЯ</p><h2>Технічні дані</h2></div>
        <div className={styles.technicalGrid}>
          <div><span>Марка</span><b>{detail.vehicle.brand || "—"}</b></div>
          <div><span>Модель</span><b>{detail.vehicle.model || "—"}</b></div>
          <div><span>Рік</span><b>{detail.vehicle.year || "—"}</b></div>
          <div><span>VIN</span><b>{detail.vehicle.vin ? <CopyableValue value={detail.vehicle.vin} label="VIN" /> : "—"}</b></div>
          <div><span>Пробіг</span><b>{detail.vehicle.mileageKm != null ? `${new Intl.NumberFormat("uk-UA").format(detail.vehicle.mileageKm)} км` : "—"}</b></div>
          <div><span>Статус</span><b className={styles.technicalStatus}>{detail.vehicle.status.label}</b></div>
        </div>
      </section>

      <a className={styles.newRequest} href="#chat">+ Нова заявка</a>

      {detail.vehicle.status.code !== "OUTSIDE_SERVICE" ? <section className={styles.timelineSection} id="diagnostics">
        <div className={styles.sectionTitle}><p>ПОТОЧНИЙ РЕМОНТ</p><h2>Етап автомобіля</h2></div>
        <div className={styles.timeline}>
          {detail.service.stages.map((stage, index) => <div className={`${styles.stage} ${stage.state === "DONE" ? styles.stageDone : stage.state === "CURRENT" ? styles.stageCurrent : ""}`} key={stage.key}>
            <div className={styles.stageDot}>{stage.state === "DONE" ? "✓" : index + 1}</div><span>{stage.label}</span>
          </div>)}
        </div>
        <div className={styles.serviceFacts}>
          <div><span>Пост</span><b>{detail.service.postName || "—"}</b></div>
          <div><span>Заїзд</span><b>{dateTime(detail.service.actualArrivalAt || detail.service.plannedStartAt)}</b></div>
          <div><span>Орієнтовна готовність</span><b>{dateTime(detail.service.plannedEndAt || detail.vehicle.eta)}</b></div>
        </div>
      </section> : <section className={styles.calmCard}><b>Автомобіль зараз не перебуває в активному сервісному випадку.</b><span>Історія попередніх робіт і документи залишаються доступними нижче.</span></section>}

      {estimate ? <section className={styles.approvalSection} id="estimate">
        <div className={styles.approvalHeader}>
          <div><p>ПОТРІБНА ВАША ДІЯ</p><h2>Кошторис · ревізія {estimate.revision}</h2><span>{estimate.lines.length} позицій · {money(estimate.totalAmount, estimate.currency)}</span></div>
          <div className={styles.approvalTotal}><small>Ваш вибір</small><b>{money(approvedSum, estimate.currency)}</b></div>
        </div>

        {estimate.status === "SENT" && !estimate.selectionSubmitted ? <>
          <div className={styles.quickActions}>
            <button type="button" onClick={() => chooseAll("APPROVE")}>Погодити все</button>
            <button type="button" onClick={() => chooseAll("REJECT")}>Відмовитись від усього</button>
            <span>{selectedCount}/{estimate.lines.length} рішень</span>
          </div>
          <div className={styles.estimateLines}>
            {estimate.lines.map((line) => <article className={`${styles.estimateLine} ${decisions[line.id] === "APPROVE" ? styles.lineApproved : decisions[line.id] === "REJECT" ? styles.lineRejected : ""}`} key={line.id}>
              <div className={styles.lineTop}><span>{lineType(line.type)}</span>{line.requiredForRepair ? <em>Потрібно для ремонту</em> : <em>Рекомендовано</em>}</div>
              <h3>{line.description}</h3>
              {(line.brand || line.article) ? <p>{[line.brand, line.article].filter(Boolean).join(" · ")}</p> : null}
              <div className={styles.linePrice}><span>{line.quantity} {line.unit} × {money(line.unitPrice, estimate.currency)}</span><b>{money(line.total, estimate.currency)}</b></div>
              <div className={styles.lineActions}>
                <button type="button" className={decisions[line.id] === "APPROVE" ? styles.approveActive : ""} onClick={() => choose(line.id, "APPROVE")}>✓ Погодити</button>
                <button type="button" className={decisions[line.id] === "REJECT" ? styles.rejectActive : ""} onClick={() => choose(line.id, "REJECT")}>× Відмовитись</button>
                <button type="button" onClick={() => askAboutLine(line.description)}>Запитати менеджера</button>
              </div>
            </article>)}
          </div>
          <label className={styles.noteField}><span>Коментар до вибору — за бажанням</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Наприклад: цю роботу зробимо наступного разу" /></label>
          {decisionError ? <p className={styles.error}>{decisionError}</p> : null}
          <button type="button" className={styles.submitDecision} onClick={() => void submitDecisions()} disabled={decisionBusy || !allSelected}>{decisionBusy ? "Зберігаємо…" : "Надіслати мій вибір менеджеру"}</button>
          <small className={styles.legalNote}>Фіксується точна ревізія кошторису, кожна позиція та час Вашого рішення. Якщо склад або ціни зміняться, менеджер надішле нову ревізію.</small>
        </> : <div className={styles.selectionResult}>
          <strong>{estimate.status === "APPROVED" ? "Кошторис погоджено" : estimate.status === "REJECTED" ? "Кошторис відхилено" : estimate.selectionSubmitted ? "Ваш вибір передано менеджеру" : "Рішення зафіксовано"}</strong>
          <p>{estimate.selectionMode === "MIXED" ? "Ви погодили частину позицій. Менеджер перевіряє вибір і за потреби сформує нову ревізію кошторису." : estimate.status === "APPROVED" ? "Усі позиції погоджені. СТО може продовжувати роботи відповідно до workflow." : estimate.status === "REJECTED" ? "Відмова зафіксована в CRM." : "Рішення збережено."}</p>
          {estimate.lines.some((line) => line.decision) ? <div className={styles.lockedLines}>{estimate.lines.map((line) => <div key={line.id}><span>{line.description}</span><b className={line.decision === "APPROVE" ? styles.choiceYes : styles.choiceNo}>{line.decision === "APPROVE" ? "Погоджено" : line.decision === "REJECT" ? "Відмовлено" : "—"}</b></div>)}</div> : null}
        </div>}
      </section> : null}

      {detail.findings.length ? <section className={styles.section}>
        <div className={styles.sectionTitle}><p>ФОТО / ВІДЕО</p><h2>Що побачив механік</h2></div>
        <div className={styles.findings}>{detail.findings.map((finding) => <article className={styles.finding} key={finding.id}>
          <div className={styles.findingHead}><span>{urgency(finding.urgency)}</span><small>{dateTime(finding.submittedAt)}</small></div>
          <h3>{finding.text}</h3>
          {finding.recommendation ? <p><b>Рекомендація:</b> {finding.recommendation}</p> : null}
          {finding.managerComment ? <p><b>Коментар менеджера:</b> {finding.managerComment}</p> : null}
          {finding.media.length ? <div className={styles.mediaGrid}>{finding.media.map((media) => media.mimeType.startsWith("image/")
            ? <a href={media.url} target="_blank" rel="noreferrer" key={media.id}><img src={media.url} alt={finding.text} /></a>
            : media.mimeType.startsWith("video/")
              ? <video controls preload="metadata" src={media.url} key={media.id} />
              : <a className={styles.fileLink} href={media.url} target="_blank" rel="noreferrer" key={media.id}>{media.fileName}</a>)}</div> : null}
        </article>)}</div>
      </section> : null}

      <section className={styles.section} id="documents">
        <div className={styles.sectionTitle}><p>ДОКУМЕНТИ</p><h2>По цьому автомобілю</h2></div>
        {detail.documents.length ? <div className={styles.documents}>{detail.documents.map((document) => <article key={document.key}><div><strong>{document.title}</strong><span>{document.subtitle}</span></div><div><b>{document.status}</b><small>{date(document.date)}</small></div></article>)}</div> : <div className={styles.empty}>Документів ще немає.</div>}
      </section>

      <section className={styles.section} id="history">
        <div className={styles.sectionTitle}><p>ІСТОРІЯ</p><h2>Сервісна історія</h2></div>
        {detail.history.length ? <div className={styles.history}>{detail.history.map((item) => <article key={`${item.kind}:${item.id}`}><div><small>{date(item.date)}</small><strong>{item.title}</strong><span>{item.subtitle}</span></div><div><b>{item.status}</b>{item.amount != null ? <strong>{money(item.amount, item.currency || "UAH")}</strong> : null}</div></article>)}</div> : <div className={styles.empty}>Історія цього автомобіля ще порожня.</div>}
      </section>

      <section className={styles.section} id="chat" ref={chatRef}>
        <div className={styles.sectionTitle}><p>ЗВ'ЯЗОК ІЗ СТО</p><h2>Чат по цьому авто</h2></div>
        <div className={styles.chatMessages}>{detail.chat.messages.length ? detail.chat.messages.map((message) => <div className={`${styles.message} ${message.direction === "IN" ? styles.messageClient : message.direction === "OUT" ? styles.messageManager : styles.messageSystem}`} key={message.id}><p>{message.text}</p><small>{dateTime(message.sentAt)}</small></div>) : <div className={styles.empty}>Напишіть сервіс-менеджеру. Повідомлення буде прив’язане саме до цього автомобіля.</div>}</div>
        <div className={styles.chatComposer}><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={2000} placeholder="Написати сервіс-менеджеру…" /><button type="button" disabled={chatBusy || !chatText.trim()} onClick={() => void sendMessage()}>{chatBusy ? "…" : "Надіслати"}</button></div>
        {chatError ? <p className={styles.error}>{chatError}</p> : null}
      </section>

      <nav className={styles.bottomNav} aria-label="Навігація особистого кабінету">
        <a href="/my"><span>⌂</span>Гараж</a>
        <a href="#top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span>◆</span>Авто</a>
        <a href="#chat"><span>💬</span>Чат</a>
        <a href="#documents"><span>▤</span>Документи</a>
      </nav>
    </div>
  </main>;
}
