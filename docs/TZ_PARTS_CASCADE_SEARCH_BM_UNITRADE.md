# TURBO LEV CRM — ТЗ: каскадний підбір запчастин BM Parts + UniTrade

Дата: 2026-09-14
Статус: implementation v1
Scope: `Підбір запчастин`, без зміни структури Діагностичної карти.

## 1. Мета

Підбір запчастини з Діагностичної карти має працювати як керований каскад, а не як два ізольовані пошуки постачальників:

`назва механіка → canonical part → provider aliases → VIN/OE → BM Parts + UniTrade → OEM/cross seeds → повторний пошук у BM Parts + UniTrade → аналоги → комплектна альтернатива → ручне підтвердження → КП/ЗН`.

Критичний контроль: комплектна деталь не є автоматично еквівалентною окремому компоненту.

## 2. Незмінні правила

1. Діагностична карта не перейменовує запис механіка. Наприклад, у ДК залишається `Ступичний підшипник`.
2. Внутрішньо CRM використовує canonical code, синоніми, терміни BM Parts, терміни UniTrade, українські/російські/англійські назви та крос-номери.
3. Відсутність точного fitment не блокує API-пошук. Результат переходить у ручну перевірку.
4. `Ступиця в зборі` може бути запропонована лише як `ASSEMBLY` / комплектна альтернатива.
5. `ASSEMBLY` ніколи не отримує auto-approval і потребує явного ручного підтвердження менеджера.
6. Несумісний результат не потрапляє до основного релевантного списку.

## 3. Пошуковий каскад

### Етап A — нормалізація

Вхід:
- назва з ДК;
- OEM/артикул, якщо є;
- VIN / vehicleId / держномер;
- позиція: вісь, сторона, підпозиція;
- GenericArticle/canonicalCode, якщо вже визначені.

CRM визначає canonical part і provider-specific search terms.

### Етап B — первинний паралельний пошук

BM Parts і UniTrade запускаються паралельно за:
- normalized query;
- original query;
- provider-specific terms;
- OE numbers;
- catalog articles;
- VIN/model scoped BM Parts search, якщо доступний підтверджений vehicle context.

Непідтверджений fitment не забороняє виклик постачальника.

### Етап C — формування cascade seeds

До seed-ів потрапляють:
- OE numbers із fitment;
- catalog articles;
- прямий артикул користувача;
- OEM/крос-артикул, знайдений BM Parts або UniTrade;
- OE numbers з картки товару постачальника.

Seed дедуплікується за normalized article; запис із відомим brand має пріоритет над записом без brand.

Приклад: якщо BM Parts або VIN-каталог дає `9036945003`, цей номер обов’язково стає входом другого етапу для BM Parts і UniTrade.

### Етап D — cross-provider повторний пошук

Для кожного seed:
- `searchByArticle` / article search у кожного підключеного постачальника;
- якщо постачальник підтримує analog endpoint і відомий brand — пошук аналогів;
- усі результати отримують provenance/reason;
- результати об’єднуються та дедуплікуються.

Важливо: знайдений номер одного постачальника стає пошуковим ключем другого постачальника.

### Етап E — комплектна альтернатива

Запускається тільки якщо після первинного + cascade пошуку немає релевантного component result.

Для `WHEEL_HUB_BEARING` fallback:
- canonical alternative: `WHEEL_HUB_ASSEMBLY`;
- BM Parts: `ступица в сборе`, `ступица с подшипником`, `hub bearing kit`;
- UniTrade: `ступиця в зборі`, `маточина в зборі`, `ступиця з підшипником`, `wheel hub assembly`.

Результат повинен містити:
- `resultType = ASSEMBLY`;
- `fitmentStatus = MANUAL_REQUIRED`;
- `compatibilityTier = REVIEW_REQUIRED`;
- `requiresManualConfirmation = true`;
- `alternativeForCanonicalCode = <requested canonical code>`;
- reason: `Комплектна альтернатива — потребує підтвердження менеджера.`

## 4. Класифікація результатів

`resultType`:
- `ORIGINAL` — OE/OEM збіг і бренд відповідає vehicle brand;
- `OEM_REPLACEMENT` — OEM/OE-number based replacement іншого бренду;
- `ANALOG` — аналог/крос;
- `ASSEMBLY` — комплектна альтернатива;
- `UNKNOWN` — результат, який не можна безпечно класифікувати.

`compatibilityTier`:
- `CONFIRMED` — VERIFIED + exact;
- `PARTIAL` — VERIFIED, але exact=false;
- `REVIEW_REQUIRED` — manual/reference/assembly;
- `UNCONFIRMED` — немає достатнього fitment evidence.

## 5. Дедуплікація

Primary key для об’єднання offer-ів у межах постачальника:
`<supplierId>:<normalized brand>:<normalized article>`.

Якщо той самий offer приходить кількома шляхами, залишається запис з вищим rank:
1. confirmed fitment;
2. partial fitment;
3. original/OEM replacement;
4. analog;
5. available stock;
6. assembly нижче component result.

Причини пошуку не губляться: вони накопичуються у `matchReasons`.

## 6. Відображення у picker/modal

Для offer необхідно відображати:
- supplier;
- result type;
- article;
- brand;
- stock/availability;
- purchase price;
- sell price;
- delivery estimate, якщо API його надає;
- match reason;
- compatibility status;
- OE numbers;
- manual confirmation warning для assembly/unconfirmed;
- кнопку додавання.

Агрегована відповідь API має містити:
- total;
- originals;
- OEM replacements;
- analogs;
- assemblies;
- unknown;
- confirmed;
- partial;
- review required.

Поточний picker уже має вкладки та ручне підтвердження; `ASSEMBLY` належить до контрольованої групи review і ніколи не проходить VIN auto-select.

## 7. Збереження та аудит

Перед збереженням пропозиція повторно перевіряється сервером у live search.

Правила:
- VIN auto-flow — тільки confirmed exact OE/catalog fitment;
- PART_NUMBER/TEXT/ASSEMBLY — тільки після `manualConfirmation=true`;
- unavailable/stale offer — reject;
- purchase price required;
- supplier quote snapshot та audit event зберігаються.

## 8. Таблиця відповідностей / knowledge layer

Canonical knowledge продовжує зберігати:
- mechanic-facing name;
- canonical code/name;
- BM Parts aliases;
- UniTrade aliases;
- multilingual synonyms;
- OEM crosses;
- vehicle fitment;
- related/assembly alternatives.

Статуси knowledge record:
- approved;
- automatically found;
- needs review;
- rejected.

Для зв’язку component → assembly використовувати semantic relation `ASSEMBLY_OF` / `ALTERNATIVE`, але не synonym/equivalence.

## 9. API contract

`searchConfiguredSuppliers()` повертає:
- `offers[]`;
- `providers[]`;
- `supplierStatuses[]`;
- `configuredSuppliers[]`;
- `searchMode`;
- `resultSummary`;
- `cascade.references[]`;
- `cascade.assemblyFallback`;
- `blocked=false` для normal search flow.

## 10. Performance/safety

- supplier timeout: bounded;
- primary calls parallel;
- cascade refs bounded;
- assembly fallback only after zero relevant component results;
- one supplier failure does not cancel another;
- no production DB migration required for v1;
- diagnostic-card structure remains unchanged.

## 11. Acceptance criteria

1. Query `9036945003` is sent to every configured BM Parts/UniTrade adapter.
2. OEM discovered on the first provider becomes a second-stage key for the other provider.
3. Analogs are collected from supported analog endpoints and ordinary article search.
4. Duplicate supplier/article offers collapse into one best-ranked offer.
5. Unverified fitment does not block supplier API search.
6. Unverified result cannot auto-select.
7. Bearing search does not show unrelated assemblies as normal bearings.
8. If no bearing result exists, hub assembly fallback is executed.
9. Assembly result is explicitly typed `ASSEMBLY` and requires manual confirmation.
10. Existing mechanic-facing DK name is unchanged.
11. Existing price/stock/provider information remains available.
12. Contract smoke validates cascade seed `9036945003`, assembly fallback, and result classification.

## 12. Live verification still required

Code-level implementation can be completed without exposing secrets. Full production acceptance additionally requires:
- valid BM Parts and UniTrade credentials in the CRM environment;
- a real vehicle/VIN reproducing the case;
- live request for `9036945003`;
- confirmation of actual supplier payloads/analogs and delivery fields.

No claim of successful live UniTrade/BM Parts result should be made until that production request is executed against configured credentials.
