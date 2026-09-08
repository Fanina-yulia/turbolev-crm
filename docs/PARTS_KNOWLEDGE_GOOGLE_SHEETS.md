# Каталог знань запчастин у CRM і Google Sheets

CRM зберігає власний каталог у PostgreSQL і одночасно записує той самий валідований запис у Google Sheets. Це два паралельні записи в межах однієї дії користувача, а не автоматична синхронізація.

Google Sheets використовується як зручний зовнішній довідник для перегляду та ручного редагування. Ручні зміни в таблиці не імпортуються до CRM автоматично і не запускають зворотний запис. Legacy-імпорт із таблиці доступний лише явно через адміністративну дію.

Прайси та залишки не копіюються в цю таблицю: вони приходять з BM Parts/Unitrade через їхні API.

## Вкладки

Створіть вкладки з такими точними назвами:

- \`Parts\`
- \`Aliases\`
- \`Provider Terms\`
- \`Relations\`
- \`Operations\`
- \`Photos\`
- \`Unrecognized Terms\`

Перший рядок кожної вкладки — заголовки. Імпортер і записувач допускають нижній регістр, пробіли та дефіси, але назви полів нижче є канонічними.

### Parts

\`code | name | slug | status | category | source | source_version\`

Приклад:

\`WHEEL_HUB_BEARING | Підшипник маточини | wheel-bearing | ACTIVE | suspension | MANUAL | v1\`

\`status\`: \`DRAFT\`, \`ACTIVE\`, \`INACTIVE\`, \`MERGED\`, \`DEPRECATED\`. У підборі використовуються лише \`ACTIVE\` групи.

### Aliases

\`generic_code | alias | alias_type | language | provider | axis | side | sub_position | confidence | status | source | source_version\`

Приклад:

\`WHEEL_HUB_BEARING | ступічний підшипник | SYNONYM | uk | | FRONT | | | 100 | ACTIVE | MANUAL | v1\`

Типи alias: \`SYNONYM\`, \`MECHANIC_MISTAKE\`, \`ABBREVIATION\`, \`TRANSLATION\`, \`SEARCH_PHRASE\`, \`DO_NOT_USE\`.

### Provider Terms

\`generic_code | provider | term | language | axis | side | sub_position | confidence | status | source | source_version\`

\`provider\`: \`BM_PARTS\` або \`UNITRADE\`. Тут зберігаються саме формулювання постачальника, наприклад «ступичный подшипник».

Із CRM можна додати одразу канонічну назву, синоніми та provider terms. Вони будуть записані до відповідних вкладок одним dual-write запитом.

### Relations

\`from_code | to_code | relation_type | confidence | status | source | source_version | notes\`

Типові \`relation_type\`: \`RELATED\`, \`REQUIRES\`, \`KIT_COMPONENT\`, \`ASSEMBLY_OF\`, \`ALTERNATIVE\`, \`DO_NOT_CONFUSE_WITH\`.

### Operations

\`generic_code | operation_code | operation_name | service_code | position_rule | norm_minutes | default_quantity | status | source | source_version | notes\`

### Photos

\`generic_code | media_type | url | storage_key | rights | status | alt_text | sort_order | content_hash | source\`

Використовуйте тільки зображення, на які СТО має право використання. Для одного запису достатньо \`url\` або \`storage_key\`.

### Unrecognized Terms

\`raw_term | normalized_term | suggested_code | status | source | diagnostic_finding_id | metadata_json\`

Сюди можна завантажувати невідомі формулювання механіків для подальшого затвердження.

## Налаштування Google Sheets

1. Додайте service account як **Editor** до приватної таблиці. Для dual-write одного доступу Viewer недостатньо.
2. У Vercel/оточенні CRM задайте:
   - \`GOOGLE_SHEETS_PARTS_KNOWLEDGE_SPREADSHEET_ID\`;
   - \`GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON\`.
3. Service account використовує OAuth scope \`https://www.googleapis.com/auth/spreadsheets\`.
4. Один раз застосуйте міграції Prisma.
5. Один раз виконайте \`npm run parts:knowledge:seed\`, щоб додати стартові канонічні групи в CRM. Це bootstrap-операція; нові зміни каталогу робіть через \`UPSERT_DUAL\`.
6. Перевірте конфігурацію через \`GET /api/settings/parts-knowledge\`.

## Запис у два місця

Авторизований endpoint:

\`POST /api/settings/parts-knowledge\`

Тіло запиту:

\`\`\`json
{
  "action": "UPSERT_DUAL",
  "input": {
    "part": {
      "code": "WHEEL_HUB_BEARING",
      "name": "Підшипник маточини",
      "slug": "wheel-bearing",
      "status": "ACTIVE",
      "category": "suspension",
      "source": "MANUAL",
      "sourceVersion": "v1"
    },
    "aliases": [
      {
        "alias": "підшипник ступиці",
        "aliasType": "SYNONYM",
        "language": "uk",
        "confidence": 100
      },
      {
        "alias": "підшипник колеса",
        "aliasType": "SYNONYM",
        "language": "uk",
        "confidence": 95
      }
    ],
    "providerTerms": [
      {
        "term": "ступичный подшипник",
        "provider": "BM_PARTS",
        "language": "ru",
        "confidence": 90
      },
      {
        "term": "підшипник маточини",
        "provider": "UNITRADE",
        "language": "uk",
        "confidence": 90
      }
    ]
  }
}
\`\`\`

Під час однієї дії CRM:

1. нормалізує назву, синоніми й provider terms;
2. ідемпотентно записує GenericArticle та GenericArticleAlias у PostgreSQL;
3. **паралельно** записує/оновлює відповідні рядки у вкладках \`Parts\`, \`Aliases\` і \`Provider Terms\`;
4. зберігає результат обох каналів у \`PartsKnowledgeDualWrite\`.

Запис ідемпотентний за \`operationKey\`. Якщо його не передано, CRM створює детермінований ключ із нормалізованого payload. Повторний виклик не створює дублікати.

### Частковий успіх

Відповіді endpoint:

- \`200\` + \`SUCCEEDED\` — запис успішний у CRM і Google Sheets;
- \`207\` + \`PARTIAL\` — один канал записав, інший завершився помилкою;
- \`409\` + \`FAILED\` — обидва канали не записали;
- \`202\` + \`IN_PROGRESS\` — така сама операція вже виконується.

У відповіді є \`operationId\`, \`operationKey\`, окремі \`crm\` і \`googleSheets\`, а також помилка конкретного каналу в журналі.

### Повторна спроба

Після усунення причини помилки:

\`\`\`http
POST /api/settings/parts-knowledge
Content-Type: application/json

{
  "action": "RETRY_DUAL_WRITE",
  "operationId": "..."
}
\`\`\`

Повторна спроба безпечна: CRM та Google Sheets знову використовують ті самі ключі.

## Legacy-імпорт

Старий односпрямований імпорт Sheet → CRM не запускається автоматично. Його можна викликати лише явно:

\`\`\`json
{ "action": "SYNC_GOOGLE_SHEETS" }
\`\`\`

Використовуйте його тільки для разового backfill або міграції вже заповненої таблиці. Для звичайних додавань і змін завжди використовуйте \`UPSERT_DUAL\`.

## Як працює підбір

Найменування з діагностичної карти проходить через:

\`назва механіка → alias/провайдерський термін → GenericArticle → VIN/VehicleReference → VehicleFitment → OE → аналоги → пропозиції BM Parts/Unitrade\`

Якщо немає підтвердженого зв'язку автомобіля з OE-каталогом, CRM не робить глобальний пошук і не показує несумісні товари як придатні. Для неоднозначного або непідтвердженого результату залишається ручне підтвердження.
