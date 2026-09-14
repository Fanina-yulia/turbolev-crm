# TURBO LEV CRM — ТЗ v2: UI комплектних альтернатив і навчання підбору

Дата: 2026-09-14
Статус: implemented in feature branch
Scope: UI підбору запчастин, server-side підтвердження вибору, knowledge/feedback layer. Структура Діагностичної карти не змінюється.

## 1. Мета

Довести каскадний пошук BM Parts + UniTrade до завершеного операторського сценарію:

- не блокувати supplier API тільки через відсутність exact OE fitment;
- окремо показувати комплектні альтернативи;
- не дозволяти `ASSEMBLY` без явного ручного підтвердження;
- повторно перевіряти обрану пропозицію на сервері;
- зберігати причину відповідності та тип результату з live supplier response;
- використовувати фактичні вибори менеджера як контрольований feedback для knowledge-каталогу;
- не автоматично активувати нову відповідність без review.

## 2. UI

Picker має вкладки:

- Усі;
- Оригінали;
- Аналоги;
- Комплектні;
- Перевірка.

`Комплектні` містить тільки `resultType=ASSEMBLY` / `sourceKind=ASSEMBLY`.

Для комплектної альтернативи показується явне повідомлення:

`Комплектна альтернатива — потребує підтвердження менеджера`.

Кнопка додавання комплектної альтернативи недоступна, поки оператор не підтвердив ручну перевірку сумісності, позиції та складу комплекту.

## 3. Непідтверджений fitment

Frontend не має права достроково припиняти supplier search лише тому, що `fitment.status !== VERIFIED`.

Запит виконується, а результати маркуються рівнем:

- CONFIRMED;
- PARTIAL;
- REVIEW_REQUIRED;
- UNCONFIRMED.

Результат без достатнього evidence не може пройти auto-select.

## 4. Server-side selection evidence

Після натискання `Додати` сервер повторно виконує supplier search.

Тип, compatibility tier, source kind, reason і match reasons беруться тільки з повторно знайденого `liveOffer`. Значення з браузера не є джерелом істини для аудиту/knowledge.

Для `ASSEMBLY` сервер додатково вимагає `manualConfirmation=true` навіть якщо клієнтський UI буде обійдений.

## 5. Збереження вибору

У WorkOrderLine metadata та AuditEvent зберігаються:

- resultType;
- compatibilityTier;
- sourceKind;
- offerReason;
- matchReasons;
- requiresManualConfirmation;
- факт manualConfirmation;
- fitment status/exact/confidence/source/reason;
- supplier/quote/article/price snapshot.

Для `ASSEMBLY` note у PartsRequestItem прямо фіксує, що це комплектна альтернатива, підтверджена менеджером.

## 6. Knowledge/feedback

Кожен успішний вибір створює PartSearchFeedback.

Якщо canonical GenericArticle відомий:

- supplier article, якого ще немає у verified external references, створює `PartCatalogChange` зі статусом `PENDING`, action `PROPOSE_SUPPLIER_REFERENCE`;
- комплектна альтернатива створює `PartCatalogChange` зі статусом `PENDING`, action `PROPOSE_ASSEMBLY_ALTERNATIVE`.

Жоден новий supplier cross або assembly relation не стає ACTIVE/APPROVED автоматично.

Canonical article для knowledge визначається за переданим `genericArticleId`, а якщо його немає — за `canonicalCode`.

## 7. Acceptance criteria

1. Відсутність exact OE fitment не зупиняє supplier API request у frontend.
2. `ASSEMBLY` має окрему вкладку та лічильник.
3. `ASSEMBLY` не входить до звичайних OEM/analog buckets.
4. Без checkbox ручної перевірки assembly не можна додати.
5. Server-side gate дублює цей контроль і не довіряє UI.
6. Аудит використовує liveOffer classification/evidence.
7. Вибрана assembly позиція зберігається в PartsRequest як комплектна альтернатива.
8. Вибір створює feedback record.
9. Нова supplier-відповідність/assembly mapping створюється як PENDING catalog change.
10. Існуюча підтверджена external reference не дублюється як новий кандидат.
11. Структура ДК не змінюється.
12. Нової DB migration не потрібно.
13. Smoke contract перевіряє ключові frontend/server/knowledge invariants.
