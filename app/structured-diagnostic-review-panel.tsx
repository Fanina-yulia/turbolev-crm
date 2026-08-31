"use client";

import { useEffect, useMemo, useState } from "react";
import { DiagnosticReportSharePanel } from "./diagnostic-report-share-panel";
import { navigateCrm } from "./crm-route";
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
type Section = { id: string; name: string; counts: Counts; items: Item[] };
type Counts = { total: number; checked: number; ok: number; attention: number; defect: number };
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
    review: { state: string; mechanicComment: string | null; managerComment: string | null; submittedAt: string | null; returnedAt: string | null; confirmedAt: string | null };
    workOrder: { id: string; status: string } | null;
  };
  inspections: Array<{ id: string; templateName: string; status: string; counts: Counts; sections: Section[] }>;
  counts: Counts;
  suggestedTechnicalConclusion?: string | null;
};
type DiagnosticCardState = {
  card: null | { id: string; number: string; currentRevision: number; finalizedAt: string | null };
  latest?: null | { revision: number; kind: "REVIEW" | "FINAL"; createdAt: string };
  final?: null | { revision: number; kind: "FINAL"; createdAt: string };
};

const actionLabels: Record<string, string> = { NONE: "Без дії", REPLACE: "Замінити", REPAIR: "Ремонтувати", ADJUST: "Відрегулювати", CLEAN: "Очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "Додаткова діагностика" };
const urgencyLabels: Record<string, string> = { INFO: "Рекомендація", CRITICAL: "Критично" };
const reviewLabels: Record<string, string> = { DRAFT: "Чернетка", SUBMITTED: "На перевірці", RETURNED: "В роботі", CONFIRMED: "Підтверджена ДК" };

function countLabel(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many}`;
}

function priorityLabel(urgency: string | null | undefined) {
  if (!urgency || urgency === "SOON") return null;
  return urgencyLabels[urgency] || urgency;
}

export function StructuredDiagnosticReviewPanel({ diagnosticId, onChanged }: { diagnosticId: string; onChanged: () => void | Promise<void> }) {
  const [view, setView] = useState<View | null>(null);
  const [cardState, setCardState] = useState<DiagnosticCardState>({ card: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [technicalConclusion, setTechnicalConclusion] = useState("");
  const [showFullInspection, setShowFullInspection] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [response, cardResponse] = await Promise.all([
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }),
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/card`, { cache: "no-store", credentials: "include" }),
      ]);
      const body = await response.json().catch(() => null);
      const cardBody = await cardResponse.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити структуровану діагностику");
      setView(body as View & { ok: true });
      setManagerComment(body.diagnostic?.review?.managerComment || "");
      setTechnicalConclusion(body.diagnostic?.technicalConclusion || "");
      if (cardResponse.ok && cardBody?.ok) setCardState({ card: cardBody.card || null, latest: cardBody.latest || null, final: cardBody.final || null });
      else setCardState({ card: null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка завантаження"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [diagnosticId]);

  const findings = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ inspection: inspection.templateName, section: section.name, item })))) || [], [view]);
  const criticalCount = useMemo(() => findings.filter(({ item }) => item.finding?.urgency === "CRITICAL").length, [findings]);
  const actionGroups = useMemo(() => {
    const groups = [
      { key: "REPLACE", label: "Потрібно замінити", tone: "replace", items: findings.filter(({ item }) => item.finding?.action === "REPLACE") },
      { key: "REPAIR", label: "Потрібно ремонтувати", tone: "repair", items: findings.filter(({ item }) => item.finding?.action === "REPAIR") },
      { key: "ADDITIONAL_DIAGNOSTICS", label: "Потрібно додатково перевірити", tone: "diagnostics", items: findings.filter(({ item }) => item.finding?.action === "ADDITIONAL_DIAGNOSTICS" || !item.finding?.action || item.finding?.action === "NONE") },
    ] as const;
    return groups.filter((group) => group.items.length > 0);
  }, [findings]);

  async function returnToMechanic() {
    if (!view) return;
    if (!managerComment.trim()) { setError("Вкажіть, що саме механіку потрібно уточнити."); return; }
    if (!confirm("Повернути Діагностичну карту механіку в роботу?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}/structured`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RETURN", managerComment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося повернути діагностику");
      setView(body as View & { ok: true });
      setMessage("Діагностичну карту повернено механіку в роботу. Коментар менеджера збережено.");
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function confirmDiagnosticCard() {
    if (!view || !confirm("Підтвердити Діагностичну карту? Після підтвердження її фінальна ревізія буде зафіксована.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${diagnosticId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONFIRMED", technicalConclusion: technicalConclusion.trim() }),
      });
      const body = await response.json().catch(() => null);
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
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося створити Комерційну пропозицію");
      const parts = Number(body.handoff?.counts?.parts || 0);
      const works = Number(body.handoff?.counts?.labor || 0);
      setMessage(`Комерційну пропозицію створено: ${works} робіт · ${parts} деталей. Далі можна перейти до підбору деталей або відкрити КП.`);
      await load();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка створення Комерційної пропозиції"); }
    finally { setBusy(false); }
  }

  function openPartsSelection() {
    if (!view) return;
    navigateCrm("Підбір запчастин", {
      diagnosticId,
      vehicleId: view.diagnostic.vehicle.id,
      plate: view.diagnostic.vehicle.plateNumber || "",
      vin: view.diagnostic.vehicle.vin || "",
    });
  }

  function openCommercialProposal() {
    if (!view?.diagnostic.workOrder) return;
    navigateCrm("Комерційна пропозиція", { workOrderId: view.diagnostic.workOrder.id, workOrderTab: "estimate" });
  }

  if (loading) return <div className={styles.state}>Завантажую Діагностичну карту…</div>;
  if (error && !view) return <div className={styles.error}>{error}<button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!view || !view.inspections.length) return null;

  const confirmed = view.diagnostic.review.state === "CONFIRMED" && view.diagnostic.status === "CONFIRMED";
  const cardNumber = cardState.card?.number || null;
  const automaticConclusion = view.suggestedTechnicalConclusion?.trim() || "";

  return <section className={styles.panel}>
    <div className={styles.head}><div><span>ДІАГНОСТИЧНА КАРТА</span><h3>{cardNumber ? cardNumber : "Результати діагностики"}</h3><p>{view.diagnostic.review.state === "SUBMITTED" ? "Автомеханік завершив діагностику. CRM сформувала чернетку ДК — перевірте факти та технічний висновок." : view.diagnostic.review.state === "RETURNED" ? "ДК повернена механіку в роботу. Після доопрацювання механік повторно передасть її на перевірку." : confirmed ? "ДК підтверджена. Це готовий технічний документ. Комерційна пропозиція формується окремо." : "Автомеханік працює над діагностикою; чернетка ДК оновлюється з фактичних результатів."}</p></div><b className={styles.reviewState}>{reviewLabels[view.diagnostic.review.state] || view.diagnostic.review.state}</b></div>
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.state}>{message}</div>}

    <div className={styles.caseSummary}>
      <div className={styles.caseSummaryHead}><div><span className={styles.eyebrow}>РІШЕННЯ СЕРВІС-МЕНЕДЖЕРА</span><h4>Що потрібно зробити з автомобілем</h4></div><button type="button" className={styles.modeButton} onClick={() => setShowFullInspection((value) => !value)}>{showFullInspection ? "Повернутися до рішення" : "Відкрити повну перевірку"}</button></div>
      <div className={styles.caseComplaint}><span>Скарга / завдання клієнта</span><strong>{view.diagnostic.problem || "Скаргу не вказано"}</strong></div>
      <div className={styles.metrics}><div><span>Перевірено</span><strong>{view.counts.checked}/{view.counts.total}</strong></div><div className={styles.ok}><span>Норма</span><strong>{view.counts.ok}</strong></div><div className={styles.attention}><span>Увага</span><strong>{view.counts.attention}</strong></div><div className={styles.defect}><span>Дефекти</span><strong>{view.counts.defect}</strong></div></div>
      {!showFullInspection && <div className={styles.actionGrid}>{actionGroups.map((group) => <section className={`${styles.actionGroup} ${styles[group.tone]}`} key={group.key}><div className={styles.actionGroupHead}><strong>{group.label}</strong><b>{group.items.length}</b></div><div className={styles.actionItems}>{group.items.slice(0, 4).map(({ section, item }) => <div className={styles.actionItem} key={item.id || item.templateItemId}><span>{section}</span><strong>{item.name}</strong><small>{item.finding?.findingText || item.note || "Потрібна перевірка"}</small></div>)}</div>{group.items.length > 4 && <small className={styles.moreItems}>Ще {group.items.length - 4} позицій — у повній перевірці</small>}</section>)}</div>}
    </div>
    {criticalCount > 0 && <div className={styles.error}>Критичних зауважень: <strong>{criticalCount}</strong>. Перевірте їх перед підтвердженням ДК.</div>}

    <div className={styles.inspections}>{view.inspections.map((inspection) => <details key={inspection.id} open={showFullInspection ? false : inspection.counts.defect > 0 || inspection.counts.attention > 0}><summary><div><strong>{inspection.templateName}</strong><span>{inspection.counts.checked}/{inspection.counts.total} перевірено</span></div><div className={styles.summaryBadges}>{inspection.counts.defect > 0 && <em className={styles.defectBadge}>{countLabel(inspection.counts.defect, "дефект", "дефекти", "дефектів")}</em>}{inspection.counts.attention > 0 && <em className={styles.attentionBadge}>{countLabel(inspection.counts.attention, "увага", "уваги", "уваг")}</em>}{inspection.counts.defect === 0 && inspection.counts.attention === 0 && <em className={styles.okBadge}>Норма</em>}<b aria-hidden="true">⌄</b></div></summary><div className={styles.sectionList}>{inspection.sections.map((section) => <div className={styles.section} key={section.id}><div className={styles.sectionHead}><strong>{section.name}</strong><div className={styles.sectionCounts}>{section.counts.defect > 0 && <span className={styles.defectText}>{countLabel(section.counts.defect, "дефект", "дефекти", "дефектів")}</span>}{section.counts.attention > 0 && <span className={styles.attentionText}>{countLabel(section.counts.attention, "увага", "уваги", "уваг")}</span>}{section.counts.defect === 0 && section.counts.attention === 0 && <span>{section.counts.checked}/{section.counts.total}</span>}</div></div>{showFullInspection ? section.items.map((item) => item.state === "OK" ? <CheckRow key={item.id || item.templateItemId} item={item} /> : <FindingRow key={item.id || item.templateItemId} diagnosticId={diagnosticId} item={item} />) : section.items.filter((item) => item.state !== "OK" && item.state !== "NOT_CHECKED").map((item) => <FindingRow key={item.id || item.templateItemId} diagnosticId={diagnosticId} item={item} />)}{!showFullInspection && !section.items.some((item) => item.state === "ATTENTION" || item.state === "DEFECT") && <small className={styles.sectionOk}>✓ Перевірені пункти без зауважень</small>}</div>)}</div></details>)}</div>

    {view.diagnostic.review.mechanicComment && <div className={styles.comment}><span>Коментар механіка</span><p>{view.diagnostic.review.mechanicComment}</p></div>}

    {!confirmed && automaticConclusion && <details className={styles.automaticConclusion}><summary><span>Попередній висновок CRM</span><b>Показати повний текст ⌄</b></summary><p>{automaticConclusion}</p><small>Сформовано з результатів матриці. Фінальний висновок сервіс-менеджера внесіть після перевірки фактів.</small></details>}

    {(view.diagnostic.review.state === "SUBMITTED" || confirmed) && <label className={styles.comment}><span>Висновок сервіс-менеджера</span><textarea rows={5} value={technicalConclusion} disabled={confirmed} onChange={(event) => setTechnicalConclusion(event.target.value)} placeholder="Внесіть фінальний технічний висновок після перевірки результатів діагностики." /></label>}

    {view.diagnostic.review.state === "SUBMITTED" && view.diagnostic.status === "IN_PROGRESS" && <div className={styles.decision}><label><span>Перевірка сервіс-менеджером</span><small>Повернення переводить діагностику назад «В роботу» та потребує пояснення. Підтвердження створює фінальну незмінну ревізію ДК.</small><textarea rows={3} value={managerComment} onChange={(event) => setManagerComment(event.target.value)} placeholder="Що потрібно доопрацювати механіку…" /></label><div><button className={styles.returnButton} type="button" disabled={busy} onClick={() => void returnToMechanic()}>← Повернути в роботу</button><button className={styles.confirmButton} type="button" disabled={busy || !technicalConclusion.trim()} onClick={() => void confirmDiagnosticCard()}>{busy ? "Обробляю…" : "Підтвердити ДК"}</button></div></div>}

    {view.diagnostic.review.state === "RETURNED" && <div className={styles.lock}>Діагностика знову «В роботі». Механік бачить коментар менеджера, доопрацьовує перевірку та повторно передає ДК «На перевірку».</div>}

    {confirmed && <div className={styles.decision}>
      <label><span>Наступний етап</span><small>ДК завершена. Можна перейти до підбору запчастин або створити Комерційну пропозицію. Ціни не записуються назад у ДК.</small></label>
      <div>
        <button className={styles.returnButton} type="button" disabled={busy} onClick={openPartsSelection}>Підібрати запчастини</button>
        {view.diagnostic.workOrder
          ? <button className={styles.confirmButton} type="button" disabled={busy} onClick={openCommercialProposal}>Відкрити КП</button>
          : <button className={styles.confirmButton} type="button" disabled={busy} onClick={() => void createCommercialProposal()}>{busy ? "Створюю…" : "Створити Комерційну пропозицію"}</button>}
      </div>
    </div>}

    <DiagnosticReportSharePanel diagnosticId={diagnosticId} reviewState={view.diagnostic.review.state} workOrder={view.diagnostic.workOrder} />
  </section>;
}

function FindingRow({ diagnosticId, item }: { diagnosticId: string; item: Item }) {
  const finding = item.finding;
  const priority = priorityLabel(finding?.urgency);
  return <div className={styles.finding}><div className={item.state === "DEFECT" ? styles.red : styles.orange} aria-label={item.state === "DEFECT" ? "Дефект" : "Увага"}>!</div><div className={styles.findingMain}><strong>{item.name}</strong><span>{finding?.findingText || item.note || (item.state === "DEFECT" ? "Виявлено дефект" : "Потребує уваги")}</span>{item.measurementValue && <small>Замір: {item.measurementValue}{item.measurementUnit ? ` ${item.measurementUnit}` : ""}</small>}{item.measurementText && <small>Замір: {item.measurementText}</small>}<div className={styles.findingMeta}><b className={item.state === "DEFECT" ? styles.defectTag : styles.attentionTag}>{item.state === "DEFECT" ? "Дефект" : "Увага"}</b>{finding && <b>{actionLabels[finding.action] || finding.action}</b>}{priority && <b>{priority}</b>}</div>{finding?.suggestedWorkName && <em>Робота: {finding.suggestedWorkName}</em>}{finding?.suggestedPartName && <em>Деталь: {finding.suggestedPartName}</em>}</div>{finding?.media.length ? <div className={styles.media}>{finding.media.map((media) => <a href={`/api/diagnostics/${diagnosticId}/media/${media.id}`} target="_blank" rel="noreferrer" key={media.id}><img src={`/api/diagnostics/${diagnosticId}/media/${media.id}`} alt={media.fileName} /></a>)}</div> : null}</div>;
}

function CheckRow({ item }: { item: Item }) {
  return <div className={styles.checkRow}><span>✓</span><div><strong>{item.name}</strong>{item.measurementValue || item.measurementText ? <small>Замір: {item.measurementValue || item.measurementText}</small> : null}</div><b>Норма</b></div>;
}
