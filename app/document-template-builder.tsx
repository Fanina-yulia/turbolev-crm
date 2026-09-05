"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ChangeEvent } from "react";
import styles from "./document-template-builder.module.css";

type TemplateType = "DIAGNOSTIC_CARD" | "COMMERCIAL_PROPOSAL";
type TemplateStatus = "DRAFT" | "PUBLISHED";
type TemplateFont = "system" | "inter" | "manrope";
type TemplateBackground = "plain" | "brand" | "image";
type TemplateLogo = "global" | "custom" | "none";
type Block = { id: string; label: string; visible: boolean };
type TemplateStyle = {
  font: TemplateFont;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  background: TemplateBackground;
  backgroundColor: string;
  backgroundImageDataUrl: string;
  logo: TemplateLogo;
  logoDataUrl: string;
  footerText: string;
};
type Template = {
  type: TemplateType;
  title: string;
  description: string;
  status: TemplateStatus;
  version: number;
  style: TemplateStyle;
  blocks: Block[];
};
type ApiResponse = { ok?: boolean; templates?: Template[]; error?: string };

const TYPE_LABEL: Record<TemplateType, string> = {
  DIAGNOSTIC_CARD: "Діагностична карта",
  COMMERCIAL_PROPOSAL: "Комерційна пропозиція",
};

const FONT_LABEL: Record<TemplateFont, string> = {
  system: "Системний",
  inter: "Inter",
  manrope: "Manrope",
};

const BACKGROUND_LABEL: Record<TemplateBackground, string> = {
  plain: "Білий",
  brand: "Фірмовий",
  image: "Зображення",
};

const LOGO_LABEL: Record<TemplateLogo, string> = {
  global: "Глобальний логотип CRM",
  custom: "Логотип цього шаблону",
  none: "Без логотипа",
};

function templateLabel(type: TemplateType) { return TYPE_LABEL[type]; }

function moveBlock(blocks: Block[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function readImage(event: ChangeEvent<HTMLInputElement>, onDone: (value: string) => void, onError: (message: string) => void) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
    onError("Оберіть зображення у форматі PNG, JPG або WebP.");
    return;
  }
  if (file.size > 1024 * 1024) {
    onError("Зображення не може перевищувати 1 МБ.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => onDone(String(reader.result || ""));
  reader.onerror = () => onError("Не вдалося прочитати зображення.");
  reader.readAsDataURL(file);
}

export function DocumentTemplateBuilder() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedType, setSelectedType] = useState<TemplateType>("DIAGNOSTIC_CARD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => templates.find((template) => template.type === selectedType) || null,
    [selectedType, templates],
  );

  useEffect(() => {
    let active = true;
    void fetch("/api/settings/document-templates", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as ApiResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити шаблони документів.");
        if (active) setTemplates(data.templates || []);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Помилка завантаження."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function updateSelected(patch: Partial<Template>) {
    setTemplates((current) => current.map((template) => template.type === selectedType ? { ...template, ...patch } : template));
    setDirty(true);
    setMessage("");
    setError("");
  }

  function updateStyle(patch: Partial<TemplateStyle>) {
    if (!selected) return;
    updateSelected({ style: { ...selected.style, ...patch } });
  }

  async function save(status: TemplateStatus) {
    if (!selected) return;
    setSaving(true); setError(""); setMessage("");
    const nextTemplates = templates.map((template) => template.type === selectedType
      ? { ...template, status, version: status === "PUBLISHED" ? template.version + 1 : template.version }
      : template);
    try {
      const response = await fetch("/api/settings/document-templates", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templates: nextTemplates }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося зберегти шаблон.");
      setTemplates(data.templates || nextTemplates);
      setDirty(false);
      setMessage(status === "PUBLISHED" ? "Шаблон опубліковано для нових документів." : "Чернетку шаблону збережено.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Помилка збереження.");
    } finally { setSaving(false); }
  }

  function resetSelected() {
    if (!selected || !window.confirm(`Повернути стандартну структуру «${templateLabel(selectedType)}»?`)) return;
    const blocks = selectedType === "DIAGNOSTIC_CARD"
      ? ["Клієнт та автомобіль", "Загальний висновок", "Результати перевірки", "Виявлені несправності", "Деталі, що потребують заміни", "Фото та докази", "Рекомендації механіка", "Механік та дата", "Контакти станції"]
      : ["Клієнт та автомобіль", "Вступний текст", "Роботи", "Запчастини", "Підсумок та сума", "Умови та гарантія", "Підтвердження клієнта", "Контакти станції"];
    updateSelected({
      title: templateLabel(selectedType),
      description: selectedType === "DIAGNOSTIC_CARD" ? "Результати проведеної діагностики автомобіля." : "Перелік робіт, запчастин і вартості ремонту.",
      style: { ...selected.style, background: "plain", backgroundColor: "#FFFFFF", backgroundImageDataUrl: "", logo: "global", logoDataUrl: "" },
      blocks: blocks.map((label, index) => ({ id: `block-${index + 1}`, label, visible: true })),
    });
  }

  if (loading) return <section className={styles.panel}><div className={styles.loading}>Завантажуємо конструктор документів…</div></section>;
  if (!selected) return <section className={styles.panel}><div className={styles.error}>Шаблони документів недоступні.</div></section>;

  const previewStyle = {
    "--doc-accent": selected.style.accentColor,
    "--doc-text": selected.style.textColor,
    "--doc-muted": selected.style.mutedColor,
    backgroundColor: selected.style.background === "brand" ? `${selected.style.accentColor}12` : selected.style.backgroundColor,
    backgroundImage: selected.style.background === "image" && selected.style.backgroundImageDataUrl ? `url(${selected.style.backgroundImageDataUrl})` : undefined,
  } as CSSProperties;
  const visibleBlocks = selected.blocks.filter((block) => block.visible);
  const logo = selected.style.logo === "custom" ? selected.style.logoDataUrl : null;

  return <section className={styles.panel} data-document-template-builder="true">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>КОНСТРУКТОР ДОКУМЕНТІВ</p><h2>Діагностична карта та КП</h2><span>Редагуйте структуру й оформлення документів. Дані автомобіля та діагностики підставляються CRM автоматично.</span></div>
      <div className={styles.headingActions}><span className={dirty ? styles.dirty : styles.saved}>{dirty ? "Є незбережені зміни" : `Версія ${selected.version}`}</span><button type="button" className={styles.secondary} onClick={resetSelected}>Стандартна структура</button><button type="button" className={styles.primary} disabled={!dirty || saving} onClick={() => void save("PUBLISHED")}>{saving ? "Зберігаємо…" : "Опублікувати"}</button></div>
    </div>
    {message && <div className={styles.message} role="status">✓ {message}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}

    <div className={styles.tabs} role="tablist" aria-label="Тип документа">
      {(Object.keys(TYPE_LABEL) as TemplateType[]).map((type) => <button key={type} type="button" role="tab" aria-selected={selectedType === type} className={selectedType === type ? styles.tabActive : ""} onClick={() => { setSelectedType(type); setMessage(""); setError(""); }}>{TYPE_LABEL[type]}<small>{templates.find((template) => template.type === type)?.status === "PUBLISHED" ? "Опубліковано" : "Чернетка"}</small></button>)}
    </div>

    <div className={styles.editorLayout}>
      <div className={styles.controls}>
        <section className={styles.card}><div className={styles.cardTitle}><div><p>ШАБЛОН</p><h3>Основні дані</h3></div><span>{selected.status === "PUBLISHED" ? "Активний" : "Чернетка"}</span></div><label><span>Назва документа</span><input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })}/></label><label><span>Опис під заголовком</span><textarea rows={2} value={selected.description} onChange={(event) => updateSelected({ description: event.target.value })}/></label></section>

        <section className={styles.card}><div className={styles.cardTitle}><div><p>ФІРМОВИЙ СТИЛЬ</p><h3>Шапка та сторінка</h3></div></div><div className={styles.fieldGrid}><label><span>Шрифт</span><select value={selected.style.font} onChange={(event) => updateStyle({ font: event.target.value as TemplateFont })}>{(Object.keys(FONT_LABEL) as TemplateFont[]).map((font) => <option key={font} value={font}>{FONT_LABEL[font]}</option>)}</select></label><label><span>Логотип</span><select value={selected.style.logo} onChange={(event) => updateStyle({ logo: event.target.value as TemplateLogo })}>{(Object.keys(LOGO_LABEL) as TemplateLogo[]).map((logoKey) => <option key={logoKey} value={logoKey}>{LOGO_LABEL[logoKey]}</option>)}</select></label><label><span>Акцент</span><span className={styles.colorInput}><input type="color" value={selected.style.accentColor} onChange={(event) => updateStyle({ accentColor: event.target.value })}/><input value={selected.style.accentColor} maxLength={7} onChange={(event) => updateStyle({ accentColor: event.target.value })}/></span></label><label><span>Колір тексту</span><span className={styles.colorInput}><input type="color" value={selected.style.textColor} onChange={(event) => updateStyle({ textColor: event.target.value })}/><input value={selected.style.textColor} maxLength={7} onChange={(event) => updateStyle({ textColor: event.target.value })}/></span></label></div>{selected.style.logo === "custom" && <label className={styles.upload}><span>Власний логотип шаблону</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readImage(event, (value) => updateStyle({ logoDataUrl: value }), setError)}/><small>PNG, JPG або WebP · до 1 МБ</small></label>}<label><span>Текст у нижньому колонтитулі</span><input value={selected.style.footerText} onChange={(event) => updateStyle({ footerText: event.target.value })}/></label></section>

        <section className={styles.card}><div className={styles.cardTitle}><div><p>ФОН</p><h3>Оформлення сторінки</h3></div></div><div className={styles.segmented}>{(Object.keys(BACKGROUND_LABEL) as TemplateBackground[]).map((background) => <button key={background} type="button" className={selected.style.background === background ? styles.choiceActive : ""} onClick={() => updateStyle({ background })}>{BACKGROUND_LABEL[background]}</button>)}</div>{selected.style.background !== "image" && <label><span>Колір фону</span><span className={styles.colorInput}><input type="color" value={selected.style.backgroundColor} onChange={(event) => updateStyle({ backgroundColor: event.target.value })}/><input value={selected.style.backgroundColor} maxLength={7} onChange={(event) => updateStyle({ backgroundColor: event.target.value })}/></span></label>}{selected.style.background === "image" && <label className={styles.upload}><span>Фонове зображення</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readImage(event, (value) => updateStyle({ backgroundImageDataUrl: value }), setError)}/><small>Зображення використовується з низькою інтенсивністю для читабельності тексту.</small></label>}</section>

        <section className={styles.card}><div className={styles.cardTitle}><div><p>СТРУКТУРА</p><h3>Блоки документа</h3></div><span>{visibleBlocks.length}/{selected.blocks.length}</span></div><div className={styles.blockList}>{selected.blocks.map((block, index) => <div className={`${styles.blockRow} ${block.visible ? "" : styles.blockHidden}`} key={block.id}><button type="button" className={styles.visibility} aria-label={`${block.visible ? "Сховати" : "Показати"} блок ${block.label}`} onClick={() => updateSelected({ blocks: selected.blocks.map((item) => item.id === block.id ? { ...item, visible: !item.visible } : item) })}>{block.visible ? "◉" : "○"}</button><span>{index + 1}. {block.label}</span><button type="button" className={styles.move} aria-label={`Перемістити ${block.label} вгору`} disabled={index === 0} onClick={() => updateSelected({ blocks: moveBlock(selected.blocks, index, -1) })}>↑</button><button type="button" className={styles.move} aria-label={`Перемістити ${block.label} вниз`} disabled={index === selected.blocks.length - 1} onClick={() => updateSelected({ blocks: moveBlock(selected.blocks, index, 1) })}>↓</button></div>)}</div></section>
        <button type="button" className={styles.saveDraft} disabled={!dirty || saving} onClick={() => void save("DRAFT")}>Зберегти як чернетку</button>
      </div>

      <div className={styles.previewColumn}><div className={styles.previewToolbar}><strong>Попередній перегляд</strong><span>A4 · HTML preview</span></div><article className={`${styles.document} ${styles[`font_${selected.style.font}`]}`} style={previewStyle}><header className={styles.documentHeader}>{selected.style.logo !== "none" && (logo ? <img src={logo} alt="Логотип шаблону"/> : <div className={styles.logoPlaceholder}>ТУРБО<br/><b>ЛЕВ</b></div>)}<div><p>{selectedType === "DIAGNOSTIC_CARD" ? "TURBO LEV · АВТОСЕРВІС" : "TURBO LEV · СЕРВІС"}</p><h1>{selected.title}</h1><span>{selected.description}</span></div></header><div className={styles.documentMeta}><span>ДАТА <b>05.09.2026</b></span><span>АВТОМОБІЛЬ <b>Peugeot Partner 2005</b></span><span>ДЕРЖ. НОМЕР <b>АЕ0914МН</b></span><span>VIN <b>Тестовий VIN</b></span><span>КЛІЄНТ <b>Юрій</b></span><span>МЕХАНІК <b>Микола Карабан</b></span></div><div className={styles.previewBlocks}>{visibleBlocks.map((block) => <PreviewBlock key={block.id} block={block} type={selectedType} accent={selected.style.accentColor}/>)}</div><footer className={styles.documentFooter}>{selected.style.footerText}<span>Документ сформовано CRM</span></footer></article><p className={styles.previewHint}>Попередній перегляд використовує демонстраційні дані. У реальному документі CRM підставить дані конкретної діагностики або КП.</p></div>
    </div>
  </section>;
}

function PreviewBlock({ block, type, accent }: { block: Block; type: TemplateType; accent: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    identity: { title: "Клієнт та автомобіль", body: "Peugeot Partner 2005 · АЕ0914МН · VIN · пробіг · контакт клієнта" },
    summary: { title: "Загальний висновок", body: "Виявлено 2 зауваження. Одна позиція потребує першочергової уваги." },
    inspections: { title: type === "DIAGNOSTIC_CARD" ? "Результати перевірки" : "Роботи", body: type === "DIAGNOSTIC_CARD" ? "Передня підвіска · Норма / Увага / Додаткова діагностика" : "Заміна мастила · Діагностика ходової · Регулювання" },
    findings: { title: "Виявлені несправності", body: "Передній правий сайлентблок · рекомендована заміна" },
    parts: { title: type === "DIAGNOSTIC_CARD" ? "Деталі, що потребують заміни" : "Запчастини", body: "Сайлентблок · 2 шт. · статус: рекомендовано" },
    media: { title: "Фото та докази", body: "Фото вузлів і результати вимірювань будуть підставлені з діагностики." },
    conclusion: { title: "Рекомендації механіка", body: "Рекомендується погодити ремонт і повторно перевірити вузол після виконання робіт." },
    intro: { title: "Вступний текст", body: "Підготували перелік робіт і запчастин для вашого автомобіля." },
    totals: { title: "Підсумок та сума", body: "Роботи: 0,00 грн · Запчастини: 0,00 грн · Разом: 0,00 грн" },
    terms: { title: "Умови та гарантія", body: "Термін дії пропозиції та гарантійні умови станції." },
    signature: { title: type === "DIAGNOSTIC_CARD" ? "Механік та дата" : "Підтвердження клієнта", body: type === "DIAGNOSTIC_CARD" ? "Микола Карабан · 05.09.2026" : "Підтвердження клієнта" },
    contacts: { title: "Контакти станції", body: "098 341 56 46 · turbolev.net · Глеваха / Одеська траса" },
  };
  const value = copy[block.id] || { title: block.label, body: "Дані цього блока будуть підставлені з CRM." };
  return <section className={styles.previewBlock} style={{ borderLeftColor: accent }}><h3>{value.title}</h3><p>{value.body}</p></section>;
}
