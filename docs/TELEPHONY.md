# Turbo LEV CRM — Binotel telephony

## Реалізовано

- `CallHistory` для повного життєвого циклу дзвінка.
- Server-only Binotel REST client.
- Захищений `POST /api/telephony/binotel-webhook`.
- Події `incomingCall`, `answeredTheCall`, `hangupTheCall`.
- Нормалізація телефону та дедуп за Binotel call ID.
- Прив'язка дзвінка до існуючого Client, активного Lead, WorkOrder і менеджера, коли вони визначені.
- Вхідний дзвінок дзеркалиться в `CommunicationInquiry` і стає частиною єдиного Inbox.
- Пропущений дзвінок залишається відкритим зверненням для передзвону.
- Запис завершеної розмови зберігається серверно в `CallHistory`, коли провайдер уже підготував media URL.
- Health check: `GET /api/telephony/binotel-health`.

## Головне бізнес-правило

**Телефонний дзвінок не створює нового Lead автоматично.**

Маршрут:

`Binotel → CommunicationInquiry → кваліфікація менеджером → Lead → Запис/Заявка → Client + Vehicle`.

Якщо телефон уже належить активному Lead, звернення може бути одразу прив'язане до нього. Якщо телефон належить існуючому Client, історія дзвінка зберігається в клієнтському контексті, але новий Lead не створюється без потреби.

## Статуси

Під час дзвінка статус може бути ще невизначеним. На завершенні CRM фіксує `ANSWERED`, `MISSED` або `BUSY`. Повторні webhook-події оновлюють той самий `CallHistory`.

## Безпека

Production webhook активний тільки якщо задано `BINOTEL_WEBHOOK_TOKEN`. API credentials і token зберігаються виключно у Vercel Environment Variables і не передаються у frontend.

Детальна інструкція з налаштування: `docs/BINOTEL_SETUP.md`.

## Наступні розширення

- realtime incoming-call popup через WebSocket;
- click-to-call після появи авторизації/ролей у CRM;
- відтворення записів дзвінків у захищеному інтерфейсі;
- KPI по пропущених дзвінках, швидкості передзвону та конверсії телефонії в запис.
