# TURBO LEV — ТЗ: Робочий центр «Підбір запчастин» v1

Дата: 14.09.2026
Статус: READY FOR IMPLEMENTATION / RELEASE
URL: `/?section=parts`
Модуль: `parts-inventory`

## 1. Проблема

Поточний `section=parts` відкривав екран із заголовком «Комерційна пропозиція» і великим списком ремонтних замовлень. Це змішувало два різні бізнес-процеси: підбір запчастин та комерційну пропозицію. Користувач обирає пункт меню «Підбір запчастин», тому сторінка повинна бути робочим центром запчастин, а не дублем КП.

## 2. Мета

Перетворити `section=parts` на сучасний робочий центр із трьома режимами:

1. `Огляд` — що зараз відбувається із запчастинами і що потребує дії.
2. `Каталог` — робочий процес підбору для конкретної Діагностичної карти.
3. `Аналітика` — фактичні KPI запчастин, постачальників і руху позицій.

Критичне правило: **жодних вигаданих, статичних або demo-KPI**. Якщо джерела правди немає — показується `—`, empty state або явне повідомлення про відсутність canonical source.

## 3. Бізнес-процес

Канонічний ланцюжок:

`Діагностична карта → позиція до заміни → VIN/комплектація → OE/OEM → аналоги → пропозиції постачальників → вибір → КП/погодження → PartsRequest → замовлення → отримання → встановлення`.

### 3.1 Підбір

- джерело потреби — Діагностична карта та manual parts;
- автомобіль/VIN передається з контексту ДК;
- пошук розділяє підтверджені оригінали, аналоги та непідтверджені результати;
- вибір пропозиції зберігається через `/api/parts-selection/select`;
- постачальник, артикул, склад, закупівельна ціна, продажна ціна і фактичний markup зберігаються як business facts;
- пошук без підтвердженого VIN не має автоматично вважатися сумісним — потрібне ручне підтвердження.

### 3.2 Націнка

Базова націнка TURBO LEV — **40%**. У чинному backend `DEFAULT_MARKUP_PERCENT = 40`; якщо для постачальника в `Supplier.defaultMarkupPercent` збережене інше валідне значення, використовується саме налаштований відсоток. UI не підміняє це статичною цифрою у розрахунках — фактичний sellPrice приходить із backend pricing flow.

## 4. Режим «Огляд»

### 4.1 Джерела

- `/api/procurement` — поточна активна операційна черга;
- `/api/analytics/parts` — агрегати за період;
- scope/permissions беруться з чинної RBAC-моделі API.

### 4.2 KPI поточної черги

Показувати тільки розраховані з реальних `PartsRequest`:

- активна черга;
- потрібно підібрати (`NEW`, `SELECTING`);
- до рішення / замовлення (`SELECTED`, `WAITING_APPROVAL`, `APPROVED`, `ORDER_REQUIRED` через operational category);
- в дорозі / частково (`ORDERED`, `PARTIALLY_RECEIVED`);
- прострочені ETA: `etaAt < now && receivedQuantity < quantity`;
- заявки, що блокують ремонт: є `requiredForRepair=true` і недоотримана кількість.

### 4.3 Фактична черга

Кожен рядок:

- № Work Order;
- авто + держномер;
- кількість позицій;
- прогрес отримання;
- чинний PartsRequest status;
- кількість прострочених ETA;
- кількість required-for-repair позицій, що ще не отримані;
- перехід у точний `partsRequestId` у розділ «Закупівлі та склад».

## 5. Режим «Каталог»

Поточний production-ready flow підбору не видаляється. Він переноситься в режим `Каталог` і зберігає:

- вибір Work Order / ДК;
- VIN / держномер;
- перелік деталей з ДК;
- OE/OEM та аналоги;
- fitment/confidence;
- live supplier offers;
- закупівельну і продажну ціну;
- збереження вибору;
- додавання до commercial flow;
- графічну схему вузлів, якщо вона доступна.

Старий заголовок «Комерційна пропозиція» на `section=parts` приховується. Головний заголовок сторінки — «Підбір запчастин».

## 6. Режим «Аналітика»

### 6.1 Період

`from/to` передаються у `/api/analytics/parts`. Timezone — `Europe/Kyiv` із API.

### 6.2 Формули

На основі `PartsRequestItem`:

- `requestedQty = Σ quantity`;
- `receivedQty = Σ receivedQuantity`;
- `installedQty = Σ installedQuantity`;
- `pendingRequiredQty = Σ max(quantity - receivedQuantity, 0)` лише для required-for-repair та non-terminal request;
- `purchaseValue = Σ purchasePrice × receivedQuantity`;
- `installedRevenue = Σ sellPrice × installedQuantity`;
- `installedCost = Σ purchasePrice × installedQuantity`;
- `installedProfit = installedRevenue - installedCost`;
- `installedMarginPct = installedProfit / installedRevenue × 100%`;
- average supply = середній час `orderedAt → receivedAt` для фактично отриманих request.

### 6.3 Таблиці

- breakdown за status;
- постачальники: requests, items, requestedQty, receivedQty, fulfillment%, purchaseValue (лише з фінансовим permission);
- top items: requested / received / installed + revenue/profit, якщо дозволено.

## 7. Чесність даних

### 7.1 Заборонено

- підставляти красиві KPI константами;
- показувати `0` замість прихованої фінансової інформації;
- вигадувати вартість складу;
- рахувати оборотність/неліквіди без canonical stock ledger;
- використовувати demo records як business truth.

### 7.2 Stock ledger

Чинний `/api/analytics/parts` повертає `stockLedgerAvailable=false`. Тому v1 **не показує** вартість залишків, оборотність, неліквіди та списання як фактичні KPI. UI прямо пояснює, що ці показники з'являться після надійного ledger source.

## 8. Права

- analytics endpoint вимагає `ANALYTICS_READ`;
- parts analytics додатково враховує `PROCUREMENT_READ`/`PARTS_READ`;
- фінанси показуються лише при `ANALYTICS_FINANCIAL_READ`;
- procurement endpoint використовує чинний location scope;
- UI не обходить API permission gates.

## 9. Навігація

- `/?section=parts` → `Огляд`;
- `scope=catalog` → `Каталог`;
- `scope=analytics` → `Аналітика`;
- якщо є `diagnosticId`, сторінка переходить у focus-mode підбору конкретної ДК;
- повернення з focus-mode очищає контекст і повертає у центр запчастин.

## 10. UI/UX

- один верхній header «Підбір запчастин»;
- 3 компактні вкладки;
- адаптивний KPI grid;
- операційна черга без зайвих карток;
- drill-down по кліку;
- min font 11px;
- light/dark theme через чинні CSS variables;
- старий темний «Комерційна пропозиція» header не дублюється.

## 11. Acceptance criteria

1. `section=parts` більше не починається з заголовка «Комерційна пропозиція».
2. Є режими `Огляд`, `Каталог`, `Аналітика`.
3. `Огляд` читає `/api/procurement` і `/api/analytics/parts`.
4. KPI черги обчислені з реальних cards/items.
5. Перехід із queue row відкриває точний `partsRequestId`.
6. Фінансові KPI не показуються без permission.
7. Stock metrics не вигадуються при `stockLedgerAvailable=false`.
8. `Каталог` зберігає чинний VIN/OE/analog/supplier selection flow.
9. Focus-mode конкретної ДК не ламає існуючий `/api/parts-selection/select`.
10. Базовий backend markup лишається 40%, але UI показує фактичний pricing result.
11. Production build і canonical contract smoke проходять.
12. Production deployment має `READY`, після релізу немає нових runtime error clusters для цієї сторінки.
