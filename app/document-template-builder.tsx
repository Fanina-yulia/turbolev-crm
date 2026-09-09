"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ChangeEvent } from "react";
import { maskDocumentArticle } from "@/src/services/document-article-masking";
import styles from "./document-template-builder.module.css";
import compactStyles from "./document-template-builder-compact.module.css";

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

const DIAGNOSTIC_BLOCKS: Array<Pick<Block, "id" | "label">> = [
  { id: "identity", label: "Клієнт та автомобіль" },
  { id: "parts", label: "Деталі, що потребують заміни" },
  { id: "contacts", label: "Контакти станції" },
];

const REFERENCE_BLOCKS: Record<TemplateType, string[]> = {
  DIAGNOSTIC_CARD: [
    "Шапка: логотип, клієнт, автомобіль, VIN та дата",
    "Деталі до заміни: маскований артикул, бренд, назва та кількість",
    "Контакти Turbo LEV та футер",
  ],
  COMMERCIAL_PROPOSAL: [
  "Шапка: логотип, автомобіль, VIN та дата",
  "Запчастини: маскований артикул, бренд, найменування, ціна, кількість, сума",
  "Послуги: найменування, кількість, ціна та сума",
  "Загальна сума до сплати та QR-код",
  "Попередження, контакти Turbo LEV та футер",
  ],
};

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
      ? DIAGNOSTIC_BLOCKS
      : [
        { id: "identity", label: "Клієнт та автомобіль" },
        { id: "intro", label: "Вступний текст" },
        { id: "works", label: "Послуги" },
        { id: "parts", label: "Запчастини" },
        { id: "totals", label: "Підсумок та сума" },
        { id: "terms", label: "Умови та гарантія" },
        { id: "signature", label: "Підтвердження клієнта" },
        { id: "contacts", label: "Контакти станції" },
      ];
    updateSelected({
      title: templateLabel(selectedType),
      description: selectedType === "DIAGNOSTIC_CARD" ? "Перелік деталей до заміни автомобіля." : "Перелік запчастин і вартості послуг.",
      style: { ...selected.style, background: "plain", backgroundColor: "#FFFFFF", backgroundImageDataUrl: "", logo: "global", logoDataUrl: "" },
      blocks: blocks.map((block) => ({ id: block.id, label: block.label, visible: true })),
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
  const isReferenceDocument = selectedType === "DIAGNOSTIC_CARD";

  return <section className={styles.panel} data-document-template-builder="true">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>КОНСТРУКТОР ДОКУМЕНТІВ</p><h2>Діагностична карта та КП</h2><span>{isReferenceDocument ? "Діагностична карта містить лише перелік деталей до заміни. Дані підставляються CRM автоматично." : "Редагуйте структуру й оформлення документів. Дані автомобіля та діагностики підставляються CRM автоматично."}</span></div>
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

        <section className={styles.card}><div className={styles.cardTitle}><div><p>СТРУКТУРА</p><h3>Блоки документа</h3></div><span>{isReferenceDocument ? "Фіксований A4" : `${visibleBlocks.length}/${selected.blocks.length}`}</span></div>{isReferenceDocument ? <div className={styles.referenceNotice}><strong>Затверджена розкладка</strong>{REFERENCE_BLOCKS[selectedType].map((label, index) => <div className={styles.referenceRow} key={label}><span>{index + 1}</span><span>{label}</span></div>)}</div> : <div className={styles.blockList}>{selected.blocks.map((block, index) => <div className={`${styles.blockRow} ${block.visible ? "" : styles.blockHidden}`} key={block.id}><button type="button" className={styles.visibility} aria-label={`${block.visible ? "Сховати" : "Показати"} блок ${block.label}`} onClick={() => updateSelected({ blocks: selected.blocks.map((item) => item.id === block.id ? { ...item, visible: !item.visible } : item) })}>{block.visible ? "◉" : "○"}</button><span>{index + 1}. {block.label}</span><button type="button" className={styles.move} aria-label={`Перемістити ${block.label} вгору`} disabled={index === 0} onClick={() => updateSelected({ blocks: moveBlock(selected.blocks, index, -1) })}>↑</button><button type="button" className={styles.move} aria-label={`Перемістити ${block.label} вниз`} disabled={index === selected.blocks.length - 1} onClick={() => updateSelected({ blocks: moveBlock(selected.blocks, index, 1) })}>↓</button></div>)}</div>}</section>
        <button type="button" className={styles.saveDraft} disabled={!dirty || saving} onClick={() => void save("DRAFT")}>Зберегти як чернетку</button>
      </div>

      <div className={styles.previewColumn}><div className={styles.previewToolbar}><strong>Попередній перегляд</strong><span>A4 · HTML preview</span></div>{isReferenceDocument ? <DiagnosticCardReferencePreview/> : <article className={`${styles.document} ${styles[`font_${selected.style.font}`]}`} style={previewStyle}><header className={styles.documentHeader}>{selected.style.logo !== "none" && (logo ? <img src={logo} alt="Логотип шаблону"/> : <div className={styles.logoPlaceholder}>ТУРБО<br/><b>ЛЕВ</b></div>)}<div className={styles.documentHeading}><p>TURBO LEV · СЕРВІС</p><h1>{selected.title}</h1><span>{selected.description}</span></div><img className={styles.headerCar} src="/brand/turbo-lev-document-car.png" alt="Автомобіль"/></header><div className={styles.documentMeta}><span>ДАТА <b>05.09.2026</b></span><span>АВТОМОБІЛЬ <b>Peugeot Partner 2005</b></span><span>ДЕРЖ. НОМЕР <b>АЕ0914МН</b></span><span>VIN <b>Тестовий VIN</b></span><span>КЛІЄНТ <b>Юрій</b></span><span>МЕХАНІК <b>Микола Карабан</b></span></div><div className={styles.previewBlocks}>{visibleBlocks.map((block) => <PreviewBlock key={block.id} block={block} type={selectedType} accent={selected.style.accentColor}/>)}</div><footer className={styles.documentFooter}>{selected.style.footerText}<span>098 341 56 46 · turbolev.net</span></footer></article>}<p className={styles.previewHint}>{isReferenceDocument ? "Діагностична карта показує лише перелік деталей без вартості послуг, закупівельних цін і підсумків." : "Комерційна пропозиція містить деталі та окремий перелік послуг із ціною. Артикули для клієнта показуються з маскуванням."}</p></div>
    </div>
  </section>;
}

function DiagnosticCardReferencePreview() {
  const parts = [
    [maskDocumentArticle("113-1451X"), "QUICK BRAKE", "Направляюча переднього супорта Opel Astra J/Chevrolet Aveo 09-", "1"],
    [maskDocumentArticle("181513"), "ICER", "Колодки гальмівні передні Toyota Corolla 2001-2014", "1"],
    [maskDocumentArticle("818 0243 10"), "FAG", "Тяга переднього стабілізатора Citroen C4/C5/Berlingo/Peugeot 307", "1"],
    [maskDocumentArticle("181233-701"), "ICER", "Колодки гальмівні передні Mercedes-Benz A-Class W168", "1"],
    [maskDocumentArticle("738128"), "FRENKIT", "Ремкомплект заднього супорта Mercedes-Benz Vito W639", "2"],
    [maskDocumentArticle("208024"), "SOLGY", "Диск гальмівний задній Citroen Berlingo/Peugeot Partner", "2"],
  ];
  return <article className={styles.referenceDocument}>
    <div className={styles.referenceCorner}/>
    <header className={styles.referenceHeader}>
      <div className={styles.referencePanorama}>
        <img className={styles.referenceBrandLogo} src="/brand/turbo-lev-document-logo.png" alt="Турбо Лев"/>
        <img className={styles.referenceCar} src="/brand/turbo-lev-document-car-panorama.png" alt="Автомобіль"/>
        <div className={styles.referenceMotion} aria-hidden="true"><i/><i/><i/></div>
      </div>
      <div className={styles.referenceHeading}><h1>ДІАГНОСТИЧНА КАРТА</h1><strong>ПЕРЕЛІК ДЕТАЛЕЙ ДО ЗАМІНИ</strong></div>
    </header>
    <div className={styles.referenceMeta}><span>Автомобіль: <b>Citroen C3</b></span><span>VIN: <b>VF7SXHNVTKT682038</b></span><span>Дата: <b>05.08.2026</b></span></div>
    <ReferenceTable title="ДЕТАЛІ ДО ЗАМІНИ" columns={["№", "Артикул", "Бренд", "Найменування", "Кільк."]} rows={parts} variant="parts"/>
    <p className={styles.referenceWarning}>Артикулі у клієнтському документі замасковані: останні три цифри замінено на ###.</p>
    <footer className={styles.referenceFooter}><span>098 341 56 46</span><b>Глеваха, вул. Окружна, 55 Г</b><span>turbolev.net</span></footer>
  </article>;
}

function CommercialProposalReferencePreview() {
  const parts = [
    [maskDocumentArticle("113-1451X"), "QUICK BRAKE", "Направляюча переднього супорта Opel Astra J/Chevrolet Aveo 09-", "523.00", "1", "523.00"],
    [maskDocumentArticle("181513"), "ICER", "Колодки гальмівні передні Toyota Corolla 2001-2014", "786.00", "1", "786.00"],
    [maskDocumentArticle("818 0243 10"), "FAG", "Тяга переднього стабілізатора Citroen C4/C5/Berlingo/Peugeot 307", "558.00", "1", "558.00"],
    [maskDocumentArticle("181233-701"), "ICER", "Колодки гальмівні передні Mercedes-Benz A-Class W168", "1 204.00", "1", "1 204.00"],
    [maskDocumentArticle("738128"), "FRENKIT", "Ремкомплект заднього супорта Mercedes-Benz Vito W639", "1 041.00", "2", "2 082.00"],
    [maskDocumentArticle("208024"), "SOLGY", "Диск гальмівний задній Citroen Berlingo/Peugeot Partner", "2 817.00", "2", "5 634.00"],
  ];
  const works = [
    ["1", "Обслуговування направляючих переднього супорта", "1", "600.00", "600.00"],
    ["2", "Заміна передніх гальмівних колодок", "1", "1 200.00", "1 200.00"],
    ["3", "Заміна передньої тяги стабілізатора", "1", "600.00", "600.00"],
    ["4", "Ремонт задніх гальмівних супортів", "2", "1 200.00", "2 400.00"],
    ["5", "Заміна задніх гальмівних дисків", "1", "1 200.00", "1 200.00"],
  ];
  return <article className={styles.referenceDocument}>
    <div className={styles.referenceCorner}/>
    <header className={`${styles.referenceHeader} ${compactStyles.compactReferenceHeader}`}>
      <div className={`${styles.referencePanorama} ${compactStyles.compactReferencePanorama}`}>
        <img className={`${styles.referenceBrandLogo} ${compactStyles.compactBrandLogo}`} src="/brand/turbo-lev-document-logo.png" alt="Турбо Лев"/>
        <span className={compactStyles.referenceCarFallback} aria-label="Резервне зображення автомобіля">
          <svg viewBox="0 0 180 82" aria-hidden="true"><path d="M19 53c3-9 9-15 18-17l20-5 14-15c4-4 9-6 15-6h33c7 0 12 2 17 7l13 14 15 4c8 2 13 8 14 16l1 8h-14a16 16 0 0 1-31 0H57a16 16 0 0 1-31 0H15l4-6Z"/><path className={compactStyles.referenceGlass} d="M65 31l12-13c2-2 5-3 9-3h13v16H65Zm40 0V15h14c4 0 7 1 10 4l11 12h-35Z"/><circle cx="42" cy="59" r="10"/><circle cx="149" cy="59" r="10"/></svg>
        </span>
        <div className={`${styles.referenceMotion} ${compactStyles.compactMotion}`} aria-hidden="true"><i/><i/><i/></div>
      </div>
      <div className={`${styles.referenceHeading} ${compactStyles.compactHeading}`}><h1>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</h1><strong>ЗАПЧАСТИНИ ТА ВАРТІСТЬ ПОСЛУГ</strong></div>
    </header>
    <div className={styles.referenceMeta}><span>Автомобіль: <b>Citroen C3</b></span><span>VIN: <b>VF7SXHNVTKT682038</b></span><span>Дата: <b>05.08.2026</b></span></div>
    <ReferenceTable title="ЗАПЧАСТИНИ" columns={["Артикул", "Бренд", "Найменування", "Ціна/шт.", "Кільк.", "Сума"]} rows={parts} variant="parts" total={"10 787.00"}/>
    <ReferenceTable title="ПОСЛУГИ" columns={["№", "Найменування послуг", "Кільк.", "Ціна", "Сума"]} rows={works} variant="works" total={"6 000.00"}/>
    <div className={styles.referenceTotal}><div><strong>₴</strong><span>Загальна сума пропозиції:<b>16 787.00 <small>грн</small></b></span></div><div className={styles.referenceQr}><img src="/brand/turbo-lev-contact-qr.png" alt="QR-код"/><span><b>Скануй QR</b>для зв'язку<strong>turbolev.net</strong></span></div></div>
    <p className={styles.referenceWarning}>Ціни наведені для погодження ремонту. Остаточна сумісність кожної деталі перевіряється за VIN автомобіля перед установленням.</p>
    <footer className={styles.referenceFooter}><span>098 341 56 46</span><b>Глеваха, вул. Окружна, 55 Г</b><span>turbolev.net</span></footer>
  </article>;
}

function ReferenceTable({ title, columns, rows, total, variant = "parts" }: { title: string; columns: string[]; rows: string[][]; total?: string; variant?: "parts" | "works" }) {
  return <section className={styles.referenceTableSection}><h2>{title}</h2><div className={`${styles.referenceTable} ${variant === "works" ? styles.referenceWorkTable : variant === "parts" && columns.length === 5 ? styles.referencePartsTable : ""}`}><div className={styles.referenceTableHead}>{columns.map((column) => <span key={column}>{column}</span>)}</div>{rows.map((row, rowIndex) => <div className={styles.referenceTableRow} key={`${title}-${rowIndex}`}>{row.map((cell, cellIndex) => <span key={`${rowIndex}-${cellIndex}`}>{cell}</span>)}</div>)}{total ? <div className={styles.referenceTableTotal}><span>Всього {title.toLowerCase()}:</span><b>{columns.length === 6 ? "8" : ""}</b><strong>{total}</strong></div> : null}</div></section>;
}

function PreviewBlock({ block, type, accent }: { block: Block; type: TemplateType; accent: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    identity: { title: "Клієнт та автомобіль", body: "Peugeot Partner 2005 · АЕ0914МН · VIN · пробіг · контакт клієнта" },
    intro: { title: "Вступний текст", body: "Підготували перелік запчастин і послуг для вашого автомобіля." },
    works: { title: "Послуги", body: "Заміна сайлентблока · 1 шт. · 600,00 грн" },
    parts: { title: "Запчастини", body: `Сайлентблок переднього важеля · Артикул ${maskDocumentArticle("181513")} · 1 шт. · 786,00 грн` },
    totals: { title: "Підсумок та сума", body: "Послуги: 600,00 грн · Запчастини: 786,00 грн · Разом: 1 386,00 грн" },
    terms: { title: "Умови та гарантія", body: "Термін дії пропозиції та гарантійні умови станції." },
    signature: { title: "Підтвердження клієнта", body: "Погодження комерційної пропозиції" },
    contacts: { title: "Контакти станції", body: "098 341 56 46 · turbolev.net · Глеваха / Одеська траса" },
  };
  const value = copy[block.id] || { title: block.label, body: "Дані цього блока будуть підставлені з CRM." };
  return <section className={styles.previewBlock} style={{ borderLeftColor: accent }}><h3>{value.title}</h3><p>{value.body}</p></section>;
}
