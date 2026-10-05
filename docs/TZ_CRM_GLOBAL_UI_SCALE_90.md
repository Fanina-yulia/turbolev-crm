# Технічне завдання — CRM-UI-005 Global Scale 90

**Проєкт:** Turbo LEV CRM  
**Стандарт:** `CRM-UI-005`  
**Статус:** ACTIVE  
**Дата:** 2026-10-05  
**Область:** уся внутрішня CRM, що працює через canonical `.shell`.  
**Не входить:** standalone Кабінет механіка, auth-сторінки, публічний кабінет клієнта та token/public surfaces.

## 1. Бізнес-вимога

При browser zoom **100%** внутрішня CRM повинна візуально мати щільність, близьку до поточної CRM при browser zoom **90%**.

Користувач не повинен вручну змінювати масштаб Chrome/Edge. Браузер залишається на 100%; щільність задається самою CRM.

Ціль:

> Browser 100% → Turbo LEV CRM візуально ≈ попередня CRM при Browser 90%.

## 2. Що масштабується

Єдиний scale застосовується до всієї внутрішньої CRM:

- floating rail / sidebar;
- page headers;
- filters;
- buttons;
- inputs/selects;
- cards;
- tables;
- planner;
- communications;
- clients;
- vehicles;
- diagnostics;
- work journal;
- commercial offers / work orders;
- warranties;
- parts;
- procurement;
- finance;
- payments;
- analytics;
- settings;
- New Request;
- modal/popover/dropdown/toast, якщо вони рендеряться в документі внутрішньої CRM.

Коефіцієнт:

```css
--crm-ui-scale: .9;
--crm-ui-inverse-scale: 1.1111111111;
```

## 3. Scope guard

Scale активується тільки коли документ містить canonical `.shell`.

```css
body:has(.shell) { ... }
```

Standalone Кабінет механіка повертається з `app/page.tsx` до створення `CrmShell`, тому `.shell` у DOM відсутній і `CRM-UI-005` на нього не діє.

Так само правило не застосовується до:

- `/auth/*`;
- `/my/*`;
- `/r/[token]`;
- public work-order documents;
- інших сторінок без internal CRM shell.

## 4. Технічний спосіб

Заборонено використовувати `transform: scale(.9)` для кореня CRM: transform не перераховує layout і може ламати координати dropdown/modal/sticky.

Використовується CSS `zoom: .9`, який бере участь у layout.

Щоб після scale робоча область не займала лише 90% фізичної ширини/висоти, задається compensated logical canvas:

- physical scale = `0.90`;
- inverse = `1 / 0.90 = 1.1111111111`;
- logical width = `111.111111vw`;
- logical height = `111.111111dvh`.

Додаткова ручна горизонтальна компенсація **не застосовується**. Production-перевірка на Chrome показала, що `left:-5.555vw` зміщував усе полотно вліво приблизно на 76 px при viewport 1366 px і створював порожню смугу справа. Canonical layout починається від природного лівого краю документа.

Після рендеру:

- `111.111vw × 0.90 ≈ 100vw`;
- `111.111dvh × 0.90 ≈ 100dvh`.

Таким чином CRM заповнює весь браузер, але внутрішні controls, typography, gaps та cards мають ~90% колишнього фізичного розміру.

## 5. Взаємодія з CRM-UI-004

`CRM-UI-004 One Screen First` залишається активним.

`CRM-UI-005` не замінює screen contracts. Він лише змінює глобальну щільність.

Порядок:

1. `CRM-UI-004` визначає `one / one-scroll / two-max`.
2. Page/module CSS визначає власника scroll.
3. `CRM-UI-005` масштабує готовий internal CRM canvas до 90%.

Shell/workspace, які раніше були прив'язані до `100dvh`, під scale використовують compensated logical height `111.111111dvh`.

## 6. Browser zoom та accessibility

Browser zoom користувача не блокується.

При Chrome:

- browser 100% → CRM design scale 90%;
- browser 110% → приблизно попередній фізичний розмір CRM;
- browser 125% → CRM збільшується поверх design scale.

Тобто користувач зберігає можливість збільшити інтерфейс системними засобами браузера.

Не використовувати `zoom: reset` і не забороняти user zoom.

## 7. Responsive

Desktop/laptop/tablet-landscape: scale 0.90 при viewport > 760 px.

Mobile <= 760 px:

- scale = 1;
- чинна mobile adaptive логіка зберігається;
- document flow не змінюється.

Причина: мобільна CRM вже має окремі adaptive contracts; механічне зменшення touch targets на 10% погіршить usability.

## 8. Modals, dropdowns, popovers

Оскільки scale застосовується на `body` внутрішньої CRM, descendants і body-level portals отримують однаковий effective zoom.

Обов'язкові перевірки:

- dropdown відкривається біля trigger;
- modal center не зміщується;
- fixed toast/call popup залишається в межах viewport;
- sticky header/footer не обрізається;
- channel picker і sidebar flyout не отримують подвійний scale;
- hit area збігається з видимою кнопкою.

## 9. QA viewports

Browser zoom: **100%**.

Desktop:

- 1920×1080;
- 1440×900;
- 1366×768;
- 1280×720;
- 1024×768.

Mobile контроль без scale:

- 390×844;
- 360×800.

## 10. Acceptance criteria

1. Внутрішня CRM при browser 100% візуально близька до попередньої CRM при browser 90%.
2. CRM заповнює всю фізичну ширину та висоту browser content area.
3. Немає порожньої смуги праворуч або внизу через scale; контент не зміщений за лівий край.
4. Немає horizontal body scroll.
5. Screen contracts `one / one-scroll / two-max` продовжують працювати.
6. Planner timeline не обрізається.
7. Communications list/timeline/context залишаються синхронними по висоті.
8. Dropdown/popover/modal позиціонуються біля правильних controls.
9. Floating sidebar rail масштабується разом із CRM.
10. New Request займає весь viewport і має доступний footer.
11. User browser zoom продовжує працювати.
12. Mobile <=760 px залишається scale 1.
13. Standalone Mechanic Cabinet залишається scale 1 і не змінюється.
14. Auth/public/client surfaces не змінюються.
15. Production build, responsive checks, page-integrity, font-floor і CRM scale contract проходять.

## 11. Файли реалізації

- `app/crm-global-ui-scale.css`;
- `app/layout.tsx`;
- `scripts/check-crm-ui-scale.mjs`;
- `scripts/build-production.mjs`;
- `docs/CRM_STANDARDS_TABLE.md`;
- `docs/modules/module-registry.json`;
- цей документ.

## 12. Non-goals

Ця задача не:

- перепроєктовує конкретні сторінки;
- змінює business logic/API/DB;
- змінює RBAC;
- змінює Кабінет механіка;
- замінює browser zoom;
- використовує `transform: scale` як layout hack.
