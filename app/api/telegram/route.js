// Обработчик Telegram-вебхука.
//
// Состояние анкеты хранится в Supabase, а не в памяти процесса: на Vercel
// функция перезапускается на каждом сообщении, и память между вызовами
// не сохраняется.

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CALENDLY = 'https://calendly.com/dianawwin/30min';

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
  budget: 'Готовы ли вы вкладывать в продвижение от 500 000 ₸ в месяц?',
  source: 'Откуда вы узнали о Диане?',
  social: 'Пришлите ссылку на ваши соцсети или сайт.',
  whatsapp: 'Оставьте номер WhatsApp для связи.',
};

const NEXT = {
  sphere: 'budget',
  budget: 'source',
  source: 'social',
  social: 'whatsapp',
  whatsapp: 'done',
};

// Кнопки «Да/Нет» только на вопросе про бюджет.
function keyboardFor(step) {
  if (step !== 'budget') return { remove_keyboard: true };
  return {
    keyboard: [[{ text: 'Да' }, { text: 'Нет' }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

const GREETING =
  'Здравствуйте! 👋 Я помогу быстро понять, чем может быть полезна ' +
  'Диана Бакбергенова, и передам ваши данные ей для связи.\n\n' +
  'Отвечу на пару вопросов, займёт минуту.';

const FINISH =
  'Спасибо! Передала ваши данные Диане — она свяжется с вами в ближайшее время.\n\n' +
  'Если захотите начать заново, отправьте /start.';

const IDLE = 'Чтобы начать, отправьте команду /start';

// ---------------------------------------------------------------- Telegram

async function send(chatId, text, markup) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (markup) body.reply_markup = markup;
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- вебхук

export async function GET() {
  return Response.json({ ok: true, service: 'pr-lead-bot' });
}

export async function POST(req) {
  try {
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
      await send(chatId, QUESTION.sphere, keyboardFor('sphere'));
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
      await send(chatId, QUESTION[nextStep], keyboardFor(nextStep));
      return Response.json({ ok: true });
    }

    // ---- анкета пройдена
    const budgetYes = /^\s*да/i.test(answers.budget || '');
    const username = (msg.from && msg.from.username) || null;

    const lead = await supabase.from('leads').insert({
      telegram_chat_id: chatId,
      telegram_username: username,
      sphere: answers.sphere || null,
      budget_yes: budgetYes,
      source: answers.source || null,
      social_links: answers.social || null,
      whatsapp_number: answers.whatsapp || null,
      qualified: budgetYes,
    });
    if (lead.error) console.error('leads insert failed', lead.error);

    await send(chatId, FINISH, { remove_keyboard: true });

    if (process.env.ADMIN_CHAT_ID) {
      await send(
        Number(process.env.ADMIN_CHAT_ID),
        '🔔 <b>Новая заявка в боте</b>\n\n' +
          `Сфера: ${answers.sphere || '—'}\n` +
          `Бюджет от 500 000 ₸: ${budgetYes ? 'Да' : 'Нет'}\n` +
          `Откуда узнали: ${answers.source || '—'}\n` +
          `Соцсети/сайт: ${answers.social || '—'}\n` +
          `WhatsApp: ${answers.whatsapp || '—'}\n` +
          `Telegram: ${username ? '@' + username : '—'}\n` +
          `Статус: ${budgetYes ? '✅ квалифицирован' : '⚪️ не квалифицирован'}\n` +
          `Calendly для отправки в WhatsApp: ${CALENDLY}`
      );
    }

    return Response.json({ ok: true });
  } catch (e) {
    console.error('telegram handler error', e);
    // Всегда 200: иначе Telegram будет слать тот же апдейт повторно.
    return Response.json({ ok: true });
  }
}
