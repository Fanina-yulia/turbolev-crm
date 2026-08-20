## Що змінено

<!-- Коротко: яка бізнес-проблема вирішена. -->

## Модуль

- Головний модуль: `<!-- module-id -->`
- Залежності, які реально зачеплені: `<!-- module-id або none -->`

Перед review запусти:

```bash
npm run module:scope -- --base origin/main
```

## Ризики перетину модулів

- [ ] Prisma schema / migration не змінювались, або перевірені окремо
- [ ] Permissions / role / cabinet routing не змінювались, або перевірені окремо
- [ ] Workflow/status/gates не змінювались, або перевірені окремо
- [ ] API-контракти сумісні з залежними модулями
- [ ] Background side effects (notifications/images/telephony) перевірені

## Перевірки

- [ ] Build / type-check пройшов
- [ ] Smoke checks головного модуля виконані
- [ ] Залежні модулі перевірені тільки там, де зміна реально перетинає межу
- [ ] Якщо змінилась відповідальність модуля — оновлено `docs/modules/module-registry.json` і паспорт

## Production

- [ ] Міграції перевірені на тимчасовій БД, якщо були
- [ ] Preview READY
- [ ] Після merge production READY і немає нових 5xx/error clusters
