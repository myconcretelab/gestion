import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import nodemailer from "nodemailer";
import { env } from "../src/config/env.js";
import {
  buildBookingRequestApprovedMessage,
  buildBookingRequestApprovedSms,
  sendBookingRequestCreatedEmails,
} from "../src/services/bookingRequestEmail.ts";
import { resetSmtpTransportForTests } from "../src/services/mailer.ts";
import {
  buildBookingRequestApprovedTelegramMessage,
  buildBookingRequestCreatedMessage,
  buildDefaultTelegramNotificationConfig,
  normalizeTelegramNotificationConfig,
} from "../src/services/telegramNotifications.ts";
import {
  buildDefaultDocumentEmailTemplateSettings,
  readDocumentEmailTemplateSettings,
  writeDocumentEmailTemplateSettings,
} from "../src/services/documentEmailTemplateSettings.ts";
import { buildBookingRequestApprovedEmailDraft, buildDocumentEmailTemplateSettings } from "../../client/src/utils/documentEmail.ts";
import type { BookingRequest } from "../../client/src/utils/types.ts";

const settingsPath = path.join(env.DATA_DIR, "document-email-template-settings.json");
const originalSettings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf-8") : null;
test.beforeEach(() => {
  writeDocumentEmailTemplateSettings(buildDefaultDocumentEmailTemplateSettings());
});
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

test("les variables d’options détaillent les calculs à l’identique dans l’aperçu et l’email", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.bodyLines = ["{{optionsSummary}}", "{{optionsChiens}}", "{{optionsDraps}}", "{{optionsLingeToilette}}", "{{optionsDepartTardif}}"];
  writeDocumentEmailTemplateSettings(settings);
  const request = { ...payload, nb_nuits: 4, options: { chiens: { enabled: true, nb: 1 }, draps: { enabled: true, nb_lits: 2 }, linge_toilette: { enabled: true, nb_personnes: 3 } }, pricing_snapshot: { ...quote, nb_nuits: 4, options_detail: { ...quote.options_detail, chiens: 60, linge: 18 }, options_unit_prices: { chiens: 15, draps: 12, linge: 6 } } };
  const message = buildBookingRequestApprovedMessage(request as any);
  const preview = buildBookingRequestApprovedEmailDraft(request as unknown as BookingRequest, { bookingRequestApproved: settings.bookingRequestApproved });
  assert.equal(preview.body, message.text);
  assert.match(message.text, /Chiens : 15.*× 4 nuits = 60/);
  assert.match(message.text, /Draps : 12.*× 2 lits = 24/);
  assert.match(message.text, /Linge de toilette : 6.*× 3 personnes = 18/);
  assert.ok(!message.text.includes("{{"));
  assert.match(message.html, /× 4 nuits = 60/);
});

test("les emails de réception au client et au propriétaire contiennent aussi le calcul des options", async (t) => {
  const originalHost = env.SMTP_HOST, originalFrom = env.SMTP_FROM;
  const originalTransport = nodemailer.createTransport;
  const messages: any[] = [];
  t.after(() => { env.SMTP_HOST = originalHost; env.SMTP_FROM = originalFrom; nodemailer.createTransport = originalTransport; resetSmtpTransportForTests(); });
  env.SMTP_HOST = "smtp.example.test";
  env.SMTP_FROM = "owner@example.test";
  resetSmtpTransportForTests();
  nodemailer.createTransport = () => ({ verify: async () => true, sendMail: async (message: any) => { messages.push(message); return { accepted: [message.to], rejected: [], pending: [] }; } }) as any;
  await sendBookingRequestCreatedEmails({ ...payload, gite: { ...payload.gite, email: "owner@example.test" }, options: { chiens: { enabled: true, nb: 1 } }, pricing_snapshot: { ...quote, nb_nuits: 4, options_detail: { ...quote.options_detail, chiens: 60 } } } as any);
  assert.equal(messages.length, 2);
  for (const message of messages) assert.match(message.text, /Chiens : 15.*× 4 nuits = 60/);
});

test("un modèle avec les variables par option ne reçoit pas un second récapitulatif automatique", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.bodyLines = ["{{optionsChiens}}", "{{optionsDraps}}"];
  writeDocumentEmailTemplateSettings(settings);
  assert.deepEqual(readDocumentEmailTemplateSettings().bookingRequestApproved.bodyLines, settings.bookingRequestApproved.bodyLines);
});

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
    assert.match(text, /Draps : 12.*× 2 lits = 24/);
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

test("l'email d'approbation expose l'adresse du gîte et le téléphone du propriétaire", () => {
  const settings = buildDefaultDocumentEmailTemplateSettings();
  settings.bookingRequestApproved.bodyLines = ["{{giteAddress}}", "{{ownerPhone}}"];
  writeDocumentEmailTemplateSettings(settings);
  const request = {
    ...payload,
    gite: {
      ...payload.gite,
      adresse_ligne1: "1 rue de la Forêt",
      adresse_ligne2: "56430 Mauron",
      telephones: ["06 12 34 56 78"],
    },
  };

  const serverEmail = buildBookingRequestApprovedMessage(request as any);
  const clientEmail = buildBookingRequestApprovedEmailDraft(
    { ...request, nb_nuits: 2 } as unknown as BookingRequest,
    buildDocumentEmailTemplateSettings({
      contrat: { subject: "", body: "", activitiesList: "", guideUrl: "", destinationUrl: "" },
      facture: { subject: "", body: "" },
      bookingRequestApproved: {
        subject: serverEmail.subject,
        body: settings.bookingRequestApproved.bodyLines.join("\n"),
        activitiesList: "",
        guideUrl: "",
        destinationUrl: "",
        smsBody: "",
      },
    }),
  );

  for (const text of [serverEmail.text, clientEmail.body]) {
    assert.match(text, /^1 rue de la Forêt, 56430 Mauron\n06 12 34 56 78/);
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
  assert.match(buildBookingRequestApprovedMessage(legacy as any).text, /Draps \(2 lits\)/);
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
