import { smsMessageChannel } from "./sms.js";
import { telegramMessageChannel } from "./telegram.js";
import type {
  MessageChannel,
  MessageChannelAvailability,
  MessageSendRequest,
  MessageSendResult,
} from "./types.js";

const channels = [smsMessageChannel, telegramMessageChannel] satisfies MessageChannel[];
const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

export const listMessageChannels = () =>
  channels.map(({ id, label }) => ({ id, label }));

export const getMessageChannel = (channelId: string) => {
  const channel = channelsById.get(channelId);
  if (!channel) {
    throw new Error(`Mode d'envoi inconnu: ${channelId}.`);
  }
  return channel;
};

export const getMessageChannelAvailability = (
  channelId: string,
  options?: unknown,
): MessageChannelAvailability =>
  getMessageChannel(channelId).getAvailability(options);

export const sendMessage = (
  channelId: string,
  request: MessageSendRequest,
): Promise<MessageSendResult> =>
  getMessageChannel(channelId).send(request);

export type {
  MessageChannel,
  MessageChannelAvailability,
  MessageDelivery,
  MessageSendRequest,
  MessageSendResult,
} from "./types.js";
