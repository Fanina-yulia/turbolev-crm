# Turbo LEV CRM — One Screen First

**Код:** `CRM-UI-004`  
**Статус:** ACTIVE  
**Дата:** 2026-10-04  
**Scope:** уся CRM, окрім standalone Кабінету механіка.

## 1. Мета

Desktop/laptop інтерфейс працює як керований робочий простір, а не як нескінченний документ. Для кожного екрану існує один контракт:

- `one` — весь основний сценарій у viewport;
- `one-scroll` — shell/page не росте, робоча область прокручується локально;
- `two-max` — складна картка/документ максимально ущільнюється; другорядна інформація переводиться у tabs/drawer/accordion, а робочий shell залишається viewport-bound.

Базовий QA viewport: **1280×720, zoom 100%**.

## 2. Канонічна матриця

| Екран | Контракт |
|---|---|
| Огляд станції / рольові dashboard | one-scroll |
| Центр уваги | one-scroll |
| Комунікації | one-scroll |
| Клієнти / картка клієнта | one-scroll |
| Авто — реєстр | one-scroll |
| Картка авто | two-max |
| Планувальник день/тиждень | one-scroll |
| Діагностика — реєстр | one-scroll |
| Діагностична карта | two-max |
| Роботи | one-scroll |
| КП/ЗН — реєстр | one-scroll |
| КП/ЗН — деталь | two-max |
| Гарантії | one-scroll |
| Підбір запчастин | two-max |
| Закупівлі / склад | one-scroll |
| Фінансовий центр | two-max |
| Оплати | one-scroll |
| Аналітика | two-max |
| Нова заявка | one-scroll |

Налаштування: `schedule`, `markup`, `cameras`, `appearance` — `one`; решта вкладок — `one-scroll`.

## 3. Кабінет механіка

`app/page.tsx` маршрутизує primary role `MECHANIC` безпосередньо у `MechanicCabinet`, минаючи `CrmShell`. CRM-UI-004 застосовується лише через `[data-crm-screen-frame]`, який рендерить `CrmShell`. Тому standalone Кабінет механіка не входить у цей контракт і не повинен отримувати нові viewport/scroll правила.

## 4. Desktop shell

На ширині від 761 px:

- `body`, `.shell`, `.workspace` прив'язані до `100dvh`;
- document scroll для внутрішньої CRM вимкнений;
- sidebar menu може мати власний vertical scroll;
- горизонтальний body/workspace scroll заборонений;
- modal/drawer мають bounded height і прокручуване body;
- primary footer/action у drawer/modal залишається доступним.

На mobile документний flow дозволений.

## 5. Density

- Comfortable: height >= 900;
- Compact: 769–899;
- Dense: <= 768.

Density змінює gap/padding/висоту control, але не зменшує читабельний текст нижче чинного font-floor.

## 6. Реалізація

Канонічні файли:

- `app/crm-screen-contracts.ts`;
- `app/crm-screen-contract-frame.tsx`;
- `app/crm-one-screen-standard.css`;
- `scripts/check-one-screen-contracts.mjs`.

Кожен внутрішній екран отримує:

- `data-crm-screen-frame="true"`;
- `data-crm-screen="<id>"`;
- `data-screen-contract="one|one-scroll|two-max"`;
- `data-crm-scroll-owner="frame|page"`.

### 6.1. Принцип scroll ownership

Після візуальної перевірки production 2026-10-04 заборонено реалізовувати One Screen First через глобальне вгадування CSS-module класів на кшталт `[class*="_grid__"]`, `[class*="_list__"]` або примусове стискання будь-яких карток.

Глобальний `crm-one-screen-standard.css` керує тільки shell/frame і визначає, хто володіє прокруткою:

- `frame` — складна сторінка `two-max` або звичайний документ усередині bounded workspace;
- `page` — конкретний модуль сам визначає фіксовані header/filters/actions і свою робочу scroll-зону.

Розміри карток, таблиць, календарів, колонок, sticky actions та split-pane визначаються у CSS-модулі конкретної сторінки. Це є обов'язковою частиною `CRM-UI-004`, а не винятком.

## 7. Acceptance

Реліз не допускається, якщо:

1. screen registry не покриває CRM navigation;
2. одна з 15 settings tabs не має контракту;
3. новий CSS містить selector/імпорт standalone mechanic;
4. CRM shell не використовує contract frame;
5. `CRM-UI-004` не зареєстровано в module registry;
6. production build не проходить.

Візуальна QA виконується на 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, 768×1024 і 390×844.


## 8. Візуальний polish після production-аудиту 2026-10-04

Після першого релізу стандарту production-скріншоти показали, що універсальне стискання компонентів може формально прибрати document scroll, але погіршити читабельність. Канонічне рішення:

- Клієнти та Авто: двоколонковий реєстр із картками сталої читабельної висоти; scroll належить result grid; pagination залишається доступною.
- Планувальник: controls залишаються, календар отримує весь залишок viewport.
- Графік роботи: усі 7 днів і primary save action повністю доступні в одному viewport.
- Пульт власника: KPI/контроль зверху; деталі згруповані у вкладки `Результат / Сервіс / Ризики / Тренди`.
- Комунікації: contact list і timeline мають незалежні scroll-зони, composer завжди доступний.
- Реєстри/таблиці: header + filters не рухаються; scroll належить списку/таблиці.
- Кабінет механіка не входить у цей polish і не змінюється.
