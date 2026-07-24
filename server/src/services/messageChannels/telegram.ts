import type {
  MessageChannel,
  MessageDelivery,
  MessageSendRequest,
} from "./types.js";

export type TelegramMessageChannelOptions = {
  enabled: boolean;
  bot_token: string;
  chat_ids: string[];
};

const getOptions = (request: MessageSendRequest) =>
  request.options as TelegramMessageChannelOptions | undefined;

const postTelegramMessage = async (params: {
  botToken: string;
  chatId: string;
  text: string;
}) => {
  const response = await fetch(
    `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Telegram sendMessage failed (${response.status}): ${body || response.statusText}`,
    );
  }
};

export const telegramMessageChannel: MessageChannel = {
  id: "telegram",
  label: "Telegram",
  getAvailability: (rawOptions) => {
    const options = rawOptions as TelegramMessageChannelOptions | undefined;
    const missing = [];
    if (!options?.bot_token.trim()) missing.push("bot_token");
    if (!options?.chat_ids.length) missing.push("chat_ids");
    return {
      available: Boolean(options?.enabled) && missing.length === 0,
      missing,
    };
  },
  send: async (request) => {
    const options = getOptions(request);
    if (!options?.enabled) {
      return {
        channel: "telegram",
        sent_count: 0,
        skipped_reason: "disabled",
        deliveries: [],
      };
    }
    if (!options.bot_token.trim()) {
      return {
        channel: "telegram",
        sent_count: 0,
        skipped_reason: "missing_bot_token",
        deliveries: [],
      };
    }

    const recipients = [
      ...new Set(
        (request.recipients ?? options.chat_ids)
          .map((recipient) => recipient.trim())
          .filter(Boolean),
      ),
    ];
    if (recipients.length === 0) {
      return {
        channel: "telegram",
        sent_count: 0,
        skipped_reason: "missing_chat_ids",
        deliveries: [],
      };
    }

    const deliveries: MessageDelivery[] = [];
    for (const chatId of recipients) {
      await postTelegramMessage({
        botToken: options.bot_token,
        chatId,
        text: request.message,
      });
      deliveries.push({
        recipient: chatId,
        provider: "telegram",
      });
    }

    return {
      channel: "telegram",
      sent_count: deliveries.length,
      skipped_reason: null,
      deliveries,
    };
  },
};
