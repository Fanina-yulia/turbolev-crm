# CRM Турбо ЛЕВ — Етап 2: технічне завдання

## Мета
Довести CRM від функціонально працюючої системи до стабільної бойової системи, через яку ведеться весь цикл СТО: від першого звернення клієнта до видачі авто, фінансового результату та повторного звернення.

## Пріоритети
1. P0 — фінальний запуск RBAC у ENFORCED.
2. P1 — оптимізація кабінету механіка.
3. P1 — завершення WALK-IN.
4. P1 — спрощення «Звернень».
5. P1 — стабілізація Binotel.
6. P2 — клієнтський «Мій гараж».
7. P2 — постачальники та закупівлі.
8. P2 — діагностика і документи.
9. P2 — управлінська аналітика власника.
10. Final gate — повний бойовий E2E на 10–20 реальних авто.
11. P3 — косметичні та допоміжні роботи.

---

## 1. RBAC — фінальний запуск бойового режиму

### Поточний стан
- permission/scope guards реалізовані;
- API security inventory працює;
- production має `enforcementMode=SHADOW` і `bootstrapCompleted=false`.

### Потрібно
- аудит усіх активних користувачів, ролей, локацій, scope та overrides;
- контрольна матриця OWNER / STATION_MANAGER / SERVICE_ADVISOR / MECHANIC / ACCOUNTANT та інших активних ролей;
- окремо перевірити SELF / ASSIGNED / LOCATION / ALL;
- role-based E2E для Planner → Diagnostics → Work Orders → Parts → QC → Payments;
- негативні прямі API-тести: 401 без сесії, 403 без permission, відсутність/403 при неправильному scope;
- тільки після зелених тестів переключити SHADOW → ENFORCED;
- після стабільної роботи встановити `bootstrapCompleted=true`.

### Acceptance criteria
- ENFORCED реально активний у production;
- усі активні користувачі мають правильні ролі;
- механік не бачить чужі авто/роботи;
- location-ролі не бачать чужу станцію;
- фінансові дані закриті від неавторизованих ролей;
- OWNER має повний доступ;
- role-based E2E пройдено.

---

## 2. Оптимізація кабінету механіка
- використати напрацювання PR #279;
- один snapshot для home/tasks/diagnostics/notifications/findings/assigned vehicles;
- diagnostic bootstrap і batch update;
- throttle `lastSeenAt`;
- прибрати зайвий polling і широкі MutationObserver;
- не poll-ити приховану вкладку;
- lazy-load важких частин;
- mobile-first UI без звичайного CRM sidebar;
- повторно виміряти First Load JS і runtime errors після rebase на актуальний main.

## 3. WALK-IN
- використати напрацювання PR #277;
- сценарій: приїхав без запису → діагностика → оплата → завершення або передача у ремонт;
- live-сигнал, якщо діагностика завершена без оплати;
- live-сигнал, якщо оплата є, але візит не завершено/не передано у ремонт;
- без дублювання CrmTask;
- аналітика: visits, diagnostics, payments, diagnostic-only, repair handoff, completed, stalled, revenue, avg check, daily dynamics;
- фільтри: період і location.

## 4. Спрощення «Звернень»
- використати актуальну логіку PR #269;
- бізнес-стани UI: Нове → Записаний / Скасоване;
- історичні enum/status не видаляти з БД;
- повторні дзвінки зберігати як attempts/last contact/next action/result/note, а не як окремі бізнес-статуси;
- причина скасування обов’язкова;
- ручні Planner-статуси: Записаний / Приїхав / Не приїхав / Скасований / Резерв;
- сервісні етапи керуються профільними процесами, а не dropdown Планувальника.

## 5. Binotel production hardening
- основний номер PBX: 0983415646;
- використати напрацювання PR #58;
- відділити integration health від тимчасового provider rate limit;
- глобальна координація heavy REST між serverless instances;
- серіалізувати live fallback / history incoming / history outgoing / manual sync;
- retry/reclaim після `Requests are too frequent`;
- live smoke: outgoing call, incoming call, webhook, live indicator, history, recording, manual sync.

## 6. Клієнтський «Мій гараж»
- використати напрацювання PR #263;
- сторінка авто: статус, етап, ETA, СТО, пост, механік, кошторис, фото/відео, документи, історія;
- line-level estimate decisions: Погодити / Відмовитись / Запитати менеджера;
- Погодити все / Відмовитись від усього;
- mixed approval не повинен ламати WorkOrder workflow: immutable decisions + повідомлення менеджеру + нова revision за потреби;
- server-side ownership check для кожного vehicle/chat/media/estimate API.

## 7. Постачальники та закупівлі
- supplier schema вже відновлена;
- єдиний provider interface: пошук, артикул, бренд, закупівельна ціна, залишок, ETA, order, status, receiving, return;
- інтеграції: Unique Trade, БМПартс, Автонова-Д, ATL та інші за потреби;
- default markup 23%, з підтримкою global/category/item/manual overrides та audit log;
- workflow: потреба → підбір → погодження → замовлення → в дорозі → отримано → видано на роботу → встановлено.

## 8. Діагностика та документи
- діагностична карта — першоджерело дефектів;
- дефект: назва, опис, критичність, фото/відео, рекомендація, потрібна деталь/робота, рішення клієнта;
- погоджені дефекти автоматично переходять у estimate → WorkOrderLine → parts request → repair;
- без ручного повторного переписування;
- документи: діагностична карта, кошторис, накладна, акт, гарантійний документ, рекомендації, історія авто.

## 9. Аналітика власника
- бізнес: revenue, gross profit, operating result, cars count, avg check, avg margin, repeat clients, debts;
- авто: revenue − parts − labor/payroll − direct costs = vehicle profit;
- механік: work count, norm-hours, actual time, avg labor check, returns, warranty, productivity, load;
- пости: occupancy, downtime, cars/day, average repair time;
- клієнти: new, repeat, LTV, last visit, next-service recommendations.

## 10. Повний бойовий E2E
На 10–20 реальних авто пройти:
дзвінок/повідомлення → звернення → авто → запис → приїзд → діагностика → дефекти/медіа → кошторис → погодження → деталі → ремонт → QC → оплата → документи → видача → історія → фінрезультат.

Acceptance: жоден етап не потребує паралельного Excel/Viber-блокнота для компенсації прогалин CRM.

## 11. Data quality перед повним запуском
- дублікати клієнтів, телефонів, авто;
- нормалізація держномерів і VIN;
- порожні призначення механіків;
- старі завислі appointments/Work Orders/statuses;
- стабільний пошук по телефону, ПІБ, держномеру, VIN.

## Production gate для кожної роботи
1. Окрема feature/fix branch.
2. PR.
3. Branch синхронізована з актуальним main.
4. Security inventory green.
5. Typecheck/build green.
6. Vercel Preview READY.
7. DB migration: спочатку temporary Neon branch + verification + idempotency test.
8. Merge в main.
9. Production deployment READY.
10. Фактична production-перевірка.
11. Для інтеграцій — реальний live test.

## Порядок виконання
RBAC ENFORCED → швидкість механіка → WALK-IN → Звернення → Binotel → Мій гараж → Постачальники → Діагностика + документи → Owner Analytics → 10–20 реальних авто E2E → косметика/MVS.
