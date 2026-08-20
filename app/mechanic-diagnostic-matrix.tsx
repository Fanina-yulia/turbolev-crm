"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./mechanic-diagnostic-matrix.module.css";

type CheckState = "NOT_CHECKED" | "OK" | "ATTENTION" | "DEFECT";
type Finding = {
  id: string;
  action: string;
  urgency: string;
  findingText: string | null;
  suggestedWorkName?: string | null;
  suggestedPartName?: string | null;
};
type Check = {
  id: string | null;
  templateItemId: string;
  name: string;
  position: string | null;
  measurementUnit: string | null;
  state: CheckState;
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
};
type DiagnosticPayload = {
  ok?: boolean;
  message?: string;
  error?: string;
  canSubmit?: boolean;
  completion?: {
    canSubmit?: boolean;
    requiredTotal?: number;
    requiredChecked?: number;
    requiredRemaining?: number;
    missingRequired?: number;
  };
  diagnostic?: {
    id: string;
    status: string;
    workflowState: string;
    problem: string | null;
    vehicle: { id: string; label: string; plateNumber: string | null; vin: string | null; mileageKm: number | null };
    review: { state: string; mechanicComment: string | null; managerComment: string | null };
  };
  inspections?: Inspection[];
};

type Axis = "FRONT" | "REAR";
type Side = "LEFT" | "RIGHT" | "COMMON";
type MatrixRow = {
  inspectionId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  node: string;
  axis: Axis;
  side: Side;
  item: Check;
};
type View = "MATRIX" | "NODE" | "SUMMARY";

const NODE_ORDER = ["Підвіска", "Рульове", "Гальма", "Привід"];

function lower(value?: string | null) {
  return (value || "").toLocaleLowerCase("uk-UA");
}

function axisFor(section: Section, item: Check): Axis {
  const source = lower(`${section.code} ${section.name} ${item.position || ""} ${item.name}`);
  return /(rear|задн)/u.test(source) ? "REAR" : "FRONT";
}

function sideFor(item: Check): Side {
  const source = lower(`${item.position || ""} ${item.name}`);
  if (/(left|лів)/u.test(source)) return "LEFT";
  if (/(right|прав)/u.test(source)) return "RIGHT";
  return "COMMON";
}

function nodeFor(section: Section) {
  const source = lower(`${section.code} ${section.name}`);
  if (/(brake|hydraul|гальм|тормоз)/u.test(source)) return "Гальма";
  if (/(steer|руль)/u.test(source)) return "Рульове";
  if (/(drive|cv|шрус|привід)/u.test(source)) return "Привід";
  if (/(susp|front|rear|ходов|підвіск)/u.test(source)) return "Підвіска";
  return section.name;
}

function cleanPartName(item: Check) {
  return item.name
    .replace(/^(лівий|ліва|ліве|ліві|правий|права|праве|праві)\s+/iu, "")
    .replace(/^(передній|передня|переднє|передні|задній|задня|заднє|задні)\s+/iu, "")
    .trim();
}

function sideLabel(side: Side) {
  return side === "LEFT" ? "Ліва сторона" : side === "RIGHT" ? "Права сторона" : "Загальне";
}

function nodeIcon(node: string) {
  if (node === "Підвіска") return "◫";
  if (node === "Рульове") return "◉";
  if (node === "Гальма") return "◎";
  if (node === "Привід") return "↔";
  return "◇";
}

export function MechanicDiagnosticMatrix({ diagnosticId, onBack, onChanged }: { diagnosticId: string; onBack: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<DiagnosticPayload | null>(null);
  const [view, setView] = useState<View>("MATRIX");
  const [axis, setAxis] = useState<Axis>("FRONT");
  const [selectedSide, setSelectedSide] = useState<Side>("LEFT");
  const [selectedNode, setSelectedNode] = useState("Підвіска");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити діагностику");
    setData(body);
    setComment(body.diagnostic?.review.mechanicComment || "");
  }, [diagnosticId]);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося відкрити діагностику"));
  }, [load]);

  const workflow = data?.diagnostic?.workflowState || data?.diagnostic?.status || "PENDING";
  const locked = ["SUBMITTED", "CONFIRMED", "CANCELLED"].includes(workflow)
    || data?.diagnostic?.review.state === "SUBMITTED"
    || data?.diagnostic?.review.state === "CONFIRMED";

  const rows = useMemo<MatrixRow[]>(() => {
    return (data?.inspections || []).flatMap((inspection) => inspection.sections.flatMap((section) => section.items.map((item) => ({
      inspectionId: inspection.id,
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      node: nodeFor(section),
      axis: axisFor(section, item),
      side: sideFor(item),
      item,
    }))));
  }, [data]);

  const defectRows = useMemo(() => rows.filter((row) => row.item.state === "DEFECT"), [rows]);
  const recommendedWorks = useMemo(() => Array.from(new Set(defectRows.map((row) => row.item.finding?.suggestedWorkName).filter((value): value is string => Boolean(value)))), [defectRows]);

  const nodeRows = useMemo(() => rows.filter((row) => row.axis === axis && row.side === selectedSide && row.node === selectedNode), [rows, axis, selectedSide, selectedNode]);
  const nodesFor = useCallback((side: Side) => {
    const available = Array.from(new Set(rows.filter((row) => row.axis === axis && row.side === side).map((row) => row.node)));
    return [...NODE_ORDER.filter((node) => available.includes(node)), ...available.filter((node) => !NODE_ORDER.includes(node))];
  }, [axis, rows]);

  const openNode = (side: Side, node: string) => {
    setSelectedSide(side);
    setSelectedNode(node);
    setView("NODE");
    setMessage("");
    setError("");
  };

  async function start() {
    setBusy("start"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/matrix-start`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося розпочати діагностику");
      setData(body);
      setComment(body.diagnostic?.review.mechanicComment || "");
      setMessage("Діагностику розпочато. Відмічайте лише те, що потребує заміни.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося розпочати діагностику");
    } finally { setBusy(""); }
  }

  async function patchCheck(item: Check, state: CheckState, silent = false) {
    if (!item.id) return null;
    const replacement = state === "DEFECT";
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/checks/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        measurementValue: null,
        measurementText: null,
        note: null,
        findingText: replacement ? `${cleanPartName(item)} — потребує заміни` : null,
        urgency: replacement ? "SOON" : "INFO",
        action: replacement ? "REPLACE" : "NONE",
      }),
    });
    const body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти відмітку");
    if (!silent) setData(body);
    return body;
  }

  async function toggleReplacement(item: Check) {
    if (locked || !item.id) return;
    setBusy(`check:${item.id}`); setError(""); setMessage("");
    try {
      const nextState: CheckState = item.state === "DEFECT" ? "OK" : "DEFECT";
      const body = await patchCheck(item, nextState);
      if (body) {
        onChanged?.();
        setMessage(nextState === "DEFECT" ? "Додано до переліку заміни." : "Прибрано з переліку заміни.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти відмітку");
    } finally { setBusy(""); }
  }

  async function confirmNode() {
    if (locked || !nodeRows.length) return;
    setBusy("confirm-node"); setError(""); setMessage("");
    try {
      for (const row of nodeRows) {
        if (row.item.state === "NOT_CHECKED") await patchCheck(row.item, "OK", true);
      }
      await load();
      setMessage("Вузол перевірено. Непозначені деталі не додані до заміни.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося підтвердити вузол");
    } finally { setBusy(""); }
  }

  async function submit() {
    if (!data?.canSubmit) return;
    if (!window.confirm("Передати діагностичну карту сервіс-менеджеру? Після передачі редагування буде заблоковано.")) return;
    setBusy("submit"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT", mechanicComment: comment.trim() || null }),
      });
      const body = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати діагностику");
      setData(body);
      setMessage("Діагностичну карту передано сервіс-менеджеру.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося передати діагностику");
    } finally { setBusy(""); }
  }

  if (!data?.diagnostic) {
    return <div className={styles.page}><header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Діагностика</strong><span /></header><div className={styles.loading}>{error || "Завантажую діагностику…"}</div></div>;
  }

  const vehicle = data.diagnostic.vehicle;
  const remaining = data.completion?.requiredRemaining ?? data.completion?.missingRequired ?? 0;
  const nodeComplete = nodeRows.length > 0 && nodeRows.every((row) => row.item.state !== "NOT_CHECKED");

  return <div className={styles.page}>
    <header className={styles.top}>
      <button type="button" onClick={() => view === "MATRIX" ? onBack() : setView(view === "SUMMARY" ? "MATRIX" : "MATRIX")}>‹</button>
      <strong>{view === "SUMMARY" ? "Діагностична карта" : view === "NODE" ? selectedNode : "Ходова"}</strong>
      <span />
    </header>

    <main className={styles.content}>
      <section className={styles.vehicleBar}>
        <div><strong>{vehicle.label}</strong><span>{vehicle.plateNumber || "Без номера"}</span></div>
        <b>{defectRows.length} до заміни</b>
      </section>

      {data.diagnostic.review.managerComment && <div className={styles.managerNote}><b>Коментар сервіс-менеджера</b><span>{data.diagnostic.review.managerComment}</span></div>}
      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {workflow === "PENDING" ? <section className={styles.startCard}>
        <span className={styles.bigIcon}>✓</span>
        <h1>{data.diagnostic.problem || "Діагностика автомобіля"}</h1>
        <p>Відмічайте тільки деталі, які потребують заміни. Справні деталі не потрібно проклацувати по одній.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void start()}>{busy === "start" ? "Розпочинаю…" : "Почати діагностику →"}</button>
      </section> : view === "MATRIX" ? <>
        <div className={styles.axisTabs}>
          <button type="button" className={axis === "FRONT" ? styles.activeTab : ""} onClick={() => setAxis("FRONT")}>Передня вісь</button>
          <button type="button" className={axis === "REAR" ? styles.activeTab : ""} onClick={() => setAxis("REAR")}>Задня вісь</button>
        </div>

        <section className={styles.matrix}>
          {(["LEFT", "RIGHT"] as Side[]).map((side) => <div className={styles.sideColumn} key={side}>
            <h2>{side === "LEFT" ? "Ліва сторона" : "Права сторона"}</h2>
            <div className={styles.nodeGrid}>{nodesFor(side).map((node) => {
              const group = rows.filter((row) => row.axis === axis && row.side === side && row.node === node);
              const defects = group.filter((row) => row.item.state === "DEFECT").length;
              const complete = group.length > 0 && group.every((row) => row.item.state !== "NOT_CHECKED");
              return <button type="button" key={`${side}:${node}`} onClick={() => openNode(side, node)}>
                <span>{nodeIcon(node)}</span><strong>{node}</strong>
                {defects > 0 ? <em>{defects}</em> : complete ? <small>✓</small> : null}
              </button>;
            })}</div>
          </div>)}
        </section>

        {nodesFor("COMMON").length > 0 && <section className={styles.commonBlock}><h2>Загальне для осі</h2><div className={styles.nodeGrid}>{nodesFor("COMMON").map((node) => <button type="button" key={`COMMON:${node}`} onClick={() => openNode("COMMON", node)}><span>{nodeIcon(node)}</span><strong>{node}</strong></button>)}</div></section>}

        <button type="button" className={styles.summaryButton} onClick={() => setView("SUMMARY")}><span>Відмічено до заміни</span><b>{defectRows.length}</b><i>›</i></button>
      </> : view === "NODE" ? <>
        <div className={styles.breadcrumb}>{axis === "FRONT" ? "Передня вісь" : "Задня вісь"} · {sideLabel(selectedSide)}</div>
        <section className={styles.nodeCard}>
          <header><div><span>{nodeIcon(selectedNode)}</span><div><h1>{selectedNode}</h1><p>Галочка означає: деталь потребує заміни</p></div></div><b>{nodeRows.filter((row) => row.item.state === "DEFECT").length}</b></header>
          <div className={styles.parts}>{nodeRows.map((row) => {
            const checked = row.item.state === "DEFECT";
            return <button type="button" key={row.item.id || row.item.templateItemId} className={checked ? styles.partChecked : ""} disabled={Boolean(busy) || locked || !row.item.id} onClick={() => void toggleReplacement(row.item)}>
              <span className={styles.checkbox}>{checked ? "✓" : ""}</span>
              <strong>{cleanPartName(row.item)}</strong>
              {checked && <em>ДО ЗАМІНИ</em>}
            </button>;
          })}</div>
          {!locked && <button type="button" className={nodeComplete ? styles.nodeDone : styles.confirmNode} disabled={Boolean(busy)} onClick={() => void confirmNode()}>{busy === "confirm-node" ? "Зберігаю…" : nodeComplete ? "✓ Вузол перевірено" : "✓ Завершити перевірку вузла"}</button>}
        </section>
        <button type="button" className={styles.summaryButton} onClick={() => setView("SUMMARY")}><span>Відмічено до заміни</span><b>{defectRows.length}</b><i>›</i></button>
      </> : <>
        <section className={styles.summaryCard}>
          <header><div><span>✓</span><div><h1>Потребує заміни</h1><p>Тільки відмічені механіком деталі</p></div></div><b>{defectRows.length}</b></header>
          {defectRows.length ? (["FRONT", "REAR"] as Axis[]).map((summaryAxis) => {
            const axisRows = defectRows.filter((row) => row.axis === summaryAxis);
            if (!axisRows.length) return null;
            return <div className={styles.summaryAxis} key={summaryAxis}><h2>{summaryAxis === "FRONT" ? "Передня вісь" : "Задня вісь"}</h2>{(["LEFT", "RIGHT", "COMMON"] as Side[]).map((side) => {
              const sideRows = axisRows.filter((row) => row.side === side);
              if (!sideRows.length) return null;
              return <div className={styles.summarySide} key={side}><h3>{sideLabel(side)}</h3>{Array.from(new Set(sideRows.map((row) => row.node))).map((node) => <div className={styles.summaryNode} key={node}><strong>{node}</strong>{sideRows.filter((row) => row.node === node).map((row) => <span key={row.item.id || row.item.templateItemId}>• {cleanPartName(row.item)}</span>)}</div>)}</div>;
            })}</div>;
          }) : <div className={styles.empty}>Деталей до заміни не відмічено.</div>}
        </section>

        {recommendedWorks.length > 0 && <section className={styles.worksCard}><h2>Автоматично сформовані роботи</h2>{recommendedWorks.map((work) => <div key={work}><span>🔧</span><strong>{work}</strong></div>)}</section>}

        {!locked && <section className={styles.submitCard}>
          <label><span>Примітка механіка <small>(необов’язково)</small></span><textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="За потреби додайте коротке уточнення" /></label>
          {!data.canSubmit && <div className={styles.incomplete}>Щоб завершити діагностику, підтвердьте всі вузли. Залишилось пунктів: <b>{remaining}</b>.</div>}
          <button type="button" disabled={Boolean(busy) || !data.canSubmit} onClick={() => void submit()}>{busy === "submit" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button>
        </section>}
        {locked && <div className={styles.locked}>✓ Діагностичну карту передано. Редагування заблоковано.</div>}
      </>}
    </main>
  </div>;
}
