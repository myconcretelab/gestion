import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContractReturnOverdueMessage,
  buildInvoicePaymentOverdueMessage,
  buildCleaningCheckReminderMessage,
  buildCleaningCheckToken,
  parseCleaningCheckToken,
  parisDateTime,
  startOfTodayInParisAsUtc,
} from "../src/services/telegramDeadlineNotifications.ts";
import {
  buildDefaultTelegramNotificationConfig,
  normalizeTelegramNotificationConfig,
} from "../src/services/telegramNotifications.ts";

test("les nouvelles alertes Telegram sont actives par défaut et migrent une ancienne configuration", () => {
  const defaults = buildDefaultTelegramNotificationConfig();
  const config = normalizeTelegramNotificationConfig(
    {
      enabled: true,
      bot_token: " token ",
      chat_ids: ["123"],
      notify_booking_request_created: false,
    },
    defaults,
  );

  assert.equal(config.notify_contract_return_overdue, true);
  assert.equal(config.notify_invoice_payment_overdue, true);
  assert.equal(config.notify_cleaning_check_reminder, true);
  assert.equal(config.bot_token, "token");
});

test("l'heure d'arrivée est convertie depuis le fuseau de Paris, été comme hiver", () => {
  assert.equal(parisDateTime("2026-07-01", "17:00").toISOString(), "2026-07-01T15:00:00.000Z");
  assert.equal(parisDateTime("2026-12-01", "17:00").toISOString(), "2026-12-01T16:00:00.000Z");
});

test("le lien de validation du ménage est signé et expire", () => {
  const payload = {
    departureReservationId: "departure-1",
    arrivalReservationId: "arrival-1",
    expiresAt: new Date("2026-07-02T15:00:00.000Z").getTime(),
  };
  const token = buildCleaningCheckToken(payload, "secret-bot");
  assert.deepEqual(
    parseCleaningCheckToken(token, "secret-bot", new Date("2026-07-01T15:00:00.000Z")),
    payload,
  );
  assert.equal(parseCleaningCheckToken(`${token}x`, "secret-bot"), null);
  assert.equal(parseCleaningCheckToken(token, "secret-bot", new Date("2026-07-03T15:00:00.000Z")), null);
});

test("le rappel du ménage contient le gîte, le locataire et l'heure", () => {
  const message = buildCleaningCheckReminderMessage({
    giteName: "Gîte & Spa",
    guestName: "Jean <Test>",
    arrivalAt: new Date("2026-07-01T15:00:00.000Z"),
  });
  assert.match(message, /Gîte &amp; Spa/);
  assert.match(message, /Jean &lt;Test&gt;/);
  assert.match(message, /17:00/);
});

test("le jour courant est calculé selon le fuseau de Paris", () => {
  assert.equal(
    startOfTodayInParisAsUtc(new Date("2026-06-30T22:30:00.000Z")).toISOString(),
    "2026-07-01T00:00:00.000Z",
  );
});

test("les messages d'échéance contiennent les informations utiles et échappent le HTML", () => {
  const document = {
    id: "doc-1",
    number: "F-2026-001",
    guestName: "Jean <Test>",
    giteName: "Gîte & Spa",
    deadline: new Date("2026-06-30T00:00:00.000Z"),
  };

  const contractMessage = buildContractReturnOverdueMessage(document);
  const invoiceMessage = buildInvoicePaymentOverdueMessage(document);

  assert.match(contractMessage, /Contrat non rendu/);
  assert.match(invoiceMessage, /Facture impayée/);
  assert.match(contractMessage, /Jean &lt;Test&gt;/);
  assert.match(invoiceMessage, /Gîte &amp; Spa/);
  assert.match(invoiceMessage, /\/factures\/doc-1/);
});
