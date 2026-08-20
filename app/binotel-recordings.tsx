"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./binotel-recordings.module.css";

type CallDirection = "INCOMING" | "OUTGOING";
type CallStatus = "ANSWERED" | "MISSED" | "BUSY" | null;

export type BinotelCallItem = {
  id: string;
  callId: string;
  externalNumber: string;
  internalNumber: string | null;
  direction: CallDirection;
  status: CallStatus;
  duration: number;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  clientId: string | null;
  workOrderId: string | null;
  managerId: string | null;
  client: { id: string; name: string | null; phone: string } | null;
  manager: { id: string; name: string; internalNumber: string | null } | null;
  recordingEligible: boolean;
};

type CallListPayload = {
  ok?: boolean;
  items?: BinotelCallItem[];
  total?: number;
  page?: number;
  pages?: number;
  managers?: Array<{ id: string; name: string; internalNumber: string | null }>;
  error?: string;
};

type PlayerContextValue = {
  active: BinotelCallItem | null;
  loading: boolean;
  playing: boolean;
  error: string;
  playCall: (call: BinotelCallItem) => Promise<void>;
  toggle: () => void;
  openJournal: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function durationText(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function clockText(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return durationText(seconds);
}

function statusLabel(status: CallStatus) {
  if (status === "ANSWERED") return "Прийнятий";
  if (status === "MISSED") return "Пропущений";
  if (status === "BUSY") return "Зайнято";
  return "Без статусу";
}

function directionLabel(direction: CallDirection) {
  return direction === "INCOMING" ? "Вхідний" : "Вихідний";
}

function displayName(call: BinotelCallItem) {
  return call.client?.name?.trim() || call.client?.phone || call.externalNumber || "Невідомий номер";
}

function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("BinotelRecordingProvider is missing");
  return value;
}

export function BinotelRecordingProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [active, setActive] = useState<BinotelCallItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [journalOpen, setJournalOpen] = useState(false);

  const playCall = useCallback(async (call: BinotelCallItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (active?.callId === call.callId && audio.src) {
      if (audio.paused) await audio.play().catch(() => setError("Браузер заблокував відтворення. Натисніть ▶ ще раз."));
      else audio.pause();
      return;
    }

    setActive(call);
    setLoading(true);
    setError("");
    setCurrentTime(0);
    setDuration(call.duration || 0);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    try {
      const response = await fetch(`/api/telephony/recordings/${encodeURIComponent(call.callId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; available?: boolean; url?: string | null; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося отримати запис розмови.");
      if (!data.available || !data.url) throw new Error("Для цього дзвінка запис у Binotel недоступний.");
      audio.src = data.url;
      audio.playbackRate = rate;
      audio.volume = volume;
      audio.load();
      await audio.play();
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : "Не вдалося відтворити запис.");
    } finally {
      setLoading(false);
    }
  }, [active?.callId, rate, volume]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    if (audio.paused) void audio.play().catch(() => setError("Не вдалося продовжити відтворення."));
    else audio.pause();
  }, []);

  function closePlayer() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setActive(null);
    setPlaying(false);
    setError("");
    setCurrentTime(0);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function changeRate(value: number) {
    setRate(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  }

  function changeVolume(value: number) {
    const next = Math.min(1, Math.max(0, value));
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
  }

  const context = useMemo<PlayerContextValue>(() => ({
    active,
    loading,
    playing,
    error,
    playCall,
    toggle,
    openJournal: () => setJournalOpen(true),
  }), [active, loading, playing, error, playCall, toggle]);

  return <PlayerContext.Provider value={context}>
    {children}
    <audio
      ref={audioRef}
      preload="none"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
      onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : active?.duration || 0)}
      onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : active?.duration || 0)}
      onEnded={() => setPlaying(false)}
      onError={() => { if (!loading && active) setError("Не вдалося завантажити аудіо Binotel. Спробуйте відкрити запис ще раз."); }}
    />

    <button type="button" className={`${styles.journalLauncher} ${active ? styles.journalLauncherRaised : ""}`} onClick={() => setJournalOpen(true)}>
      ☎ <span>Журнал дзвінків</span>
    </button>

    {active && <div className={styles.player} role="region" aria-label="Плеєр запису Binotel">
      <div className={styles.playerIdentity}>
        <span className={styles.playerIcon}>{active.direction === "INCOMING" ? "↙" : "↗"}</span>
        <div><strong>{displayName(active)}</strong><small>{directionLabel(active.direction)} · {fmtDateTime(active.startedAt)}{active.manager?.name ? ` · ${active.manager.name}` : ""}</small></div>
      </div>
      <button className={styles.playMain} type="button" onClick={toggle} disabled={loading || Boolean(error)} aria-label={playing ? "Пауза" : "Відтворити"}>{loading ? "…" : playing ? "Ⅱ" : "▶"}</button>
      <div className={styles.timeline}>
        <span>{clockText(currentTime)}</span>
        <input type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, Math.max(duration, 1))} onChange={(event) => seek(Number(event.target.value))}/>
        <span>{clockText(duration || active.duration)}</span>
      </div>
      <select className={styles.rate} value={rate} onChange={(event) => changeRate(Number(event.target.value))} aria-label="Швидкість відтворення">
        <option value={1}>×1</option><option value={1.25}>×1.25</option><option value={1.5}>×1.5</option><option value={2}>×2</option>
      </select>
      <label className={styles.volume} title="Гучність">🔊<input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => changeVolume(Number(event.target.value))}/></label>
      <button type="button" className={styles.closePlayer} onClick={closePlayer} aria-label="Закрити плеєр">×</button>
      {error && <div className={styles.playerError}>{error}</div>}
    </div>}

    {journalOpen && <BinotelCallJournal onClose={() => setJournalOpen(false)} />}
  </PlayerContext.Provider>;
}

export function BinotelPlayButton({ call, compact = false }: { call: BinotelCallItem; compact?: boolean }) {
  const player = usePlayer();
  const isActive = player.active?.callId === call.callId;
  const busy = isActive && player.loading;
  const label = busy ? "Завантажую…" : isActive && player.playing ? "Пауза" : "Прослухати";
  return <button
    type="button"
    className={`${styles.playButton} ${compact ? styles.playButtonCompact : ""} ${isActive ? styles.playButtonActive : ""}`}
    disabled={!call.recordingEligible || busy}
    onClick={() => void player.playCall(call)}
    title={call.recordingEligible ? "Прослухати запис Binotel" : "Запис недоступний для цього дзвінка"}
  >{busy ? "…" : isActive && player.playing ? "Ⅱ" : "▶"}<span>{label}</span></button>;
}

export function BinotelClientCalls({ clientId, phone, limit = 8 }: { clientId: string; phone?: string | null; limit?: number }) {
  const player = usePlayer();
  const [items, setItems] = useState<BinotelCallItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ clientId, take: String(limit), page: "1" });
      const response = await fetch(`/api/telephony/calls?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as CallListPayload;
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити дзвінки.");
      setItems(data.items || []);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити дзвінки.");
    } finally { setLoading(false); }
  }, [clientId, limit]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, [load]);

  return <div className={styles.clientCalls}>
    <div className={styles.clientCallsHead}>
      <div><h3>Дзвінки Binotel <span>{items.length}</span></h3><p>{phone || "Історія телефонних розмов клієнта"}</p></div>
      <div className={styles.clientCallActions}><button type="button" onClick={() => void load()} disabled={loading}>↻</button><button type="button" onClick={player.openJournal}>Весь журнал</button></div>
    </div>
    {loading ? <div className={styles.empty}>Завантажую дзвінки…</div> : error ? <div className={styles.errorBox}>{error}</div> : !items.length ? <div className={styles.empty}>Дзвінків цього клієнта в CRM ще немає.</div> : <div className={styles.callList}>
      {items.map((call) => <CallRow key={call.id} call={call} compact />)}
    </div>}
  </div>;
}

function CallRow({ call, compact = false }: { call: BinotelCallItem; compact?: boolean }) {
  return <div className={`${styles.callRow} ${compact ? styles.callRowCompact : ""}`} data-status={call.status || "UNKNOWN"}>
    <span className={styles.direction} data-direction={call.direction}>{call.direction === "INCOMING" ? "↙" : "↗"}</span>
    <div className={styles.callMain}>
      <strong>{compact ? `${directionLabel(call.direction)} дзвінок` : displayName(call)}</strong>
      <small>{fmtDateTime(call.startedAt)} · {durationText(call.duration)}{call.manager?.name ? ` · ${call.manager.name}` : call.internalNumber ? ` · вн. ${call.internalNumber}` : ""}</small>
    </div>
    {!compact && <span className={styles.statusBadge} data-status={call.status || "UNKNOWN"}>{statusLabel(call.status)}</span>}
    <BinotelPlayButton call={call} compact={compact}/>
  </div>;
}

function BinotelCallJournal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<BinotelCallItem[]>([]);
  const [managers, setManagers] = useState<Array<{ id: string; name: string; internalNumber: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");
  const [managerId, setManagerId] = useState("");
  const [onlyRecords, setOnlyRecords] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), take: "40" });
      if (query.trim()) params.set("q", query.trim());
      if (direction) params.set("direction", direction);
      if (status) params.set("status", status);
      if (managerId) params.set("managerId", managerId);
      if (onlyRecords) params.set("hasRecording", "true");
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/telephony/calls?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as CallListPayload;
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити журнал дзвінків.");
      setItems(data.items || []);
      setManagers(data.managers || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити журнал дзвінків.");
    } finally { setLoading(false); }
  }, [query, direction, status, managerId, onlyRecords, from, to, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  function resetPage() { if (page !== 1) setPage(1); }

  async function reconcile() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/communications/binotel-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manual: true, lookbackMinutes: 180 }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося синхронізувати Binotel.");
      await load();
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "calls" } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося синхронізувати Binotel.");
    } finally { setSyncing(false); }
  }

  return <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.journal} role="dialog" aria-modal="true" aria-label="Журнал дзвінків Binotel">
      <header className={styles.journalHead}>
        <div><p>BINOTEL · TURBO LEV</p><h2>Журнал дзвінків</h2><span>Прослуховування записів, історія та контроль роботи з клієнтами</span></div>
        <div className={styles.journalHeadActions}><button type="button" onClick={() => void reconcile()} disabled={syncing}>{syncing ? "Синхронізую…" : "↻ Оновити з Binotel"}</button><button type="button" className={styles.journalClose} onClick={onClose}>×</button></div>
      </header>

      <div className={styles.filters}>
        <label className={styles.searchField}><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Клієнт, телефон, менеджер..."/></label>
        <select value={direction} onChange={(event) => { setDirection(event.target.value); resetPage(); }}><option value="">Усі напрямки</option><option value="INCOMING">Вхідні</option><option value="OUTGOING">Вихідні</option></select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}><option value="">Усі статуси</option><option value="ANSWERED">Прийняті</option><option value="MISSED">Пропущені</option><option value="BUSY">Зайнято</option></select>
        <select value={managerId} onChange={(event) => { setManagerId(event.target.value); resetPage(); }}><option value="">Усі менеджери</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.internalNumber ? ` · ${manager.internalNumber}` : ""}</option>)}</select>
        <label className={styles.dateField}>Від<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); resetPage(); }}/></label>
        <label className={styles.dateField}>До<input type="date" value={to} onChange={(event) => { setTo(event.target.value); resetPage(); }}/></label>
        <label className={styles.checkbox}><input type="checkbox" checked={onlyRecords} onChange={(event) => { setOnlyRecords(event.target.checked); resetPage(); }}/><span>Тільки із записом</span></label>
      </div>

      <div className={styles.journalSummary}>Знайдено дзвінків: <b>{total}</b>{pages > 1 && <span> · сторінка {page} з {pages}</span>}</div>
      {error && <div className={styles.errorBox}>{error}</div>}
      <div className={styles.journalBody}>
        {loading ? <div className={styles.empty}>Завантажую журнал…</div> : !items.length ? <div className={styles.empty}>За вибраними фільтрами дзвінків немає.</div> : items.map((call) => <CallRow key={call.id} call={call}/>) }
      </div>
      {pages > 1 && <footer className={styles.pagination}><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Назад</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Далі →</button></footer>}
    </section>
  </div>;
}
