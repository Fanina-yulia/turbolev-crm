# Технічне завдання P0-05 — role E2E та єдиний контракт ролей

## 1. Мета

Забезпечити, щоб один і той самий стабільний role code використовувався у:

- AccessRole/RBAC;
- workflow definitions та відповідальних ролях;
- серверному визначенні кабінету;
- клієнтському `RoleAwareOverview`;
- smoke/readiness перевірках.

Назви ролей українською є presentation layer і можуть змінюватися без зміни дозволів.

## 2. Канонічні коди

| Код | Відображення | Кабінет |
|---|---|---|
| `OWNER` | Власник | Owner |
| `EXECUTIVE_DIRECTOR` | Виконавчий директор | Owner |
| `STATION_MANAGER` | Керівник станції | Station Manager |
| `SERVICE_ADVISOR` | Сервіс-менеджер | Service Advisor |
| `MECHANIC` | Механік | Mechanic |
| `PARTS_SPECIALIST` | Менеджер з запчастин | Parts |
| `WAREHOUSE_KEEPER` | Комірник | Parts |
| `HEAD_OF_SALES` | Керівник відділу продажів | Sales |
| `SALES` | Менеджер з продажу | Sales |
| `ACCOUNTANT` | Бухгалтер | Station Overview |
| `MARKETING_DIRECTOR` | Директор з маркетингу | Station Overview |
| `MARKETER` | Маркетолог | Station Overview |
| `HR_MANAGER` | HR-менеджер | Station Overview |
| `ADMINISTRATOR` | Адміністратор | Station Overview |
| `CRM_ADMIN` | CRM-адміністратор | Station Overview |

Єдиний source of truth: `src/security/role-contract.ts`.

## 3. Legacy compatibility

Застарілі коди не використовуються для нових призначень і нормалізуються тільки на compatibility boundary:

- `SERVICE_MANAGER → SERVICE_ADVISOR`;
- `PARTS_MANAGER → PARTS_SPECIALIST`;
- `QUALITY_CONTROLLER → STATION_MANAGER`;
- `CASHIER_ACCOUNTING → ACCOUNTANT`;
- `ADMIN → ADMINISTRATOR`;
- `SHIFT_MASTER → MECHANIC`.

Невідомий код не дає доступ і не відкриває спеціальний кабінет.

## 4. E2E правила маршрутизації кабінету

1. OWNER/EXECUTIVE_DIRECTOR мають пріоритет над іншими ролями та бачать Owner Control Center.
2. Для декількох ролей пріоритет визначає `isPrimary`, якщо немає Owner.
3. SERVICE_ADVISOR відкриває Service Advisor Cabinet.
4. PARTS_SPECIALIST/WAREHOUSE_KEEPER відкривають Parts Cabinet.
5. HEAD_OF_SALES/SALES відкривають Sales Cabinet.
6. MECHANIC відкриває Mechanic Cabinet.
7. STATION_MANAGER відкриває Station Manager Cabinet.
8. ACCOUNTANT, HR, Marketing, Administrator та CRM Admin мають безпечний Station Overview fallback до появи окремого спеціалізованого UI.
9. Сервер і браузер використовують одну функцію `resolveRoleCabinet`.

## 5. Доступи

Role cabinet не є авторизацією. Перед відкриттям модуля та кожною mutation API додатково перевіряються:

- provisioning state;
- enforcement mode;
- permission code;
- scope;
- owner view-as read-only обмеження.

## 6. Перевірки

- `scripts/role-cabinet-contract-smoke.ts` перевіряє всі canonical коди, aliases та priority routing;
- `scripts/rbac-smoke.ts` отримує перелік canonical ролей з того самого контракту;
- existing `rbac-production-readiness` перевіряє реальні призначення, primary role, location та permission matrix;
- production build запускає contract/navigation/security smokes.

## 7. Acceptance criteria

1. У коді немає другого незалежного списку активних role codes.
2. Workflow labels включають усі активні RBAC ролі.
3. Legacy role alias не створює окремий кабінет.
4. Серверний та клієнтський routing повертають однаковий cabinet code.
5. Owner view-as не отримує mutation-доступ.
6. Немає ролі без primary assignment у readiness звіті.
7. MECHANIC має тільки призначені діагностики/роботи та власну зарплату.
8. SERVICE_ADVISOR не отримує фінансове адміністрування.
9. Contract smoke проходить, PR злитий, production deployment READY.
