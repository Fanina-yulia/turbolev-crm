# TZ — Пульт власника: інтерактивний аналітичний дашборд (варіант 4)

## 1. Мета
Перебудувати верхній блок «Пульт власника» у візуально зрозумілий, інтерактивний аналітичний дашборд, який займає приблизно ту саму висоту й ширину, що й поточний блок, але показує ключові показники через мініграфіки, gauge/donut, progress та статусні візуалізації.

## 2. Scope
Робота стосується лише кабінету Власника / Owner Control Center. Інші рольові кабінети не змінюються.

## 3. KPI верхнього ряду
Зберегти 6 KPI:
1. Виручка за період — значення, delta до попереднього періоду, area/sparkline trend.
2. Валовий прибуток — значення, delta, mini bar chart.
3. Валова маржа — %, delta, radial/donut gauge + ціль.
4. Завантаження постів — %, delta, radial/donut gauge occupied/free.
5. Повторні клієнти — %, delta, compact retention bars/history.
6. Запис → приїзд — %, delta, semicircle/radial conversion gauge.

Кожна KPI-картка має бути клікабельна/фокусована, з aria-label, hover/focus станом та переходом до деталізації, якщо маршрут уже існує. Якщо деталізація ще не має окремого маршруту — клік не повинен ламати сторінку.

## 4. Другий ряд
Зберегти 4 операційні показники:
- Активні авто — count + mini area trend.
- У ремонті — count + mini bar/activity trend.
- Протерміновано — count + stacked status/risk bar; red alert treatment.
- Готові до видачі — count + progress/status distribution.

Окремих CTA-кнопок на кшталт «Переглянути» всередині карток немає. Перехід виконується натисканням на всю картку; у всіх картках використовується однаковий компактний navigation affordance.

## 5. Період та інтерактивність
У шапці дашборда додати compact period control:
- Сьогодні
- 7 днів
- 30 днів
- 90 днів
- Рік

Період має керувати лише локальною візуалізацією, якщо backend не підтримує period param. Значення KPI, що приходять з backend, залишаються source of truth. Демо-дані для trend не вигадуються з реальних сум: якщо історичних точок немає — графік показує нейтральний flat/no-data state.

## 6. Візуальні правила
- Світлий фон сторінки, білі картки.
- Основний текст — темний navy/charcoal.
- Brand accent — Turbo LEV orange.
- Позитивна динаміка — green.
- Негативна/critical — red.
- Neutral/no data — gray.
- Border radius 16–18 px.
- Висота верхнього KPI-ряду ~190–220 px на desktop.
- Другий ряд ~220–260 px.
- Загальна висота дашборда не повинна суттєво перевищувати поточний блок на desktop.
- Мінімальний шрифт 11 px відповідно до глобального UI-contract.

## 7. Responsive
Desktop ≥1280: 6 KPI в один ряд + 4 операційні картки в один ряд.
Tablet 768–1279: KPI у 3 колонки; operational у 2 колонки.
Mobile <768: 1 колонка; horizontal overflow заборонений; period control переноситься/скролиться всередині власного контейнера без overflow сторінки.

## 8. Реалізація графіків
Без додавання важкої chart-бібліотеки, якщо її немає у проєкті. Використати CSS + SVG primitives:
- sparkline: inline SVG polyline/path;
- mini bars: flex/grid div bars;
- donut/gauge: conic-gradient або SVG circle stroke;
- stacked bar: CSS grid/flex.

Усі графіки повинні бути aria-hidden, а значення та delta — доступні текстом.

## 9. Source of truth / data integrity
Поточні значення KPI беруться лише з фактичного payload owner dashboard API/contract. Не генерувати фальшиві бізнес-суми чи історію. Якщо trend/history відсутній у контракті, показувати neutral pattern/no-data, використовуючи поточне значення лише як present state.

## 10. UX поведінка
- Hover card: border/shadow elevation, без зміни layout.
- Focus-visible: outline 2px brand accent.
- Critical card «Протерміновано»: red-tinted border/background only when value > 0.
- Delta: green only якщо зміна корисна для метрики; для «Протерміновано» зростання завжди red, зниження green.
- Tooltip через title/aria-label для скорочених labels.

## 11. Acceptance criteria
1. Всі 10 KPI збережені.
2. Верхні 6 KPI мають різні зрозумілі графічні форми відповідно до макета v4.
3. «Протерміновано» візуально виділяється при value > 0.
4. Немає горизонтального overflow на 360/390/768/1024/1280/1440/1920.
5. Мінімальний шрифт ≥11 px.
6. Графіки не перекривають текст і не змінюють висоту карток при різних значеннях.
7. Власник бачить дашборд без попередніх role-work-queue блоків.
8. Build, typecheck, page integrity, responsive contract та font-floor проходять.
9. Production deployment READY.

## 12. Files
Очікувано:
- app/owner-dashboard.tsx
- app/owner-dashboard.module.css
- за потреби локальні helper-и в app/owner-dashboard-*.tsx без зміни API contracts.

## 13. Не робити
- Не міняти бізнес-логіку фінансів.
- Не робити production DB migration.
- Не вигадувати trend/history дані як реальні.
- Не змінювати кабінети інших ролей.
