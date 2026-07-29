import { config } from "./config.ts";

// Telegram flow-run notifications — entirely optional, additive. If either
// TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is unset, notifications are
// silently disabled and the keeper's poll loop is unaffected. Uses the free
// Telegram Bot API directly via fetch — no new dependency. The token never
// leaves this process (read from env, not logged, not sent anywhere but
// api.telegram.org).

const enabled = Boolean(config.telegramBotToken && config.telegramChatId);

export function telegramEnabled(): boolean {
  return enabled;
}

let loggedDisabledOnce = false;

/** Logs once, on startup, that notifications are off — never repeats. */
export function logDisabledNoticeOnce(log: (message: string) => void) {
  if (enabled || loggedDisabledOnce) return;
  loggedDisabledOnce = true;
  log("Telegram notifications disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — see .env.example)");
}

/**
 * Sends a Telegram message. A no-op if notifications are disabled. Never
 * throws — a failed send (bad token, Telegram down, network error) is
 * logged and swallowed so it can never crash or block the poll loop.
 */
export async function notifyTelegram(text: string, log: (message: string) => void): Promise<void> {
  if (!enabled) return;

  try {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log(`telegram notify failed: ${res.status} ${res.statusText} ${body}`);
    }
  } catch (err) {
    log(`telegram notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
