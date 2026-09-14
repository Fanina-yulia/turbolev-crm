# TURBO LEV — ТЗ: відновлення пошуку запчастин v3

Дата: 14.09.2026
Статус: IMPLEMENTATION
Модуль: Підбір запчастин
Production URL: `/?section=parts`

## 1. Проблема

Для частини автомобілів popup «Підбір деталі» показував `0` пропозицій і повідомлення, що запит до API постачальників не відправлено через відсутність підтвердженого OE-зв’язку.

Production-аудит показав, що проблема складається з кількох незалежних факторів:

1. У CRM може бути валідний автомобіль і VIN, але не бути `VehicleCatalogLink` / `VehicleFitment`.
2. BM Parts може визначити автомобіль, але не знайти точну позицію за vehicle-scoped пошуком.
3. Відсутність VERIFIED fitment не повинна блокувати звичайний пошук BM Parts / UniTrade за назвою, артикулом, OE та крос-номерами.
4. Канонічні таблиці `GenericArticle` / `GenericArticleAlias` можуть бути порожніми, хоча статична термінологія вже є в коді.
5. UI не має трактувати `0` як «всі постачальники перевірені», якщо provider search фактично не виконувався.

## 2. Бізнес-правило

Підбір запчастин працює за принципом **search first, compatibility explicit**:

- відсутність VERIFIED fitment **не блокує** запит до постачальників;
- якщо exact OE/VIN fitment є — пропозиції можуть отримати `CONFIRMED`;
- якщо exact fitment немає — пропозиції все одно показуються, але з `REVIEW_REQUIRED` / ручним підтвердженням;
- комплектна деталь показується окремо як fallback і ніколи не прирівнюється до окремої деталі автоматично;
- CRM не вигадує OE, крос-номери або сумісність.

## 3. Канонічний pipeline

`ДК → автомобіль/VIN/держномер → нормалізація назви → canonical part family → VIN/OE fitment (якщо доступний) → BM Parts + UniTrade → OE/cross/analogs cascade → assembly fallback → manual compatibility gate → вибір → КП/ЗН`.

### 3.1 Якщо OE-каталог не готовий

Система повинна:

1. зберегти відомий контекст автомобіля;
2. виконати supplier search;
3. показати результати у вкладці «Перевірка» або з відповідною позначкою сумісності;
4. вимагати ручне підтвердження перед вибором;
5. не показувати повідомлення «API не відправлено», якщо API реально було викликано.

## 4. Джерела правди

### Автомобіль
- `Vehicle.id`
- `Vehicle.vin`
- `Vehicle.plateNumber`
- `Vehicle.brand/model/year`

### Канонічна термінологія
- `GenericArticle`
- `GenericArticleAlias`
- статичний словник `parts-terminology.service.ts` як bootstrap-source.

### Сумісність
- `VehicleCatalogLink`
- `VehicleFitment`
- BM Parts vehicle context / fitment evidence.

### Постачальники
- BM Parts live API;
- UniTrade live API;
- збережені credentials через `IntegrationCredential`.

## 5. Bootstrap canonical knowledge

`seedStaticPartKnowledge()` є ідемпотентним bootstrap-процесом.

Production release після успішного `next build` повинен запускати `scripts/parts-knowledge-seed.ts`.

Seed:
- створює/активує `GenericArticle` із затвердженої статичної термінології;
- створює/оновлює `GenericArticleAlias` через stable `identityKey`;
- не створює `VehicleFitment`;
- не створює фальшиві OE-номери;
- не підміняє supplier data.

Таким чином слово «амортизатор» стає реальною канонічною товарною групою CRM, але сумісність із конкретним автомобілем як і раніше потребує фактичного evidence.

## 6. Supplier fallback

`searchConfiguredSuppliers()` повинен залишатися незаблокованим при `NO_MATCH`, `CATALOG_NOT_CONNECTED`, `MANUAL_REQUIRED`, `REFERENCE_ONLY`.

Для vehicle-scoped VERIFIED fitment дозволено точніший provider search.

Для non-verified станів:
- BM Parts та UniTrade отримують normalized/canonical/name/article запити;
- OE/cross references використовуються, якщо відомі;
- знайдені результати позначаються `REVIEW_REQUIRED`;
- оператор не може вибрати їх без manual confirmation.

## 7. UI

Popup повинен розрізняти:

- `VIN-каталог підтверджено`;
- `Модель підтверджена · перевірте двигун`;
- `Сумісність не підтверджена`.

Якщо supplier search виконується без VERIFIED fitment, UI показує кількість підключених API та текст `результати потребують перевірки`.

`0` означає нуль після фактичного supplier search, а не hard-block до його запуску.

## 8. Release safety

Додати regression contract, який гарантує:

1. `parts-catalog-legacy.tsx` не містить старого hard-stop `vehicleScoped && fitment !== VERIFIED → return`;
2. frontend викликає supplier search навіть без verified fitment;
3. backend `searchConfiguredSuppliers()` повертає `blocked: false`;
4. manual confirmation gate залишається перед вибором непідтвердженої позиції;
5. production build запускає canonical knowledge seed після успішного Next build;
6. seed є idempotent через upsert/identityKey;
7. BM Parts та UniTrade залишаються в supplier registry.

## 9. Acceptance criteria

- Для авто з валідним CRM context, але без `VehicleCatalogLink`, supplier search все одно виконується.
- BM Parts `NO_MATCH` не припиняє UniTrade/free-text cascade.
- Непідтверджена пропозиція не може бути автоматично вибрана.
- `GenericArticle` та `GenericArticleAlias` після production deploy не порожні.
- `VehicleFitment` не заповнюється штучно bootstrap-seed'ом.
- Production CI зелений.
- Production Vercel deployment `READY`.
- Після релізу немає нових runtime error clusters для parts API.
