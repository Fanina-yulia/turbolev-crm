"use client";

import { useEffect, useMemo, useState } from "react";
import { DocumentTemplateBuilder } from "./document-template-builder";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_CACHE_KEY,
  DEFAULT_CRM_APPEARANCE,
  applyCrmAppearance,
  loadCrmAppearance,
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

type ColorKey = keyof Pick<CrmAppearance, "accent" | "accentStrong" | "background" | "panel" | "panelRaised" | "text" | "muted" | "line" | "success" | "warning" | "danger" | "info">;

const COLOR_FIELDS: Array<{ key: ColorKey; label: string; description: string; group: "brand" | "surface" | "status" }> = [
  { key: "accent", label: "Основний акцент", description: "Кнопки, активні елементи та фірмовий помаранчевий.", group: "brand" },
  { key: "accentStrong", label: "Акцент при наведенні", description: "Hover, фокус і підсилені інтерактивні стани.", group: "brand" },
  { key: "background", label: "Фон робочої області", description: "Базовий фон усіх екранів CRM.", group: "surface" },
  { key: "panel", label: "Фон карток", description: "Картки, панелі, таблиці та контейнери.", group: "surface" },
  { key: "panelRaised", label: "Піднята поверхня", description: "Другий рівень контрасту для полів і вкладених блоків.", group: "surface" },
  { key: "text", label: "Основний текст", description: "Заголовки, значення та основна інформація.", group: "surface" },
  { key: "muted", label: "Другорядний текст", description: "Підписи, метадані та допоміжні пояснення.", group: "surface" },
  { key: "line", label: "Межі та розділювачі", description: "Границі карток, полів і рядків.", group: "surface" },
  { key: "success", label: "Успішний статус", description: "Підтверджено, виконано, доступно.", group: "status" },
  { key: "warning", label: "Статус уваги", description: "Попередження, очікування та потрібна дія.", group: "status" },
  { key: "danger", label: "Критичний статус", description: "Дефекти, помилки та блокуючі стани.", group: "status" },
  { key: "info", label: "Інформаційний статус", description: "Підказки, інформація та нейтральні акценти.", group: "status" },
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

function colorDrafts(value: CrmAppearance): Record<ColorKey, string> {
  return COLOR_FIELDS.reduce((result, field) => {
    result[field.key] = value[field.key];
    return result;
  }, {} as Record<ColorKey, string>);
}

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function AppearanceSettingsPanel() {
  const [appearance, setAppearance] = useState<CrmAppearance>(DEFAULT_CRM_APPEARANCE);
  const [savedAppearance, setSavedAppearance] = useState<CrmAppearance>(DEFAULT_CRM_APPEARANCE);
  const [draftColors, setDraftColors] = useState<Record<ColorKey, string>>(colorDrafts(DEFAULT_CRM_APPEARANCE));
  const [invalidColor, setInvalidColor] = useState<ColorKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void loadCrmAppearance()
      .then((loaded) => {
        if (!active) return;
        const next = loaded ?? DEFAULT_CRM_APPEARANCE;
        setAppearance(next);
        setSavedAppearance(next);
        setDraftColors(colorDrafts(next));
        applyCrmAppearance(next);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити оформлення."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  const invalidColorLabel = useMemo(() => COLOR_FIELDS.find((field) => field.key === invalidColor)?.label, [invalidColor]);

  function update(patch: Partial<CrmAppearance>) {
    setAppearance((current) => {
      const next = normalizeCrmAppearance({ ...current, ...patch });
      setDraftColors(colorDrafts(next));
      applyCrmAppearance(next);
      return next;
    });
    setDirty(true);
    setMessage("");
    setError("");
  }

  function updateColorText(key: ColorKey, value: string) {
    const nextValue = value.toUpperCase();
    setDraftColors((current) => ({ ...current, [key]: nextValue }));
    if (!isHexColor(nextValue)) {
      setInvalidColor(key);
      setMessage("");
      return;
    }
    setInvalidColor((current) => current === key ? null : current);
    update({ [key]: nextValue } as Partial<CrmAppearance>);
  }

  async function save(nextAppearance = appearance, success = "Глобальне оформлення збережено.") {
    if (invalidColor && nextAppearance === appearance) {
      setError(`Виправте колір «${invalidColorLabel || "поля"}» у форматі #RRGGBB.`);
      return;
    }
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
      setSavedAppearance(saved);
      setDraftColors(colorDrafts(saved));
      setInvalidColor(null);
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
    setAppearance(next); setDraftColors(colorDrafts(next)); setInvalidColor(null); setDirty(true); applyCrmAppearance(next);
    void save(next, `Стиль «${preset.label}» застосовано до CRM.`);
  }

  function cancelChanges() {
    setAppearance(savedAppearance);
    setDraftColors(colorDrafts(savedAppearance));
    setInvalidColor(null);
    applyCrmAppearance(savedAppearance);
    setDirty(false); setMessage("Незбережені зміни скасовано."); setError("");
  }

  function resetToDefault() {
    update({ ...DEFAULT_CRM_APPEARANCE, logoDataUrl: appearance.logoDataUrl, logoName: appearance.logoName });
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

  return <section className={styles.page} data-appearance-settings="true">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>НАЛАШТУВАННЯ · БРЕНД І UI</p><h1>Оформлення CRM</h1><span>Єдиний стиль для всіх сторінок, ролей і робочих кабінетів.</span></div>
      <div className={styles.headerActions}><span className={dirty ? styles.dirty : styles.saved}>{dirty ? "Є незбережені зміни" : "Синхронізовано"}</span>{dirty && <button className={styles.secondary} type="button" disabled={saving} onClick={cancelChanges}>Скасувати</button>}<button className={styles.primary} type="button" disabled={!dirty || saving || Boolean(invalidColor)} onClick={() => void save()}>{saving ? "Зберігаємо…" : "Зберегти зміни"}</button></div>
    </header>
    {message && <div className={styles.message} role="status">✓ {message}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}

    <div className={styles.scopeNote}><span className={styles.scopeIcon}>✓</span><div><strong>Глобальне оформлення</strong><p>Після збереження налаштування застосовуються до всіх розділів CRM, кабінету механіка, адаптивних екранів і публічних сервісних сторінок.</p></div><span className={styles.scopeStatus}>12 токенів · 4 стилі</span></div>

    <div className={styles.layout}>
      <div className={styles.mainColumn}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Готові стилі</h2><p>Оберіть варіант одним натисканням. Він одразу застосовується і зберігається для всієї CRM.</p></div><span className={styles.sectionHint}>4 варіанти</span></div>
          <div className={styles.presetGrid}>{APPEARANCE_PRESETS.map((preset) => <button key={preset.id} type="button" className={`${styles.preset} ${appearance.preset === preset.id ? styles.presetActive : ""}`} onClick={() => choosePreset(preset.id)} disabled={saving} aria-pressed={appearance.preset === preset.id}>
            <span className={styles.presetPreview} style={{ background: preset.background, borderColor: preset.line }}><i style={{ background: preset.accent }}/><b style={{ background: preset.panel }}/><em style={{ background: preset.panelRaised }}/></span>
            <span className={styles.presetCopy}><strong>{preset.label}</strong><small>{preset.description}</small></span><span className={styles.presetCheck}>{appearance.preset === preset.id ? "✓ Активний" : "Застосувати"}</span>
          </button>)}</div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Кольорова система</h2><p>Зміни використовуються в компонентах через спільні семантичні токени й не зникають після переходу між сторінками.</p></div><span className={styles.sectionHint}>HEX</span></div>
          <div className={styles.colorGroup}><h3>Бренд</h3><div className={styles.colorGrid}>{COLOR_FIELDS.filter((field) => field.group === "brand").map((field) => <ColorControl key={field.key} field={field} value={draftColors[field.key]} invalid={invalidColor === field.key} onTextChange={updateColorText} onPickerChange={(value) => { setInvalidColor(null); update({ [field.key]: value } as Partial<CrmAppearance>); }} />)}</div></div>
          <div className={styles.colorGroup}><h3>Поверхні та текст</h3><div className={styles.colorGrid}>{COLOR_FIELDS.filter((field) => field.group === "surface").map((field) => <ColorControl key={field.key} field={field} value={draftColors[field.key]} invalid={invalidColor === field.key} onTextChange={updateColorText} onPickerChange={(value) => { setInvalidColor(null); update({ [field.key]: value } as Partial<CrmAppearance>); }} />)}</div></div>
          <div className={styles.colorGroup}><h3>Статуси</h3><div className={styles.colorGrid}>{COLOR_FIELDS.filter((field) => field.group === "status").map((field) => <ColorControl key={field.key} field={field} value={draftColors[field.key]} invalid={invalidColor === field.key} onTextChange={updateColorText} onPickerChange={(value) => { setInvalidColor(null); update({ [field.key]: value } as Partial<CrmAppearance>); }} />)}</div></div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Типографіка та щільність</h2><p>Налаштування читаються на всіх сторінках: діагностика, клієнти, замовлення, склад, фінанси та звіти.</p></div></div>
          <div className={styles.settingsGrid}>
            <label className={styles.selectField}><span>Шрифт</span><select value={appearance.font} onChange={(event) => update({ font: event.target.value as AppearanceFont })}>{FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.sample}</option>)}</select></label>
            <label className={styles.selectField}><span>Режим</span><select value={appearance.themeMode} onChange={(event) => update({ themeMode: event.target.value as AppearanceThemeMode })}>{(["dark", "light", "auto"] as AppearanceThemeMode[]).map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}</select></label>
            <ChoiceField title="Розмір тексту" options={scaleOptions} value={appearance.scale} onChange={(value) => update({ scale: value })} />
            <ChoiceField title="Щільність блоків" options={densityOptions} value={appearance.density} onChange={(value) => update({ density: value })} />
            <fieldset className={styles.settingsFieldset}><legend>Радіус карток</legend><div className={styles.inlineChoices}>{radiusOptions.map((option) => <button type="button" key={option.value} className={appearance.radius === option.value ? styles.choiceActive : ""} onClick={() => update({ radius: option.value })} aria-pressed={appearance.radius === option.value}>{option.label}</button>)}</div></fieldset>
            <label className={styles.selectField}><span>Бічна панель</span><select value={appearance.sidebar} onChange={(event) => update({ sidebar: event.target.value as AppearanceSidebar })}><option value="expanded">Розгорнута</option><option value="compact">Компактна</option></select></label>
          </div>
          <div className={styles.resetRow}><span>Повернути базові параметри Turbo LEV, зберігши завантажений логотип.</span><button type="button" className={styles.secondary} onClick={resetToDefault}>Скинути стиль</button></div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><div><h2>Логотип компанії</h2><p>Логотип зберігається централізовано й підтягується в навігацію CRM на всіх сторінках.</p></div><span className={styles.sectionHint}>до 512 КБ</span></div>
          <div className={styles.logoEditor}><div className={styles.logoPreview}>{appearance.logoDataUrl ? <img src={appearance.logoDataUrl} alt={appearance.logoName || "Логотип компанії"}/> : <span>Turbo LEV</span>}</div><div className={styles.logoActions}><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readLogo(event.target.files?.[0])}/><b>Завантажити логотип</b><small>PNG, JPG або WebP · рекомендовано прозорий фон</small></label>{appearance.logoDataUrl && <button type="button" className={styles.secondary} onClick={() => update({ logoDataUrl: "", logoName: "" })}>Повернути логотип Turbo LEV</button>}</div></div>
        </section>
      </div>
    </div>
    <DocumentTemplateBuilder />
  </section>;
}

function ColorControl({ field, value, invalid, onTextChange, onPickerChange }: { field: typeof COLOR_FIELDS[number]; value: string; invalid: boolean; onTextChange: (key: ColorKey, value: string) => void; onPickerChange: (value: string) => void }) {
  return <label className={styles.colorField}><span><b>{field.label}</b><small>{field.description}</small>{invalid && <em>Формат: #RRGGBB</em>}</span><span className={styles.colorControl}><input aria-label={`${field.label}: вибір кольору`} type="color" value={isHexColor(value) ? value : "#000000"} onChange={(event) => onPickerChange(event.target.value)}/><input aria-label={`${field.label}: HEX`} type="text" value={value} maxLength={7} onChange={(event) => onTextChange(field.key, event.target.value)} aria-invalid={invalid}/></span></label>;
}

function ChoiceField<T extends string>({ title, options, value, onChange }: { title: string; options: Array<{ value: T; label: string; description: string }>; value: T; onChange: (value: T) => void }) {
  return <fieldset className={styles.settingsFieldset}><legend>{title}</legend><div className={styles.choiceRow}>{options.map((option) => <button type="button" key={option.value} className={value === option.value ? styles.choiceActive : ""} onClick={() => onChange(option.value)} aria-pressed={value === option.value}><b>{option.label}</b><small>{option.description}</small></button>)}</div></fieldset>;
}
