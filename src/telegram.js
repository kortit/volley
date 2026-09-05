const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function isConfigured() {
  return Boolean(TOKEN && CHAT_ID);
}

export async function sendMessage(text) {
  if (!isConfigured()) {
    throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(`Telegram API ${res.status}: ${body.description || 'unknown error'}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}
