# TURBO LEV — Комунікації / Workspace v2

## Мета
Перетворити наявний omnichannel inbox на компактне робоче місце оператора без зміни transport/business logic.

## Незмінні канонічні правила
- Один клієнт = один діалог.
- Дзвінки й повідомлення з усіх каналів залишаються в одній хронології.
- `/api/communications`, Binotel, Meta, OLX, Telegram та lifecycle status не дублюються новою моделлю.
- Жодної нової БД-схеми або міграції.

## UI
1. Верхні фільтри: основні черги залишаються видимими; канали Instagram/Facebook/Telegram/TikTok/Binotel/OLX/Сайт згортаються в один dropdown «Канал».
2. Ліва колонка: ширина ~330–360 px, менше декоративного шуму, акцент на ім'я/телефон/останню подію/статус.
3. Центральна колонка: messenger-like timeline, більший composer, стабільна нижня зона відповіді.
4. Права колонка на desktop: контекст клієнта, кількість авто, кількість Work Order, активний/останній Work Order, швидкий перехід у картку клієнта/авто/наряд.
5. На екранах <=1180 px права колонка прибирається, автомобілі повертаються у header діалогу.
6. На <=900 px workspace стає одноколонковим без горизонтального overflow.

## Data source для Context
`GET /api/client-card?phone=...`:
- client identity;
- vehicles;
- serviceHistory (Work Order).

Ніякі фінансові/операційні факти не вигадуються, якщо їх немає у source.

## Acceptance
- Всі існуючі функції відповіді/attachment/retry/lifecycle працюють без змін.
- Channel dropdown запускає існуючі канонічні фільтри, а не власний паралельний state.
- Контекстний Work Order відкривається через `navigateCrm("Наряди та ремонт", { workOrderId })`.
- UI font floor >= 11px.
- Desktop: list + chat + context; medium: list + chat; mobile: stacked.
- Production build, Module Scope, telephony/communications smoke — green before merge.
