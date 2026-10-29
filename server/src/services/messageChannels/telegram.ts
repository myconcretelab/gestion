import type {
  MessageChannel,
  MessageDelivery,
  MessageSendRequest,
} from "./types.js";
import {
  sendOwnerPushNotification,
  telegramRecipientsAfterPush,
  type OwnerPushTarget,
} from "../webPushNotifications.js";

export type TelegramMessageChannelOptions = {
  enabled: boolean;
  bot_token: string;
  chat_ids: string[];
  recipient_user_ids?: string[];
  parse_mode?: "HTML" | null;
  has_explicit_recipients?: boolean;
  owner_push?: OwnerPushTarget;
  reply_markup?: {
    inline_keyboard: Array<
      Array<{
        text: string;
        url: string;
      }>
    >;
  };
};

const getOptions = (request: MessageSendRequest) =>
  request.options as TelegramMessageChannelOptions | undefined;

const postTelegramMessage = async (params: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup?: TelegramMessageChannelOptions["reply_markup"];
}) => {
  const response = await fetch(
    `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        ...(params.parseMode ? { parse_mode: params.parseMode } : {}),
        ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
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
    if (
      !options?.has_explicit_recipients &&
      !options?.chat_ids.length &&
      !options?.recipient_user_ids?.length
    ) {
      missing.push("chat_ids");
    }
    return {
      available: Boolean(options?.enabled) && missing.length === 0,
      missing,
    };
  },
  send: async (request) => {
    const options = getOptions(request);
    if (!options?.enabled || !options.owner_push)
      return sendTelegramOnly(request);
    let push;
    let recipients = request.recipients ?? options.chat_ids;
    try {
      push = await sendOwnerPushNotification(
        request.message,
        options.owner_push,
      );
      recipients = await telegramRecipientsAfterPush(
        recipients,
        push.handled_user_ids,
        options.owner_push.userIds,
        options.recipient_user_ids,
        push.failed_user_ids,
      );
    } catch {
      console.error("Impossible de préparer les notifications sur appareil.");
    }
    const pushDeliveries = (push?.handled_user_ids ?? []).map((recipient) => ({
      recipient,
      provider: "web-push",
    }));
    if (!recipients.length && pushDeliveries.length)
      return {
        channel: "web-push",
        sent_count: pushDeliveries.length,
        skipped_reason: null,
        deliveries: pushDeliveries,
      };
    const telegram = await sendTelegramOnly({ ...request, recipients });
    return pushDeliveries.length
      ? {
          ...telegram,
          sent_count: telegram.sent_count + pushDeliveries.length,
          skipped_reason: null,
          deliveries: [...telegram.deliveries, ...pushDeliveries],
        }
      : telegram;
  },
};

const sendTelegramOnly = async (request: MessageSendRequest) => {
  const options = getOptions(request);
  if (!options?.enabled) {
    return {
      channel: "telegram",
      sent_count: 0,
      skipped_reason: "disabled",
      deliveries: [],
    };
  }
  if (process.env.NODE_ENV === "test") {
    return {
      channel: "telegram",
      sent_count: 0,
      skipped_reason: "test_environment",
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
      parseMode: options.parse_mode === null ? null : "HTML",
      replyMarkup: options.reply_markup,
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
};
