# Turbo LEV CRM — підключення Binotel

## Що вже робить CRM

Binotel підключається до єдиного розділу **Комунікації**. Вхідний дзвінок не створює клієнта або нового ліда напряму: спочатку він стає зверненням у Inbox, а менеджер уже кваліфікує його та переводить у Lead.

CRM зберігає життєвий цикл дзвінка в `CallHistory`, нормалізує телефон, намагається знайти існуючого клієнта або активний Lead, прив'язує відповідального менеджера за внутрішнім номером і додає системні події дзвінка в історію звернення.

## 1. Vercel Environment Variables

Обов'язкові для живого Binotel:

- `DATABASE_URL`
- `BINOTEL_API_KEY`
- `BINOTEL_API_SECRET`
- `BINOTEL_WEBHOOK_TOKEN` — окремий довгий випадковий секрет для захисту webhook.

Опціональні:

- `BINOTEL_COMPANY_ID`
- `BINOTEL_WS_KEY`
- `BINOTEL_WS_SECRET`
- `BINOTEL_WS_URL`

WebSocket не потрібен для базового прийому webhook-подій. Його можна підключити пізніше для realtime popup.

## 2. Захищений webhook

Єдина точка для Binotel:

```text
POST https://YOUR_DOMAIN/api/telephony/binotel-webhook?token=YOUR_BINOTEL_WEBHOOK_TOKEN
```

Старий універсальний маршрут `/api/webhooks/binotel` навмисно не використовується. У production CRM не приймає Binotel webhook без `BINOTEL_WEBHOOK_TOKEN`.

Підтримуються події CRM:

- `incomingCall`
- `answeredTheCall`
- `hangupTheCall`

Якщо конкретний callback Binotel не передає назву події у payload, її можна зафіксувати в URL:

```text
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=incomingCall&token=YOUR_TOKEN
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=answeredTheCall&token=YOUR_TOKEN
https://YOUR_DOMAIN/api/telephony/binotel-webhook?event=hangupTheCall&token=YOUR_TOKEN
```

Маршрут приймає JSON, form-urlencoded і multipart form data.

## 3. Логіка в CRM

Для вхідного дзвінка CRM:

1. Нормалізує зовнішній номер телефону.
2. Шукає `Client` за телефоном.
3. Якщо клієнта немає — шукає активний Lead з цим телефоном.
4. Створює або оновлює один `CallHistory` за унікальним Binotel call ID.
5. Прив'язує дзвінок до знайденого Client/Lead, активного WorkOrder і менеджера, якщо їх можна визначити.
6. Створює/оновлює `CommunicationInquiry` у каналі `BINOTEL`.
7. Додає системні повідомлення: новий дзвінок, відповідь, завершення, пропущений/зайнято.
8. **Не створює новий Lead автоматично для невідомого номера.** Менеджер бачить звернення в «Комунікаціях» і натискає «Створити / прив'язати лід» після кваліфікації.
9. Для завершеної розмови намагається отримати URL запису і зберегти його серверно в `CallHistory`. Відсутність готового запису не ламає webhook.

Таким чином один дзвінок не розмножується на кілька звернень: call ID використовується для ідемпотентного оновлення.

## 4. Health check

```text
GET https://YOUR_DOMAIN/api/telephony/binotel-health
```

Відповідь показує тільки стан конфігурації (`restConfigured`, `webhookTokenConfigured`, `databaseConfigured` тощо) та список відсутніх змінних. Секретні значення ніколи не повертаються у браузер.

У CRM цей health check використовується у вкладці **Комунікації → Інтеграції**: картка Binotel сама показує, чи готовий сервер до живого підключення.

## 5. Перший live-тест

Після додавання credentials у Vercel і callback-ів у Binotel:

1. Подзвонити на номер СТО з телефону, якого немає в CRM.
2. Перевірити, що в **Комунікації → Binotel** з'явилося звернення, але новий Lead ще не створений.
3. Відповісти/завершити дзвінок або зробити пропущений тест.
4. Перевірити, що в тому самому зверненні з'явилися системні події, а `CallHistory` не дублюється.
5. Для комерційного звернення натиснути «Створити / прив'язати лід» і перевірити перехід у воронку продажів.

## 6. Безпека

Не зберігайте Binotel API key/secret/token у GitHub, frontend-коді або змінних `NEXT_PUBLIC_*`. Усі секрети — тільки server-side Vercel Environment Variables.
