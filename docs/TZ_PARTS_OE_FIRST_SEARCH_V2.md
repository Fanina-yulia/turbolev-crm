# TURBO LEV CRM — ТЗ: OE-first підбір запчастин V2

## 1. Мета

Перебудувати підбір деталей для конкретного автомобіля так, щоб CRM спочатку доводила застосовність деталі до автомобіля, а лише потім порівнювала ціну та наявність у постачальників.

Цільовий pipeline:

`Автомобіль → VIN/vehicle context → canonical part → позиція/вісь → OE → cross/analogs → BM Parts + UniTrade → fitment validation → ціна/залишок → ranking → UI`.

Fuzzy-пошук за назвою залишається лише останнім fallback, коли OE/catalog evidence відсутній або не дав результатів.

Еталонний кейс:

`АЕ0914МН → GEELY EMGRAND X7 2014 → STABILIZER_BUSHING → REAR → OE 1014012805 → cross → BM Parts + UniTrade`.

## 2. Проблема поточної реалізації

До V2 система могла показувати результати, знайдені постачальником лише за текстом, навіть коли вони явно суперечили контексту авто. При запиті задньої втулки стабілізатора для Geely у видачу могли потрапляти:

- передні втулки;
- Audi/VW/Skoda;
- Mercedes Sprinter;
- Renault/Fiat/Hyundai/Kia;
- generic `Sway Bar Bushing` без доказу сумісності;
- позиції з ціною `0.00`.

Позначка `потрібна ручна перевірка` не є достатнім захистом: CRM повинна автоматично відкидати явні суперечності.

## 3. Основні принципи V2

### 3.1. Structured Part Search Intent

Кожен пошук для автомобіля повинен мати структурований intent:

- `vehicleId`;
- VIN;
- держномер;
- brand/model/year;
- canonical part code;
- genericArticleId;
- axis;
- side;
- subPosition;
- position;
- quantity.

Параметр `axis` є бізнес-обмеженням, а не текстовою підказкою. `REAR` не можна втрачати під час переходу між normalization, fitment та supplier search.

### 3.2. OE як перший search seed

Пріоритет джерел:

1. exact VIN / VehicleFitment;
2. OE numbers із канонічного каталогу;
3. confirmed catalog articles;
4. confirmed cross numbers;
5. model/axis catalog evidence;
6. curated OE reference;
7. free-text supplier search.

Якщо існує OE/catalog seed, primary supplier search запускається з нього, а не з тексту `Втулка стабілізатора задня вісь`.

### 3.3. Curated OE fallback

До повного імпорту OE-каталогу дозволяється малий auditable curated reference layer.

Вимоги:

- кожен запис обмежений brand/model/year/canonicalCode/axis;
- має `sourceVersion`;
- має evidence refs;
- має confidence;
- ніколи не позначається як exact VIN fitment;
- не може застосовуватися до іншої осі або іншого року поза діапазоном.

Перший контрольний запис V2:

- GEELY;
- EMGRAND X7 / EMGRAND EX7;
- 2012–2015;
- `STABILIZER_BUSHING`;
- `REAR`;
- OE `1014012805`;
- confidence 88;
- exact = false.

Публічний cross-check перед реалізацією підтвердив, що `1014012805` використовується як задня втулка стабілізатора Emgrand X7; curated layer однак залишається model-level evidence, а не доказом конкретної VIN-модифікації.

## 4. Supplier search cascade

### Stage A — OE/catalog evidence

Якщо відомий OE:

`BM Parts: search(OE)`
`UniTrade: search(OE)`

У контекст передаються всі відомі OE/catalog/cross numbers.

### Stage B — cross expansion

Для знайденого OE/confirmed article:

- отримати кроси BM Parts;
- отримати analogs UniTrade, коли API дозволяє;
- кожний cross повторно оцінити через compatibility policy;
- cross не успадковує `CONFIRMED`, якщо немає достатнього доказу.

### Stage C — model/vehicle search

Якщо OE не дав товарних пропозицій, допускається model-scoped supplier search із canonical part і position.

### Stage D — fuzzy fallback

Тільки якщо Stage A–C не дали strong evidence:

- виконати пошук за назвою;
- показувати лише результати без hard conflict;
- усі такі позиції мають `REVIEW_REQUIRED`;
- вони не можуть виглядати як підтверджені.

## 5. Hard Reject Policy

CRM повинна відкинути пропозицію до UI, якщо існує явна суперечність.

### 5.1. Axis conflict

Запит `REAR`, товар явно `FRONT` → `AXIS_CONFLICT`.

Запит `FRONT`, товар явно `REAR` → `AXIS_CONFLICT`.

### 5.2. Vehicle conflict

Автомобіль `GEELY`, а назва/vehicle evidence явно містить тільки інші марки (`AUDI`, `VW`, `RENAULT`, `MERCEDES`, `FIAT`, `HYUNDAI`, `KIA`, тощо) → `VEHICLE_CONFLICT`.

Марка виробника запчастини (`FAG`, `FEBI`, `MOOG`) не є маркою автомобіля і не використовується для reject.

### 5.3. Part-family conflict

Для `STABILIZER_BUSHING` без trusted OE/cross назва повинна мати семантику і втулки, і стабілізатора (`втулка/bushing` + `стабілізатор/sway bar`). Generic `ВТУЛКА (У КОМПЛ.)` без OE evidence не проходить.

## 6. Evidence tiers

V2 використовує чотири логічні рівні:

- `CONFIRMED` — exact VIN/catalog evidence;
- `PARTIAL` — OE/model/cross evidence без exact VIN proof;
- `REVIEW_REQUIRED` — fuzzy result без достатнього доказу;
- `REJECTED` — суперечність, результат не передається в UI.

`REJECTED` не є UI-групою: такі пропозиції видаляються сервером.

## 7. Ranking

Спочатку доказ сумісності, потім комерційні параметри.

Порядок:

1. exact VIN/OE;
2. OE model-level;
3. confirmed cross;
4. model match;
5. review only;
6. наявність;
7. коректна ціна;
8. нижча закупівельна ціна — тільки як tie-breaker всередині однакового рівня доказу.

Дешева непідтверджена деталь не може бути вище підтвердженої через ціну.

## 8. Price policy

`purchasePrice <= 0` не є валідною ціною.

Server policy:

- `purchasePrice = null`;
- `sellPrice = null`;
- додати пояснення `ціна потрібно уточнити`;
- UI не дозволяє `Додати`, бо existing picker вимагає `purchasePrice != null`.

## 9. Deduplication

У межах одного supplier:

`key = supplier + brand + normalized article`.

Якщо одна позиція прийшла через кілька cascade stage, залишається варіант із сильнішим evidence score.

Пропозиції одного артикулу від різних постачальників не зливаються на сервері: це окремі комерційні пропозиції з різною ціною/складом.

## 10. API

`GET /api/parts/suppliers` і комбінований parts search повинні повертати:

- effective OE numbers;
- OE resolution metadata;
- `searchMode = OE_FIRST_CASCADE` при evidence-driven search;
- `strictSearch.algorithm = OE_FIRST_V2`;
- primary seed;
- fallbackUsed;
- rejectedCount;
- rejectedByCode;
- strongResultCount;
- reviewResultCount.

Ці поля потрібні для аудиту і production E2E.

## 11. Контрольний сценарій АЕ0914МН

Вхід:

- GEELY EMGRAND X7;
- 2014;
- `Втулка стабілізатора задня вісь`;
- canonical `STABILIZER_BUSHING`;
- axis `REAR`.

Очікування:

1. normalization зберігає `REAR`;
2. canonical VehicleFitment перевіряється першим;
3. якщо catalog OE відсутній — curated evidence повертає `1014012805`;
4. `1014012805` стає primary supplier seed;
5. BM/UTR шукаються по OE/cross;
6. `Audi/VW front`, `Renault front`, `MB Sprinter rear` не потрапляють у response;
7. generic MOOG без evidence може залишитися лише `REVIEW_REQUIRED`, і тільки якщо strong evidence не знайдено;
8. `0.00` ціна стає `null`;
9. OE/cross results ранжуються вище fuzzy.

## 12. Backward compatibility

- існуючі supplier adapters не ламаються;
- старий `searchConfiguredSuppliers` залишається low-level provider layer;
- OE-first V2 є orchestration/policy layer над ним;
- direct repair, diagnostic parts selection і procurement можуть поступово перейти на той самий orchestration без дублювання adapter logic;
- manual confirmation залишається для `PARTIAL/REVIEW_REQUIRED`.

## 13. Тести

Обов'язковий contract smoke:

- Geely X7 2014 + rear stabilizer bushing → OE 1014012805;
- той самий автомобіль + FRONT → curated OE не застосовується;
- Renault FRONT при REAR request → reject;
- Mercedes Sprinter при Geely request → reject;
- exact/curated OE → strong evidence;
- generic `Sway Bar Bushing` → review;
- `purchasePrice=0` → null;
- production build запускає цей smoke до Next build.

## 14. Acceptance criteria

Реліз приймається, якщо:

- code/type build READY;
- contract smoke проходить;
- API security policy не регресує;
- UI font/page guards не регресують;
- production deployment READY;
- root CRM відповідає штатно;
- для контрольного кейсу алгоритм формує OE-first search plan і не віддає очевидні axis/vehicle conflicts.
