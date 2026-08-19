"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./mechanic-mobile-cabinet.module.css";

type MechanicPayload = {
  linked: boolean;
  mechanic?: { id: string; name: string; station: { id: string; name: string } };
  kpis?: { assigned: number; inProgress: number; completedToday: number; waitingParts: number };
  tasks?: Array<{ id: string; workOrderId: string; description: string; status: string; type: string; laborHours: string | null; plate: string; vehicle: string; workOrderStatus: string; updatedAt: string }>;
  appointments?: Array<{ id: string; status: string; plannedStartAt: string; plannedEndAt: string; plate: string; vehicle: string; problem: string | null; post: string | null }>;
};

type QueueItem = {
  id: string;
  status: string;
  workflowState: string;
  reviewState: string;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  problem: string | null;
  vehicle: { id: string; label: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null };
  client: { id: string; name: string | null; phone: string };
};

type MediaMeta = { id: string; findingId: string; fileName: string; mimeType: string; fileSize: number; createdAt: string };
type Finding = {
  id: string;
  action: string;
  urgency: string;
  findingText: string | null;
  suggestedWorkName: string | null;
  suggestedPartName: string | null;
  media: MediaMeta[];
};
type Check = {
  id: string | null;
  templateItemId: string;
  name: string;
  position: string | null;
  measurementUnit: string | null;
  state: "NOT_CHECKED" | "OK" | "ATTENTION" | "DEFECT";
  measurementValue: string | null;
  measurementText: string | null;
  note: string | null;
  finding: Finding | null;
};
type Section = {
  id: string;
  code: string;
  name: string;
  items: Check[];
  counts: { total: number; checked: number; ok: number; attention: number; defect: number };
};
type Inspection = {
  id: string;
  templateId: string;
  templateName: string;
  status: string;
  sections: Section[];
  counts: { total: number; checked: number; ok: number; attention: number; defect: number };
};
type DiagnosticView = {
  diagnostic: {
    id: string;
    status: string;
    workflowState: string;
    technicalConclusion: string | null;
    problem: string | null;
    vehicle: QueueItem["vehicle"];
    client: QueueItem["client"];
    review: { state: string; mechanicComment: string | null; managerComment: string | null; submittedAt: string | null; returnedAt: string | null; confirmedAt: string | null };
    workOrder: { id: string; status: string } | null;
  };
  inspections: Inspection[];
  availableTemplates: Array<{ id: string; code: string; name: string; description: string | null; added: boolean }>;
  counts: { total: number; checked: number; ok: number; attention: number; defect: number };
  canSubmit: boolean;
};

type Preferences = {
  textScale: "S" | "M" | "L" | "XL";
  controlScale: "COMPACT" | "STANDARD" | "LARGE";
  textMode: "STANDARD" | "HIGH_CONTRAST" | "DARK";
  interfaceContrast: "NORMAL" | "HIGH";
  spacing: "NORMAL" | "SPACIOUS";
  largeTouchTargets: boolean;
};

type Payroll = {
  ok: boolean;
  projection?: { total?: number | string; month?: string };
  summary?: Record<string, unknown>;
  [key: string]: unknown;
};

type Screen = "HOME" | "DIAGNOSTICS" | "DIAGNOSTIC" | "SECTION" | "SUMMARY" | "ACCESSIBILITY" | "PAYROLL";

const DEFAULT_PREFS: Preferences = {
  textScale: "M",
  controlScale: "STANDARD",
  textMode: "STANDARD",
  interfaceContrast: "NORMAL",
  spacing: "NORMAL",
  largeTouchTargets: true,
};

const stateLabel: Record<string, string> = {
  PENDING: "Не розпочата",
  IN_PROGRESS: "В роботі",
  SUBMITTED: "Передано менеджеру",
  RETURNED: "Повернено на уточнення",
  CONFIRMED: "Підтверджено",
  CANCELLED: "Скасовано",
};
const checkLabel: Record<Check["state"], string> = { NOT_CHECKED: "Не перевірено", OK: "Норма", ATTENTION: "Увага", DEFECT: "Дефект" };
const actionOptions = [
  ["NONE", "Без дії"], ["REPLACE", "Замінити"], ["REPAIR", "Ремонтувати"], ["ADJUST", "Відрегулювати"], ["CLEAN", "Очистити / обслужити"], ["ADDITIONAL_DIAGNOSTICS", "Додаткова діагностика"],
] as const;
const urgencyOptions = [["INFO", "Рекомендація"], ["SOON", "Найближчим часом"], ["CRITICAL", "Критично"]] as const;

function time(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(number) : "—";
}
function classNames(...values: Array<string | false | null | undefined>) { return values.filter(Boolean).join(" "); }

export function MechanicMobileCabinet({ data, userName }: { data: MechanicPayload; userName?: string | null }) {
  const [screen, setScreen] = useState<Screen>("HOME");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [view, setView] = useState<DiagnosticView | null>(null);
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [draftPrefs, setDraftPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [mechanicComment, setMechanicComment] = useState("");
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const photoInput = useRef<HTMLInputElement | null>(null);
  const photoCheckId = useRef<string | null>(null);

  const loadQueue = useCallback(async () => {
    const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити діагностики");
    setQueue(body.items || []);
  }, []);

  const loadPreferences = useCallback(async () => {
    const response = await fetch("/api/me/ui-preferences", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) return;
    const next = { ...DEFAULT_PREFS, ...body.preferences } as Preferences;
    setPrefs(next);
    setDraftPrefs(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.allSettled([loadQueue(), loadPreferences()]).then((results) => {
      if (!mounted) return;
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "Помилка завантаження");
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [loadPreferences, loadQueue]);

  const rootClass = classNames(
    styles.app,
    styles[`text${prefs.textScale}`],
    styles[`controls${prefs.controlScale}`],
    prefs.textMode === "HIGH_CONTRAST" && styles.highContrast,
    prefs.textMode === "DARK" && styles.dark,
    prefs.interfaceContrast === "HIGH" && styles.contrastHigh,
    prefs.spacing === "SPACIOUS" && styles.spacious,
    prefs.largeTouchTargets && styles.largeTouch,
  );

  const selectedInspection = view?.inspections.find((item) => item.id === selectedInspectionId) || null;
  const selectedSection = selectedInspection?.sections.find((item) => item.id === selectedSectionId) || null;
  const currentFindingRows = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ inspection, section, item })))) || [], [view]);

  async function loadDiagnostic(id: string) {
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(id)}/structured`, { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити діагностику");
    const next = body as DiagnosticView & { ok: true };
    setView(next);
    setMechanicComment(next.diagnostic.review.mechanicComment || "");
    return next;
  }

  async function openDiagnostic(item: QueueItem) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (item.status === "PENDING" || item.workflowState === "RETURNED") {
        const response = await fetch(`/api/diagnostics/${encodeURIComponent(item.id)}/structured`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ action: "START" }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося розпочати діагностику");
        setView(body as DiagnosticView & { ok: true });
      } else await loadDiagnostic(item.id);
      setScreen(item.workflowState === "SUBMITTED" || item.status === "CONFIRMED" ? "SUMMARY" : "DIAGNOSTIC");
      await loadQueue();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function addTemplate(templateId: string) {
    if (!view) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${view.diagnostic.id}/structured`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "ADD_TEMPLATE", templateId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося додати шаблон");
      setView(body as DiagnosticView & { ok: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function setCheck(check: Check, patch: Partial<{ state: Check["state"]; measurementValue: string; measurementText: string; note: string; action: string; urgency: string; findingText: string }>) {
    if (!view || !check.id) return;
    setBusy(true); setError(""); setMessage("");
    const body = {
      state: patch.state || check.state,
      measurementValue: patch.measurementValue ?? check.measurementValue,
      measurementText: patch.measurementText ?? check.measurementText,
      note: patch.note ?? check.note,
      action: patch.action ?? check.finding?.action ?? "NONE",
      urgency: patch.urgency ?? check.finding?.urgency ?? "INFO",
      findingText: patch.findingText ?? check.finding?.findingText ?? "",
    };
    try {
      const response = await fetch(`/api/diagnostics/${view.diagnostic.id}/checks/${check.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const dataBody = await response.json().catch(() => null);
      if (!response.ok || !dataBody?.ok) throw new Error(dataBody?.message || dataBody?.error || "Не вдалося зберегти пункт");
      setView(dataBody as DiagnosticView & { ok: true });
      if ((body.state === "ATTENTION" || body.state === "DEFECT") && check.id) setExpandedCheckId(check.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function sectionAllOk() {
    if (!view || !selectedInspection || !selectedSection) return;
    if (!confirm(`Позначити всі пункти секції «${selectedSection.name}» як «Норма»?`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${view.diagnostic.id}/structured`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "SECTION_ALL_OK", inspectionId: selectedInspection.id, sectionId: selectedSection.id }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити секцію");
      setView(body as DiagnosticView & { ok: true });
      setMessage("Усі пункти секції позначено як норму. Проблемні можна змінити вручну.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function uploadPhoto(file: File) {
    if (!view || !photoCheckId.current) return;
    setBusy(true); setError("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const response = await fetch(`/api/diagnostics/${view.diagnostic.id}/checks/${photoCheckId.current}/media`, { method: "POST", credentials: "include", body: fd });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити фото");
      await loadDiagnostic(view.diagnostic.id);
      setMessage("Фото додано до дефекту.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка завантаження фото"); }
    finally { photoCheckId.current = null; setBusy(false); }
  }

  async function submitDiagnostic() {
    if (!view) return;
    if (!view.canSubmit) { setError("Спочатку перевірте всі пункти діагностики."); return; }
    if (!confirm("Завершити діагностику та передати сервіс-менеджеру? Після передачі редагування буде заблоковано до можливого повернення.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${view.diagnostic.id}/structured`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "SUBMIT", mechanicComment }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати діагностику");
      setView(body as DiagnosticView & { ok: true });
      await loadQueue();
      setScreen("SUMMARY");
      setMessage("Діагностику передано сервіс-менеджеру.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function savePreferences() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/me/ui-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(draftPrefs) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти налаштування");
      const next = { ...DEFAULT_PREFS, ...body.preferences } as Preferences;
      setPrefs(next); setDraftPrefs(next); setMessage("Налаштування читабельності збережено для вашого акаунта."); setScreen("HOME");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
    finally { setBusy(false); }
  }

  async function openPayroll() {
    setScreen("PAYROLL"); setError("");
    try {
      const response = await fetch("/api/me/compensation", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити оплату праці");
      setPayroll(body as Payroll);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка"); }
  }

  function openSection(inspection: Inspection, section: Section) {
    setSelectedInspectionId(inspection.id); setSelectedSectionId(section.id); setExpandedCheckId(null); setScreen("SECTION"); setError(""); setMessage("");
  }

  if (!data.linked || !data.mechanic) return <div className={styles.linkState}><strong>Кабінет механіка ще не прив’язаний</strong><span>Призначте працівнику ресурс автомеханіка і станцію в «Персонал».</span></div>;

  const diagnosticsToday = queue;
  const activeCount = diagnosticsToday.filter((item) => ["PENDING", "IN_PROGRESS", "RETURNED"].includes(item.workflowState)).length;

  return <div className={rootClass}>
    <input ref={photoInput} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadPhoto(file); event.currentTarget.value = ""; }} />

    <div className={styles.phoneShell}>
      {screen === "HOME" && <>
        <header className={styles.homeHeader}>
          <div className={styles.brandMark}>TL</div>
          <div><h1>Добрий день, {userName?.split(" ")[0] || data.mechanic.name.split(" ")[0]}</h1><p>СТО Turbo LEV · {data.mechanic.station.name}</p></div>
          <button className={styles.iconButton} type="button" aria-label="Налаштування доступності" onClick={() => { setDraftPrefs(prefs); setScreen("ACCESSIBILITY"); }}>⚙</button>
        </header>
        <section className={styles.modeStrip}><span>◉</span><div><b>{prefs.textScale === "M" && prefs.controlScale === "STANDARD" ? "Стандартний режим" : `Текст: ${prefs.textScale} · Кнопки: ${prefs.controlScale === "LARGE" ? "великі" : prefs.controlScale === "COMPACT" ? "компактні" : "стандарт"}`}</b><small>{prefs.textMode === "HIGH_CONTRAST" ? "Підвищений контраст" : prefs.textMode === "DARK" ? "Темна тема" : "Налаштування читабельності"}</small></div><button type="button" onClick={() => { setDraftPrefs(prefs); setScreen("ACCESSIBILITY"); }}>Змінити</button></section>
        <div className={styles.titleRow}><div><h2>Сьогодні</h2><p>{activeCount} діагностик потребують дії</p></div><button className={styles.calendarButton} type="button" onClick={() => navigateCrm("Планувальник")}>▣</button></div>
        {loading ? <div className={styles.empty}>Завантажую ваш робочий день…</div> : diagnosticsToday.length ? <div className={styles.appointmentList}>{diagnosticsToday.map((item) => <article className={styles.appointmentCard} key={item.id}>
          <div className={styles.cardTop}><time>{time(item.plannedStartAt)}</time><div className={styles.vehicleTitle}><h3>{item.vehicle.label}</h3><b className={styles.plate}>🇺🇦 {item.vehicle.plateNumber || "БЕЗ НОМЕРА"}</b></div><span className={classNames(styles.statusPill, styles[`state${item.workflowState}`])}>● {stateLabel[item.workflowState] || item.workflowState}</span></div>
          <div className={styles.problem}><span>☏</span><p>{item.problem || "Планова діагностика"}</p></div>
          {item.post && <small className={styles.post}>Пост: {item.post}</small>}
          <button className={styles.primary} type="button" disabled={busy || ["SUBMITTED", "CONFIRMED", "CANCELLED"].includes(item.workflowState)} onClick={() => void openDiagnostic(item)}>{item.workflowState === "PENDING" ? "Почати діагностику" : item.workflowState === "RETURNED" ? "Внести уточнення" : item.workflowState === "IN_PROGRESS" ? "Продовжити" : stateLabel[item.workflowState] || "Відкрити"}</button>
          {["SUBMITTED", "CONFIRMED"].includes(item.workflowState) && <button className={styles.secondaryFull} type="button" onClick={() => void openDiagnostic(item)}>Переглянути підсумок</button>}
        </article>)}</div> : <div className={styles.empty}><strong>Діагностик на сьогодні немає</strong><span>Нові авто з’являться тут після ARRIVED і призначення на вас у Планувальнику.</span></div>}
      </>}

      {screen === "DIAGNOSTICS" && <>
        <MobileTop title="Мої діагностики" onBack={() => setScreen("HOME")} />
        <div className={styles.metricRow}><div><span>У черзі</span><strong>{queue.length}</strong></div><div><span>В роботі</span><strong>{queue.filter((item) => item.workflowState === "IN_PROGRESS").length}</strong></div><div><span>Передано</span><strong>{queue.filter((item) => item.workflowState === "SUBMITTED").length}</strong></div></div>
        <div className={styles.compactList}>{queue.map((item) => <button type="button" key={item.id} onClick={() => void openDiagnostic(item)}><time>{time(item.plannedStartAt)}</time><div><strong>{item.vehicle.label}</strong><span>{item.vehicle.plateNumber || "Без номера"}</span><small>{item.problem || "Планова діагностика"}</small></div><em>{stateLabel[item.workflowState] || item.workflowState}</em></button>)}</div>
      </>}

      {screen === "DIAGNOSTIC" && view && <>
        <MobileTop title="Діагностика авто" onBack={() => { setScreen("HOME"); void loadQueue(); }} right={`${view.counts.checked}/${view.counts.total}`} />
        <VehicleCard view={view} />
        {view.diagnostic.review.state === "RETURNED" && <div className={styles.returned}><strong>Повернено сервіс-менеджером</strong><p>{view.diagnostic.review.managerComment || "Потрібно уточнити результати діагностики."}</p></div>}
        <div className={styles.inspectionList}>{view.inspections.map((inspection) => <section className={styles.inspectionCard} key={inspection.id}>
          <div className={styles.inspectionHead}><div><h3>{inspection.templateName}</h3><span>{inspection.counts.checked}/{inspection.counts.total} пунктів</span></div><StatusSummary counts={inspection.counts} /></div>
          <div className={styles.progress}><i style={{ width: `${inspection.counts.total ? Math.round(inspection.counts.checked / inspection.counts.total * 100) : 0}%` }} /></div>
          <div className={styles.sectionLinks}>{inspection.sections.map((section) => <button type="button" key={section.id} onClick={() => openSection(inspection, section)}><div><strong>{section.name}</strong><span>{section.counts.checked}/{section.counts.total}</span></div><StatusSummary counts={section.counts} compact /><b>›</b></button>)}</div>
        </section>)}</div>
        {view.availableTemplates.some((item) => !item.added) && <section className={styles.addTemplate}><h3>Додати вид діагностики</h3>{view.availableTemplates.filter((item) => !item.added).map((template) => <button type="button" key={template.id} disabled={busy} onClick={() => void addTemplate(template.id)}><span>＋</span><div><strong>{template.name}</strong><small>{template.description}</small></div></button>)}</section>}
        <button className={styles.primarySticky} type="button" onClick={() => setScreen("SUMMARY")}>Підсумок діагностики →</button>
      </>}

      {screen === "SECTION" && view && selectedInspection && selectedSection && <>
        <MobileTop title={selectedSection.name} onBack={() => setScreen("DIAGNOSTIC")} right={`${selectedSection.counts.checked}/${selectedSection.counts.total}`} />
        <div className={styles.sectionVehicle}><div><strong>{view.diagnostic.vehicle.label}</strong><span>{view.diagnostic.vehicle.plateNumber || "Без номера"}</span></div><button type="button" onClick={() => void sectionAllOk()}>✓ Усе в нормі</button></div>
        <div className={styles.checkList}>{selectedSection.items.map((check) => <CheckRow key={check.templateItemId} check={check} diagnosticId={view.diagnostic.id} expanded={Boolean(check.id && expandedCheckId === check.id)} busy={busy} onExpand={() => check.id && setExpandedCheckId(expandedCheckId === check.id ? null : check.id)} onState={(state) => void setCheck(check, { state })} onSave={(patch) => void setCheck(check, patch)} onPhoto={() => { if (!check.id) return; photoCheckId.current = check.id; photoInput.current?.click(); }} />)}</div>
        <button className={styles.primarySticky} type="button" onClick={() => setScreen("DIAGNOSTIC")}>Зберегти секцію</button>
      </>}

      {screen === "SUMMARY" && view && <>
        <MobileTop title="Підсумок діагностики" onBack={() => setScreen("DIAGNOSTIC")} />
        <div className={styles.summaryVehicle}><strong>{view.diagnostic.vehicle.label}</strong><span>{view.diagnostic.vehicle.plateNumber || "Без номера"}</span></div>
        <div className={styles.summaryMetrics}><div><span>Перевірено</span><strong>{view.counts.checked}/{view.counts.total}</strong></div><div className={styles.okBox}><span>Норма</span><strong>{view.counts.ok}</strong></div><div className={styles.attentionBox}><span>Увага</span><strong>{view.counts.attention}</strong></div><div className={styles.defectBox}><span>Дефект</span><strong>{view.counts.defect}</strong></div></div>
        <section className={styles.findingSummary}><h3>Виявлено</h3>{currentFindingRows.length ? currentFindingRows.map(({ section, item }) => <div key={item.id || item.templateItemId}><span className={item.state === "DEFECT" ? styles.redDot : styles.orangeDot}>{item.state === "DEFECT" ? "×" : "!"}</span><div><strong>{item.name}</strong><small>{section.name} · {item.finding?.findingText || item.note || checkLabel[item.state]}</small>{item.finding?.suggestedWorkName && <em>Робота: {item.finding.suggestedWorkName}</em>}{item.finding?.suggestedPartName && <em>Деталь: {item.finding.suggestedPartName}</em>}</div><b>{checkLabel[item.state]}</b></div>) : <p className={styles.allGood}>✓ Зауважень і дефектів не виявлено.</p>}</section>
        {currentFindingRows.some(({ item }) => item.finding?.media.length) && <section className={styles.photoGrid}><h3>Фото дефектів</h3><div>{currentFindingRows.flatMap(({ item }) => item.finding?.media || []).map((media) => <a key={media.id} href={`/api/diagnostics/${view.diagnostic.id}/media/${media.id}`} target="_blank" rel="noreferrer"><img src={`/api/diagnostics/${view.diagnostic.id}/media/${media.id}`} alt={media.fileName} /></a>)}</div></section>}
        {!["SUBMITTED", "CONFIRMED"].includes(view.diagnostic.review.state) && <label className={styles.commentBox}><span>Коментар механіка</span><textarea rows={3} value={mechanicComment} onChange={(event) => setMechanicComment(event.target.value)} placeholder="Додатковий коментар (необов’язково)" /></label>}
        {view.diagnostic.review.state === "SUBMITTED" ? <div className={styles.submittedState}><strong>✓ Передано сервіс-менеджеру</strong><span>Результати зафіксовані. Якщо потрібне уточнення, діагностику повернуть у ваш кабінет.</span></div> : view.diagnostic.review.state === "CONFIRMED" || view.diagnostic.status === "CONFIRMED" ? <div className={styles.submittedState}><strong>✓ Діагностику підтверджено</strong><span>{view.diagnostic.workOrder ? `Створено замовлення-наряд · ${view.diagnostic.workOrder.status}` : "Hard Gate пройдено."}</span></div> : <button className={styles.primarySticky} type="button" disabled={busy || !view.canSubmit} onClick={() => void submitDiagnostic()}>{view.canSubmit ? "Завершити та передати сервіс-менеджеру" : `Залишилось перевірити ${view.counts.total - view.counts.checked}`}</button>}
      </>}

      {screen === "ACCESSIBILITY" && <>
        <MobileTop title="Доступність" onBack={() => { setDraftPrefs(prefs); setScreen("HOME"); }} />
        <p className={styles.accessLead}>Налаштуйте інтерфейс під свій зір, розмір пальців і умови роботи.</p>
        <PreferenceGroup title="Розмір тексту" hint="Змінює текст у всьому кабінеті механіка."><Segment values={["S", "M", "L", "XL"]} value={draftPrefs.textScale} labels={{ S: "S", M: "M", L: "L", XL: "XL" }} onChange={(value) => setDraftPrefs((current) => ({ ...current, textScale: value as Preferences["textScale"] }))} /></PreferenceGroup>
        <PreferenceGroup title="Розмір кнопок" hint="Великі елементи легше натискати робочими руками."><Segment values={["COMPACT", "STANDARD", "LARGE"]} value={draftPrefs.controlScale} labels={{ COMPACT: "Компактні", STANDARD: "Стандарт", LARGE: "Великі" }} onChange={(value) => setDraftPrefs((current) => ({ ...current, controlScale: value as Preferences["controlScale"] }))} /></PreferenceGroup>
        <PreferenceGroup title="Режим тексту" hint="Підвищений контраст допомагає при слабкому зорі або яскравому освітленні."><Segment values={["STANDARD", "HIGH_CONTRAST", "DARK"]} value={draftPrefs.textMode} labels={{ STANDARD: "Стандарт", HIGH_CONTRAST: "Контраст", DARK: "Темний" }} onChange={(value) => setDraftPrefs((current) => ({ ...current, textMode: value as Preferences["textMode"] }))} /></PreferenceGroup>
        <PreferenceGroup title="Контраст інтерфейсу"><Segment values={["NORMAL", "HIGH"]} value={draftPrefs.interfaceContrast} labels={{ NORMAL: "Нормальний", HIGH: "Підвищений" }} onChange={(value) => setDraftPrefs((current) => ({ ...current, interfaceContrast: value as Preferences["interfaceContrast"] }))} /></PreferenceGroup>
        <PreferenceGroup title="Відстань між елементами"><Segment values={["NORMAL", "SPACIOUS"]} value={draftPrefs.spacing} labels={{ NORMAL: "Звичайна", SPACIOUS: "Простора" }} onChange={(value) => setDraftPrefs((current) => ({ ...current, spacing: value as Preferences["spacing"] }))} /></PreferenceGroup>
        <label className={styles.toggleRow}><div><strong>Великі торкальні зони</strong><span>Збільшує активну зону кнопок і відступи між ними.</span></div><input type="checkbox" checked={draftPrefs.largeTouchTargets} onChange={(event) => setDraftPrefs((current) => ({ ...current, largeTouchTargets: event.target.checked }))} /></label>
        <div className={styles.preview} data-preview-text={draftPrefs.textScale} data-preview-controls={draftPrefs.controlScale}><span>Попередній перегляд</span><div><time>10:00</time><div><strong>Ford Mondeo</strong><b>AA1234KX</b></div></div><button type="button">Почати діагностику</button></div>
        <button className={styles.primarySticky} type="button" disabled={busy} onClick={() => void savePreferences()}>Застосувати</button>
      </>}

      {screen === "PAYROLL" && <>
        <MobileTop title="Моя зарплата" onBack={() => setScreen("HOME")} />
        <section className={styles.payrollCard}><span>Особисті дані оплати</span><h2>{money(payroll?.projection?.total ?? payroll?.summary?.total)}</h2><p>Відображається лише ваша власна проєкція. Дані інших працівників недоступні.</p></section>
        <button className={styles.secondaryFull} type="button" onClick={() => void openPayroll()}>Оновити розрахунок</button>
      </>}

      {error && <div className={styles.toastError} role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div>}
      {message && <div className={styles.toastSuccess}>{message}<button type="button" onClick={() => setMessage("")}>×</button></div>}

      {!(["SECTION", "ACCESSIBILITY"].includes(screen)) && <nav className={styles.bottomNav}>
        <button type="button" className={screen === "HOME" ? styles.navActive : ""} onClick={() => setScreen("HOME")}><span>⌂</span><b>Головна</b></button>
        <button type="button" className={["DIAGNOSTICS", "DIAGNOSTIC", "SUMMARY"].includes(screen) ? styles.navActive : ""} onClick={() => setScreen("DIAGNOSTICS")}><span>♧</span><b>Діагностика</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { scope: "mechanics" })}><span>▤</span><b>Мої роботи</b></button>
        <button type="button" onClick={() => navigateCrm("Планувальник")}><span>▣</span><b>Графік</b></button>
        <button type="button" className={screen === "PAYROLL" ? styles.navActive : ""} onClick={() => void openPayroll()}><span>▱</span><b>Зарплата</b></button>
      </nav>}
    </div>
  </div>;
}

function MobileTop({ title, onBack, right }: { title: string; onBack: () => void; right?: string }) {
  return <header className={styles.mobileTop}><button type="button" onClick={onBack}>←</button><h1>{title}</h1>{right ? <span>{right}</span> : <i />}</header>;
}

function VehicleCard({ view }: { view: DiagnosticView }) {
  return <section className={styles.vehicleCard}><div><h2>{view.diagnostic.vehicle.label}</h2><b className={styles.plate}>🇺🇦 {view.diagnostic.vehicle.plateNumber || "БЕЗ НОМЕРА"}</b><p>VIN: {view.diagnostic.vehicle.vin || "не вказано"}</p></div><div className={styles.vehicleFacts}><span><small>Пробіг</small><strong>{view.diagnostic.vehicle.mileageKm ? `${view.diagnostic.vehicle.mileageKm.toLocaleString("uk-UA")} км` : "—"}</strong></span><span><small>Скарга клієнта</small><strong>{view.diagnostic.problem || "Планова перевірка"}</strong></span></div></section>;
}

function StatusSummary({ counts, compact = false }: { counts: { defect: number; attention: number; checked: number; total: number }; compact?: boolean }) {
  if (counts.defect) return <span className={styles.defectTag}>{counts.defect} {compact ? "деф." : "дефекти"}</span>;
  if (counts.attention) return <span className={styles.attentionTag}>{counts.attention} {compact ? "увага" : "зауваження"}</span>;
  if (counts.total > 0 && counts.checked === counts.total) return <span className={styles.okTag}>Норма</span>;
  return <span className={styles.neutralTag}>{counts.checked ? "Не завершено" : "Не розпочато"}</span>;
}

function CheckRow({ check, diagnosticId, expanded, busy, onExpand, onState, onSave, onPhoto }: {
  check: Check;
  diagnosticId: string;
  expanded: boolean;
  busy: boolean;
  onExpand: () => void;
  onState: (state: Check["state"]) => void;
  onSave: (patch: Partial<{ state: Check["state"]; measurementValue: string; measurementText: string; note: string; action: string; urgency: string; findingText: string }>) => void;
  onPhoto: () => void;
}) {
  const [findingText, setFindingText] = useState(check.finding?.findingText || "");
  const [note, setNote] = useState(check.note || "");
  const [measurement, setMeasurement] = useState(check.measurementValue || check.measurementText || "");
  const [action, setAction] = useState(check.finding?.action || "NONE");
  const [urgency, setUrgency] = useState(check.finding?.urgency || "INFO");
  useEffect(() => { setFindingText(check.finding?.findingText || ""); setNote(check.note || ""); setMeasurement(check.measurementValue || check.measurementText || ""); setAction(check.finding?.action || "NONE"); setUrgency(check.finding?.urgency || "INFO"); }, [check.finding?.action, check.finding?.findingText, check.finding?.urgency, check.measurementText, check.measurementValue, check.note]);
  const problem = check.state === "ATTENTION" || check.state === "DEFECT";
  return <article className={classNames(styles.checkRow, problem && styles.checkProblem)}>
    <button className={styles.checkTitle} type="button" onClick={onExpand}><div><strong>{check.name}</strong>{check.position && <small>{check.position}</small>}</div>{problem && <span>{expanded ? "⌃" : "⌄"}</span>}</button>
    <div className={styles.stateButtons}>{(["OK", "ATTENTION", "DEFECT", "NOT_CHECKED"] as const).map((state) => <button type="button" key={state} disabled={busy || !check.id} className={check.state === state ? styles[`selected${state}`] : ""} onClick={() => { onState(state); if (state === "ATTENTION" || state === "DEFECT") onExpand(); }}>{checkLabel[state]}</button>)}</div>
    {expanded && problem && <div className={styles.findingEditor}>
      <label><span>Опис / примітка</span><textarea rows={2} value={findingText} onChange={(event) => setFindingText(event.target.value)} placeholder="Наприклад: виражений люфт, стук…" /></label>
      <div className={styles.editorGrid}><label><span>Рекомендація</span><select value={action} onChange={(event) => setAction(event.target.value)}>{actionOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Терміновість</span><select value={urgency} onChange={(event) => setUrgency(event.target.value)}>{urgencyOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      {check.measurementUnit && <label><span>Замір, {check.measurementUnit}</span><input inputMode="decimal" value={measurement} onChange={(event) => setMeasurement(event.target.value)} placeholder={`Значення у ${check.measurementUnit}`} /></label>}
      <label><span>Додаткова примітка</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Необов’язково" /></label>
      {check.finding?.suggestedWorkName && <div className={styles.suggestion}><span>🔧</span><div><small>Запропонована робота</small><strong>{check.finding.suggestedWorkName}</strong></div></div>}
      {check.finding?.suggestedPartName && <div className={styles.suggestion}><span>▣</span><div><small>Запропонована деталь</small><strong>{check.finding.suggestedPartName}</strong></div></div>}
      <div className={styles.mediaBlock}><span>Фото дефекту</span><div className={styles.mediaThumbs}>{check.finding?.media.map((media) => <a key={media.id} href={`/api/diagnostics/${diagnosticId}/media/${media.id}`} target="_blank" rel="noreferrer"><img src={`/api/diagnostics/${diagnosticId}/media/${media.id}`} alt={media.fileName} /></a>)}<button type="button" onClick={onPhoto}>📷<small>Додати фото</small></button></div></div>
      <button className={styles.saveFinding} type="button" disabled={busy} onClick={() => onSave({ state: check.state, findingText, note, action, urgency, ...(check.measurementUnit ? { measurementValue: measurement } : { measurementText: measurement }) })}>Зберегти дефект</button>
    </div>}
  </article>;
}

function PreferenceGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className={styles.preferenceGroup}><h3>{title}</h3>{children}{hint && <p>{hint}</p>}</section>;
}
function Segment({ values, value, labels, onChange }: { values: string[]; value: string; labels: Record<string, string>; onChange: (value: string) => void }) {
  return <div className={styles.segment}>{values.map((item) => <button type="button" key={item} className={value === item ? styles.segmentActive : ""} onClick={() => onChange(item)}>{labels[item]}</button>)}</div>;
}
