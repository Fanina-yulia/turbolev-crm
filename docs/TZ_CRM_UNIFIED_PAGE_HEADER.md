# Технічне завдання — CRM-UI-006 Unified Page Header

**Проєкт:** Turbo LEV CRM  
**Стандарт:** `CRM-UI-006`  
**Статус:** ACTIVE  
**Дата:** 2026-10-07  
**Область:** усі внутрішні сторінки CRM, що рендеряться через canonical `CrmShell`.  
**Виключення:** standalone Кабінет механіка, auth, public/client surfaces.

## 1. Мета

Усі внутрішні сторінки CRM повинні мати одну візуальну систему шапки. Назва сторінки, eyebrow, опис, actions, tabs і context controls не повинні відрізнятися за типографікою та базовою геометрією між модулями.

Проблема, яку усуває стандарт:

- різні розміри H1: 26/27/28/30/31/38px;
- різні eyebrow: 11/12px, різний letter-spacing, різний колір;
- різні horizontal/vertical paddings;
- різний порядок `tabs / title / filters`;
- локальні товсті divider-и та module-specific header styles;
- окремі сторінки виглядають як різні продукти.

## 2. Канонічна композиція

Порядок елементів:

1. Eyebrow.
2. Title + actions.
3. Description.
4. Primary tabs.
5. Context controls / period / filters.

Візуально:

```text
TURBO LEV · НАЗВА МОДУЛЯ                     [Secondary] [+ Primary]
Назва сторінки
Коротке пояснення призначення сторінки
────────────────────────────────────────────────────────────
[Вкладка] [Вкладка] [Вкладка]
[Період / станція / пошук / режим]
```

## 3. Канонічний компонент

Єдиний компонент:

`app/crm-page-header.tsx`

API:

```tsx
<CrmPageHeader
  eyebrow="TURBO LEV · ЦЕНТР УПРАВЛІННЯ"
  title="Аналітика"
  description="..."
  actions={...}
  tabs={...}
  controls={...}
/>
```

Заборонено створювати нові top-level header-композиції з локальними `h1` і eyebrow замість цього компонента.

## 4. Типографіка

Desktop internal CRM:

- H1: **28px**;
- H1 line-height: **1.08**;
- H1 weight: **780**;
- H1 letter-spacing: **-0.03em**;
- eyebrow: **11px**;
- eyebrow weight: **850**;
- eyebrow letter-spacing: **0.11em**;
- eyebrow: uppercase;
- eyebrow color: `var(--orange)`;
- description: **12px**, `var(--muted)`, line-height 1.42.

Після CRM-UI-005 scale 0.90 фактичний фізичний H1 приблизно 25.2px, але design token залишається 28px.

## 5. Geometry

- header top padding: 6px;
- header bottom padding: 9px;
- eyebrow → title: 3px;
- title → description: 4px;
- slots gap: 8px;
- actions gap: 8px;
- top row gap: 18px;
- divider: **1px `var(--line)`**;
- ніяких 2–3px чорних ліній у top-level header;
- outer horizontal page padding належить тільки canonical workspace: **24px design token** (`--crm-page-gutter`; ~21.6px фізично після CRM-UI-005);
- page/module root із `CrmPageHeader` **не має права** додавати другий `padding-top/left/right` навколо шапки.

## 6. Actions

Canonical desktop geometry:
- action height: **40px**;
- action font: **12px / 800**;
- radius: **10px**;
- horizontal padding: **14px**.

- primary action справа;
- secondary actions справа перед primary;
- refresh є secondary;
- actions не змінюють H1 alignment;
- при вузькому viewport actions можуть wrap;
- fixed/floating page-level buttons не замінюють header actions, якщо дія логічно належить сторінці.

## 7. Tabs

Canonical desktop geometry:
- primary/context tab height: **36px**;
- tab/control font: **12px / 800**;
- radius: **10px**;
- horizontal padding: **12px**;
- gap: **6px**;
- active accent: canonical **orange**; модулі не вводять власний синій/інший accent для top-level header navigation.

Primary module tabs розташовуються **після title/description**.

Заборонено:

- module tabs над H1;
- tabs перед eyebrow;
- tabs у випадковому правому блоці header, якщо вони перемикають основний контент сторінки.

Допускається secondary segmented control усередині context controls, якщо це режим представлення, а не module tab.

## 8. Context controls

Input/select/button у header context controls мають ту саму design-height **36px**, radius **10px**, font-size **12px**. На mobile touch-height = **40px**.

Після primary tabs:

- period;
- date range;
- location;
- search;
- view mode;
- status filters.

Controls не повинні дублювати primary actions.

## 9. Мапа модулів

Обов'язково привести до CRM-UI-006:

- Overview / role dashboards;
- Attention Center;
- Communications;
- Clients;
- Vehicles;
- Planner;
- Diagnostics;
- Work Journal;
- Work Orders / Commercial Proposal;
- Warranties;
- Parts;
- Procurement / Reconciliation;
- Financial Center;
- Payments;
- Analytics;
- Settings frames;
- Personnel;
- Diagnostic Templates;
- Workflow;
- Roles & Access;
- Appearance;
- Cameras;
- Integrations;
- Parts Catalog;
- Price Catalog.

## 10. Спеціальні рішення

### Analytics
Візуальна база стандарту. Перевести header/tabs/filters у shared component.

### Procurement
Поточні `Операційна черга / Reconciliation` не можуть стояти над H1. Tabs мають бути передані дочірньому workspace і відображатися відразу після canonical header.

### Finance
Прибрати залежність H1 від browser/default heading style. Eyebrow має бути canonical orange. Порядок: header → tabs → filters.

### Settings
Top-level page title у кожній settings-вкладці є H1 canonical header. Внутрішні editor section titles залишаються H2/H3.

## 11. Scope guard

Standalone Mechanic Cabinet не мігрується на `CrmPageHeader`.

Auth/public/client pages також не входять у стандарт.

## 12. QA

Перевірити при browser 100%, CRM-UI-005=0.90:

- 1920×1080;
- 1440×900;
- 1366×768;
- 1280×720;
- 1024×768.

Перевірити:

1. усі H1 візуально однакові;
2. eyebrow однаковий;
3. title baseline однаковий;
4. actions справа;
5. tabs після title;
6. divider 1px;
7. filters після tabs;
8. header не перекривається rail/sidebar;
9. немає horizontal body scroll;
10. sticky/page-owned scroll з CRM-UI-004 не ламається;
11. scale CRM-UI-005 не ламається.

## 13. Acceptance criteria

1. Жодна основна internal CRM page не використовує самостійний top-level H1 header замість canonical component.
2. H1 design size = 28px.
3. Eyebrow = 11px orange uppercase.
4. Description = 12px muted.
5. Procurement tabs більше не стоять над title.
6. Finance tabs стоять перед filters.
7. Settings editor pages мають H1, а не H2, на верхньому рівні.
8. Mechanic Cabinet не змінений.
9. Public/auth surfaces не змінені.
10. Production checks проходять.


## 14. V2 — visual lock (2026-10-07)

CRM-UI-006 V2 усуває ситуацію, коли сторінки технічно використовують `CrmPageHeader`, але локальні CSS модулів усе одно роблять шапки візуально різними.

Обов'язкові правила V2:

1. `CrmPageHeader` має `data-crm-page-header-version="2"`.
2. H1 / eyebrow / description задаються тільки canonical header stylesheet.
3. Header actions, primary tabs і context controls отримують canonical height/font/radius на рівні shared component; локальні модулі визначають лише semantic tone/active state.
4. Workspace володіє outer gutter. Root конкретної сторінки не додає другий top/left/right inset навколо canonical header.
5. Dashboard global `+ Нова заявка` не створює окремий вертикальний рядок і не зсуває H1; на desktop вона займає праву action-zone canonical header.
6. Communications більше не використовує окремий segmented-control стиль для primary tabs.
7. Financial Center top-level active tab використовує canonical orange accent.
8. Ці правила застосовуються системно до всіх internal CRM pages у CrmShell; standalone mechanic/auth/public/client surfaces залишаються поза scope.
