"use client";

import { useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
import { navigateCrm } from "./crm-route";
import { VehiclePlate } from "./vehicle-plate";
import { VehicleRender } from "./vehicle-render";
import styles from "./structured-diagnostic-review-panel.module.css";

type Media = { id: string; fileName: string };
type Item = {
  id: string | null;
  templateItemId: string;
  name: string;
  position: string | null;
  measurementUnit: string | null;
  state: string;
  measurementValue: string | null;
  measurementText: string | null;
  note: string | null;
  finding: null | { id?: string; action: string; urgency: string; findingText: string | null; suggestedWorkName: string | null; suggestedPartName: string | null; media: Media[] };
};
type Counts = { total: number; checked: number; ok: number; attention: number; defect: number };
type Section = { id: string; name: string; counts: Counts; items: Item[] };
type Inspection = { id: string; templateName: string; status: string; startedAt?: string | null; completedAt?: string | null; counts: Counts; sections: Section[] };
type View = {
  diagnostic: {
    id: string;
    status: string;
    workflowState: string;
    createdAt: string;
    updatedAt: string;
    confirmedAt: string | null;
    technicalConclusion: string | null;
    problem: string | null;
    client: { id: string; name: string | null; phone: string };
    vehicle: {
      id: string;
      label: string;
      brand: string | null;
      model: string | null;
      year: number | null;
      plateNumber: string | null;
      vin: string | null;
      mileageKm: number | null;
      engineName?: string | null;
      engineVolumeCm3?: number | null;
      fuelType?: string | null;
      driveType?: string | null;
      bodyType?: string | null;
      updatedAt?: string | null;
    };
    mechanic?: { id: string; name: string } | null;
    assignment: { locationId: string | null; mechanicId: string | null } | null;
    review: { state: string; mechanicComment: string | null; managerComment: string | null; submittedAt: string | null; returnedAt: string | null; confirmedAt: string | null };
    workOrder: { id: string; status: string } | null;
  };
  inspections: Inspection[];
  counts: Counts;
  suggestedTechnicalConclusion?: string | null;
};
type DiagnosticCardState = {
  card: null | { id: string; number: string; currentRevision: number; finalizedAt: string | null };
  latest?: null | { revision: number; kind: "REVIEW" | "FINAL"; createdAt: string };
  final?: null | { revision: number; kind: "FINAL"; createdAt: string };
};
type CommercialLine = {
  id: string;
  type: string;
  status: string;
  description: string;
  code?: string | null;
  article?: string | null;
  brand?: string | null;
  unit: string;
  currency: string;
  plannedQuantity: string | number;
  plannedUnitPrice: string | number;
  plannedDiscount: string | number;
};
type CommercialView = {
  lines: CommercialLine[];
  estimate: null | {
    id: string;
    revision: number;
    status: string;
    currency: string;
    subtotal: string | number;
    discountAmount: string | number;
    totalAmount: string | number;
    laborTotal: string | number;
    partsTotal: string | number;
    approvedAt?: string | null;
    approvedByName?: string | null;
  };
  estimateApproved?: boolean;
  estimateIsCurrent?: boolean;
  partsRequest?: { id: string; status: string } | null;
};

const actionLabels: Record<string, string> = { NONE: "Без дії", REPLACE: "Замінити", REPAIR: "Ремонтувати", ADJUST: "Відрегулювати", CLEAN: "Очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "Додаткова діагностика" };
const urgencyLabels: Record<string, string> = { INFO: "Рекомендація", CRITICAL: "Критично" };
const reviewLabels: Record<string, string> = { DRAFT: "Чернетка", SUBMITTED: "На перевірці", RETURNED: "В роботі", CONFIRMED: "Підтверджена ДК" };

function countLabel(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many}`;
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}

function formatMoney(value: string | number | null | undefined, currency = "UAH") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(number) ? number : 0);
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineTotal(line: CommercialLine) {
  return Math.max(0, numeric(line.plannedQuantity) * numeric(line.plannedUnitPrice) - numeric(line.plannedDiscount));
}

function durationLabel(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "—";
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} год ${rest ? `${rest} хв` : ""}`.trim() : `${rest} хв`;
}

function vehicleTitle(vehicle: View["diagnostic"]["vehicle"]) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Автомобіль";
}

function engineLabel(vehicle: View["diagnostic"]["vehicle"]) {
  if (vehicle.engineName) return vehicle.engineName;
  const volume = vehicle.engineVolumeCm3 ? `${(vehicle.engineVolumeCm3 / 1000).toFixed(1)} л` : null;
  return [volume, vehicle.fuelType].filter(Boolean).join(" ") || "—";
}

function priorityLabel(urgency: string | null | undefined) {
  if (!urgency || urgency === "SOON") return null;
  return urgencyLabels[urgency] || urgency;
}

export function StructuredDiagnosticReviewPanel({ diagnosticId, onChanged }: { diagnosticId: string; onChanged: () => void | Promise<void> }) {
  const [view, setView] = useState<View | null>(null);
  const [cardState, setCardState] = useState<DiagnosticCardState>({ card: null });
  const [commercial, setCommercial] = useState<CommercialView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [technicalConclusion, setTechnicalConclusion] = useState("");
  const [showFullInspection, setShowFullInspection] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [response, cardResponse] = await Promise.all([
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }),
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/card`, { cache: "no-store", credentials: "include" }),
      ]);
      const body = await response.json().catch(() => null) as (View & { ok?: boolean; message?: string; error?: string }) | null;
      const cardBody = await cardResponse.json().catch(() => null) as (DiagnosticCardState & { ok?: boolean }) | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити Діагностичну карту");
      setView(body);
      setManagerComment(body.diagnostic?.review?.managerComment || "");
      setTechnicalConclusion(body.diagnostic?.technicalConclusion || "");
      if (cardResponse.ok && cardBody?.ok) setCardState({ card: cardBody.card || null, latest: cardBody.latest || null, final: cardBody.final || null });
      else setCardState({ card: null });

      const workOrderId = body.diagnostic?.workOrder?.id;
      if (workOrderId) {
        const [linesResponse, estimateResponse] = await Promise.all([
          fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/lines`, { cache: "no-store", credentials: "include" }),
          fetch(`/api/work-orders/${encodeURIComponent(workOrderId)}/estimate`, { cache: "no-store", credentials: "include" }),
        ]);
        const linesBody = await linesResponse.json().catch(() => null) as { ok?: boolean; lines?: CommercialLine[] } | null;
        const estimateBody = await estimateResponse.json().catch(() => null) as { ok?: boolean; commercial?: CommercialView } | null;
        setCommercial({
          lines: linesBody?.ok && Array.isArray(linesBody.lines) ? linesBody.lines : [],
          estimate: estimateBody?.ok ? estimateBody.commercial?.estimate || null : null,
          estimateApproved: estimateBody?.ok ? estimateBody.commercial?.estimateApproved : false,
          estimateIsCurrent: estimateBody?.ok ? estimateBody.commercial?.estimateIsCurrent : false,
          partsRequest: estimateBody?.ok ? estimateBody.commercial?.partsRequest || null : null,
        });
      } else {
        setCommercial(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [diagnosticId]);

  const findings = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ inspection: inspection.templateName, section: section.name, item })))) || [], [view]);
  const findingGroups = useMemo(() => {
    const groups = new Map<string, typeof findings>();
    for (const finding of findings) groups.set(finding.section, [...(groups.get(finding.section) || []), finding]);
    return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
  }, [findings]);
  const criticalCount = useMemo(() => findings.filter(({ item }) => item.finding?.urgency === "CRITICAL").length, [findings]);
  const recommendationCount = useMemo(() => findings.filter(({ item }) => item.finding?.urgency === "INFO").length, [findings]);
  const diagnosticTimes = useMemo(() => {
    const starts = view?.inspections.map((item) => item.startedAt).filter(Boolean).map((value) => new Date(value as string).getTime()) || [];
    const ends = view?.inspections.map((item) => item.completedAt).filter(Boolean).map((value) => new Date(value as string).getTime()) || [];
    return { start: starts.length ? new Date(Math.min(...starts)).toISOString() : null, end: ends.length ? new Date(Math.max(...ends)).toISOString() : null };
  }, [view]);
  const activeLines = useMemo(() => commercial?.lines.filter((line) => line.status !== "CANCELLED") || [], [commercial]);
  const laborLines = useMemo(() => activeLines.filter((line) => line.type === "LABOR"), [activeLines]);
  const partLines = useMemo(() => activeLines.filter((line) => line.type === "PART"), [activeLines]);
  const otherLines = useMemo(() => activeLines.filter((line) => line.type !== "LABOR" && line.type !== "PART"), [activeLines]);
  const recommendedWorks = useMemo(() => Array.from(new Set(findings.map(({ item }) => item.finding?.suggestedWorkName).filter((value): value is string => Boolean(value)))), [findings]);
  const recommendedParts = useMemo(() => Array.from(new Set(findings.map(({ item }) => item.finding?.suggestedPartName).filter((value): value is string => Boolean(value)))), [findings]);

  async function returnToMechanic() {
    if (!view) return;
    if (!managerComment.trim()) { setError("Вкажіть, що саме механіку потрібно уточнити."); return; }
    if (!confirm("Повернути Діагностичну карту механіку в роботу?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/structured`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RETURN", managerComment }) });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося повернути діагностику");
      setMessage("Діагностичну карту повернено механіку в роботу. Коментар менеджера збережено.");
      await load();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function confirmDiagnosticCard() {
    if (!view || !confirm("Підтвердити Діагностичну карту? Після підтвердження її фінальна ревізія буде зафіксована.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CONFIRMED", technicalConclusion: technicalConclusion.trim() }) });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося підтвердити Діагностичну карту");
      setMessage("Діагностичну карту підтверджено. Це фінальний технічний документ; ціни та розрахунок формуються окремо в Комерційній пропозиції.");
      await load();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка підтвердження Діагностичної карти"); }
    finally { setBusy(false); }
  }

  async function createCommercialProposal() {
    if (!view || !confirm("Створити Комерційну пропозицію з рекомендованих робіт і деталей цієї Діагностичної карти?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/commercial-proposal`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as { ok?: boolean; handoff?: { counts?: { parts?: number; labor?: number } }; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося створити Комерційну пропозицію");
      const parts = Number(body.handoff?.counts?.parts || 0);
      const works = Number(body.handoff?.counts?.labor || 0);
      setMessage(`Комерційну пропозицію створено: ${works} робіт · ${parts} деталей.`);
      await load();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка створення Комерційної пропозиції"); }
    finally { setBusy(false); }
  }

  function openPartsSelection() {
    if (!view) return;
    navigateCrm("Підбір запчастин", { diagnosticId, vehicleId: view.diagnostic.vehicle.id, plate: view.diagnostic.vehicle.plateNumber || "", vin: view.diagnostic.vehicle.vin || "" });
  }

  function openCommercialProposal(tab = "estimate") {
    if (!view?.diagnostic.workOrder) return;
    navigateCrm("Комерційна пропозиція", { workOrderId: view.diagnostic.workOrder.id, workOrderTab: tab });
  }

  if (loading) return <div className={styles.state}>Завантажую Діагностичну карту…</div>;
  if (error && !view) return <div className={styles.error}>{error}<button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!view || !view.inspections.length) return null;

  const confirmed = view.diagnostic.review.state === "CONFIRMED" && view.diagnostic.status === "CONFIRMED";
  const estimateApproved = Boolean(commercial?.estimateApproved && commercial.estimateIsCurrent);
  const cardNumber = cardState.card?.number || "Результати діагностики";
  const automaticConclusion = view.suggestedTechnicalConclusion?.trim() || "";
  const diagnosticState = estimateApproved ? "ПОГОДЖЕНО КЛІЄНТОМ" : confirmed ? "ПІДТВЕРДЖЕНА ДК" : reviewLabels[view.diagnostic.review.state] || view.diagnostic.review.state;
  const revisionState = confirmed ? `ФІНАЛЬНА РЕВІЗІЯ${cardState.final?.revision ? ` · ${cardState.final.revision}` : ""}` : "РЕВІЗІЯ REVIEW";
  const totalAmount = commercial?.estimate?.totalAmount ?? activeLines.reduce((sum, line) => sum + lineTotal(line), 0);
  const currency = commercial?.estimate?.currency || activeLines[0]?.currency || "UAH";
  const vehicle = view.diagnostic.vehicle;
  const title = vehicleTitle(vehicle);
  const defaultNextTitle = estimateApproved ? "Заплануйте ремонт" : confirmed ? "Підготуйте пропозицію для клієнта" : "Перевірте результати діагностики";
  const defaultNextDescription = estimateApproved ? "Обрані роботи та деталі погоджені клієнтом." : confirmed ? "ДК завершена. Наступний крок — підбір деталей і формування КП." : "Після перевірки фактів підтвердьте Діагностичну карту.";

  return <section className={styles.panel}>
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.state}>{message}</div>}

    <section className={styles.identityCard}>
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}><h3>ДІАГНОСТИЧНА КАРТА</h3><p>{cardNumber} <i>·</i> Створено: {formatDate(view.diagnostic.createdAt, true)} <i>·</i> Механік: {view.diagnostic.mechanic?.name || "Не призначено"}</p></div>
      <div className={styles.headerStatuses}><span className={`${styles.statusPill} ${estimateApproved ? styles.statusGood : styles.statusReview}`}>{estimateApproved ? "✓ " : ""}{diagnosticState}</span><span className={`${styles.revisionPill} ${confirmed ? styles.revisionGood : ""}`}>{revisionState}</span>{!confirmed && <button type="button" className={styles.inspectionToggle} onClick={() => setShowFullInspection((value) => !value)}>{showFullInspection ? "Сховати повну перевірку" : "Повна перевірка"}</button>}</div>
    </header>

    <section className={styles.vehicleHero} aria-label="Ідентичність автомобіля">
      <div className={styles.vehicleImage}><VehicleRender id={vehicle.id} brand={vehicle.brand} model={vehicle.model} year={vehicle.year} updatedAt={vehicle.updatedAt} size="hero" eager /></div>
      <div className={styles.vehicleMain}><h2>{title}{vehicle.year ? ` ${vehicle.year}` : ""}</h2><div className={styles.vehicleSpecs}><div><span>Двигун</span><strong>{engineLabel(vehicle)}</strong></div><div><span>Пробіг</span><strong>{vehicle.mileageKm != null ? `${vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</strong></div><div><span>Держ. номер</span><strong><VehiclePlate value={vehicle.plateNumber} size="sm" /></strong></div><div><span>VIN</span><strong className={styles.vin}>{vehicle.vin || "—"}</strong></div></div></div>
      <div className={styles.clientCard}><span className={styles.clientIcon} aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="10" r="5" /><path d="M6 27c.9-5.6 4.2-8.5 10-8.5S25.1 21.4 26 27" /></svg></span><div><span>Клієнт</span><strong>{view.diagnostic.client.name || "Без імені"}</strong><small>{view.diagnostic.client.phone}</small></div></div>
    </section
    </section>>

    <section className={styles.dashboardGrid}>
      <article className={`${styles.dashboardCard} ${styles.resultCard}`}>
        <div className={styles.cardHeading}><h4>Результат діагностики</h4><span className={confirmed ? styles.headingGood : styles.headingReview}>{confirmed ? "Завершена" : reviewLabels[view.diagnostic.review.state] || "В роботі"}</span></div>
        <div className={`${styles.completionCallout} ${confirmed ? styles.completionGood : ""}`}><span className={styles.completionIcon}>{confirmed ? "✓" : "!"}</span><div><strong>{confirmed ? "Діагностика завершена" : "Діагностика потребує перевірки"}</strong><small>Автомобіль перевірено за {view.counts.checked} з {view.counts.total} пунктів</small></div></div>
        <div className={styles.resultStats}><div><span>Системи без критичних зауважень</span><strong className={styles.greenText}>{view.counts.ok}</strong></div><div><span>Потрібна увага</span><strong className={styles.yellowText}>{view.counts.attention}</strong></div><div><span>Рекомендації</span><strong className={styles.blueText}>{recommendationCount}</strong></div></div>
        <dl className={styles.metaList}><div><dt>Дата діагностики</dt><dd>{formatDate(diagnosticTimes.start || view.diagnostic.createdAt, true)}</dd></div><div><dt>Тривалість</dt><dd>{durationLabel(diagnosticTimes.start, diagnosticTimes.end)}</dd></div><div><dt>Виконавець</dt><dd>{view.diagnostic.mechanic?.name || "Не призначено"}</dd></div><div><dt>Метод діагностики</dt><dd>Комплексна</dd></div><div><dt>Статус</dt><dd className={estimateApproved ? styles.greenText : ""}>{diagnosticState}</dd></div><div><dt>Етап</dt><dd className={confirmed ? styles.greenText : ""}>{revisionState}</dd></div></dl>
      </article>

      <article className={`${styles.dashboardCard} ${styles.findingsCard}`}>
        <div className={styles.cardHeading}><h4>Виявлені дефекти</h4><span className={findings.length ? styles.headingDanger : styles.headingGood}>{findings.length ? countLabel(findings.length, "позиція", "позиції", "позицій") : "Зауважень немає"}</span></div>
        {findingGroups.length ? <div className={styles.findingGroups}>{findingGroups.map((group, groupIndex) => { const defectCount = group.items.filter(({ item }) => item.state === "DEFECT").length; return <details key={group.name} open={groupIndex < 2 || defectCount > 0}><summary><span className={defectCount ? styles.groupIconDanger : styles.groupIconAttention}>!</span><strong>{group.name}</strong><b>{group.items.length}</b><i>⌄</i></summary><div className={styles.groupItems}>{group.items.map(({ item }) => <FindingCompact key={item.id || item.templateItemId} item={item} />)}</div></details>; })}</div> : <div className={styles.emptyCard}><span>✓</span><p>Критичних дефектів не виявлено.</p></div>}
      </article>

      <article className={`${styles.dashboardCard} ${styles.proposalCard}`}>
        <div className={styles.cardHeading}><h4>{estimateApproved ? "Погоджені роботи та деталі" : commercial ? "Роботи та деталі" : "Рекомендовані роботи та деталі"}</h4><span className={estimateApproved ? styles.headingGood : styles.headingReview}>{estimateApproved ? "Погоджено" : commercial?.estimate?.status === "SENT" ? "Очікує погодження" : commercial ? "Чернетка КП" : "Ще не сформовано"}</span></div>
        {commercial && activeLines.length ? <><div className={styles.lineTableHead}><span>Роботи та деталі</span><span>К-ть</span><span>Сума, грн</span></div><LineGroup title="Роботи" lines={laborLines} total={commercial.estimate?.laborTotal ?? laborLines.reduce((sum, line) => sum + lineTotal(line), 0)} currency={currency} tone="work" /><LineGroup title="Деталі" lines={partLines} total={commercial.estimate?.partsTotal ?? partLines.reduce((sum, line) => sum + lineTotal(line), 0)} currency={currency} tone="part" />{otherLines.length ? <LineGroup title="Інші позиції" lines={otherLines} total={otherLines.reduce((sum, line) => sum + lineTotal(line), 0)} currency={currency} tone="other" /> : null}<div className={styles.totalRow}><span>Разом до оплати</span><strong>{formatMoney(totalAmount, currency)}</strong></div></> : <><RecommendationGroup title="Роботи" items={recommendedWorks} /><RecommendationGroup title="Деталі" items={recommendedParts} /><div className={styles.proposalEmpty}>{confirmed ? "Створіть КП, щоб додати ціни, оригінали та аналоги постачальників." : "Позиції з’являться після підтвердження Діагностичної карти."}</div></>}
      </article>
    </section>

    <section className={styles.nextAction}><div className={styles.nextActionIcon} aria-hidden="true">▣</div><div className={styles.nextActionCopy}><span>НАСТУПНИЙ КРОК</span><strong>{defaultNextTitle}</strong><small>{defaultNextDescription}</small></div><div className={styles.nextActionButtons}><button type="button" className={styles.secondaryButton} onClick={openPartsSelection} disabled={!confirmed}>☷&nbsp; Перейти до підбору запчастин</button>{estimateApproved && view.diagnostic.workOrder ? <button type="button" className={styles.primaryButton} onClick={() => openCommercialProposal("works")}>▣&nbsp; Відкрити замовлення&nbsp; →</button> : commercial ? <button type="button" className={styles.primaryButton} onClick={() => openCommercialProposal("estimate")}>▣&nbsp; Відкрити КП&nbsp; →</button> : <button type="button" className={styles.primaryButton} onClick={() => void createCommercialProposal()} disabled={!confirmed || busy}>{busy ? "Створюю…" : "Створити КП&nbsp; →"}</button>}</div></section>

    {showFullInspection && <section className={styles.fullInspection}><div className={styles.fullInspectionHead}><div><span>ПОВНА ДОКАЗОВА МАТРИЦЯ</span><h4>Повна перевірка</h4><p>Усі факти, заміри, фото та пункти без зауважень збережені в первинному вигляді.</p></div><button type="button" className={styles.inspectionToggle} onClick={() => setShowFullInspection(false)}>Сховати</button></div>{view.inspections.map((inspection) => <details key={inspection.id} className={styles.inspectionBlock} open={inspection.counts.defect > 0 || inspection.counts.attention > 0}><summary><div><strong>{inspection.templateName}</strong><span>{inspection.counts.checked}/{inspection.counts.total} перевірено</span></div><div className={styles.summaryBadges}>{inspection.counts.defect > 0 && <em className={styles.defectBadge}>{countLabel(inspection.counts.defect, "дефект", "дефекти", "дефектів")}</em>}{inspection.counts.attention > 0 && <em className={styles.attentionBadge}>{countLabel(inspection.counts.attention, "увага", "уваги", "уваг")}</em>}{inspection.counts.defect === 0 && inspection.counts.attention === 0 && <em className={styles.okBadge}>Норма</em>}<b>⌄</b></div></summary><div className={styles.fullSectionList}>{inspection.sections.map((section) => <div className={styles.fullSection} key={section.id}><div className={styles.fullSectionHead}><strong>{section.name}</strong><span>{section.counts.checked}/{section.counts.total}</span></div>{section.items.map((item) => item.state === "OK" ? <CheckRow key={item.id || item.templateItemId} item={item} /> : item.state === "NOT_CHECKED" ? <UncheckRow key={item.id || item.templateItemId} item={item} /> : <FindingRow key={item.id || item.templateItemId} diagnosticId={diagnosticId} item={item} />)}</div>)}</div></details>)}</section>}

    {view.diagnostic.review.mechanicComment && <div className={styles.comment}><span>Коментар механіка</span><p>{view.diagnostic.review.mechanicComment}</p></div>}
    {!confirmed && automaticConclusion && <details className={styles.automaticConclusion}><summary><span>Попередній висновок CRM</span><b>Показати повний текст ⌄</b></summary><p>{automaticConclusion}</p><small>Сформовано з результатів матриці. Фінальний висновок сервіс-менеджера внесіть після перевірки фактів.</small></details>}
    {(view.diagnostic.review.state === "SUBMITTED" || confirmed) && <label className={styles.comment}><span>Висновок сервіс-менеджера</span><textarea rows={5} value={technicalConclusion} disabled={confirmed} onChange={(event) => setTechnicalConclusion(event.target.value)} placeholder="Внесіть фінальний технічний висновок після перевірки результатів діагностики." /></label>}
    {view.diagnostic.review.state === "SUBMITTED" && view.diagnostic.status === "IN_PROGRESS" && <div className={styles.decision}><label><span>Перевірка сервіс-менеджером</span><small>Повернення переводить діагностику назад «В роботу» та потребує пояснення. Підтвердження створює фінальну незмінну ревізію ДК.</small><textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} placeholder="Що потрібно доопрацювати механіку…" /></label><div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => void returnToMechanic()}>← Повернути в роботу</button><button className={styles.confirmButton} type="button" disabled={busy || !technicalConclusion.trim()} onClick={() => void confirmDiagnosticCard()}>{busy ? "Обробляю…" : "Підтвердити ДК"}</button></div></div>}
    {view.diagnostic.review.state === "RETURNED" && <div className={styles.lock}>Діагностика знову «В роботі». Механік бачить коментар менеджера, доопрацьовує перевірку та повторно передає ДК «На перевірку».</div>}
    {confirmed && <div className={styles.confirmedNote}>Діагностичну карту зафіксовано у фінальній ревізії. Ціни, постачальники та погоджені позиції зберігаються окремо в Комерційній пропозиції.</div>}
    <DiagnosticReportSharePanel diagnosticId={diagnosticId} reviewState={view.diagnostic.review.state} workOrder={view.diagnostic.workOrder} />
  </section>;
}

function FindingCompact({ item }: { item: Item }) {
  const defect = item.state === "DEFECT";
  const priority = priorityLabel(item.finding?.urgency);
  return <div className={styles.findingCompact}><span className={defect ? styles.findingIconDanger : styles.findingIconAttention}>!</span><div><strong>{item.name}</strong><small>{item.finding?.findingText || item.note || (defect ? "Виявлено дефект" : "Потребує уваги")}</small>{(item.finding?.action && item.finding.action !== "NONE" || priority) && <em>{item.finding?.action ? actionLabels[item.finding.action] || item.finding.action : ""}{priority ? ` · ${priority}` : ""}</em>}</div></div>;
}

function RecommendationGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div className={styles.recommendationGroup}><div><strong>{title}</strong><span>{items.length}</span></div>{items.map((item) => <p key={item}>{item}</p>)}</div>;
}

function LineGroup({ title, lines, total, currency, tone }: { title: string; lines: CommercialLine[]; total: string | number; currency: string; tone: "work" | "part" | "other" }) {
  if (!lines.length) return null;
  return <div className={styles.lineGroup}><div className={styles.lineGroupHead}><strong><span className={`${styles.lineIcon} ${styles[tone]}`}>{tone === "work" ? "⚒" : tone === "part" ? "◇" : "•"}</span>{title}</strong><b>{formatMoney(total, currency)}</b></div><div className={styles.lineList}>{lines.map((line) => <div className={styles.lineItem} key={line.id}><div><strong>{line.description}</strong><small>{[line.brand, line.article, line.code].filter(Boolean).join(" · ")}</small></div><span>{numeric(line.plannedQuantity).toLocaleString("uk-UA")} {line.unit}</span><b>{formatMoney(lineTotal(line), line.currency || currency)}</b></div>)}</div></div>;
}

function FindingRow({ diagnosticId, item }: { diagnosticId: string; item: Item }) {
  const finding = item.finding;
  const priority = priorityLabel(finding?.urgency);
  return <div className={styles.findingRow}><div className={item.state === "DEFECT" ? styles.findingIconDanger : styles.findingIconAttention}>!</div><div className={styles.findingRowMain}><strong>{item.name}</strong><span>{finding?.findingText || item.note || (item.state === "DEFECT" ? "Виявлено дефект" : "Потребує уваги")}</span>{item.measurementValue && <small>Замір: {item.measurementValue}{item.measurementUnit ? ` ${item.measurementUnit}` : ""}</small>}{item.measurementText && <small>Замір: {item.measurementText}</small>}<div className={styles.findingMeta}><b>{item.state === "DEFECT" ? "Дефект" : "Увага"}</b>{finding && <b>{actionLabels[finding.action] || finding.action}</b>}{priority && <b>{priority}</b>}</div>{finding?.suggestedWorkName && <em>Робота: {finding.suggestedWorkName}</em>}{finding?.suggestedPartName && <em>Деталь: {finding.suggestedPartName}</em>}</div>{finding?.media.length ? <div className={styles.media}>{finding.media.map((media) => <a href={`/api/diagnostics/${diagnosticId}/media/${media.id}`} target="_blank" rel="noreferrer" key={media.id}><img src={`/api/diagnostics/${diagnosticId}/media/${media.id}`} alt={media.fileName} /></a>)}</div> : null}</div>;
}

function CheckRow({ item }: { item: Item }) {
  return <div className={styles.checkRow}><span>✓</span><div><strong>{item.name}</strong>{item.measurementValue || item.measurementText ? <small>Замір: {item.measurementValue || item.measurementText}</small> : null}</div><b>Норма</b></div>;
}

function UncheckRow({ item }: { item: Item }) {
  return <div className={styles.checkRow}><span className={styles.uncheckedIcon}>○</span><div><strong>{item.name}</strong></div><b className={styles.uncheckedLabel}>Не перевірено</b></div>;
}
