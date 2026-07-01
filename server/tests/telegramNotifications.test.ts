import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContractReturnOverdueMessage,
  buildInvoicePaymentOverdueMessage,
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
  assert.equal(config.bot_token, "token");
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
