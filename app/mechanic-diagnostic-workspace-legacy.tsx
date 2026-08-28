"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { VoiceNoteInput } from "./voice-note-input";
import styles from "./mechanic-diagnostic-workspace.module.css";

type CheckState = "NOT_CHECKED" | "OK" | "ATTENTION" | "DEFECT";
type Check = {
  id: string | null;
  templateItemId: string;
  name: string;
  position: string | null;
  measurementUnit: string | null;
  state: CheckState;
  measurementValue: string | null;
  measurementText: string | null;
  note: string | null;
  finding: { id: string; action: string; urgency: string; findingText: string | null } | null;
};
type Section = { id: string; code: string; name: string; items: Check[]; counts: { total: number; checked: number; ok: number; attention: number; defect: number } };
type Inspection = { id: string; templateId: string; templateName: string; status: string; sections: Section[]; counts: { total: number; checked: number; ok: number; attention: number; defect: number } };
type DiagnosticPayload = {
  ok?: boolean;
  message?: string;
  error?: string;
  canSubmit?: boolean;
  completion?: { canSubmit?: boolean; requiredTotal?: number; requiredChecked?: number; missingRequired?: number };
  diagnostic?: {
    id: string;
    status: string;
    workflowState: string;
    problem: string | null;
    vehicle: { id: string; label: string; plateNumber: string | null; vin: string | null; mileageKm: number | null };
    client: { id: string; name: string | null; phone: string };
    review: { state: string; mechanicComment: string | null; managerComment: string | null };
  };
  inspections?: Inspection[];
};

const stateLabel: Record<CheckState, string> = { NOT_CHECKED: "Не перевірено", OK: "Норма", ATTENTION: "Увага", DEFECT: "Дефект" };

export function MechanicDiagnosticWorkspace({ diagnosticId, onBack, onChanged, onFinished }: { diagnosticId: string; onBack: () => void; onChanged?: () => void; onFinished?: () => void }) {
  const [data, setData] = useState<DiagnosticPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { note: string; measurement: string; urgency: string }>>({});
  const [comment, setComment] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити діагностику");
    setData(body);
    setComment(body.diagnostic?.review.mechanicComment || "");
    setDrafts((current) => {
      const next = { ...current };
      for (const inspection of body.inspections || []) for (const section of inspection.sections) for (const item of section.items) {
        if (!item.id || next[item.id]) continue;
        next[item.id] = { note: item.finding?.findingText || item.note || "", measurement: item.measurementValue || item.measurementText || "", urgency: item.finding?.urgency || "INFO" };
      }
      return next;
    });
  }, [diagnosticId]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося відкрити діагностику")); }, [load]);

  const workflow = data?.diagnostic?.workflowState || data?.diagnostic?.status || "PENDING";
  const locked = ["SUBMITTED", "CONFIRMED", "CANCELLED"].includes(workflow) || data?.diagnostic?.review.state === "SUBMITTED" || data?.diagnostic?.review.state === "CONFIRMED";
  const totals = useMemo(() => {
    const rows = (data?.inspections || []).flatMap((inspection) => inspection.sections.flatMap((section) => section.items));
    return { total: rows.length, checked: rows.filter((item) => item.state !== "NOT_CHECKED").length, problems: rows.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").length };
  }, [data]);

  async function patchStructured(body: Record<string, unknown>, key: string) {
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const next = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !next?.ok) throw new Error(next?.message || next?.error || "Не вдалося оновити діагностику");
      setData(next);
      onChanged?.();
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося оновити діагностику");
      return null;
    } finally { setBusy(""); }
  }

  async function start() {
    const next = await patchStructured({ action: "START" }, "start");
    if (next) setMessage("Діагностику розпочато. Перевірте всі пункти.");
  }

  async function sectionAllOk(inspectionId: string, sectionId: string) {
    const next = await patchStructured({ action: "SECTION_ALL_OK", inspectionId, sectionId }, `section:${sectionId}`);
    if (next) setMessage("Розділ відмічено як «Норма».");
  }

  async function updateCheck(item: Check, state: CheckState) {
    if (!item.id) return;
    const draft = drafts[item.id] || { note: "", measurement: "", urgency: "INFO" };
    setBusy(`check:${item.id}`); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/checks/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          measurementValue: item.measurementUnit && draft.measurement.trim() && /^-?\d+(?:[.,]\d+)?$/.test(draft.measurement.trim()) ? draft.measurement.replace(",", ".") : null,
          measurementText: item.measurementUnit ? null : draft.measurement.trim() || null,
          note: draft.note.trim() || null,
          findingText: state === "ATTENTION" || state === "DEFECT" ? draft.note.trim() || `${item.name}: потребує уваги` : null,
          urgency: state === "DEFECT" ? draft.urgency || "SOON" : draft.urgency || "INFO",
          action: "NONE",
        }),
      });
      const next = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !next?.ok) throw new Error(next?.message || next?.error || "Не вдалося зберегти перевірку");
      setData(next);
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти перевірку"); }
    finally { setBusy(""); }
  }

  async function submit() {
    if (!window.confirm("Передати завершену діагностику сервіс-менеджеру? Після передачі редагування буде заблоковано до повернення на уточнення.")) return;
    const next = await patchStructured({ action: "SUBMIT", mechanicComment: comment.trim() || null }, "submit");
    if (next) {
      setMessage("Діагностику передано сервіс-менеджеру.");
      onFinished?.();
    }
  }

  if (!data?.diagnostic) return <div className={styles.page}><header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Діагностика</strong><span /></header><div className={styles.loading}>{error || "Завантажую діагностику…"}</div></div>;

  return <div className={styles.page}>
    <header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Діагностика</strong><span /></header>
    <main className={styles.content}>
      <section className={styles.vehicleCard}>
        <div><small>АВТОМОБІЛЬ</small><h1>{data.diagnostic.vehicle.label}</h1><b>{data.diagnostic.vehicle.plateNumber || "Без номера"}</b></div>
        <span data-state={workflow}>{workflow === "PENDING" ? "Не розпочата" : workflow === "IN_PROGRESS" ? "В роботі" : workflow === "RETURNED" ? "Повернено" : workflow === "SUBMITTED" ? "Передано" : workflow === "CONFIRMED" ? "Підтверджено" : workflow}</span>
        <div className={styles.vehicleFacts}><span>VIN <b>{data.diagnostic.vehicle.vin || "—"}</b></span><span>Пробіг <b>{data.diagnostic.vehicle.mileageKm ? `${data.diagnostic.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</b></span></div>
        {data.diagnostic.problem && <p>{data.diagnostic.problem}</p>}
      </section>

      {data.diagnostic.review.managerComment && <div className={styles.returned}><b>Коментар сервіс-менеджера</b><span>{data.diagnostic.review.managerComment}</span></div>}
      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {workflow === "PENDING" && <button className={styles.start} type="button" disabled={Boolean(busy)} onClick={() => void start()}>{busy === "start" ? "Розпочинаю…" : "▶ Почати діагностику"}</button>}

      {(data.inspections || []).length > 0 && <section className={styles.progress}><div><span>Перевірено</span><strong>{totals.checked} / {totals.total}</strong></div><div><span>Зауваження</span><strong>{totals.problems}</strong></div><progress max={Math.max(1, totals.total)} value={totals.checked} /></section>}

      {(data.inspections || []).map((inspection) => <section className={styles.inspection} key={inspection.id}>
        <header><div><small>ШАБЛОН</small><h2>{inspection.templateName}</h2></div><b>{inspection.counts.checked}/{inspection.counts.total}</b></header>
        {inspection.sections.map((section) => <article className={styles.section} key={section.id}>
          <div className={styles.sectionHead}><div><h3>{section.name}</h3><span>{section.counts.checked}/{section.counts.total} перевірено</span></div>{!locked && <button type="button" disabled={Boolean(busy)} onClick={() => void sectionAllOk(inspection.id, section.id)}>✓ Все норма</button>}</div>
          <div className={styles.checks}>{section.items.map((item) => {
            const id = item.id || item.templateItemId;
            const draft = item.id ? drafts[item.id] || { note: "", measurement: "", urgency: "INFO" } : { note: "", measurement: "", urgency: "INFO" };
            const problem = item.state === "ATTENTION" || item.state === "DEFECT";
            return <div className={styles.check} key={id} data-state={item.state}>
              <div className={styles.checkTitle}><div><strong>{item.name}</strong>{item.position && <small>{item.position}</small>}</div><span>{stateLabel[item.state]}</span></div>
              {!locked && item.id && <>
                <div className={styles.states}>
                  <button type="button" className={item.state === "OK" ? styles.activeOk : ""} disabled={Boolean(busy)} onClick={() => void updateCheck(item, "OK")}>✓ Норма</button>
                  <button type="button" className={item.state === "ATTENTION" ? styles.activeAttention : ""} disabled={Boolean(busy)} onClick={() => void updateCheck(item, "ATTENTION")}>! Увага</button>
                  <button type="button" className={item.state === "DEFECT" ? styles.activeDefect : ""} disabled={Boolean(busy)} onClick={() => void updateCheck(item, "DEFECT")}>× Дефект</button>
                </div>
                {(problem || draft.note || item.measurementUnit) && <div className={styles.details}>
                  {item.measurementUnit && <label><span>Замір, {item.measurementUnit}</span><input inputMode="decimal" value={draft.measurement} onChange={(event) => item.id && setDrafts((current) => ({ ...current, [item.id!]: { ...draft, measurement: event.target.value } }))} /></label>}
                  <label><span>{problem ? "Що виявлено / примітка" : "Примітка"}</span><textarea rows={2} value={draft.note} onChange={(event) => item.id && setDrafts((current) => ({ ...current, [item.id!]: { ...draft, note: event.target.value } }))} placeholder={problem ? "Опишіть несправність" : "За потреби"} /></label>
                  {problem && <label><span>Терміновість</span><select value={draft.urgency} onChange={(event) => item.id && setDrafts((current) => ({ ...current, [item.id!]: { ...draft, urgency: event.target.value } }))}><option value="INFO">Рекомендація</option><option value="SOON">Найближчим часом</option><option value="CRITICAL">Критично</option></select></label>}
                  <button type="button" className={styles.saveDetails} disabled={Boolean(busy)} onClick={() => void updateCheck(item, item.state === "NOT_CHECKED" ? "ATTENTION" : item.state)}>Зберегти деталі</button>
                </div>}
              </>}
              {locked && item.finding?.findingText && <p className={styles.finding}>{item.finding.findingText}</p>}
            </div>;
          })}</div>
        </article>)}
      </section>)}

      {!locked && workflow !== "PENDING" && <section className={styles.submitCard}>
        <label><span>Коментар механіка до діагностики</span></label>
        <VoiceNoteInput
          value={comment}
          onChange={setComment}
          endpoint={`/api/diagnostics/${encodeURIComponent(diagnosticId)}/voice-transcription`}
          disabled={Boolean(busy)}
          onBusyChange={setVoiceBusy}
        />
        <button type="button" disabled={Boolean(busy) || voiceBusy || !data.canSubmit} onClick={() => void submit()}>{busy === "submit" ? "Передаю…" : voiceBusy ? "Очікую завершення голосового запису…" : "Передати діагностику сервіс-менеджеру →"}</button>
        {!data.canSubmit && <small>Для передачі потрібно перевірити всі обов’язкові пункти.</small>}
      </section>}
      {locked && <div className={styles.locked}>{workflow === "SUBMITTED" ? "✓ Діагностику передано сервіс-менеджеру. Редагування заблоковано." : workflow === "CONFIRMED" ? "✓ Діагностику підтверджено. Наступний етап визначить CRM." : "Діагностика доступна лише для перегляду."}</div>}
    </main>
  </div>;
}
