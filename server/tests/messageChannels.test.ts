import assert from "node:assert/strict";
import test from "node:test";
import {
  getMessageChannel,
  getMessageChannelAvailability,
  listMessageChannels,
  sendMessage,
} from "../src/services/messageChannels/index.ts";

test("le registre expose les modes SMS et Telegram", () => {
  assert.deepEqual(listMessageChannels(), [
    { id: "sms", label: "SMS" },
    { id: "telegram", label: "Telegram" },
  ]);
  assert.equal(getMessageChannel("sms").id, "sms");
  assert.throws(
    () => getMessageChannel("inconnu"),
    /Mode d'envoi inconnu/,
  );
});

test("la disponibilité Telegram dépend de sa configuration", () => {
  assert.deepEqual(
    getMessageChannelAvailability("telegram", {
      enabled: true,
      bot_token: "",
      chat_ids: [],
    }),
    {
      available: false,
      missing: ["bot_token", "chat_ids"],
    },
  );
  assert.deepEqual(
    getMessageChannelAvailability("telegram", {
      enabled: true,
      bot_token: "token",
      chat_ids: ["123"],
    }),
    {
      available: true,
      missing: [],
    },
  );
});

test("un canal désactivé ignore l'envoi sans appeler le fournisseur", async () => {
  const result = await sendMessage("telegram", {
    message: "Test",
    options: {
      enabled: false,
      bot_token: "",
      chat_ids: [],
    },
  });

  assert.deepEqual(result, {
    channel: "telegram",
    sent_count: 0,
    skipped_reason: "disabled",
    deliveries: [],
  });
});
