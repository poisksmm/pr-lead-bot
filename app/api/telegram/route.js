// Обработчик Telegram-вебхука.
//
// Состояние анкеты хранится в Supabase, а не в памяти процесса: на Vercel
// функция перезапускается на каждом сообщении, и память между вызовами
// не сохраняется. Именно из-за этого прошлая версия зацикливалась на
// «Чтобы начать, отправьте команду /start».

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

function db() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// ---------------------------------------------------------------- сценарий

const QUESTION = {
  sphere: 'В какой сфере у вас бизнес или стартап?',
  task: 'Какая задача сейчас стоит перед вами?',
  name: 'Как вас зовут?',
  contact: 'Оставьте контакт для связи — телефон или @username.',
};

const NEXT = {
  sphere: 'task',
  task: 'name',
  name: 'contact',
  contact: 'done',
};

const GREETING =
  'Здравствуйте! 👋 Я помогу быстро понять, чем может быть полезна ' +
  'Диана Бакбергенова, и передам ваши данные ей для связи.\n\n' +
  'Отвечу на пару вопросов, займёт минуту.';

const FINISH =
  'Спасибо! Передала ваши данные Диане — она свяжется с вами в ближайшее время.\n\n' +
  'Если захотите начать заново, отправьте /start.';

const IDLE = 'Чтобы начать, отправьте команду /start';

// ---------------------------------------------------------------- Telegram

async function send(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ---------------------------------------------------------------- вебхук

export async function GET() {
  // Чтобы можно было глазами проверить, что маршрут жив.
  return Response.json({ ok: true, service: 'pr-lead-bot' });
}

export async function POST(req) {
  try {
    // Запросы принимаются только от Telegram: секрет приходит в заголовке.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (
      secret &&
      req.headers.get('x-telegram-bot-api-secret-token') !== secret
    ) {
      return new Response('forbidden', { status: 403 });
    }

    const update = await req.json();
    const msg = update && update.message;
    const chatId = msg && msg.chat && msg.chat.id;
    const text = msg && typeof msg.text === 'string' ? msg.text.trim() : null;

    if (!chatId || !text) return Response.json({ ok: true });

    const supabase = db();

    // Защита от повторной обработки: Telegram переотправляет апдейт,
    // если вебхук ответил не 200 или ответил слишком медленно.
    // Из-за этого приветствие приходило дважды подряд.
    const dupe = await supabase
      .from('bot_updates')
      .insert({ update_id: update.update_id });
    if (dupe.error) return Response.json({ ok: true });

    // ---- /start: сбрасываем анкету и начинаем заново
    if (text.startsWith('/start')) {
      await supabase.from('bot_sessions').upsert({
        chat_id: chatId,
        step: 'sphere',
        answers: {},
        updated_at: new Date().toISOString(),
      });
      await send(chatId, GREETING);
      await send(chatId, QUESTION.sphere);
      return Response.json({ ok: true });
    }

    // ---- читаем, на каком шаге диалог
    const { data: session } = await supabase
      .from('bot_sessions')
      .select('step, answers')
      .eq('chat_id', chatId)
      .maybeSingle();

    const step = session ? session.step : 'done';

    // Подсказка про /start срабатывает ТОЛЬКО когда активной анкеты нет.
    // В прошлой версии эта ветка перехватывала нормальные ответы — отсюда петля.
    if (!session || step === 'done' || !QUESTION[step]) {
      await send(chatId, IDLE);
      return Response.json({ ok: true });
    }

    // ---- записываем ответ, двигаем шаг
    const answers = Object.assign({}, session.answers || {}, { [step]: text });
    const nextStep = NEXT[step];

    await supabase
      .from('bot_sessions')
      .update({
        step: nextStep,
        answers,
        updated_at: new Date().toISOString(),
      })
      .eq('chat_id', chatId);

    if (nextStep !== 'done') {
      await send(chatId, QUESTION[nextStep]);
      return Response.json({ ok: true });
    }

    // ---- анкета пройдена
    // Имена колонок — как в существующей таблице leads:
    // telegram_chat_id обязателен, остальные необязательны.
    const lead = await supabase.from('leads').insert({
      telegram_chat_id: chatId,
      telegram_username: (msg.from && msg.from.username) || null,
      sphere: answers.sphere || null,
      task: answers.task || null,
      name: answers.name || null,
      contact: answers.contact || null,
    });
    if (lead.error) console.error('leads insert failed', lead.error);

    await send(chatId, FINISH);

    if (process.env.ADMIN_CHAT_ID) {
      await send(
        Number(process.env.ADMIN_CHAT_ID),
        '<b>Новая заявка</b>\n\n' +
          `Имя: ${answers.name}\n` +
          `Сфера: ${answers.sphere}\n` +
          `Задача: ${answers.task}\n` +
          `Контакт: ${answers.contact}\n` +
          `Telegram: ${
            msg.from && msg.from.username ? '@' + msg.from.username : '—'
          }`
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error('telegram handler error', e);
    // Всегда 200: иначе Telegram будет слать тот же апдейт повторно.
    return Response.json({ ok: true });
  }
}
