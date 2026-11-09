# PR Lead Bot

Telegram-бот Infopovod: проводит короткую анкету, сохраняет заявку в базу
и присылает уведомление владельцу.

## Где что живёт

| Что | Где |
|-----|-----|
| Код | GitHub `poisksmm/pr-lead-bot`, ветка `main` |
| Хостинг | Vercel, проект `pr-lead-bot` |
| Адрес | https://pr-lead-bot.vercel.app |
| База | Supabase, проект **Kungfu Panda** (регион Tokyo) |
| Бот | @BotFather → `/mybots` → Infopovod |

**Деплой автоматический:** любой коммит в `main` собирается и публикуется сам.
Никакого `vercel deploy` с компьютера — так код теряется.

## Переменные окружения (Vercel → Settings → Environment Variables)

| Имя | Что это |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | секрет, которым Telegram подписывает запросы |
| `ADMIN_CHAT_ID` | chat_id владельца, куда падают заявки |
| `SUPABASE_URL` | адрес проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ключ service_role (не anon!) |
| `OWNER_START_SECRET` | от старой версии, сейчас не используется |

Значения в Vercel скрыты после сохранения. Восстанавливаются так:
токен — у @BotFather, ключи Supabase — Supabase → Settings → API,
chat_id — у бота @userinfobot.

## Сценарий анкеты

1. В какой сфере у вас бизнес или стартап? → `sphere`
2. Готовы ли вы вкладывать в продвижение от 500 000 ₸ в месяц? → `budget_yes` (кнопки Да/Нет)
3. Откуда вы узнали о Диане? → `source`
4. Пришлите ссылку на ваши соцсети или сайт → `social_links`
5. Оставьте номер WhatsApp для связи → `whatsapp_number`

Telegram-ник берётся автоматически. `qualified` = ответ «Да» на вопрос о бюджете.
В уведомление владельцу добавляется ссылка на Calendly.

## Таблицы в Supabase

- `bot_sessions` — состояние диалога: `chat_id`, `step`, `answers` (jsonb), `updated_at`
- `bot_updates` — обработанные `update_id`, защита от дублей
- `leads` — заявки

Во всех трёх включён RLS без политик: бот ходит через service_role и обходит их,
снаружи таблицы закрыты.

## Как переустановить вебхук

Открыть в браузере, подставив токен:

```
https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://pr-lead-bot.vercel.app/api/telegram&secret_token=<СЕКРЕТ>&drop_pending_updates=true
```

Ответ должен быть `{"ok":true,...,"description":"Webhook was set"}`.
Адрес обязательно короткий (`pr-lead-bot.vercel.app`), а не длинный технический:
на длинных работает Vercel Authentication и Telegram упрётся в экран логина.

## Грабли, на которые уже наступали

**Supabase на бесплатном тарифе засыпает после 7 дней без обращений.**
Бот при этом молча перестаёт работать. Либо Pro, либо регулярно будить вручную.
На Free также нет автоматических бэкапов.

**Состояние диалога нельзя хранить в памяти процесса.** Vercel запускает функцию
заново на каждом сообщении, память стирается, анкета зацикливается на «отправьте
/start». Состояние только в базе.

**`create table if not exists` молча пропускает существующую таблицу**, даже если
структура у неё другая. Если таблица уже была — проверять колонки, а не доверять
слову «Success».

**Вебхук должен всегда отвечать 200**, даже при ошибке внутри. Иначе Telegram
переотправляет тот же апдейт, и пользователь получает дубли сообщений.

**Ошибки Supabase нельзя глотать.** Если не проверять `.error`, бот будет вести
себя «почти нормально», а записи молча не сохранятся.

## Диагностика, когда бот ведёт себя странно

1. Supabase → проект проснулся? Не на паузе?
2. Vercel → Deployments → последний деплой `Ready`, а не `Error`?
3. Vercel → Logs → ошибки времени выполнения
4. Supabase → SQL Editor → `select * from bot_sessions order by updated_at desc limit 10;`
   — пишутся ли сессии
5. `https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo` — куда смотрит вебхук
   и нет ли накопленных ошибок
