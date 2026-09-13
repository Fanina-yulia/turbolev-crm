# TZ — Пульт власника V5: гроші, рішення та ризики

## 1. Мета

Перебудувати нижній ряд верхнього блоку «Пульт власника», прибравши показники, що є переважно диспетчерськими для керуючого станції (`Активні авто`, `У ремонті`, `Готові до видачі`), та замінити їх на чотири власницькі контрольні блоки:

1. **Гроші до отримання**;
2. **Потрібне моє рішення**;
3. **Критичні прострочення**;
4. **Ризик втрати виручки**.

Верхні 6 KPI V4 залишаються без зміни: виручка, валовий прибуток, валова маржа, завантаження постів, повторні клієнти, запис → приїзд.

Ключова мета інтерфейсу — відповідати власнику на чотири питання: **де мої гроші, де потрібне моє рішення, де процес зламався, де бізнес може втратити майбутню виручку**.

## 2. UX-принцип

- Нижній ряд є **контрольним**, а не операційним.
- У картках немає окремих CTA типу «Переглянути».
- Уся картка клікабельна.
- Праворуч у заголовку використовується однаковий компактний affordance `›`.
- Картки повинні бути візуально гармонійними з верхніми KPI і займати приблизно той самий екранний простір, що й попередній ряд.
- Візуалізації — компактні гістограми/progress-bars з підписами, без важкої chart-бібліотеки.
- Дані не вигадуються. Якщо в CRM немає достовірної грошової оцінки ризику — показується кількість ситуацій, а не штучно розрахована сума.

## 3. Блок «Гроші до отримання»

### 3.1. Бізнес-сенс
Показує суму реальної дебіторської заборгованості клієнтів по відкритих RECEIVABLE-зобов'язаннях Work Order.

### 3.2. Source of truth
`GET /api/payments`:
- `FinancialObligation.direction = RECEIVABLE`;
- `outstanding = amount - settledAmount`;
- open statuses: `OPEN`, `PARTIALLY_PAID`, `OVERDUE`.

### 3.3. Основне значення
`totalReceivable = sum(row.outstanding where outstanding > 0)`.

### 3.4. Гістограма
Три рядки:
- `До сплати` — сума рядків `flags.due`;
- `Частково` — сума рядків `flags.partial`;
- `Прострочено` — сума рядків `flags.debt || overdue`.

### 3.5. Footer
Показати окремо `Прострочений борг` у гривнях. Якщо >0 — червоний accent.

### 3.6. Навігація
Клік по картці → `Оплати`, scope `due`.

## 4. Блок «Потрібне моє рішення»

### 4.1. Бізнес-сенс
Показує тільки ситуації, в яких потрібне рішення власника/уповноваженого фінансового decision maker, а не звичайна операційна дія працівника.

### 4.2. Source of truth
1. `GET /api/finance/margin-approvals` — pending погодження низької маржі.
2. `GET /api/dashboard` — live attention signals.

### 4.3. Категорії
- `Низька маржа` — pending margin approvals;
- `Гарантія` — attention issue code `WARRANTY_OPEN`;
- `Зупинені` — attention issue code `PAUSED_STALLED`.

### 4.4. Основне значення
`decisionCount = marginPending + warrantyOpen + pausedStalled`.

### 4.5. Додатковий фінансовий контекст
Для pending margin approvals сумувати `revenue` і показувати в footer:
`КП з низькою маржею — X грн`.

Ця сума є фактичним planned revenue відповідних КП, а не прогнозом.

### 4.6. Навігація
Клік → `Фінансовий центр`.

## 5. Блок «Критичні прострочення»

### 5.1. Бізнес-сенс
Показує активні процеси, що вийшли за плановий час / SLA.

### 5.2. Source of truth
`GET /api/analytics` → `operations.overdueNow` та `operations.delayReasons`.

### 5.3. Категорії гістограми
Використовувати фактичний `delayReasons`, зокрема:
- запчастини;
- погодження / калькуляція;
- не призначено механіка;
- пауза;
- робота / інше.

Показувати максимум 4 основні причини, відсортовані backend за кількістю.

### 5.4. Візуальний стан
Якщо `overdueNow > 0`:
- red border;
- дуже легкий red-tinted background;
- заголовок і основне число — red;
- footer `потрібне втручання`.

Якщо 0 — neutral state.

### 5.5. Навігація
Клік → `Аналітика`.

## 6. Блок «Ризик втрати виручки»

### 6.1. Бізнес-сенс
Показує кількість активних ситуацій, які ще не є дебіторкою, але можуть не конвертуватися в майбутню виручку.

### 6.2. Source of truth
- `No-show` — max із `/api/dashboard.blockers.noShow` та `/api/analytics.funnel.noShow`;
- `Погодження / розрахунок` — `/api/analytics.operations.waitingApprovalNow`;
- `Зупинені процеси` — attention issue `PAUSED_STALLED`.

### 6.3. Формула
`revenueRiskCount = noShow + waitingApproval + pausedStalled`.

### 6.4. Заборона штучної грошової оцінки
Не множити no-show або непогоджені ситуації на середній чек. Не показувати гривні без реального estimate/financial source.

Footer: `Факт без штучної оцінки`.

### 6.5. Навігація
Клік → `Аналітика`.

## 7. Візуальна система

### 7.1. Геометрія
Desktop ≥1280:
- 4 контрольні картки в один ряд;
- однакова висота `~236 px`;
- gap 10 px;
- radius 17 px.

Tablet 761–1280:
- 2 × 2.

Mobile ≤760:
- 1 колонка.

### 7.2. Ієрархія картки
1. icon + title + `›`;
2. велике ключове значення;
3. пояснювальний subtitle;
4. компактна горизонтальна гістограма з 3–4 рядків;
5. footer із ключовим secondary control.

### 7.3. Кольори
- brand / pending control — orange;
- positive / no-risk — green;
- critical / overdue / debt — red;
- neutral — gray.

Не заливати картки насиченими кольорами. Accent використовується лише у border, icon, bar та критичному тексті.

### 7.4. Типографіка
- minimum font floor 11 px;
- основне значення ~27 px;
- label 11–13 px;
- жодного horizontal overflow.

## 8. Інтерактивність та accessibility

- Кожна картка — `<button type="button">`.
- `aria-label` містить назву й ключове значення.
- `focus-visible` — 2 px brand outline.
- hover — легкий elevation без layout shift.
- графіки позначені `aria-hidden`, значення дублюються текстом.

## 9. Оновлення даних

Supplemental owner-control data (`payments`, `margin approvals`, `dashboard`) завантажуються при mount і оновлюються:
- на подію `turbolev:data-changed`;
- раз на 60 секунд.

Основні KPI та SLA-дані лишаються в чинному `/api/analytics` і оновлюються існуючим OwnerControlCenter.

Помилка одного supplemental endpoint не повинна ламати весь Owner Dashboard: картка переходить у нульовий/нейтральний стан.

## 10. Data integrity

- Не створювати нових таблиць БД.
- Не виконувати production DB migration.
- Не дублювати фінансові дані локально.
- Не вигадувати amounts або historical series.
- Гроші до отримання рахуються лише з `FinancialObligation` через чинний payments API.
- Pending margin approvals беруться з чинного audited margin gate.

## 11. Scope файлів

Основні зміни:
- `app/owner-dashboard-visual.tsx`;
- `app/owner-dashboard-visual.module.css`;
- цей документ;
- Google Sheet `Turbo LEV — Стандарти CRM (таблиця)` → новий стандарт Owner Dashboard V5.

`app/owner-dashboard.tsx`, API contracts і Prisma schema не потребують зміни.

## 12. Acceptance criteria

1. У нижньому ряду відсутні `Активні авто`, `У ремонті`, `Готові до видачі`.
2. Є 4 нові owner cards: Receivables / Owner decisions / Critical overdue / Revenue risk.
3. Немає окремих кнопок `Переглянути`; уся картка клікабельна.
4. У всіх 4 картках є візуально гармонійні гістограми/progress bars.
5. Receivables показує реальну суму outstanding та breakdown.
6. Decision card рахує pending margin + warranty + paused і показує planned revenue низькомаржинальних КП.
7. Critical overdue використовує реальні `delayReasons`.
8. Revenue risk не створює штучних сум.
9. Card states не ламаються при 403/500 окремого supplemental endpoint.
10. Немає horizontal overflow на 360/390/768/1024/1280/1440/1920.
11. Font floor ≥11 px.
12. Build/typecheck/page-integrity/font-floor проходять.
13. Production deployment READY.

## 13. Non-goals

- Не переносити `Потрібна дія` / `Центр уваги` назад у Owner Dashboard.
- Не показувати власнику диспетчерський список активних авто.
- Не змінювати рольові кабінети керуючого, майстра-приймальника, механіка тощо.
- Не робити автоматичні фінансові рішення від імені власника.
