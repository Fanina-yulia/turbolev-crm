"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./vehicle-image-library-settings-panel.module.css";

type Asset = {
  id: string;
  libraryKey: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  theme: string;
  provider: string;
  providerModel: string | null;
  promptVersion: string;
  status: string;
  reviewStatus: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  imageMimeType: string | null;
  imageSizeBytes: number | null;
  lastError: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  templateKey: string | null;
  variantKey: string | null;
  normalizedColor: string | null;
  generationFrom: number | null;
  generationTo: number | null;
  sourceAssetId: string | null;
  generationMode: string;
};

type TestVehicle = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  plateNumber: string | null;
  imageState?: string;
  imageError?: string | null;
};

type TestSetPayload = {
  ok?: boolean;
  vehicles?: TestVehicle[];
  processingVehicles?: TestVehicle[];
  incompleteVehicles?: TestVehicle[];
  blockedVehicles?: TestVehicle[];
  totalMissing?: number;
  totalWithoutReadyImage?: number;
  auditFailures?: number;
  error?: string;
};

type TestRunState = {
  running: boolean;
  completed: number;
  total: number;
  current: string;
  failures: number;
};

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function sizeText(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function themeText(theme: string) {
  return theme.replace(/^Imagin-/i, "");
}

function generationText(asset: Asset) {
  if (asset.generationFrom != null && asset.generationTo != null) {
    return asset.generationFrom === asset.generationTo ? String(asset.generationFrom) : `${asset.generationFrom}–${asset.generationTo}`;
  }
  return asset.year ? String(asset.year) : "—";
}

function generationModeText(asset: Asset) {
  if (!asset.templateKey) return "Стара бібліотека";
  if (asset.generationMode === "REFERENCE_EDIT") return "Колір із шаблону";
  if (asset.generationMode === "TEXT_GENERATION_FALLBACK") return "Нова генерація після fallback";
  if (asset.generationMode === "MANUAL") return "Вручну";
  if (asset.generationMode === "PENDING") return "Готується";
  return "Нова модель";
}

function badge(asset: Asset) {
  if (asset.status === "GENERATING") return { label: "Генерується", className: styles.badgeGenerating };
  if (asset.status === "ERROR") return { label: "Помилка", className: styles.badgeError };
  if (asset.status === "READY" && asset.reviewStatus === "APPROVED") return { label: "Затверджено", className: styles.badgeApproved };
  if (asset.status === "READY") return { label: "На перевірці", className: styles.badgePending };
  return { label: asset.status || "Очікує", className: styles.badgeNeutral };
}

function testVehicleText(vehicle: TestVehicle) {
  const identity = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Автомобіль без марки та моделі";
  return `${identity}${vehicle.year ? ` · ${vehicle.year}` : ""}${vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : " · без держномера"}`;
}

function missingIdentityText(vehicle: TestVehicle) {
  if (!vehicle.make && !vehicle.model) return "не вказані марка та модель";
  if (!vehicle.make) return "не вказана марка";
  return "не вказана модель";
}

export function VehicleImageLibrarySettingsPanel() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [testVehicles, setTestVehicles] = useState<TestVehicle[]>([]);
  const [processingVehicles, setProcessingVehicles] = useState<TestVehicle[]>([]);
  const [incompleteVehicles, setIncompleteVehicles] = useState<TestVehicle[]>([]);
  const [blockedVehicles, setBlockedVehicles] = useState<TestVehicle[]>([]);
  const [testVehicleTotal, setTestVehicleTotal] = useState(0);
  const [auditFailures, setAuditFailures] = useState(0);
  const [testSetLoading, setTestSetLoading] = useState(true);
  const [testRun, setTestRun] = useState<TestRunState>({ running: false, completed: 0, total: 0, current: "", failures: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/vehicle-images/library?limit=250", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; assets?: Asset[]; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити бібліотеку.");
      setAssets(payload.assets || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося завантажити бібліотеку.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTestSet = useCallback(async () => {
    setTestSetLoading(true);
    try {
      const response = await fetch("/api/vehicle-images/library/test-set", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as TestSetPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося знайти автомобілі без зображення.");
      setTestVehicles(payload.vehicles || []);
      setProcessingVehicles(payload.processingVehicles || []);
      setIncompleteVehicles(payload.incompleteVehicles || []);
      setBlockedVehicles(payload.blockedVehicles || []);
      setTestVehicleTotal(Number(payload.totalWithoutReadyImage ?? payload.totalMissing ?? payload.vehicles?.length ?? 0));
      setAuditFailures(Number(payload.auditFailures || 0));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося знайти автомобілі без зображення.");
    } finally {
      setTestSetLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTestSet();
  }, [load, loadTestSet]);

  const approvedAssets = useMemo(
    () => assets.filter((item) => item.status === "READY" && item.reviewStatus === "APPROVED"),
    [assets],
  );
  const reviewAssets = useMemo(
    () => assets.filter((item) => item.status === "READY" && item.reviewStatus !== "APPROVED"),
    [assets],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("uk-UA");
    return approvedAssets.filter((asset) => !query || [asset.make, asset.model, asset.year?.toString(), asset.bodyType, asset.providerModel, asset.normalizedColor, asset.variantKey]
      .filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(query));
  }, [approvedAssets, search]);

  const runTestSet = async () => {
    if (!testVehicles.length || testRun.running) return;
    setError("");
    setNotice("");
    setTestRun({ running: true, completed: 0, total: testVehicles.length, current: "Перевіряю підключення OpenAI…", failures: 0 });

    try {
      const testResponse = await fetch("/api/settings/integrations/VEHICLE_IMAGES/test", { method: "POST" });
      const testPayload = await testResponse.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
      if (!testResponse.ok || !testPayload?.ok) {
        throw new Error(testPayload?.message || testPayload?.error || "OpenAI API для зображень ще не налаштовано.");
      }

      const list = testVehicles.map((vehicle) => `• ${testVehicleText(vehicle)}`).join("\n");
      const confirmed = window.confirm(
        `Згенерувати зображення для ${testVehicles.length} реальних автомобілів CRM, у яких його ще немає?\n\n${list}\n\nПлатний OpenAI API-запит виконується тільки якщо готового зображення справді немає.`,
      );
      if (!confirmed) return;

      let cursor = 0;
      let completed = 0;
      const failures: string[] = [];

      const worker = async () => {
        while (true) {
          const index = cursor++;
          if (index >= testVehicles.length) return;
          const vehicle = testVehicles[index];
          const title = `${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ""}`;
          setTestRun((current) => ({ ...current, current: `Генерую ${title}…` }));

          try {
            const response = await fetch("/api/vehicle-images/library/test-set", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ vehicleId: vehicle.id }),
            });
            const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Помилка генерації.");
          } catch (reason) {
            failures.push(`${title}: ${reason instanceof Error ? reason.message : "помилка"}`);
          } finally {
            completed += 1;
            setTestRun((current) => ({ ...current, completed, failures: failures.length }));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(2, testVehicles.length) }, () => worker()));
      await Promise.all([load(), loadTestSet()]);

      if (failures.length) {
        setError(`Генерацію завершено: ${completed - failures.length}/${completed} успішно. ${failures.join(" · ")}`);
      } else {
        setNotice(`Готово: ${completed} зображень створено або повторно використано. Автомобілі з готовими зображеннями прибрані з «Контролю якості»; нові зображення очікують затвердження.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося запустити генерацію.");
    } finally {
      setTestRun((current) => ({ ...current, running: false, current: "" }));
    }
  };

  const patch = async (asset: Asset, action: "approve" | "regenerate") => {
    setBusy((current) => ({ ...current, [asset.id]: action }));
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/vehicle-images/library/${encodeURIComponent(asset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося виконати дію.");
      setNotice(action === "approve" ? "Зображення затверджено й додано до основної бібліотеки." : "Нове зображення згенеровано. Перевірте його перед затвердженням.");
      await Promise.all([load(), loadTestSet()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося виконати дію.");
    } finally {
      setBusy((current) => { const next = { ...current }; delete next[asset.id]; return next; });
    }
  };

  const regenerate = async (asset: Asset) => {
    const confirmed = window.confirm(`Перегенерувати ${asset.make} ${asset.model}${asset.year ? ` ${asset.year}` : ""}? Це створить новий платний запит до OpenAI.`);
    if (!confirmed) return;
    await patch(asset, "regenerate");
  };

  const replace = async (asset: Asset, file: File | null) => {
    if (!file) return;
    if (file.type !== "image/png") {
      setError("Для ручної заміни оберіть PNG-файл.");
      return;
    }
    setBusy((current) => ({ ...current, [asset.id]: "replace" }));
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/vehicle-images/library/${encodeURIComponent(asset.id)}`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося замінити PNG.");
      setNotice("PNG замінено, оптимізовано для CRM та автоматично затверджено.");
      await Promise.all([load(), loadTestSet()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося замінити PNG.");
    } finally {
      setBusy((current) => { const next = { ...current }; delete next[asset.id]; return next; });
    }
  };

  const renderAssetCard = (asset: Asset) => {
    const state = badge(asset);
    const action = busy[asset.id];
    const preview = asset.status === "READY" && asset.imageMimeType;
    return <article className={styles.card} key={asset.id}>
      <div className={styles.preview}>
        {preview ? <img src={`/api/vehicle-images/${encodeURIComponent(asset.id)}?v=${encodeURIComponent(asset.updatedAt)}`} alt={`${asset.make} ${asset.model}`}/> : <div className={styles.previewFallback}>Немає зображення</div>}
        <span className={`${styles.badge} ${state.className}`}>{state.label}</span>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.titleRow}>
          <div><h3>{asset.make} {asset.model}</h3><p>{asset.year || "Рік не вказано"}{asset.bodyType ? ` · ${asset.bodyType}` : ""}</p></div>
          <span className={styles.theme}>{asset.normalizedColor || themeText(asset.theme)}</span>
        </div>

        <dl className={styles.meta}>
          <div><dt>Джерело</dt><dd>{asset.provider === "MANUAL" ? "Вручну" : asset.providerModel || asset.provider}</dd></div>
          <div><dt>Розмір</dt><dd>{sizeText(asset.imageSizeBytes)}</dd></div>
          <div><dt>Модельний діапазон</dt><dd>{generationText(asset)}</dd></div>
          <div><dt>Колір-варіант</dt><dd>{asset.normalizedColor || themeText(asset.theme)}</dd></div>
          <div><dt>Створення</dt><dd>{generationModeText(asset)}</dd></div>
          <div><dt>Згенеровано</dt><dd>{dateText(asset.generatedAt)}</dd></div>
          <div><dt>Перевірено</dt><dd>{asset.reviewStatus === "APPROVED" ? dateText(asset.reviewedAt) : "Ще ні"}</dd></div>
        </dl>

        {asset.lastError ? <div className={styles.assetError}>{asset.lastError}</div> : null}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={Boolean(action) || asset.status !== "READY" || asset.reviewStatus === "APPROVED"} onClick={() => void patch(asset, "approve")}>
            {action === "approve" ? "Зберігаю…" : asset.reviewStatus === "APPROVED" ? "✓ Затверджено" : "✓ Затвердити"}
          </button>
          <button type="button" className={styles.secondary} disabled={Boolean(action) || asset.status === "GENERATING"} onClick={() => void regenerate(asset)}>
            {action === "regenerate" ? "Генерую…" : "↻ Перегенерувати"}
          </button>
          <label className={`${styles.secondary} ${action ? styles.disabled : ""}`}>
            {action === "replace" ? "Завантажую…" : "↑ Замінити PNG"}
            <input type="file" accept="image/png" disabled={Boolean(action)} onChange={(event) => { const file = event.currentTarget.files?.[0] || null; void replace(asset, file); event.currentTarget.value = ""; }}/>
          </label>
        </div>
      </div>
    </article>;
  };

  return <section className={styles.panel}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>OpenAI · бібліотека CRM</span>
        <h2>Бібліотека зображень авто</h2>
        <p>В основній бібліотеці відображаються тільки готові зображення, які вже затверджені для використання в CRM.</p>
      </div>
      <button className={styles.refresh} type="button" onClick={() => { void load(); void loadTestSet(); }} disabled={loading || testSetLoading}>↻ Оновити</button>
    </header>

    <div className={styles.testPanel}>
      <div className={styles.testCopy}>
        <span className={styles.testEyebrow}>Контроль якості бібліотеки</span>
        <h3>Реальні автомобілі CRM без зображення</h3>
        <p>Перевіряються всі картки авто. Готовим вважається лише файл, який уже можна показати в CRM; окремо видно генерацію, помилки та картки з неповними даними.</p>
        <div className={styles.testVehicles}>
          {testVehicles.map((vehicle) => <span key={vehicle.id}>Потрібна генерація · {testVehicleText(vehicle)}</span>)}
          {processingVehicles.map((vehicle) => <span key={vehicle.id}>Готується · {testVehicleText(vehicle)}</span>)}
          {incompleteVehicles.map((vehicle) => <span key={vehicle.id}>Уточніть дані · {testVehicleText(vehicle)} · {missingIdentityText(vehicle)}</span>)}
          {blockedVehicles.map((vehicle) => <span key={vehicle.id}>Генерація недоступна · {testVehicleText(vehicle)}{vehicle.imageError ? ` · ${vehicle.imageError}` : ""}</span>)}
          {!testSetLoading && testVehicleTotal === 0 && auditFailures === 0 ? <span>Усі автомобілі CRM уже мають готові до показу зображення</span> : null}
          {!testSetLoading && auditFailures > 0 ? <span>Не вдалося перевірити карток: {auditFailures}. Оновіть перевірку.</span> : null}
        </div>
      </div>
      <div className={styles.testAction}>
        <button type="button" onClick={() => void runTestSet()} disabled={testSetLoading || testRun.running || !testVehicles.length}>
          {testRun.running
            ? `Генерація ${testRun.completed}/${testRun.total}`
            : testSetLoading
              ? "Перевіряю CRM…"
              : testVehicles.length
                ? `Згенерувати ${testVehicles.length} авто`
                : processingVehicles.length
                  ? "Зображення готуються"
                  : incompleteVehicles.length
                    ? "Уточніть дані авто"
                    : blockedVehicles.length || auditFailures
                      ? "Перевірка потребує уваги"
                      : "Усі зображення готові"}
        </button>
        <small>{testVehicleTotal ? `Без готового зображення: ${testVehicleTotal}. До генерації готові: ${testVehicles.length}. ` : ""}Готові варіанти не генеруються повторно.</small>
        {testRun.running ? <div className={styles.testProgress}><span style={{ width: `${testRun.total ? Math.round(testRun.completed / testRun.total * 100) : 0}%` }}/><b>{testRun.current}</b></div> : null}
      </div>
    </div>

    {reviewAssets.length ? <>
      <div className={styles.testPanel}>
        <div className={styles.testCopy}>
          <span className={styles.testEyebrow}>Модерація зображень</span>
          <h3>Очікують затвердження</h3>
          <p>Ці зображення вже згенеровані, але ще не входять до основної бібліотеки. Перевірте відповідність авто та затвердьте правильні варіанти.</p>
        </div>
        <div className={styles.testAction}><small>До затвердження: {reviewAssets.length}</small></div>
      </div>
      <div className={styles.grid}>{reviewAssets.map(renderAssetCard)}</div>
    </> : null}

    <div className={styles.stats}>
      <button type="button" className={styles.statActive}><b>{approvedAssets.length}</b><span>Затверджено в бібліотеці</span></button>
      <button type="button"><b>{reviewAssets.length}</b><span>Очікують затвердження</span></button>
    </div>

    <div className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук серед затверджених: марка, модель, рік, кузов або колір"/></label>
      <span className={styles.costHint}>Основна бібліотека нижче містить виключно затверджені зображення.</span>
    </div>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    {loading ? <div className={styles.empty}>Завантажую бібліотеку…</div> : null}
    {!loading && !approvedAssets.length ? <div className={styles.empty}><b>Затверджених зображень поки немає.</b><span>Нові згенеровані зображення спочатку з’являться у блоці «Очікують затвердження».</span></div> : null}
    {!loading && approvedAssets.length > 0 && !visible.length ? <div className={styles.empty}>Серед затверджених зображень нічого не знайдено.</div> : null}

    <div className={styles.grid}>{visible.map(renderAssetCard)}</div>
  </section>;
}
