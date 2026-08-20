"use client";

import { useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
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
  finding: null | { action: string; urgency: string; findingText: string | null; suggestedWorkName: string | null; suggestedPartName: string | null; media: Media[] };
};
type Section = { id: string; name: string; counts: Counts; items: Item[] };
type Counts = { total: number; checked: number; ok: number; attention: number; defect: number };
type PlannerResource = { id: string; name: string };
type PlannerLocation = { id: string; name: string; posts: PlannerResource[]; mechanics: PlannerResource[] };
type ReportShare = { id: string; active: boolean; createdAt: string; expiresAt: string | null; revokedAt: string | null };
type BookingState = { locationId: string; postId: string; mechanicId: string; date: string; time: string; duration: string };
type View = {
  diagnostic: {
    id: string;
    status: string;
    workflowState: string;
    technicalConclusion: string | null;
    problem: string | null;
    client: { id: string; name: string | null; phone: string };
    vehicle: { id: string; label: string; plateNumber: string | null; vin: string | null; mileageKm: number | null };
    assignment: { locationId: string | null; mechanicId: string | null } | null;
    review: { state: string; reviewerUserId?: string | null; mechanicComment: string | null; managerComment: string | null; submittedAt: string | null; returnedAt: string | null; confirmedAt: string | null };
    workOrder: { id: string; status: string } | null;
  };
  inspections: Array<{ id: string; templateName: string; status: string; counts: Counts; sections: Section[] }>;
  counts: Counts;
};

const actionLabels: Record<string, string> = { NONE: "Без дії", REPLACE: "Замінити", REPAIR: "Ремонтувати", ADJUST: "Відрегулювати", CLEAN: "Очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "Додаткова діагностика" };
const urgencyLabels: Record<string, string> = { INFO: "Рекомендація", SOON: "Найближчим часом", CRITICAL: "Критично" };
const reviewLabels: Record<string, string> = { DRAFT: "В роботі", SUBMITTED: "Завершена діагностика", RETURNED: "В роботі", CONFIRMED: "На перевірці менеджера" };
const pad = (value: number) => String(value).padStart(2, "0");

function tomorrowKey() {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function StructuredDiagnosticReviewPanel({ diagnosticId, onChanged }: { diagnosticId: string; onChanged: () => void | Promise<void> }) {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [technicalConclusion, setTechnicalConclusion] = useState("");
  const [reportShare, setReportShare] = useState<ReportShare | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [locations, setLocations] = useState<PlannerLocation[]>([]);
  const [booking, setBooking] = useState<BookingState>({ locationId: "", postId: "", mechanicId: "", date: tomorrowKey(), time: "09:00", duration: "60" });

  async function load() {
    setLoading(true); setError("");
    try {
      const [response, reportResponse] = await Promise.all([
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }),
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/report`, { cache: "no-store", credentials: "include" }),
      ]);
      const body = await response.json().catch(() => null);
      const reportBody = await reportResponse.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити структуровану діагностику");
      setView(body as View & { ok: true });
      setManagerComment(body.diagnostic?.review?.managerComment || "");
      setTechnicalConclusion(body.diagnostic?.technicalConclusion || "");
      if (reportResponse.ok && reportBody?.ok) setReportShare(reportBody.share || null);
      else setReportShare(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка завантаження"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [diagnosticId]);

  const findings = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ inspection: inspection.templateName, section: section.name, item })))) || [], [view]);

  async function returnToMechanic() {
    if (!view || !confirm("Повернути діагностику механіку на уточнення?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/structured`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RETURN", managerComment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося повернути діагностику");
      setView(body as View & { ok: true });
      setMessage("Діагностику повернено механіку на уточнення.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function createDiagnosticCard() {
    if (!view || !confirm("Створити діагностичну карту та надіслати її в кабінет власника?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const confirmResponse = await fetch(`/api/diagnostics/${diagnosticId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED", technicalConclusion: technicalConclusion.trim() || view.diagnostic.technicalConclusion || "" }),
      });
      const confirmBody = await confirmResponse.json().catch(() => null);
      if (!confirmResponse.ok || !confirmBody?.ok) throw new Error(confirmBody?.message || confirmBody?.error || "Не вдалося зафіксувати діагностику");

      const reportResponse = await fetch(`/api/diagnostics/${diagnosticId}/report`, { method: "POST", credentials: "include" });
      const reportBody = await reportResponse.json().catch(() => null);
      if (!reportResponse.ok || !reportBody?.ok) throw new Error(reportBody?.message || reportBody?.error || "Не вдалося створити діагностичну карту");
      setReportShare(reportBody.share as ReportShare);
      setMessage("Діагностичну карту створено та надіслано в кабінет власника. Статус авто: «Очікує рішення клієнта».");
      await load();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка створення діагностичної карти"); }
    finally { setBusy(false); }
  }

  async function openFollowupBooking() {
    if (!view) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 30 * 24 * 60 * 60_000);
      const response = await fetch(`/api/planner?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.status !== "OK") throw new Error(body?.message || "Не вдалося завантажити Планувальник");
      const nextLocations = Array.isArray(body.locations) ? body.locations as PlannerLocation[] : [];
      setLocations(nextLocations);
      const preferredLocation = nextLocations.find((item) => item.id === view.diagnostic.assignment?.locationId) || nextLocations[0] || null;
      setBooking((current) => ({
        ...current,
        locationId: preferredLocation?.id || "",
        postId: preferredLocation?.posts?.[0]?.id || "",
        mechanicId: preferredLocation?.mechanics?.find((item) => item.id === view.diagnostic.assignment?.mechanicId)?.id || preferredLocation?.mechanics?.[0]?.id || "",
      }));
      setBookingOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося відкрити запис"); }
    finally { setBusy(false); }
  }

  async function bookNextWorks() {
    if (!view || !booking.date || !booking.time || !booking.locationId || !booking.postId || !booking.mechanicId) {
      setError("Оберіть дату, час, пост і механіка.");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const start = new Date(`${booking.date}T${booking.time}:00`);
      const end = new Date(start.getTime() + Math.max(30, Number(booking.duration || 60)) * 60_000);
      const response = await fetch(`/api/diagnostics/${diagnosticId}/next-step`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BOOK_WORK",
          locationId: booking.locationId,
          postId: booking.postId,
          mechanicId: booking.mechanicId,
          plannedStartAt: start.toISOString(),
          plannedEndAt: end.toISOString(),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося записати авто на роботи");
      setBookingOpen(false);
      setMessage("Автомобіль записано на наступні роботи. Статус авто: «Заплановано».");
      await load(); await onChanged();
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Планувальник" })), 250);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка запису на роботи"); }
    finally { setBusy(false); }
  }

  async function sendToPartsSelection() {
    if (!view || !confirm("Передати рекомендації діагностики на підбір деталей?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/next-step`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "PARTS_SELECTION" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати на підбір деталей");
      setMessage("Рекомендації передано на підбір деталей. Статус авто: «Підбір деталей».");
      await load(); await onChanged();
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Підбір запчастин" })), 250);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка передачі на підбір деталей"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className={styles.state}>Завантажую структурований звіт…</div>;
  if (error && !view) return <div className={styles.error}>{error}<button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!view || !view.inspections.length) return null;

  const cardSent = Boolean(reportShare?.active && view.diagnostic.status === "CONFIRMED");
  const managerReviewStarted = view.diagnostic.review.state === "SUBMITTED" && Boolean(view.diagnostic.review.reviewerUserId);
  const canCreateCard = (view.diagnostic.review.state === "SUBMITTED" && view.diagnostic.status === "IN_PROGRESS") || (view.diagnostic.status === "CONFIRMED" && !cardSent);
  const activeLocation = locations.find((item) => item.id === booking.locationId) || null;
  const primaryStatus = cardSent
    ? "Очікує рішення клієнта"
    : managerReviewStarted || view.diagnostic.review.state === "CONFIRMED"
      ? "На перевірці менеджера"
      : reviewLabels[view.diagnostic.review.state] || view.diagnostic.review.state;

  return <section className={styles.panel}>
    <div className={styles.head}><div><span>СТРУКТУРОВАНА ДІАГНОСТИКА</span><h3>Звіт автомеханіка</h3><p>{cardSent ? "Діагностичну карту надіслано власнику. Авто очікує рішення клієнта." : managerReviewStarted ? "Сервіс-менеджер перевіряє завершену діагностику та готує ДК." : view.diagnostic.review.state === "SUBMITTED" ? "Діагностика завершена та очікує перевірки сервіс-менеджера." : view.diagnostic.review.state === "RETURNED" ? "Авто залишається в роботі; діагностику повернено механіку на уточнення." : view.diagnostic.review.state === "CONFIRMED" ? "Діагностику зафіксовано. Потрібно створити актуальну Діагностичну карту." : "Механік працює над діагностикою."}</p></div><b className={styles.reviewState}>{primaryStatus}</b></div>
    {view.diagnostic.review.state === "RETURNED" && <div className={styles.state}>↩ Супутня ознака: повернено механіку на уточнення.</div>}
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.state}>{message}</div>}
    <div className={styles.metrics}><div><span>Перевірено</span><strong>{view.counts.checked}/{view.counts.total}</strong></div><div className={styles.ok}><span>Норма</span><strong>{view.counts.ok}</strong></div><div className={styles.attention}><span>Увага</span><strong>{view.counts.attention}</strong></div><div className={styles.defect}><span>Дефекти</span><strong>{view.counts.defect}</strong></div></div>

    <div className={styles.inspections}>{view.inspections.map((inspection) => <details key={inspection.id} open={inspection.counts.defect > 0 || inspection.counts.attention > 0}><summary><div><strong>{inspection.templateName}</strong><span>{inspection.counts.checked}/{inspection.counts.total} перевірено</span></div><div><em>{inspection.counts.defect ? `${inspection.counts.defect} деф.` : inspection.counts.attention ? `${inspection.counts.attention} увага` : "Норма"}</em><b>⌄</b></div></summary><div className={styles.sectionList}>{inspection.sections.map((section) => <div className={styles.section} key={section.id}><div className={styles.sectionHead}><strong>{section.name}</strong><span>{section.counts.defect ? `${section.counts.defect} дефект(и)` : section.counts.attention ? `${section.counts.attention} зауваження` : `${section.counts.checked}/${section.counts.total}`}</span></div>{section.items.filter((item) => item.state !== "OK" && item.state !== "NOT_CHECKED").map((item) => <FindingRow key={item.id || item.templateItemId} diagnosticId={diagnosticId} item={item} />)}{!section.items.some((item) => item.state === "ATTENTION" || item.state === "DEFECT") && <small className={styles.sectionOk}>✓ Перевірені пункти без зауважень</small>}</div>)}</div></details>)}</div>

    {findings.length > 0 && <div className={styles.findingIndex}><h4>Рекомендації</h4>{findings.map(({ section, item }) => <div key={`index-${item.id || item.templateItemId}`}><span className={item.state === "DEFECT" ? styles.red : styles.orange}>{item.state === "DEFECT" ? "×" : "!"}</span><div><strong>{item.name}</strong><small>{section} · {item.finding?.findingText || item.note || "Без опису"}</small></div><div>{item.finding?.suggestedWorkName && <em>🔧 {item.finding.suggestedWorkName}</em>}{item.finding?.suggestedPartName && <em>▣ {item.finding.suggestedPartName}</em>}</div></div>)}</div>}

    {view.diagnostic.review.mechanicComment && <div className={styles.comment}><span>Коментар механіка</span><p>{view.diagnostic.review.mechanicComment}</p></div>}

    {(view.diagnostic.review.state === "SUBMITTED" || view.diagnostic.status === "CONFIRMED") && <label className={styles.comment}><span>Технічний висновок сервіс-менеджера</span><textarea rows={4} value={technicalConclusion} disabled={cardSent} onChange={(event) => setTechnicalConclusion(event.target.value)} placeholder="Перевірте та за потреби скоригуйте висновок перед створенням ДК." /></label>}

    <DiagnosticReportSharePanel diagnosticId={diagnosticId} reviewState={view.diagnostic.review.state} workOrder={view.diagnostic.workOrder} />

    {view.diagnostic.review.state === "SUBMITTED" && view.diagnostic.status === "IN_PROGRESS" && <div className={styles.decision}><label><span>Внутрішній коментар сервіс-менеджера</span><textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} placeholder="Причина повернення або внутрішня примітка…" /></label><div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => void returnToMechanic()}>← Повернути механіку</button><button className={styles.confirmButton} type="button" disabled={busy || !technicalConclusion.trim()} onClick={() => void createDiagnosticCard()}>{busy ? "Обробляю…" : "Створити діагностичну карту"}</button></div></div>}

    {canCreateCard && view.diagnostic.review.state === "CONFIRMED" && <div className={styles.decision}><div><button className={styles.confirmButton} type="button" disabled={busy || !technicalConclusion.trim()} onClick={() => void createDiagnosticCard()}>{busy ? "Обробляю…" : "Створити діагностичну карту"}</button></div></div>}

    {view.diagnostic.review.state === "RETURNED" && <div className={styles.lock}>Очікуємо уточнення від автомеханіка. Після повторного завершення діагностика знову з’явиться на перевірці.</div>}

    {cardSent && <div className={styles.decision}>
      <label><span>Наступний крок</span><small>Діагностична карта вже у кабінеті власника. Поточний статус — «Очікує рішення клієнта». Оберіть маршрут далі.</small></label>
      <div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => void openFollowupBooking()}>Запис на наступні роботи</button><button className={styles.confirmButton} type="button" disabled={busy} onClick={() => void sendToPartsSelection()}>Підбір деталей</button></div>
    </div>}

    {cardSent && bookingOpen && <div className={styles.decision}>
      <label><span>Запис на наступні роботи</span><small>{view.diagnostic.vehicle.label} · {view.diagnostic.vehicle.plateNumber || "без номера"}</small></label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, width: "100%" }}>
        <label><span>Дата</span><input type="date" value={booking.date} onChange={(event) => setBooking({ ...booking, date: event.target.value })}/></label>
        <label><span>Час</span><input type="time" step={1800} value={booking.time} onChange={(event) => setBooking({ ...booking, time: event.target.value })}/></label>
        <label><span>Тривалість</span><select value={booking.duration} onChange={(event) => setBooking({ ...booking, duration: event.target.value })}><option value="60">1 година</option><option value="90">1,5 години</option><option value="120">2 години</option><option value="180">3 години</option><option value="240">4 години</option></select></label>
        <label><span>Локація</span><select value={booking.locationId} onChange={(event) => { const location = locations.find((item) => item.id === event.target.value); setBooking({ ...booking, locationId: event.target.value, postId: location?.posts?.[0]?.id || "", mechanicId: location?.mechanics?.[0]?.id || "" }); }}>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Пост</span><select value={booking.postId} onChange={(event) => setBooking({ ...booking, postId: event.target.value })}>{activeLocation?.posts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Механік</span><select value={booking.mechanicId} onChange={(event) => setBooking({ ...booking, mechanicId: event.target.value })}>{activeLocation?.mechanics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => setBookingOpen(false)}>Скасувати</button><button className={styles.confirmButton} type="button" disabled={busy} onClick={() => void bookNextWorks()}>{busy ? "Зберігаю…" : "Записати на роботи"}</button></div>
    </div>}
  </section>;
}

function FindingRow({ diagnosticId, item }: { diagnosticId: string; item: Item }) {
  const finding = item.finding;
  return <div className={styles.finding}><div className={item.state === "DEFECT" ? styles.red : styles.orange}>{item.state === "DEFECT" ? "×" : "!"}</div><div className={styles.findingMain}><strong>{item.name}</strong><span>{finding?.findingText || item.note || (item.state === "DEFECT" ? "Виявлено дефект" : "Потребує уваги")}</span>{item.measurementValue && <small>Замір: {item.measurementValue}{item.measurementUnit ? ` ${item.measurementUnit}` : ""}</small>}{item.measurementText && <small>Замір: {item.measurementText}</small>}<div className={styles.findingMeta}>{finding && <><b>{actionLabels[finding.action] || finding.action}</b><b>{urgencyLabels[finding.urgency] || finding.urgency}</b></>}</div>{finding?.suggestedWorkName && <em>Робота: {finding.suggestedWorkName}</em>}{finding?.suggestedPartName && <em>Деталь: {finding.suggestedPartName}</em>}</div>{finding?.media.length ? <div className={styles.media}>{finding.media.map((media) => <a href={`/api/diagnostics/${diagnosticId}/media/${media.id}`} target="_blank" rel="noreferrer" key={media.id}><img src={`/api/diagnostics/${diagnosticId}/media/${media.id}`} alt={media.fileName} /></a>)}</div> : null}</div>;
}