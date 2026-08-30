# Turbo LEV CRM — Module Map

## Навіщо це існує
Цей файл є першою точкою входу для будь-якої зміни в CRM. Перед аналізом усього репозиторію спочатку визначаємо модуль, читаємо його паспорт у `docs/modules/README.md`, відкриваємо його власні файли і лише після цього — заявлені залежності.

> Правило: **не аналізувати всю систему за замовчуванням**. Аналіз розширюється тільки коли зміна перетинає межу модуля, змінює спільну сутність, permission, workflow, Prisma-модель або API-контракт.

## Основні модулі

| ID | Модуль | Основна відповідальність | Ключові залежності |
|---|---|---|---|
| `core-platform` | Core / Platform | auth, routing, security, Prisma, deploy | — |
| `dashboard-analytics` | Dashboard / Analytics | огляд станції, KPI, метрики | finance, work-orders, planner |
| `clients-vehicles` | Clients & Vehicles | клієнти, авто, власник, VIN/номер | leads, planner, diagnostics, images |
| `leads-intake` | Leads & Intake | ліди, заявки, приймання, конвертація | clients, planner, diagnostics |
| `planner` | Planner | день/тиждень, записи, пости, прибуття | clients, personnel, diagnostics |
| `diagnostics` | Diagnostics | діагностика, призначення, підтвердження | planner, mechanic, work-orders |
| `work-orders` | Work Orders | ремонт, рядки робіт, статуси, gates | diagnostics, parts, finance |
| `service-manager` | Service Manager Cabinet | супровід клієнта і ремонту | clients, planner, work-orders, parts |
| `mechanic-cabinet` | Mechanic Cabinet | авто механіка, задачі, findings | planner, diagnostics, notifications |
| `parts-inventory` | Parts & Inventory | підбір, постачальники, склад | vehicles, work-orders, finance |
| `personnel-access` | Personnel & Access | працівники, посади, ролі, permissions | core, planner, cabinets |
| `finance` | Finance | оплати, баланс, зарплата, економіка | work-orders, parts, personnel |
| `vehicle-images` | Vehicle Images | OpenAI, шаблони моделей, кольори | vehicles, integrations |
| `notifications` | Notifications | системні сповіщення | cabinets, work-orders, leads |
| `communications` | Communications | дзвінки, callback, omnichannel | leads, clients, integrations |
| `settings-integrations` | Settings & Integrations | API, credentials, камери, настройки | core |

## Наскрізний бізнес-маршрут

`LEAD → INTAKE/BOOKING → ARRIVED → DIAGNOSTICS → WORK ORDER → PARTS/APPROVAL → REPAIR → QC → PAYMENT → CLOSED`

Сутності клієнта та авто проходять через кілька модулів, тому зміна `Vehicle`, `Client`, статусної машини, permissions або Prisma schema завжди вважається **cross-module**.

## Як обробляти нову задачу

1. Визначити 1 головний модуль за словами задачі.
2. Запустити `npm run module:scope -- --files <paths...>` якщо вже відомі файли, або `npm run module:scope -- --base origin/main` для diff гілки.
3. Прочитати паспорт головного модуля.
4. Відкрити тільки його `paths` з `docs/modules/module-registry.json`.
5. Якщо змінюється API-контракт, БД, permission, workflow або спільна сутність — додати declared dependencies до перевірки.
6. Перед merge виконати smoke checks головного модуля та залежностей, які реально зачеплені.
7. Якщо з'явився новий функціональний блок — додати його до registry і паспорта в тому самому PR.

## Обов'язкове правило повного аудиту

`CRM-AUDIT-001` із [таблиці стандартів](./CRM_STANDARDS_TABLE.md) є обов'язковим,
якщо користувач просить «перевір всю CRM» або зміна зачіпає глобальні межі системи.
У такому випадку перевіряються всі модулі реєстру, їхні залежності, спільні
сутності, API, permissions, workflow, UI, інтеграції та production runtime.
Модульний smoke одного розділу не може бути виданий за результат повного аудиту.

## Коли потрібен широкий системний аналіз

Широкий аналіз виправданий лише для:
- зміни Prisma schema / міграцій, що зачіпають спільні сутності;
- auth / permissions / cabinet routing;
- глобальної статусної машини;
- фінансових gates;
- масового рефакторингу shared components;
- зміни контракту, який використовують 3+ модулі;
- production incident з невідомим джерелом.

В усіх інших випадках починаємо з локального модуля.

## Машинозчитувана карта
Повний реєстр ключових слів, path patterns, залежностей та smoke checks: `docs/modules/module-registry.json`.
