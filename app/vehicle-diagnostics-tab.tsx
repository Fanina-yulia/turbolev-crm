"use client";

import { useEffect, useMemo, useState } from "react";
import type { VehicleCardContract } from "@/src/lib/contracts/crm-core";
import { navigateCrm } from "./crm-route";
import styles from "./vehicle-diagnostic-card.module.css";

type WorkflowState = "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED" | "CONFIRMED" | "CANCELLED";
type DiagnosticRow = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "CONFIRMED" | "CANCELLED";
  workflowState?: Exclude<WorkflowState, "RETURNED">;
  reviewState?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  vehicle: { id: string; plateNumber: string | null; vin: string | null };
  assignedMechanic?: { id: string; name: string | null } | null;
  diagnosticCard?: { number: string; finalizedAt: string | null } | null;
  structured?: { inspections: number; checked: number; defects: number; attention: number };
  commercialProposal?: { workOrderId: string; stage: string } | null;
};

type DiagnosticMedia = { id: string; fileName: string; mimeType: string; fileSize: number; createdAt: string };
type DiagnosticFinding = { id: string; action: string; urgency: string; findingText: string | null; suggestedWorkName: string | null; suggestedPartName: string | null; media: DiagnosticMedia[] };
type DiagnosticItem = { id: string; templateItemId: string; name: string; position: string | null; state: string; measurementUnit: string | null; measurementValue: string | null; measurementText: string | null; note: string | null; finding: DiagnosticFinding | null };
type DiagnosticSection = { id: string; name: string; items: DiagnosticItem[]; counts: { total: number; checked: number; ok: number; attention: number; defect: number } };
type DiagnosticInspection = { id: string; templateName: string; sections: DiagnosticSection[]; counts: { total: number; checked: number; ok: number; attention: number; defect: number } };
type DiagnosticView = {
  diagnostic: {
    id: string;
    status: string;
    workflowState: string;
    technicalConclusion: string | null;
    confirmedAt: string | null;
    client: { id: string; name: string | null; phone: string };
    vehicle: { id: string; label: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null };
    problem: string | null;
    workOrder: { id: string; status: string } | null;
    assignment: { mechanicId: string | null } | null;
    review: { state: string; mechanicComment: string | null; managerComment: string | null };
  };
  inspections: DiagnosticInspection[];
  counts: { total: number; checked: number; ok: number; attention: number; defect: number };
};

type Props = { vehicle: VehicleCardContract; diagnosticId?: string | null };

const workflowLabels: Record<WorkflowState, string> = { PENDING: "Очікує", IN_PROGRESS: "В роботі", SUBMITTED: "На перевірці", RETURNED: "В роботі", CONFIRMED: "Підтверджена", CANCELLED: "Скасована" };
function stateOf(row: DiagnosticRow): WorkflowState { if (row.reviewState === "RETURNED") return "RETURNED"; return row.workflowState || row.status; }
function dateText(value: string | null | undefined) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function vehicleTitle(vehicle: VehicleCardContract) { return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"; }

type CardStatus = { label: string; tone: "good" | "review" | "danger" | "muted" };
function cardStatus(row: DiagnosticRow, findings: Array<{ item: DiagnosticItem }>): CardStatus {
  const state = stateOf(row);
  if (state === "CONFIRMED") return { label: "Готово", tone: "good" };
  if (state === "CANCELLED") return { label: "Скасована", tone: "danger" };
  if (findings.some(({ item }) => item.state === "DEFECT" || item.finding?.urgency === "CRITICAL")) return { label: "Критично", tone: "danger" };
  if (state === "SUBMITTED") return { label: "На перевірці", tone: "review" };
  return { label: "В роботі", tone: "review" };
}

export function VehicleDiagnosticsTab({ vehicle, diagnosticId }: Props) {
  const [rows, setRows] = useState<DiagnosticRow[]>([]);
  const [prefetched, setPrefetched] = useState<{ id: string; view: DiagnosticView; cardNumber: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(diagnosticId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    setPrefetched(null);
    if (diagnosticId) {
      void fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/fast?vehicleId=${encodeURIComponent(vehicle.id)}`, { cache: "default", credentials: "include", signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null) as { ok?: boolean; row?: DiagnosticRow; view?: DiagnosticView; cardNumber?: string | null; error?: string } | null;
          if (!response.ok || !body?.ok || !body.row || !body.view) throw new Error(body?.error || "Не вдалося завантажити діагностичну карту.");
          if (controller.signal.aborted) return;
          setRows([body.row]);
          setPrefetched({ id: body.row.id, view: body.view, cardNumber: body.cardNumber || body.row.diagnosticCard?.number || "" });
          setLoading(false);

          void fetch(`/api/diagnostics?vehicleId=${encodeURIComponent(vehicle.id)}&limit=20`, { cache: "no-store", credentials: "include", signal: controller.signal })
            .then(async (historyResponse) => {
              const historyBody = await historyResponse.json().catch(() => null) as { diagnostics?: DiagnosticRow[] } | null;
              if (!historyResponse.ok || !Array.isArray(historyBody?.diagnostics) || controller.signal.aborted) return;
              setRows((current) => {
                const byId = new Map(current.map((row) => [row.id, row]));
                for (const row of historyBody.diagnostics || []) byId.set(row.id, row);
                return Array.from(byId.values());
              });
            })
            .catch(() => undefined);
        })
        .catch((cause) => { if (!controller.signal.aborted && cause instanceof Error && cause.name !== "AbortError") setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      return () => controller.abort();
    }
    void fetch(`/api/diagnostics?vehicleId=${encodeURIComponent(vehicle.id)}&limit=100`, { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { ok?: boolean; diagnostics?: DiagnosticRow[]; error?: string } | null;
        if (!response.ok || !body?.ok || !Array.isArray(body.diagnostics)) throw new Error(body?.error || "Не вдалося завантажити діагностичні карти автомобіля.");
        if (!controller.signal.aborted) setRows(body.diagnostics);
      })
      .catch((cause) => { if (!controller.signal.aborted && cause instanceof Error && cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [vehicle.id, diagnosticId, refreshTick]);

  useEffect(() => {
    if (!rows.length) { setSelectedId(null); return; }
    if (diagnosticId && rows.some((row) => row.id === diagnosticId)) { setSelectedId(diagnosticId); return; }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      const latest = [...rows].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())[0];
      setSelectedId(latest?.id || null);
    }
  }, [diagnosticId, rows, selectedId]);

  const selected = rows.find((row) => row.id === selectedId) || null;
  async function createCommercialProposal(row: DiagnosticRow) {
    setBusyId(row.id); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(row.id)}/commercial-proposal`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as { ok?: boolean; workOrder?: { id?: string }; error?: string; message?: string } | null;
      if (!response.ok || !body?.ok || !body.workOrder?.id) throw new Error(body?.message || body?.error || "Не вдалося створити Комерційну пропозицію.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: "commercial-offer", workOrderId: body.workOrder.id, workOrderTab: "estimate" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося створити Комерційну пропозицію."); }
    finally { setBusyId(""); }
  }
  function openCommercial(row: DiagnosticRow) {
    if (row.commercialProposal?.workOrderId) navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: "commercial-offer", workOrderId: row.commercialProposal.workOrderId, workOrderTab: "estimate" });
  }
  function openDiagnostic(row: DiagnosticRow) { navigateCrm("Авто", { vehicleId: vehicle.id, vehiclePage: "diagnostic-card", diagnosticId: row.id }); }

  if (loading) return <div className={styles.state}>Завантажую Діагностичну карту…</div>;
  if (error && !rows.length) return <div className={styles.error}>{error}<button type="button" onClick={() => setRefreshTick((value) => value + 1)}>Повторити</button></div>;
  if (!rows.length) return <div className={styles.empty}><strong>Діагностичних карт ще немає</strong><span>Карта з’явиться після проведення діагностики автомобіля.</span><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("turbolev:open-new-request", { detail: { source: "VEHICLE", plate: vehicle.plateNumber || "", vin: vehicle.vin || "" } }))}>+ Записати на діагностику</button></div>;

  return <div className={styles.wrap}>
    {error ? <div className={styles.error}>{error}</div> : null}
    {selected ? <DiagnosticCardDetail key={selected.id} row={selected} initialView={prefetched?.id === selected.id ? prefetched.view : null} initialCardNumber={prefetched?.id === selected.id ? prefetched.cardNumber : ""} busy={busyId === selected.id} onOpenDiagnostic={() => openDiagnostic(selected)} onOpenPartsSelection={() => navigateCrm("Підбір запчастин", { diagnosticId: selected.id, vehicleId: vehicle.id, plate: vehicle.plateNumber || "", vin: vehicle.vin || "" })} onCreateProposal={() => void createCommercialProposal(selected)} onOpenCommercial={() => openCommercial(selected)} /> : null}
    <div className={styles.historyBar}><div><span className={styles.eyebrow}>ІСТОРІЯ ДІАГНОСТИК</span><strong>{vehicleTitle(vehicle)}</strong></div><div className={styles.historyItems}>{rows.map((row) => { const state = stateOf(row); return <button type="button" key={row.id} className={selectedId === row.id ? styles.historyActive : ""} onClick={() => setSelectedId(row.id)}><b>{row.diagnosticCard?.number || "Діагностика"}</b><span>{workflowLabels[state]}</span><small>{dateText(row.confirmedAt || row.updatedAt || row.createdAt)}</small></button>; })}</div></div>
  </div>;
}

function DiagnosticCardDetail({ row, initialView, initialCardNumber, busy, onOpenDiagnostic, onOpenPartsSelection, onCreateProposal, onOpenCommercial }: { row: DiagnosticRow; initialView: DiagnosticView | null; initialCardNumber: string; busy: boolean; onOpenDiagnostic: () => void; onOpenPartsSelection: () => void; onCreateProposal: () => void; onOpenCommercial: () => void }) {
  const [view, setView] = useState<DiagnosticView | null>(initialView);
  const [cardNumber, setCardNumber] = useState(initialCardNumber || row.diagnosticCard?.number || "");
  const [loading, setLoading] = useState(!initialView);
  const [error, setError] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<DiagnosticMedia | null>(null);
  const [editingComment, setEditingComment] = useState(false);
  const [mechanicComment, setMechanicComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  useEffect(() => {
    if (initialView) {
      setView(initialView);
      setCardNumber(initialCardNumber || row.diagnosticCard?.number || "");
      setLoading(false);
      return;
    }
    const controller = new AbortController(); setLoading(true); setError("");
    void Promise.all([
      fetch(`/api/diagnostics/${encodeURIComponent(row.id)}/structured`, { cache: "no-store", credentials: "include", signal: controller.signal }),
    ]).then(async ([structuredResponse]) => {
      const structuredBody = await structuredResponse.json().catch(() => null) as { ok?: boolean; diagnostic?: DiagnosticView["diagnostic"]; inspections?: DiagnosticInspection[]; counts?: DiagnosticView["counts"]; message?: string; error?: string } | null;
      if (!structuredResponse.ok || !structuredBody?.ok || !structuredBody.diagnostic || !Array.isArray(structuredBody.inspections) || !structuredBody.counts) throw new Error(structuredBody?.message || structuredBody?.error || "Не вдалося завантажити діагностичну карту.");
      if (!controller.signal.aborted) {
        setCardNumber(row.diagnosticCard?.number || "");
        setView({ diagnostic: structuredBody.diagnostic, inspections: structuredBody.inspections, counts: structuredBody.counts });
        setMechanicComment(structuredBody.diagnostic.review.mechanicComment || "");
      }
    }).catch((cause) => { if (!controller.signal.aborted && cause instanceof Error && cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [row.id]);

  const findings = useMemo(() => view?.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").map((item) => ({ section: section.name, item })))) || [], [view]);
  const selectedFinding = findings.find(({ item }) => item.id === selectedFindingId) || findings[0] || null;
  const photos = selectedFinding?.item.finding?.media || [];
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) || photos[0] || null;
  const parts = findings.filter(({ item }) => Boolean(item.finding?.suggestedPartName || item.finding?.action === "REPLACE"));
  const state = stateOf(row);
  const status = cardStatus(row, findings);

  useEffect(() => { if (!selectedFindingId || !findings.some(({ item }) => item.id === selectedFindingId)) setSelectedFindingId(findings[0]?.item.id || null); }, [findings, selectedFindingId]);
  const firstPhotoId = photos[0]?.id || null;
  useEffect(() => { setActivePhotoId(firstPhotoId); }, [selectedFinding?.item.id, firstPhotoId]);

  async function saveMechanicComment() {
    setSavingComment(true); setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(row.id)}/structured`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "UPDATE_MECHANIC_COMMENT", mechanicComment }) });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти примітку механіка.");
      setView((current) => current ? { ...current, diagnostic: { ...current.diagnostic, review: { ...current.diagnostic.review, mechanicComment: mechanicComment.trim() || null } } } : current);
      setEditingComment(false);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти примітку механіка."); }
    finally { setSavingComment(false); }
  }

  if (loading) return <div className={styles.state}>Завантажую результати діагностики…</div>;
  if (error || !view) return <div className={styles.error}>{error || "Діагностичну карту не знайдено."}<button type="button" onClick={onOpenDiagnostic}>Відкрити діагностику</button></div>;

  return <article className={styles.card}>
    <header className={styles.cardHeader}><div><span className={styles.eyebrow}>ДІАГНОСТИЧНА КАРТА</span><h3>{cardNumber || "Результати діагностики"}</h3><p>{dateText(row.confirmedAt || row.updatedAt || row.createdAt)} · {row.assignedMechanic?.name ? `Механік: ${row.assignedMechanic.name}` : "Механік не вказаний"}</p></div><div className={styles.cardHeaderActions}><span className={`${styles.status} ${status.tone === "good" ? styles.statusGood : status.tone === "danger" ? styles.statusDanger : status.tone === "muted" ? styles.statusMuted : styles.statusReview}`}><i className={styles.statusDot} />{status.label}</span><button type="button" className={styles.iconButton} aria-label="Редагувати примітки механіка" onClick={() => setEditingComment(true)}>✎</button><button type="button" className={styles.secondaryAction} onClick={editingComment ? () => void saveMechanicComment() : onOpenDiagnostic} disabled={savingComment}>{savingComment ? "Зберігаю…" : "Зберегти"}</button><button type="button" className={styles.primaryAction} onClick={onOpenPartsSelection}>Підбір деталей →</button></div></header>
    <div className={styles.workspaceGrid}>
      <section className={styles.diagramPanel} aria-label="Схема автомобіля"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>СХЕМА АВТОМОБІЛЯ</span><h4>Проблемні зони</h4></div><span className={styles.legend}><i className={styles.legendDanger}/>Критично <i className={styles.legendAttention}/>Увага</span></div><VehicleSchematic findings={findings} selectedId={selectedFinding?.item.id || null} onSelect={setSelectedFindingId}/>{!findings.length && <div className={styles.healthy}><b>Автомобіль перевірено</b><span>Критичних несправностей не зафіксовано.</span></div>}</section>
      <section className={styles.partsPanel} aria-label="Деталі до заміни"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>РЕКОМЕНДАЦІЇ</span><h4>Деталі до заміни <b className={styles.inlineCount}>{parts.length}</b> <button type="button" className={styles.addFinding} aria-label="Додати деталь, рідину або розхідник">+</button></h4></div></div>{!parts.length && <div className={styles.panelEmpty}>Деталі до заміни за результатами цієї діагностики не визначені.</div>}<div className={styles.findingList}>{parts.map(({ section, item }, index) => <button type="button" className={`${styles.findingRow} ${selectedFinding?.item.id === item.id ? styles.findingSelected : ""}`} key={item.id} onClick={() => setSelectedFindingId(item.id)}><span className={`${styles.findingNumber} ${item.state === "DEFECT" ? styles.findingNumberDanger : styles.findingNumberAttention}`}>{index + 1}</span><span className={styles.findingCopy}><strong>{item.finding?.suggestedPartName || item.name}</strong><small>{section} · {item.finding?.findingText || item.note || "Виявлено несправність"}</small></span><span className={styles.findingSeverity} aria-label={item.state === "DEFECT" ? "Критично" : "Увага"}><i className={item.state === "DEFECT" ? styles.severityDanger : styles.severityAttention} /></span></button>)}</div></section>
      <section className={styles.evidencePanel} aria-label="Фото проблемного місця"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>ДОКАЗИ ДЕФЕКТУ</span><h4>Фото проблемного місця</h4></div>{photos.length ? <span className={styles.photoCounter}>{Math.max(1, photos.findIndex((photo) => photo.id === activePhoto?.id) + 1)}/{photos.length}</span> : null}</div>{activePhoto ? <><button type="button" className={styles.photoMain} onClick={() => setLightboxPhoto(activePhoto)}><img src={`/api/diagnostics/${encodeURIComponent(row.id)}/media/${encodeURIComponent(activePhoto.id)}`} alt={activePhoto.fileName}/><span>Збільшити фото</span></button><div className={styles.thumbnails}>{photos.map((photo) => <button type="button" key={photo.id} className={activePhoto.id === photo.id ? styles.thumbnailActive : ""} onClick={() => setActivePhotoId(photo.id)}><img src={`/api/diagnostics/${encodeURIComponent(row.id)}/media/${encodeURIComponent(photo.id)}`} alt={photo.fileName}/></button>)}</div><div className={styles.evidenceSummary}><strong>{selectedFinding?.item.finding?.suggestedPartName || selectedFinding?.item.name || "Проблемна зона"}</strong><span>{selectedFinding?.section || "—"}</span><p>{selectedFinding?.item.finding?.findingText || selectedFinding?.item.note || "Додатковий опис відсутній."}</p></div></> : <div className={styles.noPhoto}><span aria-hidden="true">▧</span><b>Фото не прикріплені</b><small>Механік може додати фото проблемного місця у своєму кабінеті.</small></div>}</section>
    </div>
    <div className={styles.metaGrid}><section className={styles.notesPanel}><div className={styles.panelHeading}><div><span className={styles.eyebrow}>КОМЕНТАР МЕХАНІКА</span><h4>Примітки механіка</h4></div><button type="button" className={styles.editLink} onClick={() => setEditingComment((value) => !value)}>{editingComment ? "Скасувати" : "✎ Редагувати"}</button></div>{editingComment ? <textarea className={styles.notesEditor} value={mechanicComment} onChange={(event) => setMechanicComment(event.target.value)} maxLength={4000} placeholder="Додайте примітку механіка…" aria-label="Примітки механіка" /> : <p className={styles.notesText}>{view.diagnostic.review.mechanicComment || "Примітка механіка ще не додана."}</p>}{editingComment ? <div className={styles.notesActions}><span>{mechanicComment.length}/4000</span><button type="button" className={styles.primaryAction} onClick={() => void saveMechanicComment()} disabled={savingComment}>{savingComment ? "Зберігаю…" : "Зберегти примітку"}</button></div> : null}</section></div>
    {error ? <div className={styles.inlineError}>{error}</div> : null}
    {lightboxPhoto ? <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="Збільшене фото" onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxPhoto(null); }}><button type="button" className={styles.lightboxClose} onClick={() => setLightboxPhoto(null)} aria-label="Закрити">×</button><img src={`/api/diagnostics/${encodeURIComponent(row.id)}/media/${encodeURIComponent(lightboxPhoto.id)}`} alt={lightboxPhoto.fileName}/></div> : null}
  </article>;
}

const markerPoints = [[210, 92], [126, 172], [294, 172], [112, 300], [308, 300], [126, 444], [294, 444], [210, 558]] as const;

function VehicleSchematic({ findings, selectedId, onSelect }: { findings: Array<{ section: string; item: DiagnosticItem }>; selectedId: string | null; onSelect: (id: string) => void }) {
  return <div className={styles.schematicWrap}><svg className={styles.schematic} viewBox="0 0 420 640" role="img" aria-label="Схема автомобіля з проблемними зонами">
    <defs><linearGradient id="carBody" x1="0" x2="1"><stop offset="0" stopColor="#eef2f4"/><stop offset=".5" stopColor="#ffffff"/><stop offset="1" stopColor="#dce3e6"/></linearGradient></defs>
    <rect x="82" y="25" width="256" height="590" rx="116" fill="url(#carBody)" stroke="#7f8b95" strokeWidth="3"/><path d="M114 170 Q210 112 306 170 L294 248 Q210 270 126 248 Z" fill="#9ba9b1" opacity=".6" stroke="#64727c" strokeWidth="2"/><path d="M126 392 Q210 370 294 392 L306 484 Q210 548 114 484 Z" fill="#9ba9b1" opacity=".45" stroke="#64727c" strokeWidth="2"/><path d="M124 290 H296 M124 350 H296" stroke="#87949c" strokeWidth="2" opacity=".65"/><path d="M118 78 Q210 42 302 78 M118 545 Q210 592 302 545" fill="none" stroke="#9aa6ad" strokeWidth="3"/>
    {["112 126", "308 126", "112 438", "308 438"].map((point) => { const [cx, cy] = point.split(" "); return <rect key={point} x={Number(cx) - 14} y={Number(cy) - 34} width="28" height="68" rx="12" fill="#37434d"/>; })}
    {["140 90", "280 90", "140 530", "280 530"].map((point) => { const [cx, cy] = point.split(" "); return <circle key={point} cx={cx} cy={cy} r="18" fill="#4a5660" stroke="#242d34" strokeWidth="4"/>; })}
    {findings.map(({ item }, index) => { const [cx, cy] = markerPoints[index % markerPoints.length]; const danger = item.state === "DEFECT" || item.finding?.urgency === "CRITICAL"; const active = item.id === selectedId; return <g key={item.id} className={styles.marker} role="button" tabIndex={0} aria-label={`Проблема ${index + 1}: ${item.name}`} onClick={() => onSelect(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.id); } }}><circle cx={cx} cy={cy} r={active ? 24 : 20} fill={danger ? "#e84b3c" : "#f39a20"} stroke="#fff" strokeWidth="4"/><text x={cx} y={cy + 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="800">{index + 1}</text></g>; })}
  </svg><div className={styles.diagramHint}>Натисніть на маркер, щоб переглянути несправність і фото.</div></div>;
}
