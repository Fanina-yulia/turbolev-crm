# Каталог знань запчастин у Google Sheets

CRM використовує Google Sheet як редагований майстер-довідник, а PostgreSQL CRM — як швидку робочу копію. Прайси та залишки не копіюються в цю таблицю: вони приходять з BM Parts/Unitrade через їхні API.

## Вкладки

Створіть вкладки з такими точними назвами:

- `Parts`
- `Aliases`
- `Provider Terms`
- `Relations`
- `Operations`
- `Photos`
- `Unrecognized Terms`

Перший рядок кожної вкладки — заголовки. Імпортер допускає нижній регістр, пробіли та дефіси, але назви полів нижче є канонічними.

### Parts

`code | name | slug | status | category | source | source_version`

Приклад:

`WHEEL_HUB_BEARING | Підшипник маточини | wheel-bearing | ACTIVE | suspension | MANUAL | v1`

`status`: `DRAFT`, `ACTIVE`, `INACTIVE`, `MERGED`, `DEPRECATED`. У підборі використовуються лише `ACTIVE` групи.

### Aliases

`generic_code | alias | alias_type | language | provider | axis | side | sub_position | confidence | status | source | source_version`

Приклад:

`WHEEL_HUB_BEARING | ступічний підшипник | SYNONYM | uk | | FRONT | | | 100 | ACTIVE | MANUAL | v1`

Типи alias: `SYNONYM`, `MECHANIC_MISTAKE`, `ABBREVIATION`, `TRANSLATION`, `SEARCH_PHRASE`, `DO_NOT_USE`.

### Provider Terms

`generic_code | provider | term | language | axis | side | sub_position | confidence | status | source | source_version`

`provider`: `BM_PARTS` або `UNITRADE`. Тут зберігаються саме формулювання постачальника, наприклад «ступичный подшипник».

### Relations

`from_code | to_code | relation_type | confidence | status | source | source_version | notes`

Типові `relation_type`: `RELATED`, `REQUIRES`, `KIT_COMPONENT`, `ASSEMBLY_OF`, `ALTERNATIVE`, `DO_NOT_CONFUSE_WITH`.

### Operations

`generic_code | operation_code | operation_name | service_code | position_rule | norm_minutes | default_quantity | status | source | source_version | notes`

`service_code` — код позиції в існуючому прайс-каталозі робіт. Якщо його немає, операція все одно зберігається як знання, але не підміняє ціну роботи.

### Photos

`generic_code | media_type | url | storage_key | rights | status | alt_text | sort_order | content_hash | source`

Використовуйте тільки зображення, на які СТО має право використання. Для одного запису достатньо `url` або `storage_key`.

### Unrecognized Terms

`raw_term | normalized_term | suggested_code | status | source | diagnostic_finding_id | metadata_json`

Сюди можна завантажувати невідомі формулювання механіків для подальшого затвердження.

## Синхронізація

1. Додайте service account як Viewer до приватної таблиці.
2. У Vercel/оточенні CRM задайте:
   - `GOOGLE_SHEETS_PARTS_KNOWLEDGE_SPREADSHEET_ID`;
   - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`.
3. Один раз застосуйте міграцію Prisma.
4. Один раз виконайте `npm run parts:knowledge:seed`, щоб додати базові 12 канонічних груп і синоніми.
5. Для імпорту змін викличте авторизований endpoint `POST /api/settings/parts-knowledge` з `{"action":"SYNC_GOOGLE_SHEETS"}`.
6. Перевірте статус через `GET /api/settings/parts-knowledge`.

Імпорт ідемпотентний: повторний запуск оновлює записи за стабільним ключем, не створюючи дублікати. Невалідні рядки не зупиняють увесь пакет — вони потрапляють у `CatalogImportRecord` зі статусом `REJECTED`, а пакет зберігає підсумок конфліктів.

## Як працює підбір

Найменування з діагностичної карти проходить через:

`назва механіка → alias/провайдерський термін → GenericArticle → VIN/VehicleReference → VehicleFitment → OE → аналоги → пропозиції BM Parts/Unitrade`

Якщо немає підтвердженого зв'язку автомобіля з OE-каталогом, CRM не робить глобальний пошук і не показує несумісні товари як придатні. Для неоднозначного або непідтвердженого результату залишається ручне підтвердження.

Синхронізація таблиці не копіює в CRM повний каталог постачальника, ціни або залишки. Вона зберігає лише власні канонічні правила, а актуальні комерційні дані читаються з API постачальника.
