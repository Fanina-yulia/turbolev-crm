# TURBO LEV CRM — WALK-IN Lifecycle + Planner Truth + Finance Recognition

**Дата:** 2026-10-06  
**Гілка:** `fix/walkin-lifecycle-finance-truth-20261006`

## 1. Проблема

Production-аудит показав реальний розрив між фактом роботи і даними Планувальника.

Чотири позапланові діагностики фактично:
- приїхали 05.10 ввечері;
- почали діагностику 05.10;
- завершили діагностику та отримали оплату 05.10;

але `plannedStartAt` був автоматично перенесений на 06.10.

Через це CRM створювала хибну картину «оплата раніше діагностики».

Причина: WALK-IN, який запускався зараз, використовував пошук найближчого вільного планового слота до 31 дня вперед. Фактичний процес стартував одразу, а планове вікно могло опинитися завтра.

Додатково:
- два записи на одному пості могли візуально накладатися;
- P&L revenue WALK-IN створювався разом із платежем;
- KPI «Гроші зараз» виглядав як показник вибраного періоду, хоча це поточний накопичений залишок.

## 2. Канонічний WALK-IN lifecycle

```text
Авто приїхало без запису
        ↓
Механік запускає WALK-IN
        ↓
actualArrivalAt = NOW
actualStartAt = NOW
plannedStartAt = NOW (технічне вікно для Planner)
plannedEndAt = NOW + 60 хв
        ↓
Якщо пост вільний зараз → займаємо пост
Якщо всі пости зайняті → "Без поста / зона приймання"
        ↓
Діагностика
        ↓
SUBMITTED / CONFIRMED
        ↓
Revenue + Receivable
        ↓
WAITING_PAYMENT
        ↓
Фактична оплата
        ↓
CashTransaction / Cash Flow
        ↓
Завершити візит або передати на розрахунок ремонту
```

## 3. Заборона майбутнього WALK-IN

WALK-IN означає фактичний заїзд «зараз».

Заборонено:
- шукати наступний вільний день;
- переносити фактичний візит на завтра;
- створювати майбутній `plannedStartAt`, якщо `actualStartAt` уже настав.

Якщо посту немає — запис залишається в поточному часі без поста.

## 4. Planner factual time

Для `source = WALK_IN`:
- display date/time = `actualStartAt || actualArrivalAt`;
- fallback на `plannedStartAt` допускається тільки для legacy WALK-IN без actual facts;
- day/week view використовують фактичний день;
- popup показує «ФАКТИЧНІ ДАТА ТА ЧАС»;
- фактичний WALK-IN не можна drag/resize як майбутній плановий запис.

Серверний `getPlannerBoard` теж включає WALK-IN за `actualStartAt/actualArrivalAt`, тому historical misplanned rows не зникають із правильного дня.

## 5. Позаробочий час

Якщо WALK-IN реально був після стандартного `closeMinute`, денний Planner динамічно розширює видимий часовий діапазон до фактичної події.

CRM не має права:
- приховувати реальну подію;
- переносити її на наступний день лише для того, щоб вона помістилася в сітку.

## 6. Overlap

Якщо історичні або конкурентні записи мають однаковий пост/час:
- жодна картка не перекриває іншу повністю;
- collision group ділить доступну ширину між картками;
- усі записи залишаються клікабельними.

Для нових WALK-IN location-level advisory lock зменшує race condition при одночасному виборі поста.

## 7. Revenue vs Cash Flow

### 7.1 Завершення діагностики

Коли diagnostic review переходить у `SUBMITTED/CONFIRMED`:
- створюється/підтверджується `FinancialEvent REVENUE`;
- створюється `FinancialObligation RECEIVABLE`;
- `recognizedAt` = момент завершення діагностики;
- CashTransaction ще НЕ створюється.

Для налаштованої базової ціни (наприклад 600 грн) charge формується автоматично.

### 7.2 Оплата

Під час фактичної оплати:
- hard-gate вимагає SUBMITTED/CONFIRMED;
- створюється `CashTransaction INFLOW`;
- `occurredAt` = фактичний момент отримання грошей;
- receivable закривається;
- P&L `recognizedAt` не переноситься на дату платежу.

Якщо механік перед оплатою коригує фінальну суму і платежу ще немає, amount charge/receivable може бути уточнений, але дата визнання доходу залишається датою завершення діагностики.

## 8. Planner finance state

Planner читає для WALK-IN не тільки payment, а й factual `FinancialObligation`.

До оплати:
- amount = фактичне нарахування;
- paid = 0;
- outstanding = amount;
- status = UNPAID.

Після оплати:
- paid = amount;
- outstanding = 0;
- status = PAID.

## 9. Financial Center UX

Картка:
- **«Гроші зараз» → «Залишок коштів зараз»**;
- показує breakdown активних рахунків;
- має пояснення **«не залежить від періоду»**.

Cash Flow KPI:
- **«Рух грошей за період»**;
- note: «Надійшло X · сплачено Y».

Таким чином користувач не плутає:
- stock: скільки грошей є зараз;
- flow: скільки грошей зайшло/вийшло за вибраний період.

## 10. Історичні записи

Production-аудит виявив п'ять WALK-IN, де factual day != planned day.

Після green preview буде виконано одноразовий контрольований repair:
- тільки `source='WALK_IN'`;
- тільки rows з actualStart/actualArrival;
- тільки якщо Kyiv calendar day відрізняється;
- `plannedStartAt = factual start`;
- `plannedEndAt = factual start + original duration`.

Це прибере ghost-reservations на майбутніх слотах.

## 11. Safety

- schema migration не потрібна;
- нових таблиць/індексів немає;
- payment hard-gate не послаблюється;
- повторна оплата лишається idempotent;
- Revenue/Cash Flow не дублюються через existing sourceEntity keys + advisory locks;
- historical data repair обмежений фактично підтвердженими WALK-IN.

## 12. Acceptance criteria

1. Новий WALK-IN не може отримати tomorrow planned slot.
2. Якщо пост вільний зараз — він використовується.
3. Якщо постів немає — WALK-IN залишається «Без поста» зараз.
4. Planner day/week показує WALK-IN за actual date/time.
5. After-hours WALK-IN видимий у розширеній сітці.
6. Два overlapping records не приховують один одного.
7. Завершення діагностики створює Revenue + Receivable без CashTransaction.
8. Оплата створює CashTransaction і закриває Receivable.
9. Payment не змінює revenue recognition date.
10. Planner показує factual amount/outstanding до оплати.
11. Financial Center чітко розділяє current balance і period cash flow.
12. Existing integration smoke PASS.
13. New contract smoke PASS.
14. TypeScript + Next build PASS.
15. Exact-commit preview READY.
16. Production deploy READY.
17. Post-deploy runtime error/fatal scan clean.
