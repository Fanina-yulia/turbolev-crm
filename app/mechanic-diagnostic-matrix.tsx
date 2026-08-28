"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoiceNoteInput } from "./voice-note-input";
import styles from "./mechanic-diagnostic-matrix.module.css";
import photoStyles from "./mechanic-diagnostic-photo-controls.module.css";
import responsiveStyles from "./mechanic-diagnostic-responsive.module.css";

type CheckState = "NOT_CHECKED" | "OK" | "ATTENTION" | "DEFECT";
type DiagnosticMedia = {
  id: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  createdAt?: string;
};
type Finding = {
  id: string;
  action: string;
  urgency: string;
  findingText: string | null;
  suggestedWorkName?: string | null;
  suggestedPartName?: string | null;
  media?: DiagnosticMedia[];
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
    autoFillRemaining?: number;
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
type SystemSection = Section & { inspectionId: string };
type SaveOptions = {
  findingText?: string | null;
  urgency?: string;
  action?: string;
};
type StateChoice = {
  state: "OK" | "ATTENTION" | "DEFECT";
  label: string;
  findingSuffix?: string;
  action?: string;
  urgency?: string;
};

const NODE_ORDER = ["Підвіска", "Рульове", "Гальма", "Привід"];
const CHASSIS_SECTION_CODES = new Set([
  "FRONT_SUSPENSION",
  "FRONT_STEERING",
  "FRONT_DRIVE",
  "FRONT_BRAKES",
  "REAR_SUSPENSION",
  "REAR_BRAKES",
]);
const SYSTEM_SECTION_CODES = new Set([
  "ENGINE_LEAKS",
  "TRANSMISSION_LEAKS",
  "AXLE_SEALS_FRONT",
  "AXLE_SEALS_REAR",
  "EXHAUST",
  "FLUIDS_EXTENDED",
]);
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const MAX_PHOTO_EDGE = 1600;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function cameraIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.7 5.5 10 3.8h4l1.3 1.7H19a2 2 0 0 1 2 2v10.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h3.7Z" />
    <circle cx="12" cy="12.5" r="4" />
  </svg>;
}

async function resizePhoto(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("Не вдалося підготувати фото. Спробуйте зробити знімок ще раз."));
      candidate.src = objectUrl;
    });
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не вдалося підготувати фото. Спробуйте зробити знімок ще раз.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const outputType = "image/webp";
    for (const quality of [0.84, 0.74, 0.62, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
      if (blob && blob.size <= MAX_PHOTO_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/u, "") || "diagnostic-photo";
        return new File([blob], `${baseName}.webp`, { type: outputType, lastModified: Date.now() });
      }
    }
    for (const quality of [0.82, 0.68, 0.52]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_PHOTO_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/u, "") || "diagnostic-photo";
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      }
    }
    throw new Error("Фото завелике. Зробіть знімок із меншою роздільною здатністю.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type PhotoUpload = {
  sourceFile: File;
  previewUrl: string;
  progress: number;
  status: "uploading" | "error";
  itemName: string;
};

function uploadPhotoRequest(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Не вдалося завантажити фото. Перевірте інтернет і повторіть спробу."));
    request.onload = () => {
      let body: { ok?: boolean; message?: string; error?: string } | null = null;
      try {
        body = JSON.parse(request.responseText || "null") as { ok?: boolean; message?: string; error?: string } | null;
      } catch {
        reject(new Error("Сервер повернув некоректну відповідь. Спробуйте ще раз."));
        return;
      }
      if (request.status < 200 || request.status >= 300 || !body?.ok) {
        reject(new Error(body?.message || body?.error || "Не вдалося зберегти фото"));
        return;
      }
      resolve();
    };
    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
  });
}

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

function buildSectionPairs(section: SystemSection): PairedPart[] {
  const pairMap = new Map<string, PairedPart>();
  for (const item of section.items) {
    const side = sideFor(item);
    if (side === "COMMON") continue;
    const key = partKey(item);
    const row: MatrixRow = {
      inspectionId: section.inspectionId,
      sectionId: section.id,
      sectionCode: section.code,
      sectionName: section.name,
      node: section.name,
      axis: section.code === "AXLE_SEALS_REAR" ? "REAR" : "FRONT",
      side,
      item,
    };
    const current = pairMap.get(key) || { key, name: partName(item), left: null, right: null };
    if (side === "LEFT") current.left = row;
    if (side === "RIGHT") current.right = row;
    pairMap.set(key, current);
  }
  return Array.from(pairMap.values());
}

function systemChoices(section: SystemSection, item: Check): StateChoice[] {
  if (section.code === "ENGINE_LEAKS" || section.code === "TRANSMISSION_LEAKS") {
    return [
      { state: "OK", label: "Норма" },
      { state: "ATTENTION", label: "Запотівання", findingSuffix: "запотівання", action: "ADDITIONAL_DIAGNOSTICS", urgency: "INFO" },
      { state: "DEFECT", label: "Підтікання", findingSuffix: "підтікання", action: "REPAIR", urgency: "SOON" },
    ];
  }

  if (section.code === "EXHAUST") {
    return [
      { state: "OK", label: "Норма" },
      { state: "ATTENTION", label: "Увага", findingSuffix: "потребує уваги", action: "ADDITIONAL_DIAGNOSTICS", urgency: "INFO" },
      { state: "DEFECT", label: "Дефект", findingSuffix: "виявлено дефект", action: "REPAIR", urgency: "SOON" },
    ];
  }

  const name = lower(item.name);
  if (/рівень моторної оливи/u.test(name)) {
    return [
      { state: "OK", label: "Норма" },
      { state: "ATTENTION", label: "Низький", findingSuffix: "низький рівень", action: "ADDITIONAL_DIAGNOSTICS", urgency: "SOON" },
      { state: "DEFECT", label: "Високий", findingSuffix: "високий рівень", action: "ADDITIONAL_DIAGNOSTICS", urgency: "SOON" },
    ];
  }
  if (/рівень/u.test(name)) {
    return [
      { state: "OK", label: "Норма" },
      { state: "ATTENTION", label: "Низький", findingSuffix: "низький рівень", action: "ADDITIONAL_DIAGNOSTICS", urgency: "SOON" },
      { state: "DEFECT", label: "Критично", findingSuffix: "критично низький рівень", action: "ADDITIONAL_DIAGNOSTICS", urgency: "SOON" },
    ];
  }

  return [
    { state: "OK", label: "Норма" },
    { state: "ATTENTION", label: "Увага", findingSuffix: "потребує уваги", action: "ADDITIONAL_DIAGNOSTICS", urgency: "INFO" },
    { state: "DEFECT", label: "Заміна", findingSuffix: "потребує заміни", action: "REPLACE", urgency: "SOON" },
  ];
}

function remarkLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "зауваження";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "зауваження";
  return "зауважень";
}

export function MechanicDiagnosticMatrix({ diagnosticId, onBack, onChanged, onFinished }: { diagnosticId: string; onBack: () => void; onChanged?: () => void; onFinished?: () => void }) {
  const [data, setData] = useState<DiagnosticPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [savingChecks, setSavingChecks] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUpload>>({});
  const [voiceBusy, setVoiceBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<{ checkId: string; itemName: string } | null>(null);

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
    return (data?.inspections || []).flatMap((inspection) => inspection.sections
      .filter((section) => CHASSIS_SECTION_CODES.has(section.code))
      .flatMap((section) => section.items.map((item) => ({
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

  const systemSections = useMemo<SystemSection[]>(() => {
    return (data?.inspections || []).flatMap((inspection) => inspection.sections
      .filter((section) => SYSTEM_SECTION_CODES.has(section.code))
      .map((section) => ({ ...section, inspectionId: inspection.id })));
  }, [data]);

  const frontGroups = useMemo(() => buildAxisGroups(rows, "FRONT"), [rows]);
  const rearGroups = useMemo(() => buildAxisGroups(rows, "REAR"), [rows]);
  const remarkCount = useMemo(() => (data?.inspections || []).flatMap((inspection) => inspection.sections.flatMap((section) => section.items))
    .filter((item) => item.state === "ATTENTION" || item.state === "DEFECT").length, [data]);

  function applyLocalCheckState(checkId: string, state: CheckState) {
    setData((current) => {
      if (!current?.inspections) return current;
      let changed = false;
      const inspections = current.inspections.map((inspection) => ({
        ...inspection,
        sections: inspection.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => {
            if (item.id !== checkId) return item;
            changed = true;
            return { ...item, state };
          }),
        })),
      }));
      if (!changed) return current;

      const allItems = inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items));
      const requiredChecked = allItems.filter((item) => item.state !== "NOT_CHECKED").length;
      // Only exceptions are entered manually. All untouched items are saved as
      // "Норма" by the server when the mechanic completes the diagnostic.
      const requiredRemaining = 0;
      const canSubmit = allItems.length > 0 && requiredRemaining === 0;

      return {
        ...current,
        inspections,
        canSubmit,
        completion: {
          ...current.completion,
          canSubmit,
          requiredTotal: allItems.length,
          requiredChecked,
          requiredRemaining,
          missingRequired: requiredRemaining,
        },
      };
    });
  }

  async function start() {
    setBusy("start"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/matrix-start`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => null) as DiagnosticPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося розпочати діагностику");
      setData(body);
      setComment(body.diagnostic?.review.mechanicComment || "");
      setMessage("Діагностику розпочато. Вся перевірка доступна однією стрічкою.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося розпочати діагностику");
    } finally { setBusy(""); }
  }

  async function patchCheck(item: Check, state: CheckState, silent = false, compact = false, options?: SaveOptions) {
    if (!item.id) return null;
    const problem = state === "ATTENTION" || state === "DEFECT";
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/checks/${encodeURIComponent(item.id)}${compact ? "?compact=1" : ""}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        measurementValue: null,
        measurementText: null,
        note: null,
        findingText: problem ? (options?.findingText ?? `${item.name} — потребує уваги`) : null,
        urgency: problem ? (options?.urgency ?? (state === "DEFECT" ? "SOON" : "INFO")) : "INFO",
        action: problem ? (options?.action ?? (state === "DEFECT" ? "REPLACE" : "ADDITIONAL_DIAGNOSTICS")) : "NONE",
      }),
    });
    const body = await response.json().catch(() => null) as DiagnosticPayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося зберегти відмітку");
    if (!silent && !compact) setData(body);
    return body;
  }

  async function setCheckState(item: Check, nextState: CheckState, options?: SaveOptions) {
    if (!item.id || locked || busy || savingChecks.has(item.id) || item.state === nextState) return;
    const previousState = item.state;

    applyLocalCheckState(item.id, nextState);
    setSavingChecks((current) => {
      const next = new Set(current);
      next.add(item.id!);
      return next;
    });
    setError("");

    try {
      await patchCheck(item, nextState, true, true, options);
    } catch (cause) {
      applyLocalCheckState(item.id, previousState);
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти відмітку");
    } finally {
      setSavingChecks((current) => {
        const next = new Set(current);
        next.delete(item.id!);
        return next;
      });
    }
  }

  async function toggleReplacement(row: MatrixRow | null) {
    const item = row?.item;
    if (!item) return;
    const nextState: CheckState = item.state === "DEFECT" ? "OK" : "DEFECT";
    await setCheckState(item, nextState, {
      findingText: nextState === "DEFECT" ? `${item.name} — потребує заміни` : null,
      urgency: "SOON",
      action: "REPLACE",
    });
  }

  function openCamera(item: Check) {
    if (!item.id || item.state !== "DEFECT" || locked || busy || savingChecks.has(item.id) || photoUploads[item.id]?.status === "uploading") return;
    photoTargetRef.current = { checkId: item.id, itemName: item.name };
    setError("");
    setMessage("");
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
      photoInputRef.current.click();
    }
  }

  async function uploadPhotoFile(checkId: string, itemName: string, sourceFile: File, previewUrl = URL.createObjectURL(sourceFile)) {
    setPhotoUploads((current) => ({ ...current, [checkId]: { sourceFile, previewUrl, progress: 0, status: "uploading", itemName } }));
    setError("");
    setMessage("");
    try {
      if (!ACCEPTED_PHOTO_TYPES.has(sourceFile.type)) throw new Error("Підтримуються фото у форматах JPEG, PNG або WEBP.");
      const file = await resizePhoto(sourceFile);
      await uploadPhotoRequest(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/checks/${encodeURIComponent(checkId)}/media`, file, (progress) => {
        setPhotoUploads((current) => current[checkId] ? { ...current, [checkId]: { ...current[checkId], progress } } : current);
      });
      await load();
      URL.revokeObjectURL(previewUrl);
      setPhotoUploads((current) => {
        const next = { ...current };
        delete next[checkId];
        return next;
      });
      setMessage(`Фото деталі «${itemName}» додано.`);
      onChanged?.();
    } catch (cause) {
      setPhotoUploads((current) => current[checkId] ? { ...current, [checkId]: { ...current[checkId], status: "error" } } : current);
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти фото");
    }
  }

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const sourceFile = event.target.files?.[0];
    const target = photoTargetRef.current;
    event.target.value = "";
    if (!sourceFile || !target) return;

    photoTargetRef.current = null;
    void uploadPhotoFile(target.checkId, target.itemName, sourceFile);
  }

  function retryPhoto(checkId: string) {
    const upload = photoUploads[checkId];
    if (!upload) return;
    void uploadPhotoFile(checkId, upload.itemName, upload.sourceFile, upload.previewUrl);
  }

  async function completeChassis() {
    if (locked || busy || savingChecks.size > 0) return;
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
        await Promise.all(chunk.map((row) => patchCheck(row.item, "OK", true, true)));
      }
      await load();
      setMessage("Ходову перевірено. Непозначені деталі збережено як справні.");
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити перевірку ходової");
    } finally { setBusy(""); }
  }

  async function markSectionNormal(section: SystemSection) {
    if (locked || busy || savingChecks.size > 0) return;
    const targets = section.items.filter((item) => item.id && item.state === "NOT_CHECKED");
    if (!targets.length) return;

    for (const item of targets) applyLocalCheckState(item.id!, "OK");
    setSavingChecks((current) => new Set([...current, ...targets.map((item) => item.id!)]));
    setError("");
    try {
      await Promise.all(targets.map((item) => patchCheck(item, "OK", true, true)));
    } catch (cause) {
      await load();
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти блок");
    } finally {
      setSavingChecks((current) => {
        const next = new Set(current);
        for (const item of targets) next.delete(item.id!);
        return next;
      });
    }
  }

  async function submit() {
    if (!data?.canSubmit || busy || savingChecks.size > 0) return;
    if (!window.confirm("Завершити діагностику? Усі непозначені пункти буде збережено як «Норма», після чого результат буде передано сервіс-менеджеру.")) return;
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
      onFinished?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити діагностику");
    } finally { setBusy(""); }
  }

  if (!data?.diagnostic) {
    return <div className={`${styles.page} ${responsiveStyles.page}`}><header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Діагностика</strong><span /></header><div className={styles.loading}>{error || "Завантажую діагностику…"}</div></div>;
  }

  const vehicle = data.diagnostic.vehicle;
  const remaining = data.completion?.requiredRemaining ?? data.completion?.missingRequired ?? 0;
  const allChassisChecked = rows.length > 0 && rows.every((row) => row.item.state !== "NOT_CHECKED");

  function renderSideCheck(row: MatrixRow | null, side: Side) {
    if (!row) return <span className={styles.emptySide} aria-hidden="true">—</span>;
    const checked = row.item.state === "DEFECT";
    const saving = Boolean(row.item.id && savingChecks.has(row.item.id));
    const photoUpload = row.item.id ? photoUploads[row.item.id] : undefined;
    const uploading = photoUpload?.status === "uploading";
    const disabled = locked || !row.item.id || Boolean(busy);
    const sideLabel = side === "LEFT" ? "Ліва сторона" : side === "RIGHT" ? "Права сторона" : "Загальна перевірка";
    const mediaCount = row.item.finding?.media?.length || 0;
    return <div className={`${photoStyles.sideAction} ${side === "RIGHT" || side === "COMMON" ? photoStyles.sideActionRight : ""}`}>
      <button
        type="button"
        className={`${styles.sideCheck} ${checked ? styles.sideCheckActive : ""} ${saving ? styles.sideCheckSaving : ""}`}
        aria-label={`${sideLabel}: ${partName(row.item)}${checked ? ", потребує заміни" : ""}`}
        aria-pressed={checked}
        aria-busy={saving}
        disabled={disabled || uploading}
        onClick={() => void toggleReplacement(row)}
      >{checked ? "✓" : ""}</button>
      {checked && <button
        type="button"
        className={`${photoStyles.photoButton} ${uploading ? photoStyles.photoButtonUploading : ""}`}
        aria-label={`${mediaCount ? "Додати ще фото" : "Сфотографувати"}: ${sideLabel.toLocaleLowerCase("uk-UA")}, ${partName(row.item)}`}
        aria-busy={uploading}
        disabled={disabled || saving || uploading}
        onClick={() => openCamera(row.item)}
      >{uploading ? <span className={photoStyles.photoSpinner} /> : cameraIcon()}{mediaCount > 0 && <b>{mediaCount}</b>}</button>}
      {photoUpload && <span className={photoStyles.photoUploadStatus}>
        <img src={photoUpload.previewUrl} alt="Попередній перегляд фото" />
        {uploading ? `${photoUpload.progress}%` : <button type="button" onClick={() => retryPhoto(row.item.id!)} aria-label="Повторити завантаження фото">↻</button>}
      </span>}
    </div>;
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
          {group.pairs.map((pair) => <div className={`${styles.partRow} ${pair.left?.item.state === "DEFECT" || pair.right?.item.state === "DEFECT" ? photoStyles.partRowWithPhoto : ""}`} key={`${axis}:${group.node}:${pair.key}`}>
            {renderSideCheck(pair.left, "LEFT")}
            <strong>{pair.name}</strong>
            {renderSideCheck(pair.right, "RIGHT")}
          </div>)}
          {group.common.map((row) => {
            return <div className={`${styles.partRow} ${styles.commonRow} ${row.item.state === "DEFECT" ? photoStyles.partRowWithPhoto : ""}`} key={row.item.id || row.item.templateItemId}>
              <span className={styles.commonMark}>ЗАГ.</span>
              <strong>{partName(row.item)}</strong>
              {renderSideCheck(row, "COMMON")}
            </div>;
          })}
        </div>
      </div>)}
    </section>;
  }

  function renderAxleSealSection(section: SystemSection) {
    const pairs = buildSectionPairs(section);
    return <section className={styles.axisSection} key={section.id}>
      <header className={styles.systemHeader}>
        <div><span>ТРАНСМІСІЯ</span><h2>{section.name}</h2></div>
      </header>
      <div className={styles.columnLabels}><span>Ліва</span><b>Деталь</b><span>Права</span></div>
      <div className={styles.partRows}>
        {pairs.map((pair) => <div className={`${styles.partRow} ${pair.left?.item.state === "DEFECT" || pair.right?.item.state === "DEFECT" ? photoStyles.partRowWithPhoto : ""}`} key={`${section.code}:${pair.key}`}>
          {renderSideCheck(pair.left, "LEFT")}
          <strong>{pair.name}</strong>
          {renderSideCheck(pair.right, "RIGHT")}
        </div>)}
      </div>
    </section>;
  }

  function renderSystemSection(section: SystemSection) {
    if (section.code === "AXLE_SEALS_FRONT" || section.code === "AXLE_SEALS_REAR") return renderAxleSealSection(section);
    const unchecked = section.items.filter((item) => item.state === "NOT_CHECKED").length;
    const eyebrow = section.code === "ENGINE_LEAKS"
      ? "ДВИГУН"
      : section.code === "TRANSMISSION_LEAKS"
        ? "ТРАНСМІСІЯ"
        : section.code === "EXHAUST"
          ? "ВИХЛОП"
          : "РІДИНИ";

    return <section className={styles.systemSection} key={section.id}>
      <header className={styles.systemHeader}>
        <div><span>{eyebrow}</span><h2>{section.name}</h2></div>
        {!locked && unchecked > 0 && <button type="button" className={styles.allNormalButton} disabled={Boolean(busy) || savingChecks.size > 0} onClick={() => void markSectionNormal(section)}>✓ Непозначене — норма</button>}
      </header>
      <div className={styles.systemRows}>
        {section.items.map((item) => {
          const saving = Boolean(item.id && savingChecks.has(item.id));
          const photoUpload = item.id ? photoUploads[item.id] : undefined;
          const uploading = photoUpload?.status === "uploading";
          const mediaCount = item.finding?.media?.length || 0;
          const choices = systemChoices(section, item);
          return <div className={styles.systemRow} key={item.id || item.templateItemId}>
            <div className={photoStyles.systemItemHeader}>
              <strong>{item.name}</strong>
              {item.state === "DEFECT" && <button
                type="button"
                className={`${photoStyles.photoButton} ${uploading ? photoStyles.photoButtonUploading : ""}`}
                aria-label={`${mediaCount ? "Додати ще фото" : "Сфотографувати"}: ${item.name}`}
                aria-busy={uploading}
                disabled={locked || !item.id || Boolean(busy) || saving || uploading}
                onClick={() => openCamera(item)}
              >{uploading ? <span className={photoStyles.photoSpinner} /> : cameraIcon()}{mediaCount > 0 && <b>{mediaCount}</b>}</button>}
              {photoUpload && <span className={photoStyles.photoUploadStatus}>
                <img src={photoUpload.previewUrl} alt="Попередній перегляд фото" />
                {uploading ? `${photoUpload.progress}%` : <button type="button" onClick={() => retryPhoto(item.id!)} aria-label="Повторити завантаження фото">↻</button>}
              </span>}
            </div>
            <div className={styles.stateChoices}>
              {choices.map((choice) => {
                const active = item.state === choice.state;
                return <button
                  type="button"
                  key={choice.state}
                  className={`${styles.stateChoice} ${active ? styles.stateChoiceActive : ""} ${active && choice.state === "ATTENTION" ? styles.stateAttention : ""} ${active && choice.state === "DEFECT" ? styles.stateDefect : ""}`}
                  aria-pressed={active}
                  aria-busy={saving}
                  disabled={locked || !item.id || Boolean(busy) || saving}
                  onClick={() => void setCheckState(item, choice.state, {
                    findingText: choice.state === "OK" ? null : `${item.name} — ${choice.findingSuffix || "потребує уваги"}`,
                    action: choice.action,
                    urgency: choice.urgency,
                  })}
                >{choice.label}</button>;
              })}
            </div>
          </div>;
        })}
      </div>
    </section>;
  }

  return <div className={`${styles.page} ${responsiveStyles.page}`}>
    <input
      ref={photoInputRef}
      className={photoStyles.photoInput}
      type="file"
      accept="image/*"
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => void uploadPhoto(event)}
    />
    <header className={styles.top}>
      <button type="button" onClick={onBack}>‹</button>
      <strong>Діагностика</strong>
      <span />
    </header>

    <main className={styles.content}>
      <section className={styles.vehicleBar}>
        <div><strong>{vehicle.label}</strong><span>{vehicle.plateNumber || "Без номера"}</span></div>
        <b>{remarkCount} {remarkLabel(remarkCount)}</b>
      </section>

      {data.diagnostic.review.managerComment && <div className={styles.managerNote}><b>Коментар сервіс-менеджера</b><span>{data.diagnostic.review.managerComment}</span></div>}
      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {workflow === "PENDING" ? <section className={styles.startCard}>
        <span className={styles.bigIcon}>✓</span>
        <h1>{data.diagnostic.problem || "Діагностика автомобіля"}</h1>
        <p>Після старту вся перевірка відкриється однією стрічкою: ходова, підтікання, трансмісія, вихлоп і технічні рідини.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void start()}>{busy === "start" ? "Розпочинаю…" : "Почати діагностику →"}</button>
      </section> : <>
        {renderAxis("FRONT", frontGroups)}
        {renderAxis("REAR", rearGroups)}

        {!locked && <section className={styles.finishCard}>
          <div><h2>Ходова перевірена?</h2><p>Позначайте тільки несправності. Кнопка нижче зафіксує всі непозначені деталі ходової як справні.</p></div>
          <button type="button" className={allChassisChecked ? styles.checkedButton : styles.finishButton} disabled={Boolean(busy) || allChassisChecked || savingChecks.size > 0} onClick={() => void completeChassis()}>
            {busy === "complete" ? "Зберігаю…" : allChassisChecked ? "✓ Ходову перевірено" : savingChecks.size > 0 ? "Зберігаю відмітки…" : "✓ Завершити перевірку ходової"}
          </button>
        </section>}

        {systemSections.map((section) => renderSystemSection(section))}

        {!locked && <section className={styles.submitCard}>
          <label><span>Примітка механіка <small>(необов’язково)</small></span></label>
          <VoiceNoteInput
            value={comment}
            onChange={setComment}
            endpoint={`/api/diagnostics/${encodeURIComponent(diagnosticId)}/voice-transcription`}
            disabled={Boolean(busy) || savingChecks.size > 0}
            onBusyChange={setVoiceBusy}
          />
          {!data.canSubmit && <div className={styles.incomplete}>Для передачі діагностики сервіс-менеджеру перевірте всі пункти. Залишилось: <b>{remaining}</b>.</div>}
          <button type="button" disabled={Boolean(busy) || voiceBusy || !data.canSubmit || savingChecks.size > 0} onClick={() => void submit()}>{busy === "submit" ? "Передаю…" : voiceBusy ? "Очікую завершення голосового запису…" : savingChecks.size > 0 ? "Зберігаю відмітки…" : "Завершити діагностику"}</button>
        </section>}
        {locked && <div className={styles.locked}>✓ Діагностика завершена. Результат передано сервіс-менеджеру.</div>}
      </>}
    </main>
  </div>;
}
