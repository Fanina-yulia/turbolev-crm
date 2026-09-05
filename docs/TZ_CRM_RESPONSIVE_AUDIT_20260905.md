# Технічне завдання: повний аудит і адаптація Turbo LEV CRM

**Код:** `CRM-UI-003 / AUDIT-2026-09-05`
**Статус:** затверджено до реалізації
**Дата:** 2026-09-05
**Система:** Turbo LEV CRM
**Production:** `https://turbolev-crm.vercel.app/`

## 1. Мета

Зробити всі сторінки CRM адаптивними для ноутбуків, моніторів, планшетів і телефонів при 100% масштабі браузера. Сторінка повинна бути цілісним документом: контент не обрізається, робочі блоки не фіксуються у власних viewport-вікнах, а користувач бачить заголовок, контекст, дані та основну дію без зміни масштабу.

Це ТЗ є практичним планом повного аудиту. Воно застосовується до внутрішньої CRM, кабінету механіка, сервіс-менеджера, клієнтського кабінету та публічних звітів.

## 2. Проблема, яку потрібно усунути

На ширині ноутбука в картці автомобіля шапка та блок дій власника виходять за доступну ширину: праві елементи обрізаються, з'являються надмірні порожні поля, а частина інформації опускається за межі видимого контейнера. Причини, які потрібно контролювати системно:

1. жорсткі `min-width` і desktop grid без `minmax(0, 1fr)`;
2. `height: 100vh`, `max-height: calc(100vh - ...)` та `overflow: hidden/auto` на основному page/list/detail;
3. action-групи, які не переносяться;
4. sticky/fixed detail-панелі, що перекривають або відтинають нижній контент;
5. довгі VIN, номери, імена, назви деталей і коментарі без переносу;
6. відсутність однакових правил у CSS-модулях різних розділів;
7. різна поведінка одного й того самого блоку «авто / клієнт / статус» у різних маршрутах.

## 3. Обсяг аудиту

Перевірити всі 17 модулів з `docs/modules/module-registry.json`:

| Модуль | Що перевірити |
|---|---|
| Core platform | shell, sidebar, query-router, auth, 401/403, глобальні toast/launcher |
| Dashboard & analytics | KPI, графіки, quick actions, порожній і помилковий стани |
| Clients & vehicles | пошук, картки, vehicle header, VIN/номер, owner, фото |
| Client portal | mobile-first картка авто, ДК, КП, повідомлення, CTA |
| Leads & intake | wizard, форми, кроки, конвертація, помилки та повернення |
| Planner | день/тиждень, записи, ресурси, конфлікти, popup запису |
| Diagnostics | реєстр, ДК, статуси, findings, evidence, next action |
| Work orders | список, detail, роботи, деталі, QC, фінансові стани |
| Service manager | черга, SLA, approvals, blockers, дії |
| Mechanic cabinet | assigned work, діагностика, scanner/camera, touch controls |
| Parts & inventory | підбір, пошук, пропозиції, постачальники, склад |
| Personnel & access | списки, editor, permission matrix, forms |
| Finance | KPI, ledger, payments, totals, confirm dialog |
| Vehicle images | library, generation, fallback, loading/error, layout shift |
| Notifications | unread/read, deep link, empty/error, mobile action |
| Communications | filters, conversation, composer, context, integration fallback |
| Settings & integrations | forms, tabs, credentials, secrets, save/error states |

## 4. Цільова матриця viewport

Перевірки виконуються без зміни zoom:

| Viewport | Обов'язкова поведінка |
|---:|---|
| 1920×1080 | expanded shell, багатоколонкові dashboard-блоки без розтягування тексту |
| 1440×900 | основні header, action і detail повністю видимі |
| 1366×768 | laptop layout: менші gutter/image, без обрізання правих дій |
| 1280×800 | двоколонкові блоки переходять у безпечну сітку або потік |
| 1024×768 | tablet landscape: складні контексти послідовно складаються |
| 768×1024 | один робочий потік, таблиці мають тільки локальний scroll |
| 390×844 | одна колонка, touch target не менше 44px, без body overflow |
| 360×800 | довгі значення переносяться, жодна основна дія не обрізається |

## 5. Єдиний layout-контракт

### 5.1. Обов'язково

- `shell` і `workspace` мають `min-width: 0`, `width: 100%`, `max-width: 100%`;
- усі grid/flex children з текстом мають `min-width: 0`;
- сторінка росте по висоті документа;
- header, toolbar, tabs і action group можуть переноситися;
- основні текстові значення використовують `overflow-wrap: anywhere` або контрольований ellipsis з доступним повним значенням;
- зображення мають `max-width: 100%`, `object-fit: contain` і стабільний aspect ratio;
- мобільна навігація не накладається на останній блок або CTA;
- focus, keyboard navigation, aria-label для icon-only дій зберігаються після адаптації.

### 5.2. Заборонено

- `width: 100vw` у page/workspace layout;
- `height: 100vh` або viewport `max-height` для основного page/list/detail;
- `overflow: hidden/auto/scroll` на всій сторінці, detail-панелі або сусідніх робочих блоках;
- `position: sticky/fixed`, що перекриває контент або блокує основну дію;
- жорсткі `min-width`, які не мають mobile/tablet сценарію;
- приховування тексту/кнопок тільки для того, щоб зберегти стару висоту блока;
- глобальне перевизначення `display:grid` компонентів на `display:flex` без аналізу їхнього контракту.

## 6. Дозволені scroll-виключення

Внутрішній scroll дозволений тільки для:

1. modal/dialog/drawer з власним close і доступним заголовком;
2. горизонтальної таблиці, коли всі колонки фізично не вміщуються;
3. planner day/week board;
4. parts diagram та zoom viewport;
5. photo/gallery/lightbox;
6. спеціалізованого picker зі своїми controls і видимим контекстом.

Кожен виняток має бути обмежений власним блоком і не може приховувати сусідні дані.

## 7. План реалізації

### Етап A — базовий шар

1. Завантажити `app/crm-responsive-standard.css` останнім у global layout.
2. Додати layout tokens для gutter, gap, control height і minimum text floor.
3. Задати `min-width: 0`/`max-width: 100%` для shell, workspace, page, layout, header, toolbar та їхніх дітей.
4. Вимкнути page-level clipping; зберегти тільки явно дозволені scroll-виключення.
5. Додати reduced-motion контракт.

### Етап B — проблемні сторінки

1. **Vehicle record:** компактна шапка, fluid фото, owner/actions у переносимому потоці, tabs без обрізання.
2. **Diagnostics / Diagnostic card:** один документний scroll, findings і action bar не відтинаються.
3. **Communications:** на tablet перейти з чотирьох вузьких колонок у послідовний потік.
4. **New inquiries:** queue та detail ростуть разом; sticky detail прибрати.
5. **Work orders / Personnel / Inbox:** прибрати viewport-обмеження основних list/detail.
6. **Mechanic cabinet:** зберегти touch-first controls, але не фіксувати сторінку всередині viewport.
7. **Planner, tables, diagrams, galleries:** залишити локальні scroll-виключення та перевірити їх межі.

### Етап C — статичний контроль

Скрипт `scripts/check-responsive-contract.mjs` повинен перевіряти:

- підключення global responsive layer;
- наявність усіх viewport у документації;
- реєстрацію `CRM-UI-003` як ACTIVE;
- layout markers `minmax(0, 1fr)`, `min-width: 0`, reduced motion;
- document-flow overrides для vehicle, diagnostics, communications, inquiries, work orders і personnel;
- наявність tablet/mobile breakpoint;
- заборону повернення page-level clipping у контрольованих файлах;
- явне маркування дозволених scroll-зон.

## 8. Функціональні та візуальні acceptance criteria

Для кожного модуля виконати:

1. відкрити success, loading, empty і error state;
2. перевірити довгі значення: VIN, номер, ім'я, назва авто, деталь, коментар;
3. перевірити основну дію клавіатурою та мишею;
4. перевірити, що нижній блок доступний через document scroll;
5. перевірити, що body не має горизонтального overflow;
6. перевірити, що жодна кнопка не виходить за межі батьківського блока;
7. перевірити, що sticky/fixed елементи не перекривають поля, таблиці та CTA;
8. перевірити 100% zoom на всіх viewport з розділу 4.

Окремо для Vehicle record:

- видно авто, модель/рік, номер, VIN, owner і workflow status;
- фото не розширює header та не створює порожній правий/нижній простір;
- WhatsApp/QR/Telegram/phone actions переносяться без обрізання;
- вкладки «Діагностична карта», «Комерційна пропозиція», «Сервісна історія» доступні повністю;
- copy VIN/номер не змінює геометрію сторінки.

## 9. Перевірки перед публікацією

Обов'язковий набір:

```text
npm run ui:responsive:check
npm run ui:pages:check
npm run ui:fonts:check
npm run ui:plates:check
npm run ui:new-request:layout:smoke
npm run module:ci
npm run build
```

Якщо змінено API, auth, workflow або базові контракти — додатково запускаються відповідні `contracts:smoke`/security checks. Публікація дозволена тільки після успішного production build і перевірки фактичного deployment.

## 10. Definition of Done

- всі 17 модулів пройшли структурний аудит;
- основні сторінки не мають небажаних fixed-height/fixed-section контейнерів;
- на 1366×768 та 1280×800 немає обрізання шапки авто, дій, таблиць чи CTA;
- на 1024/768/390/360 layout переходить у передбачений потік без body overflow;
- дозволені scroll-зони задокументовані й обмежені;
- автоматичний responsive contract проходить;
- build проходить;
- production deployment має стан `READY` і відповідає опублікованому commit SHA;
- у release note вказані commit, deployment URL, перевірені команди та відомі P2-ризики, якщо вони залишилися.

## 11. Відкат

Якщо після публікації з'являється P0/P1 регресія, повертається попередній production deployment через Vercel, а виправлення готується окремим commit. CSS-виключення не додаються «тимчасово» без внесення причини та межі до цього ТЗ і таблиці стандартів.
