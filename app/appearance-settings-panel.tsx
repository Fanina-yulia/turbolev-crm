"use client";

import { useEffect, useState } from "react";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_CACHE_KEY,
  DEFAULT_CRM_APPEARANCE,
  applyCrmAppearance,
  normalizeCrmAppearance,
  type AppearanceDensity,
  type AppearanceFont,
  type AppearanceRadius,
  type AppearanceScale,
  type AppearanceSidebar,
  type AppearanceThemeMode,
  type CrmAppearance,
} from "@/src/ui/appearance";
import styles from "./appearance-settings-panel.module.css";

const COLOR_FIELDS: Array<{ key: keyof Pick<CrmAppearance, "accent" | "accentStrong" | "background" | "panel" | "panelRaised" | "text" | "muted" | "line">; label: string; description: string }> = [
  { key: "accent", label: "Основний акцент", description: "Кнопки, активні елементи та фірмовий помаранчевий." },
  { key: "accentStrong", label: "Акцент при наведенні", description: "Hover, фокус і підсилені інтерактивні стани." },
  { key: "background", label: "Фон робочої області", description: "Базовий фон усіх екранів CRM." },
  { key: "panel", label: "Фон карток", description: "Картки, панелі, таблиці та контейнери." },
  { key: "panelRaised", label: "Піднята поверхня", description: "Другий рівень контрасту для полів і вкладених блоків." },
  { key: "text", label: "Основний текст", description: "Заголовки, значення та основна інформація." },
  { key: "muted", label: "Другорядний текст", description: "Підписи, метадані та допоміжні пояснення." },
  { key: "line", label: "Межі та розділювачі", description: "Границі карток, полів і рядків." },
];

const FONT_OPTIONS: Array<{ value: AppearanceFont; label: string; sample: string }> = [
  { value: "system", label: "Системний", sample: "Segoe UI / системний" },
  { value: "inter", label: "Inter", sample: "Inter" },
  { value: "manrope", label: "Manrope", sample: "Manrope" },
];

const scaleOptions: Array<{ value: AppearanceScale; label: string; description: string }> = [
  { value: "compact", label: "Компактний", description: "13 px основний текст" },
  { value: "standard", label: "Стандартний", description: "14 px основний текст" },
  { value: "comfortable", label: "Комфортний", description: "15 px основний текст" },
];

const densityOptions: Array<{ value: AppearanceDensity; label: string; description: string }> = [
  { value: "compact", label: "Щільна", description: "Більше інформації на екрані" },
  { value: "standard", label: "Стандартна", description: "Збалансований робочий ритм" },
  { value: "comfortable", label: "Простора", description: "Більше повітря між блоками" },
];

const radiusOptions: Array<{ value: AppearanceRadius; label: string }> = [
  { value: "sharp", label: "Строгі" },
  { value: "standard", label: "Стандартні" },
  { value: "soft", label: "М'які" },
];

function optionLabel(value: AppearanceThemeMode) {
  return value === "dark" ? "Темна" : value === "light" ? "Світла" : "Як у системі";
}

export function AppearanceSettingsPanel() {
  const [appearance, setAppearance] = useState<CrmAppearance>(DEFAULT_CRM_APPEARANCE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/settings/appearance", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; appearance?: unknown; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити оформлення.");
        if (active) {
          const next = normalizeCrmAppearance(data.appearance);
          setAppearance(next);
          applyCrmAppearance(next);
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити оформлення."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function update(patch: Partial<CrmAppearance>) {
    const next = normalizeCrmAppearance({ ...appearance, ...patch });
    setAppearance(next);
    applyCrmAppearance(next);
    setDirty(true);
    setMessage("");
    setError("");
  }

  async function save(nextAppearance = appearance, success = "Глобальне оформлення збережено.") {
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/settings/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: nextAppearance }),
      });
      const data = await response.json() as { ok?: boolean; appearance?: unknown; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти оформлення.");
      const saved = normalizeCrmAppearance(data.appearance ?? nextAppearance);
      setAppearance(saved);
      applyCrmAppearance(saved);
      window.localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(saved));
      setDirty(false); setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося зберегти оформлення.");
    } finally { setSaving(false); }
  }

  function choosePreset(presetId: CrmAppearance["preset"]) {
    const preset = APPEARANCE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const next = normalizeCrmAppearance({ ...preset, logoDataUrl: appearance.logoDataUrl, logoName: appearance.logoName });
    setAppearance(next); setDirty(true); applyCrmAppearance(next); void save(next, `Стиль «${preset.label}» застосовано до CRM.`);
  }

  function readLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) { setError("Оберіть логотип у форматі PNG, JPG або WebP."); return; }
    if (file.size > 512 * 1024) { setError("Розмір логотипу не може перевищувати 512 КБ."); return; }
    const reader = new FileReader();
    reader.onload = () => update({ logoDataUrl: String(reader.result || ""), logoName: file.name });
    reader.onerror = () => setError("Не вдалося прочитати файл логотипу.");
    reader.readAsDataURL(file);
  }

  if (loading) return <section className={styles.page}><div className={styles.loading}>Завантажуємо глобальне оформлення…</div></section>;

  return <section className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>НАЛАШТУВАННЯ · БРЕНД І UI</p><h1>Оформлення CRM</h1><span>Єдиний стиль для всіх сторінок, ролей і робочих кабінетів.</span></div>
      <div className={styles.headerActions}><span className={dirty ? styles.dirty : styles.saved}>{dirty ? "Є незбережені зміни" : "Синхронізовано"}</span><button className={styles.primary} type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Зберігаємо…" : "Зберегти зміни"}</button></div>
    </header>
    {message && <div className={styles.message} role="status">✓ {message}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}

    <div className={styles.layout}>
      <div className={styles.mainColumn}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Готові стилі</h2><p>Оберіть варіант одним натисканням. Він одразу застосовується і зберігається для всієї CRM.</p></div><span className={styles.sectionHint}>4 варіанти</span></div>
          <div className={styles.presetGrid}>{APPEARANCE_PRESETS.map((preset) => <button key={preset.id} type="button" className={`${styles.preset} ${appearance.preset === preset.id ? styles.presetActive : ""}`} onClick={() => choosePreset(preset.id)} disabled={saving}>
            <span className={styles.presetPreview} style={{ background: preset.background, borderColor: preset.line }}><i style={{ background: preset.accent }}/><b style={{ background: preset.panel }}/><em style={{ background: preset.panelRaised }}/></span>
            <span className={styles.presetCopy}><strong>{preset.label}</strong><small>{preset.description}</small></span><span className={styles.presetCheck}>{appearance.preset === preset.id ? "✓ Активний" : "Застосувати"}</span>
          </button>)}</div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Кольорова система</h2><p>Зміни кольорів використовуються в компонентах через спільні семантичні токени.</p></div><span className={styles.sectionHint}>HEX</span></div>
          <div className={styles.colorGrid}>{COLOR_FIELDS.map((field) => <label className={styles.colorField} key={field.key}><span><b>{field.label}</b><small>{field.description}</small></span><span className={styles.colorControl}><input type="color" value={String(appearance[field.key])} onChange={(event) => update({ [field.key]: event.target.value } as Partial<CrmAppearance>)}/><input type="text" value={String(appearance[field.key])} maxLength={7} onChange={(event) => update({ [field.key]: event.target.value } as Partial<CrmAppearance>)}/></span></label>)}</div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Типографіка та щільність</h2><p>Налаштування читаються на всіх сторінках: діагностика, клієнти, замовлення, склад, фінанси та звіти.</p></div></div>
          <div className={styles.settingsGrid}>
            <label className={styles.selectField}><span>Шрифт</span><select value={appearance.font} onChange={(event) => update({ font: event.target.value as AppearanceFont })}>{FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.sample}</option>)}</select></label>
            <label className={styles.selectField}><span>Режим</span><select value={appearance.themeMode} onChange={(event) => update({ themeMode: event.target.value as AppearanceThemeMode })}>{(["dark", "light", "auto"] as AppearanceThemeMode[]).map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select></label>
            <fieldset className={styles.settingsFieldset}><legend>Розмір тексту</legend><div className={styles.choiceRow}>{scaleOptions.map((option) => <button type="button" key={option.value} className={appearance.scale === option.value ? styles.choiceActive : ""} onClick={() => update({ scale: option.value })}><b>{option.label}</b><small>{option.description}</small></button>)}</div></fieldset>
            <fieldset className={styles.settingsFieldset}><legend>Щільність блоків</legend><div className={styles.choiceRow}>{densityOptions.map((option) => <button type="button" key={option.value} className={appearance.density === option.value ? styles.choiceActive : ""} onClick={() => update({ density: option.value })}><b>{option.label}</b><small>{option.description}</small></button>)}</div></fieldset>
            <fieldset className={styles.settingsFieldset}><legend>Радіус карток</legend><div className={styles.inlineChoices}>{radiusOptions.map((option) => <button type="button" key={option.value} className={appearance.radius === option.value ? styles.choiceActive : ""} onClick={() => update({ radius: option.value })}>{option.label}</button>)}</div></fieldset>
            <label className={styles.selectField}><span>Бічна панель</span><select value={appearance.sidebar} onChange={(event) => update({ sidebar: event.target.value as AppearanceSidebar })}><option value="expanded">Розгорнута</option><option value="compact">Компактна</option></select></label>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Логотип компанії</h2><p>Логотип зберігається централізовано й підтягується в навігацію CRM на всіх сторінках.</p></div><span className={styles.sectionHint}>до 512 КБ</span></div>
          <div className={styles.logoEditor}><div className={styles.logoPreview}>{appearance.logoDataUrl ? <img src={appearance.logoDataUrl} alt={appearance.logoName || "Логотип компанії"}/> : <span>Turbo LEV</span>}</div><div className={styles.logoActions}><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readLogo(event.target.files?.[0])}/><b>Завантажити логотип</b><small>PNG, JPG або WebP · рекомендовано прозорий фон</small></label>{appearance.logoDataUrl && <button type="button" className={styles.secondary} onClick={() => update({ logoDataUrl: "", logoName: "" })}>Повернути логотип Turbo LEV</button>}</div></div>
        </section>
      </div>

      <aside className={styles.previewColumn}><div className={styles.previewSticky}><div className={styles.previewTitle}><span>Попередній перегляд</span><small>Живий приклад стилю</small></div><div className={styles.mockShell}><div className={styles.mockSidebar}><div className={styles.mockLogo}>{appearance.logoDataUrl ? <img src={appearance.logoDataUrl} alt=""/> : <b>Turbo LEV</b>}</div><i/><i className={styles.mockActive}/><i/><i/><i/></div><div className={styles.mockContent}><div className={styles.mockTop}><span/><span/><b/></div><h3>Діагностична карта</h3><div className={styles.mockVehicle}><div className={styles.mockCar}/><div><strong>Volkswagen Beetle</strong><small>2010 · VIN · ДК-2026-000003</small></div></div><div className={styles.mockCards}><div><b>Результат діагностики</b><strong>108/119</strong><small>Перевірено пунктів</small></div><div><b>Виявлені дефекти</b><strong>18</strong><small>Потребують уваги</small></div></div><div className={styles.mockButton}>Створити замовлення <span>→</span></div></div></div><div className={styles.tokenLegend}><span><i style={{ background: appearance.accent }}/>{appearance.accent}</span><span><i style={{ background: appearance.success }}/>{appearance.success}</span><span><i style={{ background: appearance.panel }}/>{appearance.panel}</span></div></div></aside>
    </div>
  </section>;
}
