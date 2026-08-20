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
type PairedPart = {
  key: string;
  name: string;
  left: MatrixRow | null;
  right: MatrixRow | null;
};
type NodeGroup = {
  node: string;
  pairs: PairedPart[];
  common: MatrixRow[];
};

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

function partName(item: Check) {
  return item.name
    .replace(/^(лівий|ліва|ліве|ліві|правий|права|праве|праві)\s+/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function partKey(item: Check) {
  return lower(partName(item)).replace(/[’']/g, "").trim();
}

function buildAxisGroups(rows: MatrixRow[], axis: Axis): NodeGroup[] {
  const axisRows = rows.filter((row) => row.axis === axis);
  const nodes = Array.from(new Set(axisRows.map((row) => row.node)));
  const orderedNodes = [...NODE_ORDER.filter((node) => nodes.includes(node)), ...nodes.filter((node) => !NODE_ORDER.includes(node))];

  return orderedNodes.map((node) => {
    const nodeRows = axisRows.filter((row) => row.node === node);
    const pairMap = new Map<string, PairedPart>();
    const common: MatrixRow[] = [];

    for (const row of nodeRows) {
      if (row.side === "COMMON") {
        common.push(row);
        continue;
      }
      const key = partKey(row.item);
      const current = pairMap.get(key) || { key, name: partName(row.item), left: null, right: null };
      if (row.side === "LEFT") current.left = row;
      if (row.side === "RIGHT") current.right = row;
      pairMap.set(key, current);
    }

    return { node, pairs: Array.from(pairMap.values()), common };
  });
}

export function MechanicDiagnosticMatrix({ diagnosticId, onBack, onChanged }: { diagnosticId: string; onBack: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<DiagnosticPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
    let body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити діагностику");

    const workflow = body.diagnostic?.workflowState || body.diagnostic?.status || "PENDING";
    const reviewState = body.diagnostic?.review.state;
    const locked = ["SUBMITTED", "CONFIRMED", "CANCELLED"].includes(workflow)
      || reviewState === "SUBMITTED"
      || reviewState === "CONFIRMED";
    const matrixInspection = (body.inspections || []).some((inspection) => /матриця ходової/iu.test(inspection.templateName));

    if (workflow !== "PENDING" && !locked && matrixInspection) {
      const syncResponse = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/matrix-start`, { method: "POST", credentials: "include" });
      const syncBody = await syncResponse.json().catch(() => null) as DiagnosticPayload | null;
      if (syncResponse.ok && syncBody?.ok) body = syncBody;
    }

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

  const frontGroups = useMemo(() => buildAxisGroups(rows, "FRONT"), [rows]);
  const rearGroups = useMemo(() => buildAxisGroups(rows, "REAR"), [rows]);
  const defectRows = useMemo(() => rows.filter((row) => row.item.state === "DEFECT"), [rows]);

  async function start() {
    setBusy("start"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/matrix-start`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося розпочати діагностику");
      setData(body);
      setComment(body.diagnostic?.review.mechanicComment || "");
      setMessage("Діагностику розпочато. Галочка означає, що деталь потребує заміни.");
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
        findingText: replacement ? `${item.name} — потребує заміни` : null,
        urgency: replacement ? "SOON" : "INFO",
        action: replacement ? "REPLACE" : "NONE",
      }),
    });
    const body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти відмітку");
    if (!silent) setData(body);
    return body;
  }

  async function toggleReplacement(row: MatrixRow | null) {
    const item = row?.item;
    if (!item || locked || !item.id || busy) return;
    setBusy(`check:${item.id}`); setError(""); setMessage("");
    try {
      const nextState: CheckState = item.state === "DEFECT" ? "OK" : "DEFECT";
      const body = await patchCheck(item, nextState);
      if (body) onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти відмітку");
    } finally { setBusy(""); }
  }

  async function completeChassis() {
    if (locked || busy) return;
    const unchecked = rows.filter((row) => row.item.id && row.item.state === "NOT_CHECKED");
    if (!unchecked.length) {
      setMessage("Ходова вже перевірена.");
      return;
    }
    setBusy("complete"); setError(""); setMessage("");
    try {
      const chunkSize = 6;
      for (let index = 0; index < unchecked.length; index += chunkSize) {
        const chunk = unchecked.slice(index, index + chunkSize);
        await Promise.all(chunk.map((row) => patchCheck(row.item, "OK", true)));
      }
      await load();
      setMessage("Ходову перевірено. Непозначені деталі збережено як справні.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити перевірку ходової");
    } finally { setBusy(""); }
  }

  async function submit() {
    if (!data?.canSubmit || busy) return;
    if (!window.confirm("Завершити діагностику? Після цього вона буде передана сервіс-менеджеру, а редагування механіком буде заблоковано.")) return;
    setBusy("submit"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT", mechanicComment: comment.trim() || null }),
      });
      const body = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завершити діагностику");
      setData(body);
      setMessage("Діагностику завершено. Результат передано сервіс-менеджеру.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити діагностику");
    } finally { setBusy(""); }
  }

  if (!data?.diagnostic) {
    return <div className={styles.page}><header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Діагностика</strong><span /></header><div className={styles.loading}>{error || "Завантажую діагностику…"}</div></div>;
  }

  const vehicle = data.diagnostic.vehicle;
  const remaining = data.completion?.requiredRemaining ?? data.completion?.missingRequired ?? 0;
  const allChecked = rows.length > 0 && rows.every((row) => row.item.state !== "NOT_CHECKED");

  function renderSideCheck(row: MatrixRow | null, side: "LEFT" | "RIGHT") {
    if (!row) return <span className={styles.emptySide} aria-hidden="true">—</span>;
    const checked = row.item.state === "DEFECT";
    const disabled = locked || !row.item.id || Boolean(busy);
    return <button
      type="button"
      className={`${styles.sideCheck} ${checked ? styles.sideCheckActive : ""}`}
      aria-label={`${side === "LEFT" ? "Ліва" : "Права"} сторона: ${partName(row.item)}${checked ? ", потребує заміни" : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => void toggleReplacement(row)}
    >{checked ? "✓" : ""}</button>;
  }

  function renderAxis(axis: Axis, groups: NodeGroup[]) {
    return <section className={styles.axisSection} key={axis}>
      <header className={styles.axisHeader}>
        <div><span>ХОДОВА</span><h2>{axis === "FRONT" ? "Передня вісь" : "Задня вісь"}</h2></div>
      </header>
      <div className={styles.columnLabels}><span>Ліва</span><b>Вузол / деталь</b><span>Права</span></div>
      {groups.map((group) => <div className={styles.nodeSection} key={`${axis}:${group.node}`}>
        <h3>{group.node}</h3>
        <div className={styles.partRows}>
          {group.pairs.map((pair) => <div className={styles.partRow} key={`${axis}:${group.node}:${pair.key}`}>
            {renderSideCheck(pair.left, "LEFT")}
            <strong>{pair.name}</strong>
            {renderSideCheck(pair.right, "RIGHT")}
          </div>)}
          {group.common.map((row) => {
            const checked = row.item.state === "DEFECT";
            return <div className={`${styles.partRow} ${styles.commonRow}`} key={row.item.id || row.item.templateItemId}>
              <span className={styles.commonMark}>ЗАГ.</span>
              <strong>{partName(row.item)}</strong>
              <button type="button" className={`${styles.sideCheck} ${checked ? styles.sideCheckActive : ""}`} aria-pressed={checked} disabled={locked || !row.item.id || Boolean(busy)} onClick={() => void toggleReplacement(row)}>{checked ? "✓" : ""}</button>
            </div>;
          })}
        </div>
      </div>)}
    </section>;
  }

  return <div className={styles.page}>
    <header className={styles.top}>
      <button type="button" onClick={onBack}>‹</button>
      <strong>Ходова</strong>
      <span />
    </header>

    <main className={styles.content}>
      <section className={styles.vehicleBar}>
        <div><strong>{vehicle.label}</strong><span>{vehicle.plateNumber || "Без номера"}</span></div>
        <b>{defectRows.length} {defectRows.length === 1 ? "зауваження" : "зауважень"}</b>
      </section>

      {data.diagnostic.review.managerComment && <div className={styles.managerNote}><b>Коментар сервіс-менеджера</b><span>{data.diagnostic.review.managerComment}</span></div>}
      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {workflow === "PENDING" ? <section className={styles.startCard}>
        <span className={styles.bigIcon}>✓</span>
        <h1>{data.diagnostic.problem || "Діагностика ходової"}</h1>
        <p>Після старту вся ходова відкриється однією стрічкою. Ліва клітинка — ліва сторона, права — права. Галочка означає, що деталь потребує заміни.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void start()}>{busy === "start" ? "Розпочинаю…" : "Почати діагностику →"}</button>
      </section> : <>
        {renderAxis("FRONT", frontGroups)}
        {renderAxis("REAR", rearGroups)}

        {!locked && <section className={styles.finishCard}>
          <div><h2>Завершення перевірки</h2><p>Позначайте тільки несправності. Після завершення всі порожні клітинки будуть зафіксовані як справні.</p></div>
          <button type="button" className={allChecked ? styles.checkedButton : styles.finishButton} disabled={Boolean(busy) || allChecked} onClick={() => void completeChassis()}>
            {busy === "complete" ? "Зберігаю…" : allChecked ? "✓ Ходову перевірено" : "✓ Завершити перевірку ходової"}
          </button>
        </section>}

        {!locked && <section className={styles.submitCard}>
          <label><span>Примітка механіка <small>(необов’язково)</small></span><textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="За потреби додайте коротке уточнення" /></label>
          {!data.canSubmit && <div className={styles.incomplete}>Для передачі діагностики сервіс-менеджеру спочатку завершіть перевірку. Залишилось пунктів: <b>{remaining}</b>.</div>}
          <button type="button" disabled={Boolean(busy) || !data.canSubmit} onClick={() => void submit()}>{busy === "submit" ? "Передаю…" : "Завершити діагностику"}</button>
        </section>}
        {locked && <div className={styles.locked}>✓ Діагностика завершена. Результат передано сервіс-менеджеру.</div>}
      </>}
    </main>
  </div>;
}
