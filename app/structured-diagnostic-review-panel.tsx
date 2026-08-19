"use client";

import { useEffect, useMemo, useState } from "react";
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
type View = {
  diagnostic: {
    id: string;
    status: string;
    workflowState: string;
    technicalConclusion: string | null;
    review: { state: string; mechanicComment: string | null; managerComment: string | null; submittedAt: string | null; returnedAt: string | null; confirmedAt: string | null };
    workOrder: { id: string; status: string } | null;
  };
  inspections: Array<{ id: string; templateName: string; status: string; counts: Counts; sections: Section[] }>;
  counts: Counts;
};

const actionLabels: Record<string, string> = { NONE: "Без дії", REPLACE: "Замінити", REPAIR: "Ремонтувати", ADJUST: "Відрегулювати", CLEAN: "Очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "Додаткова діагностика" };
const urgencyLabels: Record<string, string> = { INFO: "Рекомендація", SOON: "Найближчим часом", CRITICAL: "Критично" };

export function StructuredDiagnosticReviewPanel({ diagnosticId, onChanged }: { diagnosticId: string; onChanged: () => void | Promise<void> }) {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managerComment, setManagerComment] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити структуровану діагностику");
      setView(body as View & { ok: true });
      setManagerComment(body.diagnostic?.review?.managerComment || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка завантаження"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [diagnosticId]);

  const findings = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ inspection: inspection.templateName, section: section.name, item })))) || [], [view]);

  async function returnToMechanic() {
    if (!view || !confirm("Повернути діагностику механіку на уточнення?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/structured`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RETURN", managerComment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося повернути діагностику");
      setView(body as View & { ok: true }); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function confirmDiagnostic() {
    if (!view || !confirm("Підтвердити технічний висновок і пройти Hard Gate створення WorkOrder?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CONFIRMED", technicalConclusion: view.diagnostic.technicalConclusion || "" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося підтвердити діагностику");
      await load(); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка підтвердження"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className={styles.state}>Завантажую структурований звіт…</div>;
  if (error && !view) return <div className={styles.error}>{error}<button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!view || !view.inspections.length) return null;

  return <section className={styles.panel}>
    <div className={styles.head}><div><span>СТРУКТУРОВАНА ДІАГНОСТИКА</span><h3>Звіт автомеханіка</h3><p>{view.diagnostic.review.state === "SUBMITTED" ? "Механік завершив перевірку. Потрібне рішення сервіс-менеджера." : view.diagnostic.review.state === "RETURNED" ? "Діагностику повернено механіку на уточнення." : view.diagnostic.review.state === "CONFIRMED" ? "Звіт підтверджений і зафіксований." : "Механік ще працює над діагностикою."}</p></div><b className={styles.reviewState}>{view.diagnostic.review.state}</b></div>
    {error && <div className={styles.error}>{error}</div>}
    <div className={styles.metrics}><div><span>Перевірено</span><strong>{view.counts.checked}/{view.counts.total}</strong></div><div className={styles.ok}><span>Норма</span><strong>{view.counts.ok}</strong></div><div className={styles.attention}><span>Увага</span><strong>{view.counts.attention}</strong></div><div className={styles.defect}><span>Дефекти</span><strong>{view.counts.defect}</strong></div></div>

    <div className={styles.inspections}>{view.inspections.map((inspection) => <details key={inspection.id} open={inspection.counts.defect > 0 || inspection.counts.attention > 0}><summary><div><strong>{inspection.templateName}</strong><span>{inspection.counts.checked}/{inspection.counts.total} перевірено</span></div><div><em>{inspection.counts.defect ? `${inspection.counts.defect} деф.` : inspection.counts.attention ? `${inspection.counts.attention} увага` : "Норма"}</em><b>⌄</b></div></summary><div className={styles.sectionList}>{inspection.sections.map((section) => <div className={styles.section} key={section.id}><div className={styles.sectionHead}><strong>{section.name}</strong><span>{section.counts.defect ? `${section.counts.defect} дефект(и)` : section.counts.attention ? `${section.counts.attention} зауваження` : `${section.counts.checked}/${section.counts.total}`}</span></div>{section.items.filter((item) => item.state !== "OK" && item.state !== "NOT_CHECKED").map((item) => <FindingRow key={item.id || item.templateItemId} diagnosticId={diagnosticId} item={item} />)}{!section.items.some((item) => item.state === "ATTENTION" || item.state === "DEFECT") && <small className={styles.sectionOk}>✓ Перевірені пункти без зауважень</small>}</div>)}</div></details>)}</div>

    {findings.length > 0 && <div className={styles.findingIndex}><h4>Рекомендації до кошторису</h4>{findings.map(({ section, item }) => <div key={`index-${item.id || item.templateItemId}`}><span className={item.state === "DEFECT" ? styles.red : styles.orange}>{item.state === "DEFECT" ? "×" : "!"}</span><div><strong>{item.name}</strong><small>{section} · {item.finding?.findingText || item.note || "Без опису"}</small></div><div>{item.finding?.suggestedWorkName && <em>🔧 {item.finding.suggestedWorkName}</em>}{item.finding?.suggestedPartName && <em>▣ {item.finding.suggestedPartName}</em>}</div></div>)}</div>}

    {view.diagnostic.review.mechanicComment && <div className={styles.comment}><span>Коментар механіка</span><p>{view.diagnostic.review.mechanicComment}</p></div>}

    {view.diagnostic.review.state === "SUBMITTED" && view.diagnostic.status === "IN_PROGRESS" && <div className={styles.decision}><label><span>Коментар сервіс-менеджера</span><textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} placeholder="Причина повернення або внутрішня примітка…" /></label><div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => void returnToMechanic()}>← Повернути механіку</button><button className={styles.confirmButton} type="button" disabled={busy} onClick={() => void confirmDiagnostic()}>{busy ? "Обробляю…" : "Підтвердити та створити WorkOrder"}</button></div></div>}
    {view.diagnostic.review.state === "RETURNED" && <div className={styles.lock}>Очікуємо уточнення від автомеханіка. Після повторної передачі знову з’являться кнопки рішення.</div>}
    {(view.diagnostic.review.state === "CONFIRMED" || view.diagnostic.status === "CONFIRMED") && <div className={styles.confirmed}>✓ Hard Gate пройдено{view.diagnostic.workOrder ? ` · WorkOrder ${view.diagnostic.workOrder.id.slice(-8)} · ${view.diagnostic.workOrder.status}` : ""}</div>}
  </section>;
}

function FindingRow({ diagnosticId, item }: { diagnosticId: string; item: Item }) {
  const finding = item.finding;
  return <div className={styles.finding}><div className={item.state === "DEFECT" ? styles.red : styles.orange}>{item.state === "DEFECT" ? "×" : "!"}</div><div className={styles.findingMain}><strong>{item.name}</strong><span>{finding?.findingText || item.note || (item.state === "DEFECT" ? "Виявлено дефект" : "Потребує уваги")}</span>{item.measurementValue && <small>Замір: {item.measurementValue}{item.measurementUnit ? ` ${item.measurementUnit}` : ""}</small>}{item.measurementText && <small>Замір: {item.measurementText}</small>}<div className={styles.findingMeta}>{finding && <><b>{actionLabels[finding.action] || finding.action}</b><b>{urgencyLabels[finding.urgency] || finding.urgency}</b></>}</div>{finding?.suggestedWorkName && <em>Робота: {finding.suggestedWorkName}</em>}{finding?.suggestedPartName && <em>Деталь: {finding.suggestedPartName}</em>}</div>{finding?.media.length ? <div className={styles.media}>{finding.media.map((media) => <a href={`/api/diagnostics/${diagnosticId}/media/${media.id}`} target="_blank" rel="noreferrer" key={media.id}><img src={`/api/diagnostics/${diagnosticId}/media/${media.id}`} alt={media.fileName} /></a>)}</div> : null}</div>;
}
