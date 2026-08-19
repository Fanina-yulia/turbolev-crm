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
};

type Filter = "all" | "pending" | "approved" | "generating" | "error";

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

function badge(asset: Asset) {
  if (asset.status === "GENERATING") return { label: "Генерується", className: styles.badgeGenerating };
  if (asset.status === "ERROR") return { label: "Помилка", className: styles.badgeError };
  if (asset.status === "READY" && asset.reviewStatus === "APPROVED") return { label: "Затверджено", className: styles.badgeApproved };
  if (asset.status === "READY") return { label: "На перевірці", className: styles.badgePending };
  return { label: asset.status || "Очікує", className: styles.badgeNeutral };
}

export function VehicleImageLibrarySettingsPanel() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<Record<string, string>>({});

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

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    all: assets.length,
    pending: assets.filter((item) => item.status === "READY" && item.reviewStatus !== "APPROVED").length,
    approved: assets.filter((item) => item.status === "READY" && item.reviewStatus === "APPROVED").length,
    generating: assets.filter((item) => item.status === "GENERATING").length,
    error: assets.filter((item) => item.status === "ERROR").length,
  }), [assets]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("uk-UA");
    return assets.filter((asset) => {
      const matchesText = !query || [asset.make, asset.model, asset.year?.toString(), asset.bodyType, asset.providerModel]
        .filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(query);
      if (!matchesText) return false;
      if (filter === "pending") return asset.status === "READY" && asset.reviewStatus !== "APPROVED";
      if (filter === "approved") return asset.status === "READY" && asset.reviewStatus === "APPROVED";
      if (filter === "generating") return asset.status === "GENERATING";
      if (filter === "error") return asset.status === "ERROR";
      return true;
    });
  }, [assets, filter, search]);

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
      setNotice(action === "approve" ? "Зображення затверджено." : "Нове зображення згенеровано. Перевірте його перед затвердженням.");
      await load();
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
      setNotice("PNG замінено вручну та автоматично затверджено.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося замінити PNG.");
    } finally {
      setBusy((current) => { const next = { ...current }; delete next[asset.id]; return next; });
    }
  };

  return <section className={styles.panel}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>OpenAI · бібліотека CRM</span>
        <h2>Бібліотека зображень авто</h2>
        <p>Перевіряйте згенеровані моделі, затверджуйте вдалі, перегенеровуйте неточні або замінюйте їх власним PNG.</p>
      </div>
      <button className={styles.refresh} type="button" onClick={() => void load()} disabled={loading}>↻ Оновити</button>
    </header>

    <div className={styles.stats}>
      <button type="button" className={filter === "all" ? styles.statActive : ""} onClick={() => setFilter("all")}><b>{stats.all}</b><span>Усього</span></button>
      <button type="button" className={filter === "pending" ? styles.statActive : ""} onClick={() => setFilter("pending")}><b>{stats.pending}</b><span>На перевірці</span></button>
      <button type="button" className={filter === "approved" ? styles.statActive : ""} onClick={() => setFilter("approved")}><b>{stats.approved}</b><span>Затверджено</span></button>
      <button type="button" className={filter === "generating" ? styles.statActive : ""} onClick={() => setFilter("generating")}><b>{stats.generating}</b><span>Генерується</span></button>
      <button type="button" className={filter === "error" ? styles.statActive : ""} onClick={() => setFilter("error")}><b>{stats.error}</b><span>Помилки</span></button>
    </div>

    <div className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Марка, модель, рік або кузов"/></label>
      <span className={styles.costHint}>Перегенерація запускається лише після підтвердження, бо це новий платний API-запит.</span>
    </div>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    {loading ? <div className={styles.empty}>Завантажую бібліотеку…</div> : null}
    {!loading && !assets.length ? <div className={styles.empty}><b>Бібліотека поки порожня.</b><span>Після першої генерації зображення авто воно з’явиться тут для перевірки.</span></div> : null}
    {!loading && assets.length > 0 && !visible.length ? <div className={styles.empty}>За цим фільтром нічого не знайдено.</div> : null}

    <div className={styles.grid}>
      {visible.map((asset) => {
        const state = badge(asset);
        const action = busy[asset.id];
        const preview = asset.status === "READY" && asset.imageMimeType;
        return <article className={styles.card} key={asset.id}>
          <div className={styles.preview}>
            {preview ? <img src={`/api/vehicle-images/${encodeURIComponent(asset.id)}?v=${encodeURIComponent(asset.updatedAt)}`} alt={`${asset.make} ${asset.model}`}/> : <div className={styles.previewFallback}>{asset.status === "GENERATING" ? "Генерація…" : asset.status === "ERROR" ? "Помилка генерації" : "Немає PNG"}</div>}
            <span className={`${styles.badge} ${state.className}`}>{state.label}</span>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.titleRow}>
              <div><h3>{asset.make} {asset.model}</h3><p>{asset.year || "Рік не вказано"}{asset.bodyType ? ` · ${asset.bodyType}` : ""}</p></div>
              <span className={styles.theme}>{themeText(asset.theme)}</span>
            </div>

            <dl className={styles.meta}>
              <div><dt>Джерело</dt><dd>{asset.provider === "MANUAL" ? "Вручну" : asset.providerModel || asset.provider}</dd></div>
              <div><dt>Розмір</dt><dd>{sizeText(asset.imageSizeBytes)}</dd></div>
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
      })}
    </div>
  </section>;
}
