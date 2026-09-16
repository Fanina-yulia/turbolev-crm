# TURBO LEV CRM — ТЗ: Підбір запчастин під час незавершеної діагностики V5

Дата: 16.09.2026
Статус: implementation / release gate
Модуль: `/?section=parts&diagnosticId=...`

## 1. Причина зміни

Після V4 екран підбору для Діагностичної карти став напряму залежати від `commercial-handoff`. Канонічний commercial handoff навмисно вимагає `DiagnosticRequest.status = CONFIRMED` і наявний `WorkOrder`. Через це для реальної карти зі статусом `IN_PROGRESS` інтерфейс замість переліку потреб показував повідомлення «Рекомендації можна перенести в кошторис після підтвердження діагностики та створення WorkOrder».

Це неправильне змішування двох бізнес-процесів:

1. **підбір / перевірка / резервування рішення по деталі** — може починатися під час діагностики;
2. **формування Комерційної пропозиції / WorkOrder / PartsRequest** — тільки після підтвердження Діагностичної карти.

## 2. Канонічна логіка

### 2.1 До підтвердження ДК

Для `IN_PROGRESS`, `PENDING` та інших нескасованих непідтверджених станів:

- сторінка підбору повинна завантажувати реальні findings і ручні рекомендації деталей;
- пошук BM Parts / UniTrade та інших активних постачальників працює у повному V4 режимі;
- VIN/OE/analog/fallback логіка не змінюється;
- менеджер може обрати пропозицію;
- вибрана пропозиція **не створює WorkOrder і не створює Комерційну пропозицію**;
- вибір зберігається в `DiagnosticPartSelectionDraft` як diagnostic-scoped staging fact;
- повторний вибір для тієї самої потреби оновлює один staging row, а не створює дублікат;
- кошик показує staging rows і дозволяє погоджене ручне редагування полів;
- усі ручні зміни мають audit trail.

### 2.2 Після підтвердження ДК

Після створення канонічної Комерційної пропозиції:

- рекомендації імпортуються у `WorkOrderLine` існуючим канонічним flow;
- створюється/оновлюється `PartsRequest`;
- staging selection переноситься у відповідний `WorkOrderLine` та `PartsRequestItem`;
- переносяться supplier quote, артикул, бренд, кількість, закупка, продаж, націнка, склад, ручні override/provenance;
- створюється audit `STAGED_PART_SELECTION_SYNCED_TO_WORK_ORDER`;
- WorkOrder залишається єдиним source of truth після commercial handoff.

## 3. Staging source of truth

`DiagnosticPartSelectionDraft` зберігає тільки реальний підтверджений користувачем результат live supplier search:

- `diagnosticRequestId`;
- `findingId` або `manualPartId`;
- стабільний `selectionKey`;
- номенклатуру / позицію;
- supplier provider + canonical Supplier ID;
- `SupplierProductQuote` ID;
- external product ID;
- article / brand;
- warehouse;
- purchase / sell / markup / currency;
- quantity;
- fitment snapshot;
- offer evidence;
- manual fields і причину price override;
- actor + timestamps.

**Заборонено:** створювати staging row із вигаданою ціною, вигаданою сумісністю, фіктивним supplier quote або фіктивним WorkOrder.

## 4. Preview рекомендацій

`GET /api/diagnostics/:id/commercial-handoff` має два read modes:

- `CONFIRMED + WorkOrder` → canonical commercial handoff;
- до підтвердження → read-only parts preview із structured diagnostic + manual part recommendations + staged selections.

POST цього endpoint не послаблюється: імпорт у кошторис залишається gated підтвердженням.

## 5. Вибір supplier offer

`POST /api/parts-selection/select`:

- виконує однакові safety checks незалежно від статусу ДК;
- повторно перевіряє live supplier offer server-side;
- не довіряє ціні/brand/article із браузера як source of truth;
- зберігає manual compatibility confirmation;
- якщо ДК `CONFIRMED` — використовує канонічний WorkOrder flow;
- якщо ДК ще не підтверджена — використовує staging flow.

## 6. Кошик

`GET /api/parts-selection/line` працює в обох фазах:

- pre-confirmation → `DiagnosticPartSelectionDraft`;
- post-confirmation → `WorkOrderLine + PartsRequestItem`.

Staging row отримує UI ID `draft:<id>`. `PATCH` розрізняє staging та canonical row і зберігає корекції у відповідному source of truth.

Колонки залишаються:

`№ | К-сть | Артикул | Бренд | Номенклатура | Постачальник | Склад | Ціна закупки | Сума закупки | Ціна продажу | Сума продажу | Прибуток | % | Дія`.

## 7. Редагування

Редаговані поля:

- кількість;
- артикул;
- бренд;
- номенклатура;
- постачальник;
- склад;
- закупівельна ціна;
- націнка;
- продажна ціна з обов'язковою причиною, якщо вона відхиляється від формули.

Залежні суми та прибуток перераховуються автоматично. Manual overrides зберігаються окремо від supplier API facts.

## 8. Безпека та scope

- preview/handoff GET — чинний authenticated operational scope;
- cart GET — `PARTS_READ`, LOCATION;
- select/PATCH — `PARTS_WRITE`, strict LOCATION;
- location визначається через structured Diagnostic Request;
- скасована діагностика не редагується;
- ordered/received/installed canonical rows залишаються locked.

## 9. Acceptance criteria

1. Реальна `IN_PROGRESS` ДК з findings відкриває V4 workspace, а не повідомлення про необхідність WorkOrder.
2. На екрані видно фактичні «Деталі до заміни» з structured diagnostic.
3. Пошук supplier offers працює до підтвердження ДК.
4. Вибір пропозиції до підтвердження не створює WorkOrder/КП.
5. Вибір persist-иться після reload.
6. Повторний вибір для тієї самої потреби замінює staging selection.
7. Editable cart працює до підтвердження і має audit.
8. Після підтвердження + створення КП staging data переноситься в канонічний WorkOrder/PartsRequest.
9. Commercial hard gate не послаблений: кошторис/КП не створюються для `IN_PROGRESS`.
10. Не створюються вигадані ціни, fitment або supplier data.
11. Prisma migration проходить на чистій PostgreSQL 18 і production Neon.
12. Canonical contracts, production build і Vercel production deployment — green/READY.
13. Після deployment немає нових runtime error clusters на parts selection endpoints.
