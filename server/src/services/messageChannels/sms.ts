import {
  getSmsConfigurationStatus,
  sendOvhSms,
} from "../ovhSms.js";
import type {
  MessageChannel,
  MessageDelivery,
  MessageSendRequest,
} from "./types.js";

const normalizeRecipients = (request: MessageSendRequest) =>
  [...new Set((request.recipients ?? []).map((recipient) => recipient.trim()).filter(Boolean))];

export const smsMessageChannel: MessageChannel = {
  id: "sms",
  label: "SMS",
  getAvailability: () => {
    const status = getSmsConfigurationStatus();
    return {
      available: status.configured,
      missing: status.missing,
    };
  },
  send: async (request) => {
    const recipients = normalizeRecipients(request);
    if (recipients.length === 0) {
      throw new Error("Destinataire SMS manquant.");
    }

    const deliveries: MessageDelivery[] = [];
    for (const recipient of recipients) {
      const result = await sendOvhSms({
        recipient,
        message: request.message,
      });
      deliveries.push({
        recipient: result.recipient,
        provider: result.provider,
        metadata: {
          totalCreditsRemoved: result.totalCreditsRemoved,
          ids: result.ids,
          invalidReceivers: result.invalidReceivers,
          validReceivers: result.validReceivers,
        },
      });
    }

    return {
      channel: "sms",
      sent_count: deliveries.length,
      skipped_reason: null,
      deliveries,
    };
  },
};
