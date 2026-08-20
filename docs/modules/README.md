# Turbo LEV CRM — Паспорти модулів

Цей документ — короткий operational guide. Для кожної задачі спочатку знайди модуль тут, потім використовуй `module-registry.json` для точних path patterns і залежностей.

## 1. Core / Platform (`core-platform`)
**Відповідає за:** авторизацію, routing, CRM shell, security, shared libs, Prisma, міграції, production build.

**Не змінювати без cross-module перевірки:** permissions, role routing, Prisma schema, глобальні enum/status, build/deploy scripts.

**Перевірити після змін:** login/redirect, role routing, build, migration status, 5xx.

---

## 2. Dashboard / Analytics (`dashboard-analytics`)
**Відповідає за:** огляд станції, KPI, агреговані показники.

**Читає дані з:** finance, work-orders, planner, personnel.

**Перевірити:** сторінка відкривається, показники не дублюються, суми/лічильники відповідають джерелам.

---

## 3. Clients & Vehicles (`clients-vehicles`)
**Відповідає за:** клієнта, власника авто, картку автомобіля, VIN, держномер, марку/модель/рік/кузов/колір.

**Критичні залежності:** lead conversion, planner, diagnostics, work orders, vehicle images.

**Перевірити:** однаковий власник у всіх кабінетах, пошук VIN/номер, відсутність дублювання авто, картка авто.

---

## 4. Leads & Intake (`leads-intake`)
**Відповідає за:** нові ліди, заявки, первинні дані, конвертацію в Client + Vehicle, intake.

**Критичні залежності:** clients-vehicles, planner, diagnostics, communications.

**Перевірити:** create/convert, повторний виклик не створює дубль, vehicle/client зв'язок правильний.

---

## 5. Planner (`planner`)
**Відповідає за:** день/тиждень, записи, пости, механіків, час, ARRIVED.

**Критичні залежності:** personnel, clients, diagnostics, mechanic cabinet.

**Перевірити:** day/week, створення/перенесення, конфлікти постів/механіків, ARRIVED flow.

---

## 6. Diagnostics (`diagnostics`)
**Відповідає за:** diagnostic request, assignment, findings, confirmation.

**Головний gate:** WorkOrder не повинен стартувати раніше підтвердженої діагностики, якщо workflow цього вимагає.

**Перевірити:** призначення, findings, confirmation, перехід у work-order.

---

## 7. Work Orders (`work-orders`)
**Відповідає за:** замовлення-наряд, роботи, line items, статуси, погодження, ремонтні gates.

**Критичні залежності:** diagnostics, parts, finance, mechanic/service cabinets, notifications.

**Перевірити:** створення, статусні переходи, додавання робіт, QC/payment gates, balance.

---

## 8. Service Manager Cabinet (`service-manager`)
**Відповідає за:** робочий простір сервіс-менеджера, клієнт/авто, погодження, супровід ремонту.

**Повинен бачити:** актуального власника авто, потрібні дані авто, стан ремонту, запчастини/погодження в межах прав.

**Перевірити:** cabinet load, owner consistency, клікабельні переходи, погодження.

---

## 9. Mechanic Cabinet (`mechanic-cabinet`)
**Відповідає за:** призначені авто, задачі, findings, support/clarification, mechanic notifications.

**Правило:** спеціалізація працівника не створює окремого кабінету, якщо CRM-функціонал однаковий.

**Перевірити:** assigned vehicles, task updates, findings, сповіщення, mobile layout, рольовий доступ.

---

## 10. Parts & Inventory (`parts-inventory`)
**Відповідає за:** VIN/номер → авто → підбір, catalog/OEM, supplier offers, закупівлю, склад.

**Критичні залежності:** vehicle identity, work-order, finance, supplier integrations.

**Перевірити:** VIN і plate search, fitment context, пропозиції постачальників, прив'язка до ремонту.

---

## 11. Personnel & Access (`personnel-access`)
**Відповідає за:** Employee, категорії, посади, системні ролі, permissions, cabinet routing.

**Модель:** категорія → посада → системна роль → права/кабінет. Категорія сама по собі прав не дає.

**Перевірити:** список, картка працівника, одна основна роль, cabinet routing, deny/allow permissions.

---

## 12. Finance (`finance`)
**Відповідає за:** платежі, balance due, payroll/economics, фінансові розрахунки.

**Критичні залежності:** work-orders, parts, personnel, analytics.

**Перевірити:** суми, оплата, залишок, доступ за ролями, відсутність подвійного нарахування.

---

## 13. Vehicle Images (`vehicle-images`)
**Відповідає за:** OpenAI images, shared model templates, color variants, optimization, library admin.

**Правило:** нове авто спочатку шукає готовий модельний/кольоровий варіант; платна генерація лише коли потрібного asset немає.

**Перевірити:** reuse, new color, new model, WebP delivery, library admin, відсутність дублюючих jobs.

---

## 14. Notifications (`notifications`)
**Відповідає за:** in-app alerts, unread/read, close/action, доставка в кабінети.

**Перевірити:** створення, видимість потрібній ролі, read/close, deep link, відсутність «висячих» повідомлень.

---

## 15. Communications (`communications`)
**Відповідає за:** телефонію, call history, callback, omnichannel bridges.

**Перевірити:** event ingestion, відповідність клієнта/ліда, історія дзвінка, graceful behavior при вимкненій інтеграції.

---

## 16. Settings & Integrations (`settings-integrations`)
**Відповідає за:** credentials, API keys, інтеграції, camera/operations settings.

**Безпека:** секрети не логуються і не повертаються у відкритому вигляді.

**Перевірити:** load/save/test integration, permission gate, secret masking.

---

# Cross-module правила

Завжди розширюй перевірку за межі одного модуля, якщо зміна:
1. змінює Prisma schema або migration;
2. змінює permission/role/cabinet routing;
3. змінює статусну машину або workflow gate;
4. змінює `Client`, `Vehicle`, `WorkOrder`, `Employee` або іншу спільну сутність;
5. змінює API response, який споживає інший модуль;
6. змінює фінансовий розрахунок;
7. створює/видаляє background side effect (notification, image generation, telephony event).

# Коли оновлювати паспорт

Паспорт і registry оновлюються в тому самому PR, якщо:
- з'явився новий модуль;
- змінилася відповідальність існуючого модуля;
- додалася/зникла залежність;
- змінилися ключові smoke checks;
- файл перемістили в інший домен.
