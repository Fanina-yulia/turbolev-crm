# TZ — Пульт власника V6: інтерактивна візуалізація контрольних карток

## 1. Мета

Посилити Owner Dashboard V5 так, щоб нижній блок «Гроші, рішення та ризики» був не статичним набором цифр, а живим управлінським інтерфейсом. Візуалізації повинні давати власнику більше контексту без переходу на іншу сторінку та без збільшення загальної висоти dashboard.

## 2. Загальний UX-контракт

- Усі 4 owner-control cards зберігають однакову геометрію та клікабельність всієї картки.
- Окремих CTA-кнопок «Переглянути» немає.
- При hover картка піднімається, тінь посилюється, іконка та стрілка реагують на курсор.
- Графічний елемент під курсором виділяється, сусідні елементи приглушуються.
- Для desktop/tablet на hover показується компактний tooltip з фактичним значенням і додатковим контекстом.
- На mobile tooltip не використовується; усі ключові значення залишаються продубльовані текстом.
- `prefers-reduced-motion: reduce` вимикає декоративні анімації.
- Жодні історичні чи грошові дані не генеруються штучно.

## 3. Гроші до отримання

### Візуалізація
Інтерактивна stacked horizontal bar з сегментами:
- До сплати — orange;
- Частково — neutral;
- Прострочено — red.

### Hover
- Уся шкала приглушується до ~40% opacity.
- Активний сегмент лишається 100%, піднімається на 3 px і збільшується по висоті.
- Tooltip: категорія, сума, кількість оплат/боргів.

### Data source
`GET /api/payments` → `outstanding`, `flags.due`, `flags.partial`, `flags.debt`, `overdue`.

## 4. Потрібне моє рішення

### Візуалізація
Три вертикальні animated bars:
- Низька маржа;
- Гарантія;
- Зупинені процеси.

### Hover
- Активний стовпчик піднімається та трохи розширюється.
- Неактивні стовпчики приглушуються.
- Tooltip показує точну кількість; для низької маржі — також реальну суму planned revenue КП, якщо вона є.

### Data source
`GET /api/finance/margin-approvals` + `GET /api/dashboard`.

## 5. Критичні прострочення

### Візуалізація
Ranked horizontal histogram за `operations.delayReasons`.

### Hover
- Активний рядок зміщується вправо на 3 px.
- Bar збільшується по висоті.
- Інші причини приглушуються.
- Tooltip показує назву причини та кількість прострочених процесів.

### Data source
`GET /api/analytics` → `operations.overdueNow`, `operations.delayReasons`.

## 6. Ризик втрати виручки

### Візуалізація
Interactive donut/radial chart:
- No-show — red;
- Погодження — orange;
- Зупинені — neutral.

### Hover
- Активний сектор збільшує stroke width і отримує drop-shadow.
- Інші сектори приглушуються.
- Центральне число donut динамічно змінюється із загальної кількості ризиків на значення активного сегмента.
- Центральний підпис змінюється на назву активної категорії.

### Data source
`/api/dashboard.blockers.noShow`, `/api/analytics.funnel.noShow`, `/api/analytics.operations.waitingApprovalNow`, attention `PAUSED_STALLED`.

## 7. Верхні KPI

Існуючі sparkline / mini bars / gauge також отримують motion feedback:
- line товстішає на hover;
- точки sparkline збільшуються;
- area fill стає трохи контрастнішим;
- mini bars по черзі піднімаються;
- gauge трохи повертається/масштабується;
- arrow `›` зміщується вправо.

## 8. Accessibility

- Картки залишаються `<button type="button">` і keyboard-focusable.
- Tooltip є декоративним доповненням; бізнес-значення дублюються текстом.
- Графіки мають `aria-hidden=true`.
- Focus-visible = 2px brand outline.
- Motion не є носієм критичної інформації.

## 9. Responsive

- Desktop ≥1280: 4 owner cards в один ряд.
- Tablet 761–1280: 2×2.
- Mobile ≤760: 1 колонка.
- ≤480: tooltip прихований, donut зменшується, текстові значення зберігаються.
- Horizontal overflow заборонений на 360/390/768/1024/1280/1440/1920.

## 10. Data integrity

- Не додавати нових таблиць БД.
- Не виконувати production migrations.
- Не будувати фіктивну historical series для receivables.
- Не переводити revenue risk у гривні без реального estimate/financial source.
- Усі tooltips показують ті самі фактичні агрегати, що й картки.

## 11. Файли реалізації

- `app/owner-dashboard-visual.tsx`
- `app/owner-dashboard-visual.module.css`

## 12. Acceptance criteria

1. Receivables має stacked interactive bar.
2. Owner decisions має vertical animated bars.
3. Critical overdue має ranked interactive histogram.
4. Revenue risk має interactive donut з dynamic center value.
5. Hover виділяє активний сегмент і приглушує сусідні.
6. Desktop/tablet показують tooltip без layout shift.
7. Усі картки мають однаковий hover/elevation/navigation contract.
8. `prefers-reduced-motion` вимикає decorative motion.
9. Font floor ≥11px.
10. Build/typecheck/page-integrity/font-floor проходять.
11. Production deployment READY.
