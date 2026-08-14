"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ThemeMode = "light" | "dark" | "auto";
type ResolvedTheme = "light" | "dark";
type SettingsTab = "appearance" | "suppliers";
type SupplierId = "bm-parts" | "unique-trade" | "autonova-d";
type SupplierState = "CONNECTED" | "CONFIGURED" | "NOT_CONFIGURED" | "MANUAL_SETUP" | "ERROR";

type Supplier = {
  id: SupplierId;
  name: string;
  website: string;
  apiBaseUrl: string | null;
  authType: string;
  configured: boolean;
  state: SupplierState;
  capabilities: string[];
  setupHint: string;
};

type ConnectionCheck = {
  ok: boolean;
  state: SupplierState;
  message: string;
  checkedAt?: string;
  latencyMs?: number;
};

const capabilityLabels: Record<string, string> = {
  SEARCH: "Пошук",
  PRICE: "Ціни",
  STOCK: "Залишки",
  CROSSES: "Кроси",
  WAREHOUSES: "Склади",
  DELIVERY: "Доставка",
  ORDERS: "Замовлення",
  VIN: "VIN",
};

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode);
  document.documentElement.dataset.themeMode = mode;
}

function supplierBadge(state: SupplierState, configured: boolean) {
  if (state === "CONNECTED") return { text: "Підключено", tone: "good" };
  if (state === "ERROR") return { text: "Помилка", tone: "error" };
  if (state === "MANUAL_SETUP") return { text: "Потрібен API-доступ", tone: "waiting" };
  if (configured) return { text: "Налаштовано", tone: "configured" };
  return { text: "Не налаштовано", tone: "muted" };
}

export function SettingsPanel() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [testing, setTesting] = useState<SupplierId | null>(null);
  const [checks, setChecks] = useState<Partial<Record<SupplierId, ConnectionCheck>>>({});

  useEffect(() => {
    setMounted(true);
    const saved = window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null;
    const legacy = window.localStorage.getItem("turbolev-theme") as "light" | "dark" | null;
    const initial: ThemeMode = saved ?? legacy ?? "auto";

    setMode(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      const current = (window.localStorage.getItem("turbolev-theme-mode") as ThemeMode | null) ?? initial;
      if (current === "auto") applyTheme("auto");
    };

    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    if (!open || tab !== "suppliers" || suppliers.length) return;
    void loadSuppliers();
  }, [open, tab, suppliers.length]);

  function selectMode(next: ThemeMode) {
    setMode(next);
    window.localStorage.setItem("turbolev-theme-mode", next);
    window.localStorage.removeItem("turbolev-theme");
    applyTheme(next);
  }

  async function loadSuppliers() {
    setLoadingSuppliers(true);
    try {
      const response = await fetch("/api/suppliers/status", { cache: "no-store" });
      const data = (await response.json()) as { suppliers?: Supplier[] };
      setSuppliers(Array.isArray(data.suppliers) ? data.suppliers : []);
    } catch {
      setSuppliers([]);
    } finally {
      setLoadingSuppliers(false);
    }
  }

  async function testConnection(id: SupplierId) {
    setTesting(id);
    try {
      const response = await fetch(`/api/suppliers/test?supplier=${encodeURIComponent(id)}`, { method: "POST" });
      const data = (await response.json()) as ConnectionCheck;
      setChecks((current) => ({ ...current, [id]: data }));
      if (data.state === "CONNECTED") {
        setSuppliers((current) => current.map((supplier) => supplier.id === id ? { ...supplier, state: "CONNECTED" } : supplier));
      }
    } catch {
      setChecks((current) => ({
        ...current,
        [id]: { ok: false, state: "ERROR", message: "CRM не змогла виконати перевірку з'єднання." },
      }));
    } finally {
      setTesting(null);
    }
  }

  const modal = open ? (
    <div className="settingsBackdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settingsHeader">
          <div>
            <p className="eyebrow">СИСТЕМА</p>
            <h2 id="settingsTitle">Налаштування</h2>
          </div>
          <button className="settingsClose" type="button" aria-label="Закрити налаштування" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className="settingsLayout">
          <aside className="settingsTabs" aria-label="Розділи налаштувань">
            <button className={tab === "appearance" ? "settingsTab settingsTabActive" : "settingsTab"} type="button" onClick={() => setTab("appearance")}>
              <span>◐</span><span><strong>Оформлення</strong><small>Тема CRM</small></span>
            </button>
            <button className={tab === "suppliers" ? "settingsTab settingsTabActive" : "settingsTab"} type="button" onClick={() => setTab("suppliers")}>
              <span>◆</span><span><strong>Постачальники</strong><small>API запчастин</small></span>
            </button>
          </aside>

          <div className="settingsContent">
            {tab === "appearance" ? (
              <div className="settingsSection settingsSectionFlush">
                <div className="settingsSectionCopy">
                  <strong>Оформлення</strong>
                  <span>Вибери тему CRM. Автоматична тема повторює налаштування Windows або браузера.</span>
                </div>

                <div className="themeOptions" role="radiogroup" aria-label="Тема CRM">
                  <button className={mode === "light" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "light"} onClick={() => selectMode("light")}>
                    <span className="themePreview themePreviewLight" aria-hidden="true" />
                    <span><strong>Світла</strong><small>Завжди світлий інтерфейс</small></span>
                  </button>
                  <button className={mode === "dark" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "dark"} onClick={() => selectMode("dark")}>
                    <span className="themePreview themePreviewDark" aria-hidden="true" />
                    <span><strong>Темна</strong><small>Завжди темний інтерфейс</small></span>
                  </button>
                  <button className={mode === "auto" ? "themeOption themeOptionActive" : "themeOption"} type="button" role="radio" aria-checked={mode === "auto"} onClick={() => selectMode("auto")}>
                    <span className="themePreview themePreviewAuto" aria-hidden="true" />
                    <span><strong>Автоматична</strong><small>Як у системі</small></span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="settingsSection settingsSectionFlush supplierSettings">
                <div className="settingsSectionCopy supplierSectionHead">
                  <div>
                    <strong>Постачальники запчастин</strong>
                    <span>CRM працює з постачальниками через серверні API-адаптери. Паролі й API-ключі ніколи не передаються у браузер.</span>
                  </div>
                  <button className="supplierRefresh" type="button" disabled={loadingSuppliers} onClick={loadSuppliers}>{loadingSuppliers ? "Оновлення…" : "Оновити"}</button>
                </div>

                {loadingSuppliers && !suppliers.length ? <div className="supplierEmpty">Завантажую стан інтеграцій…</div> : null}
                {!loadingSuppliers && !suppliers.length ? <div className="supplierEmpty">Не вдалося отримати список постачальників.</div> : null}

                <div className="supplierList">
                  {suppliers.map((supplier) => {
                    const check = checks[supplier.id];
                    const effectiveState = check?.state ?? supplier.state;
                    const badge = supplierBadge(effectiveState, supplier.configured);
                    return <article className="supplierCard" key={supplier.id}>
                      <div className="supplierCardTop">
                        <div className="supplierIdentity">
                          <div className="supplierMark">{supplier.name.slice(0, 2).toUpperCase()}</div>
                          <div><strong>{supplier.name}</strong><span>{supplier.authType}</span></div>
                        </div>
                        <span className={`supplierStatus supplierStatus-${badge.tone}`}>{badge.text}</span>
                      </div>

                      <div className="supplierCapabilities">
                        {supplier.capabilities.map((capability) => <span key={capability}>{capabilityLabels[capability] ?? capability}</span>)}
                      </div>

                      <p className="supplierHint">{supplier.setupHint}</p>
                      {check ? <div className={check.ok ? "supplierCheck supplierCheckOk" : "supplierCheck"}>
                        <strong>{check.message}</strong>
                        {typeof check.latencyMs === "number" ? <span>{check.latencyMs} мс</span> : null}
                      </div> : null}

                      <div className="supplierActions">
                        <a href={supplier.website} target="_blank" rel="noreferrer">Кабінет постачальника ↗</a>
                        <button type="button" disabled={testing === supplier.id} onClick={() => testConnection(supplier.id)}>{testing === supplier.id ? "Перевіряю…" : "Перевірити з'єднання"}</button>
                      </div>
                    </article>;
                  })}
                </div>

                <div className="supplierSecurityNote">
                  <strong>Безпека доступів</strong>
                  <span>У публічному GitHub зберігаються тільки назви змінних середовища. Реальні логіни, паролі та API-ключі мають бути лише в секретах сервера/Vercel.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button className="settingsNavButton" type="button" onClick={() => setOpen(true)}>
        <span className="navDot" />
        Налаштування
      </button>
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
