"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DASHBOARD_GRID_COLUMNS,
  MAIN_DASHBOARD_ID,
  type DashboardConfigDocument,
  type DashboardWidgetInstance,
  type DashboardWidgetState,
  type DashboardWidgetType,
} from "@/src/dashboard-builder/types";
import styles from "./dashboard-builder.module.css";

type CatalogDefinition = {
  id: string;
  widgetType: DashboardWidgetType;
  title: string;
  description: string;
  sizes: string[];
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
};

type ConfigResponse = {
  ok: true;
  traceId: string;
  dashboardId: typeof MAIN_DASHBOARD_ID;
  version: number;
  source: "preset" | "user";
  presetId: string;
  catalog: CatalogDefinition[];
  config: DashboardConfigDocument;
};

type BatchResponse = {
  ok: true;
  results: Array<{
    instanceId: string | null;
    widgetType: DashboardWidgetType | null;
    state: DashboardWidgetState;
    error?: string;
  }>;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function DashboardBuilderClient() {
  const [envelope, setEnvelope] = useState<ConfigResponse | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidgetInstance[]>([]);
  const [widgetStates, setWidgetStates] = useState<Record<string, DashboardWidgetState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("Завантажую конфігурацію…");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const widgetsRef = useRef<DashboardWidgetInstance[]>([]);
  const baseConfigRef = useRef<DashboardConfigDocument | null>(null);
  const versionRef = useRef(0);
  const savingRef = useRef(false);

  const catalogMap = useMemo(() => new Map((envelope?.catalog ?? []).map((item) => [item.widgetType, item])), [envelope?.catalog]);

  const refreshBatch = useCallback(async (nextWidgets: DashboardWidgetInstance[]) => {
    if (!nextWidgets.length) {
      setWidgetStates({});
      return;
    }
    const response = await fetch("/api/dashboard/batch", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dashboardId: MAIN_DASHBOARD_ID,
        widgets: nextWidgets.map((widget) => ({
          instanceId: widget.instanceId,
          widgetType: widget.widgetType,
          settings: widget.settings,
        })),
      }),
    }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json().catch(() => null) as BatchResponse | null;
    if (!body?.ok) return;
    setWidgetStates(Object.fromEntries(body.results.filter((item) => item.instanceId).map((item) => [item.instanceId!, item.state])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setConflict(false);
    setMessage("Завантажую конфігурацію…");
    try {
      const response = await fetch("/api/dashboard/config", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null) as ConfigResponse | { ok?: false; error?: string } | null;
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && "error" in body && body.error ? body.error : "DASHBOARD_CONFIG_LOAD_FAILED");
      }
      setEnvelope(body);
      setWidgets(body.config.widgets);
      widgetsRef.current = body.config.widgets;
      baseConfigRef.current = body.config;
      versionRef.current = body.version;
      setDirty(false);
      setMessage(body.source === "preset" ? `Рольовий пресет · ${body.presetId}` : `Збережено · версія ${body.version}`);
      void refreshBatch(body.config.widgets);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не вдалося завантажити конструктор");
    } finally {
      setLoading(false);
    }
  }, [refreshBatch]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutateWidgets = useCallback((recipe: (current: DashboardWidgetInstance[]) => DashboardWidgetInstance[]) => {
    setWidgets((current) => {
      const next = recipe(current);
      widgetsRef.current = next;
      return next;
    });
    setDirty(true);
    setConflict(false);
    setMessage("Є незбережені зміни");
  }, []);

  const saveNow = useCallback(async () => {
    const baseConfig = baseConfigRef.current;
    if (!baseConfig || savingRef.current || conflict) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("Зберігаю…");
    const snapshot = widgetsRef.current;
    const snapshotKey = JSON.stringify(snapshot);
    try {
      const response = await fetch("/api/dashboard/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboardId: MAIN_DASHBOARD_ID,
          expectedVersion: versionRef.current,
          config: { ...baseConfig, widgets: snapshot },
        }),
      });
      const body = await response.json().catch(() => null) as ConfigResponse | { ok?: false; error?: string; currentVersion?: number } | null;
      if (response.status === 409) {
        setConflict(true);
        setMessage(`Конфлікт версій · на сервері v${body && "currentVersion" in body ? body.currentVersion ?? "?" : "?"}`);
        return;
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && "error" in body && body.error ? body.error : "DASHBOARD_CONFIG_SAVE_FAILED");
      }
      setEnvelope((current) => current ? { ...current, ...body } : body);
      baseConfigRef.current = body.config;
      versionRef.current = body.version;
      const unchangedSinceRequest = JSON.stringify(widgetsRef.current) === snapshotKey;
      setDirty(!unchangedSinceRequest);
      setMessage(unchangedSinceRequest ? `Збережено · версія ${body.version}` : "Є нові зміни · зберігаю наступною версією");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Помилка збереження");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [conflict]);

  useEffect(() => {
    if (!dirty || saving || loading || conflict) return;
    const timer = window.setTimeout(() => void saveNow(), 850);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, loading, conflict, widgets, saveNow]);

  const resetPreset = useCallback(async () => {
    if (!baseConfigRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("Відновлюю рольовий пресет…");
    try {
      const response = await fetch("/api/dashboard/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          dashboardId: MAIN_DASHBOARD_ID,
          expectedVersion: versionRef.current,
        }),
      });
      const body = await response.json().catch(() => null) as ConfigResponse | { ok?: false; error?: string; currentVersion?: number } | null;
      if (response.status === 409) {
        setConflict(true);
        setMessage(`Конфлікт версій · на сервері v${body && "currentVersion" in body ? body.currentVersion ?? "?" : "?"}`);
        return;
      }
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && "error" in body && body.error ? body.error : "DASHBOARD_PRESET_RESET_FAILED");
      }
      setEnvelope(body);
      setWidgets(body.config.widgets);
      widgetsRef.current = body.config.widgets;
      baseConfigRef.current = body.config;
      versionRef.current = body.version;
      setDirty(false);
      setConflict(false);
      setMessage(`Пресет відновлено · версія ${body.version}`);
      void refreshBatch(body.config.widgets);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не вдалося відновити пресет");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [refreshBatch]);

  const addWidget = useCallback((definition: CatalogDefinition) => {
    mutateWidgets((current) => {
      if (current.length >= 40) return current;
      const y = current.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
      return [
        ...current,
        {
          instanceId: crypto.randomUUID(),
          widgetType: definition.widgetType,
          title: definition.title,
          settings: {},
          layout: { x: 0, y, w: definition.defaultW, h: definition.defaultH },
        },
      ];
    });
  }, [mutateWidgets]);

  const removeWidget = useCallback((instanceId: string) => {
    mutateWidgets((current) => current.filter((widget) => widget.instanceId !== instanceId));
  }, [mutateWidgets]);

  const adjustLayout = useCallback((instanceId: string, delta: Partial<{ x: number; y: number; w: number; h: number }>) => {
    mutateWidgets((current) => current.map((widget) => {
      if (widget.instanceId !== instanceId) return widget;
      const definition = catalogMap.get(widget.widgetType);
      if (!definition) return widget;
      const w = clamp(widget.layout.w + (delta.w ?? 0), definition.minW, Math.min(definition.maxW, DASHBOARD_GRID_COLUMNS));
      const h = clamp(widget.layout.h + (delta.h ?? 0), definition.minH, definition.maxH);
      const x = clamp(widget.layout.x + (delta.x ?? 0), 0, DASHBOARD_GRID_COLUMNS - w);
      const y = Math.max(0, widget.layout.y + (delta.y ?? 0));
      return { ...widget, layout: { x, y, w, h } };
    }));
  }, [catalogMap, mutateWidgets]);

  const swapWidgetPositions = useCallback((targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    mutateWidgets((current) => {
      const source = current.find((widget) => widget.instanceId === draggedId);
      const target = current.find((widget) => widget.instanceId === targetId);
      if (!source || !target) return current;
      return current.map((widget) => {
        if (widget.instanceId === source.instanceId) {
          return { ...widget, layout: { ...widget.layout, x: clamp(target.layout.x, 0, DASHBOARD_GRID_COLUMNS - widget.layout.w), y: target.layout.y } };
        }
        if (widget.instanceId === target.instanceId) {
          return { ...widget, layout: { ...widget.layout, x: clamp(source.layout.x, 0, DASHBOARD_GRID_COLUMNS - widget.layout.w), y: source.layout.y } };
        }
        return widget;
      });
    });
    setDraggedId(null);
  }, [draggedId, mutateWidgets]);

  if (loading && !envelope) {
    return <main className={styles.page}><div className={styles.loading}>Завантажую конструктор головної сторінки…</div></main>;
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · DASHBOARD BUILDER · P1</p>
        <h1>Конструктор головної сторінки</h1>
        <p className={styles.subhead}>12-колонкова сітка · рольовий пресет · версійне автозбереження</p>
      </div>
      <div className={styles.headerActions}>
        <a className={styles.secondaryButton} href="/">← CRM</a>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={saving}>Оновити</button>
        <button type="button" className={styles.secondaryButton} onClick={() => void resetPreset()} disabled={saving || !envelope}>Відновити пресет</button>
        <button type="button" className={styles.primaryButton} onClick={() => void saveNow()} disabled={!dirty || saving || conflict}>Зберегти</button>
      </div>
    </header>

    <div className={`${styles.syncBar} ${conflict ? styles.syncConflict : ""}`}>
      <span>{message}</span>
      <span>{envelope ? `${envelope.source === "preset" ? "preset" : "user"} · ${envelope.presetId} · v${versionRef.current}` : "немає конфігурації"}</span>
      {conflict && <button type="button" onClick={() => void load()}>Завантажити актуальну версію</button>}
    </div>

    <div className={styles.workspace}>
      <aside className={styles.catalog}>
        <div className={styles.catalogHead}>
          <div>
            <span>Каталог</span>
            <strong>{envelope?.catalog.length ?? 0} дозволених типів</strong>
          </div>
          <small>Показуються тільки типи, дозволені сервером для поточної ролі.</small>
        </div>
        <div className={styles.catalogList}>
          {(envelope?.catalog ?? []).map((definition) => <article key={definition.widgetType} className={styles.catalogCard}>
            <div><span>{definition.id}</span><strong>{definition.title}</strong></div>
            <p>{definition.description}</p>
            <footer><small>{definition.sizes.join(" / ")} · {definition.minW}–{definition.maxW} колонок</small><button type="button" onClick={() => addWidget(definition)}>+ Додати</button></footer>
          </article>)}
        </div>
      </aside>

      <section className={styles.canvasSection}>
        <div className={styles.canvasHead}>
          <div><span>Полотно</span><strong>{widgets.length} віджетів</strong></div>
          <small>Перетягніть заголовок блока на інший блок для обміну позиціями. Розмір змінюється кнопками в картці.</small>
        </div>
        {widgets.length === 0 ? <div className={styles.emptyCanvas}>Додайте перший віджет із каталогу.</div> : <div className={styles.grid}>
          {widgets.map((widget) => {
            const definition = catalogMap.get(widget.widgetType);
            const state = widgetStates[widget.instanceId] ?? "empty";
            const placement = {
              gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
              gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
            } as CSSProperties;
            return <article
              key={widget.instanceId}
              className={styles.widgetCard}
              style={placement}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => swapWidgetPositions(widget.instanceId)}
            >
              <header
                className={styles.widgetHead}
                draggable
                onDragStart={() => setDraggedId(widget.instanceId)}
                onDragEnd={() => setDraggedId(null)}
                title="Перетягнути блок"
              >
                <div><span>{definition?.id ?? widget.widgetType}</span><strong>{widget.title || definition?.title || widget.widgetType}</strong></div>
                <button type="button" onClick={() => removeWidget(widget.instanceId)} aria-label="Видалити віджет">×</button>
              </header>
              <div className={styles.widgetBody}>
                <span className={styles.stateBadge}>{state}</span>
                <p>{state === "empty" ? "P1: layout і контракт готові. Реальні дані підключаються провайдером на P2/P3." : `Стан провайдера: ${state}`}</p>
                <small>{widget.layout.w}×{widget.layout.h} · x{widget.layout.x} y{widget.layout.y}</small>
              </div>
              <footer className={styles.widgetControls}>
                <div>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { x: -1 })} aria-label="Ліворуч">←</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { x: 1 })} aria-label="Праворуч">→</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { y: -1 })} aria-label="Вище">↑</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { y: 1 })} aria-label="Нижче">↓</button>
                </div>
                <div>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { w: -1 })}>−W</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { w: 1 })}>+W</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { h: -1 })}>−H</button>
                  <button type="button" onClick={() => adjustLayout(widget.instanceId, { h: 1 })}>+H</button>
                </div>
              </footer>
            </article>;
          })}
        </div>}
      </section>
    </div>
  </main>;
}
