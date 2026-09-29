import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { env } from "../src/config/env.js";
import {
  buildBookingRequestApprovedMessage,
  buildBookingRequestApprovedSms,
} from "../src/services/bookingRequestEmail.ts";
import {
  buildBookingRequestApprovedTelegramMessage,
  buildBookingRequestCreatedMessage,
  buildDefaultTelegramNotificationConfig,
  normalizeTelegramNotificationConfig,
} from "../src/services/telegramNotifications.ts";
import {
  buildDefaultDocumentEmailTemplateSettings,
  readDocumentEmailTemplateSettings,
} from "../src/services/documentEmailTemplateSettings.ts";
import { buildBookingRequestApprovedEmailDraft, buildDocumentEmailTemplateSettings } from "../../client/src/utils/documentEmail.ts";
import type { BookingRequest } from "../../client/src/utils/types.ts";

const settingsPath = path.join(env.DATA_DIR, "document-email-template-settings.json");
const originalSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf-8") : null;
test.after(() => {
  if (originalSettings === null) fs.rmSync(settingsPath, { force: true });
  else fs.writeFileSync(settingsPath, originalSettings, "utf-8");
});

const quote = {
  nb_nuits: 2,
  montant_hebergement: 150,
  total_options: 84,
  taxe_sejour: 2,
  total_global: 236,
  options_detail: { draps: 24, linge: 0, menage: 60, depart_tardif: 0, chiens: 0 },
};
const options = { draps: { enabled: true, nb_lits: 2 }, menage: { enabled: true } };
const payload = {
  id: "r1", hote_nom: "Camille <Test>", email: "camille@example.test", telephone: "0600000000",
  date_entree: "2027-02-10", date_sortie: "2027-02-12", nb_adultes: 2, nb_enfants_2_17: 0,
  hold_expires_at: "2027-02-01T00:00:00Z", gite: { nom: "La Grée & Co" }, pricing_snapshot: quote,
  options,
};

test("email, aperçu et Telegram indiquent les options et leurs montants", () => {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(buildDefaultDocumentEmailTemplateSettings()), "utf-8");
  const serverEmail = buildBookingRequestApprovedMessage(payload as any);
  const clientEmail = buildBookingRequestApprovedEmailDraft(
    { ...payload, nb_nuits: 2, pricing_snapshot: quote } as unknown as BookingRequest,
    buildDocumentEmailTemplateSettings({
      contrat: { subject: "", body: "", activitiesList: "", guideUrl: "", destinationUrl: "" },
      facture: { subject: "", body: "" },
      bookingRequestApproved: { subject: serverEmail.subject, body: readDocumentEmailTemplateSettings().bookingRequestApproved.bodyLines.join("\n"), activitiesList: "", guideUrl: "", destinationUrl: "", smsBody: "" },
    }),
  );
  for (const text of [serverEmail.text, clientEmail.body]) {
    assert.match(text, /Draps \(2 lit\(s\)\) : 24/);
    assert.match(text, /Ménage : 60/);
    assert.doesNotMatch(text, /Petit rappel : les draps ne sont pas inclus/);
    assert.doesNotMatch(text, /L'option draps est bien notée/);
  }
  const createdTelegram = buildBookingRequestCreatedMessage(payload as any);
  assert.match(createdTelegram, /Draps \(2 lit\(s\)\) : 24/);
  const telegram = buildBookingRequestApprovedTelegramMessage(payload as any);
  assert.match(telegram, /Draps \(2 lit\(s\)\) : 24/);
  assert.match(telegram, /Ménage : 60/);
  assert.match(telegram, /Camille &lt;Test&gt;/);
  assert.match(telegram, /La Grée &amp; Co/);
});

test("le rappel des draps reste affiché quand l'option n'est pas choisie", () => {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(buildDefaultDocumentEmailTemplateSettings()), "utf-8");
  const requestWithoutBedding = { ...payload, options: { menage: { enabled: true } } };
  const serverEmail = buildBookingRequestApprovedMessage(requestWithoutBedding as any);
  const clientEmail = buildBookingRequestApprovedEmailDraft(
    requestWithoutBedding as unknown as BookingRequest,
    buildDocumentEmailTemplateSettings({
      contrat: { subject: "", body: "", activitiesList: "", guideUrl: "", destinationUrl: "" },
      facture: { subject: "", body: "" },
      bookingRequestApproved: {
        subject: serverEmail.subject,
        body: readDocumentEmailTemplateSettings().bookingRequestApproved.bodyLines.join("\n"),
        activitiesList: "",
        guideUrl: "",
        destinationUrl: "",
        smsBody: "",
      },
    }),
  );

  for (const text of [serverEmail.text, clientEmail.body]) {
    assert.match(text, /Petit rappel : les draps ne sont pas inclus/);
  }
});

test("le résumé des options reste vide quand aucune option n'est choisie", () => {
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(buildDefaultDocumentEmailTemplateSettings()), "utf-8");
  const requestWithoutOptions = {
    ...payload,
    options: {},
    pricing_snapshot: {
      ...quote,
      total_options: 0,
      total_global: quote.montant_hebergement + quote.taxe_sejour,
      options_detail: { draps: 0, linge: 0, menage: 0, depart_tardif: 0, chiens: 0 },
    },
  };
  const serverEmail = buildBookingRequestApprovedMessage(requestWithoutOptions as any);
  const clientEmail = buildBookingRequestApprovedEmailDraft(
    requestWithoutOptions as unknown as BookingRequest,
    buildDocumentEmailTemplateSettings({
      contrat: { subject: "", body: "", activitiesList: "", guideUrl: "", destinationUrl: "" },
      facture: { subject: "", body: "" },
      bookingRequestApproved: {
        subject: serverEmail.subject,
        body: readDocumentEmailTemplateSettings().bookingRequestApproved.bodyLines.join("\n"),
        activitiesList: "",
        guideUrl: "",
        destinationUrl: "",
        smsBody: "",
      },
    }),
  );

  for (const text of [serverEmail.text, clientEmail.body]) {
    assert.doesNotMatch(text, /Options choisies/);
    assert.match(text, /Petit rappel : les draps ne sont pas inclus/);
  }
});

test("les anciennes demandes sans détail des prix restent notifiables", () => {
  const legacy = { ...payload, pricing_snapshot: { ...quote, options_detail: undefined } };
  assert.match(buildBookingRequestApprovedMessage(legacy as any).text, /Draps \(2 lit\(s\)\)/);
  assert.match(buildBookingRequestApprovedTelegramMessage(legacy as any), /Ménage/);
});

test("SMS configurable et migration des anciens réglages", () => {
  const legacy = buildDefaultDocumentEmailTemplateSettings();
  legacy.bookingRequestApproved.bodyLines = legacy.bookingRequestApproved.bodyLines.filter(line => !line.includes("{{optionsSummary}}"));
  delete legacy.bookingRequestApproved.smsBody;
  fs.writeFileSync(settingsPath, JSON.stringify(legacy), "utf-8");
  const loaded = readDocumentEmailTemplateSettings().bookingRequestApproved;
  assert.ok(loaded.bodyLines.includes("{{optionsSummary}}"));
  assert.ok(loaded.smsBody?.includes("{{giteName}}"));
  const sms = buildBookingRequestApprovedSms(payload as any);
  assert.match(sms, /réservation au La Grée & Co/);
  assert.match(sms, /Plus d’informations dans votre email/);
  const telegram = normalizeTelegramNotificationConfig({ notify_booking_request_created: false }, buildDefaultTelegramNotificationConfig());
  assert.equal(telegram.notify_booking_request_approved, true);
});
