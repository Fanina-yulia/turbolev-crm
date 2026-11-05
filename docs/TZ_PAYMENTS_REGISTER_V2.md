# Технічне завдання — Payments Register V2

**Проєкт:** Turbo LEV CRM  
**Модуль:** Оплати  
**Версія:** V2  
**Дата:** 2026-10-06  
**Стандарти:** CRM-UI-004, CRM-UI-005, CRM-UI-006  
**Scope:** внутрішня CRM; Кабінет механіка не змінюється.

## 1. Мета

Сторінка «Оплати» є єдиним операційним реєстром:

- хто вже оплатив;
- у кого є часткова оплата / передплата;
- хто ще очікує оплату;
- хто прострочив оплату;
- скільки фактично отримано;
- скільки залишилось отримати.

Сторінка не є лише чергою боржників. Повністю оплачені КП/ЗН залишаються доступними в реєстрі й історії.

## 2. Фінансова істина

### Сума
Береться з `FinancialObligation(direction=RECEIVABLE)`, сформованого фіналізацією фактичних фінансів WorkOrder.

### Сплачено
`FinancialObligation.settledAmount`.

### Залишок
`max(0, amount - settledAmount)`.

### Фактичний платіж
Тільки `CashTransaction(status=POSTED, sourceEntity=WORK_ORDER_PAYMENT)`.

UI не створює власну паралельну фінансову модель і не визначає оплату через workflow-статус автомобіля.

## 3. Автоматичні статуси

### Green — PAID
Умова:

`outstanding <= 0` і `total > 0`.

UI:
- зелена ліва смуга;
- м’який зелений фон;
- badge «Оплачено повністю»;
- primary action «Відкрити».

### Yellow — PARTIAL
Умова:

`paid > 0 && outstanding > 0`.

UI:
- жовта ліва смуга;
- м’який жовтий фон;
- badge «Є передплата»;
- primary action «Доплатити».

### Red — DUE
Умова:

`paid = 0 && outstanding > 0`.

UI:
- червона ліва смуга;
- м’який червоний фон;
- badge «Очікує оплату»;
- primary action «Прийняти оплату».

### Overdue
Не є четвертим базовим фінансовим статусом.

Якщо `outstanding > 0` і строк `dueAt` минув або obligation має `OVERDUE`, додається badge «Прострочено».

## 4. Верхні KPI

Рівно 4 картки:

1. **До отримання**
   - сума всіх відкритих залишків;
   - кількість КП із залишком.

2. **Оплачено сьогодні**
   - сума фактичних POSTED WorkOrder платежів за поточний київський день.

3. **Є передплата**
   - кількість PARTIAL;
   - сума залишків PARTIAL.

4. **Очікують оплату**
   - кількість DUE;
   - сума залишків DUE.

Критично: текстовий пошук **не змінює KPI**. KPI залежать від permission/location scope і фінансових фактів, але не від рядка пошуку.

## 5. Toolbar

Один компактний рядок:

- Search;
- Сьогодні;
- 7 днів;
- 30 днів;
- Місяць;
- Період;
- Від;
- До;
- СТО.

Пошук:
- держномер;
- VIN;
- ПІБ;
- телефон;
- № КП/ЗН.

Періоди синхронізуються з Від/До.
Ручна зміна Від/До переводить preset у «Період».

## 6. Period semantics

Відкриті DUE/PARTIAL/OVERDUE записи показуються незалежно від їхнього віку, бо це чинна дебіторка.

PAID записи показуються за вибраний період по `settledAt`.

Пошук може знайти старий PAID WorkOrder поза вибраним періодом, але це не змінює KPI.

## 7. Status tabs

- Усі;
- Оплачено повністю;
- Є передплата;
- Очікує оплату;
- Прострочено.

Status tabs фільтрують register rows.

## 8. Основний реєстр

Колонки:

1. Авто;
2. Клієнт;
3. КП / ЗН;
4. Сума;
5. Сплачено;
6. Залишок;
7. Статус;
8. Остання оплата;
9. Дія.

Desktop register має page-owned internal scroll відповідно до CRM-UI-004.

## 9. Row interaction

Клік по рядку відкриває правий detail drawer.

Drawer містить:
- авто;
- клієнта;
- фінансовий статус;
- загальну суму;
- сплачено;
- залишок;
- телефон;
- КП/ЗН;
- due date;
- історію оплат;
- кнопку «Відкрити КП / ЗН»;
- кнопку «Прийняти оплату» або «Доплатити».

## 10. Історія оплат

Для WorkOrder показуються останні фактичні POSTED `WORK_ORDER_PAYMENT`:

- сума;
- дата/час;
- money account;
- тип account.

Платіж після проведення не видаляється з історії UI.

## 11. Прийняття оплати

Modal:
- залишок;
- сума платежу;
- дата і час;
- money account;
- підтвердження.

Default amount = весь залишок.

Після POST:
- оновлюється obligation;
- сторінка перечитує server read-model;
- статус автоматично змінюється DUE → PARTIAL → PAID;
- dispatch `turbolev:data-changed`;
- ручного перемикання статусу немає.

## 12. Переплата

Payments V2 не робить неатомарний split через два API.

Якщо введена сума > outstanding:
- операція блокується;
- UI пояснює, що переплату потрібно оформити як Customer Advance через існуючий finance settlement workflow.

Це свідомий safety rule: не створювати ризик, що погашення КП успішне, а створення авансу впало другим запитом.

Окремий атомарний overpayment-to-advance command може бути наступним етапом.

## 13. Search isolation

Search може змінити:
- видимі rows;
- лічильники status tabs у контексті search.

Search не змінює:
- KPI;
- загальну фінансову істину;
- permission/location scope.

## 14. Permissions

Read:
`PERMISSIONS.PAYMENTS_READ` + location scope.

Write:
чинний endpoint WorkOrder payment використовує `PERMISSIONS.PAYMENTS_WRITE`.

Нових обходів RBAC не створювати.

## 15. Empty states

Не показувати порожню «касова черга».

Варіанти:
- «За цим пошуком записів не знайдено.»
- «У вибраному статусі записів немає.»

KPI при цьому залишаються видимими.

## 16. UI standards

- CRM-UI-004: register має власний bounded scroll;
- CRM-UI-005: design scale 0.90;
- CRM-UI-006: canonical CrmPageHeader;
- font floor >= 11px;
- no body horizontal scroll;
- table horizontal scroll — тільки всередині register;
- drawer/modal <= viewport.

## 17. Acceptance criteria

1. Повністю оплачені записи залишаються у Payments.
2. PAID green, PARTIAL yellow, DUE red.
3. Overdue — secondary red badge.
4. KPI не обнуляються через search.
5. Search знаходить авто/клієнта/телефон/VIN/КП.
6. Status tabs працюють.
7. Period presets синхронізують Від/До.
8. Location scope збережений.
9. Row drawer показує історію фактичних платежів.
10. Payment modal проводить payment через canonical WorkOrder finance endpoint.
11. Після payment статус оновлюється автоматично.
12. Amount > outstanding блокується.
13. Mechanic Cabinet не змінений.
14. Production build і static contract проходять.
