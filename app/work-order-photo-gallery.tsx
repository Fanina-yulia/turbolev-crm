"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./work-order-photo-gallery.module.css";

type Photo = { id: string; kind: string; fileName: string; fileSize: number; createdAt: string; updatedAt: string; url: string };
type PhotoSet = {
  lineId: string;
  workDescription: string;
  mechanic: { id: string; name: string } | null;
  completedAt: string | null;
  count: number;
  complete: boolean;
  photos: Photo[];
};
type JournalRow = {
  id: string;
  number: number | null;
  vehicle: { label: string; plateNumber: string | null };
  photoSet: PhotoSet | null;
  photoCount: number;
};
type Payload = { ok?: boolean; rows?: JournalRow[]; error?: string };

const LABELS: Record<string, string> = {
  TOOL_FIRST: "Інструмент · 1",
  TOOL_SECOND: "Інструмент · 2",
  WORKSPACE_CLEAN: "Чистий пост",
};

function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function workOrderNumber(number: number | null) {
  return number == null ? "Наряд" : `ЗН-${String(number).padStart(6, "0")}`;
}

export function WorkOrderPhotoGallery({ workOrderId, initialRow }: { workOrderId: string; initialRow?: JournalRow | null }) {
  const [row, setRow] = useState<JournalRow | null>(initialRow ?? null);
  const [loading, setLoading] = useState(!initialRow);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/work-journal?scope=ALL&workOrderId=${encodeURIComponent(workOrderId)}&limit=1`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Не вдалося завантажити фінальні фото.");
      setRow(body.rows?.[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінальні фото.");
    } finally { setLoading(false); }
  }, [workOrderId]);

  useEffect(() => {
    if (initialRow) return;
    void load();
  }, [initialRow, load]);

  useEffect(() => {
    if (!activeId) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setActiveId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [activeId]);

  const photos = useMemo(() => row?.photoSet?.photos ?? [], [row]);
  const activeIndex = Math.max(0, photos.findIndex((photo) => photo.id === activeId));
  const active = activeId ? photos[activeIndex] ?? null : null;
  const move = (delta: number) => {
    if (!photos.length) return;
    const next = (activeIndex + delta + photos.length) % photos.length;
    setActiveId(photos[next].id);
  };

  if (loading) return <div className={styles.empty}>Завантажую фінальні фотографії…</div>;
  if (error) return <div className={styles.empty}>{error}<br/><button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!row) return <div className={styles.empty}>Наряд не знайдено або недоступний.</div>;

  return <div className={styles.wrap}>
    <div className={styles.head}>
      <div><h3>Фінальні фото механіка</h3><p>Архів чистоти поста після завершення ремонту. Фото доступні лише для перегляду.</p></div>
      <span className={`${styles.badge} ${row.photoCount === 3 ? styles.good : styles.missing}`}>{row.photoCount}/3</span>
    </div>

    {!photos.length ? <div className={styles.empty}>Фінальний комплект фото ще не створено.</div> : <div className={styles.grid}>
      {photos.map((photo) => <button type="button" className={styles.tile} key={photo.id} onClick={() => setActiveId(photo.id)} aria-label={`Відкрити ${LABELS[photo.kind] || "фото"}`}>
        <img src={photo.url} alt={LABELS[photo.kind] || "Фінальне фото"}/><span>{LABELS[photo.kind] || photo.kind}</span>
      </button>)}
    </div>}

    {row.photoSet && <div className={styles.meta}>
      <div><span>Механік</span><strong>{row.photoSet.mechanic?.name || "—"}</strong></div>
      <div><span>Робота</span><strong>{row.photoSet.workDescription}</strong></div>
      <div><span>Завершено</span><strong>{dateTime(row.photoSet.completedAt || row.photoSet.photos[0]?.createdAt)}</strong></div>
    </div>}

    {active && <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Фінальне фото">
      <div className={styles.overlayHead}><div><strong>{LABELS[active.kind] || active.kind}</strong><span>{workOrderNumber(row.number)} · {row.vehicle.label} · {row.vehicle.plateNumber || "Без номера"} · {dateTime(active.createdAt)}</span></div><button type="button" className={styles.close} onClick={() => setActiveId(null)} aria-label="Закрити">×</button></div>
      <div className={styles.hero}><img src={active.url} alt={LABELS[active.kind] || "Фінальне фото"}/></div>
      <div className={styles.nav}><button type="button" onClick={() => move(-1)} disabled={photos.length < 2}>←</button><span>{activeIndex + 1} / {photos.length}</span><button type="button" onClick={() => move(1)} disabled={photos.length < 2}>→</button></div>
    </div>}
  </div>;
}
