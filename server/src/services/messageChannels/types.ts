export type MessageChannelId = string;

export type MessageChannelAvailability = {
  available: boolean;
  missing: string[];
};

export type MessageDelivery = {
  recipient: string;
  provider: string;
  metadata?: Record<string, unknown>;
};

export type MessageSendResult = {
  channel: MessageChannelId;
  sent_count: number;
  skipped_reason: string | null;
  deliveries: MessageDelivery[];
};

export type MessageSendRequest = {
  message: string;
  recipients?: string[];
  options?: unknown;
};

export type MessageChannel = {
  id: MessageChannelId;
  label: string;
  getAvailability(options?: unknown): MessageChannelAvailability;
  send(request: MessageSendRequest): Promise<MessageSendResult>;
};
