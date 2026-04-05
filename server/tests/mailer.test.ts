import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { env } from "../src/config/env.js";
import {
  SmtpConfigurationError,
  SmtpDeliveryError,
  getSmtpConfigIssues,
  resetSmtpTransportForTests,
  sendSmtpMail,
} from "../src/services/mailer.ts";

const originalEnv = {
  SMTP_HOST: env.SMTP_HOST,
  SMTP_PORT: env.SMTP_PORT,
  SMTP_SECURE: env.SMTP_SECURE,
  SMTP_USER: env.SMTP_USER,
  SMTP_PASS: env.SMTP_PASS,
  SMTP_FROM: env.SMTP_FROM,
  SMTP_REPLY_TO: env.SMTP_REPLY_TO,
};

const originalCreateTransport = nodemailer.createTransport;

const restoreSmtpState = () => {
  env.SMTP_HOST = originalEnv.SMTP_HOST;
  env.SMTP_PORT = originalEnv.SMTP_PORT;
  env.SMTP_SECURE = originalEnv.SMTP_SECURE;
  env.SMTP_USER = originalEnv.SMTP_USER;
  env.SMTP_PASS = originalEnv.SMTP_PASS;
  env.SMTP_FROM = originalEnv.SMTP_FROM;
  env.SMTP_REPLY_TO = originalEnv.SMTP_REPLY_TO;
  nodemailer.createTransport = originalCreateTransport;
  resetSmtpTransportForTests();
};

test.afterEach(() => {
  restoreSmtpState();
});

test.after(() => {
  restoreSmtpState();
});

test("sendSmtpMail complete SMTP_FROM avec SMTP_USER quand seul le nom est fourni", async () => {
  const sentPayloads: SMTPTransport.MailOptions[] = [];

  env.SMTP_HOST = "smtp.example.com";
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_USER = "contact@example.com";
  env.SMTP_PASS = "secret";
  env.SMTP_FROM = "Les Gîtes de Brocéliande";
  env.SMTP_REPLY_TO = "";
  resetSmtpTransportForTests();

  nodemailer.createTransport = () =>
    ({
      verify: async () => true,
      sendMail: async (payload: SMTPTransport.MailOptions) => {
        sentPayloads.push(payload);
        return {
          envelope: { from: "contact@example.com", to: "client@example.com" },
          messageId: "message-1",
          accepted: ["client@example.com"],
          rejected: [],
          pending: [],
          response: "250 2.0.0 Ok",
        };
      },
    }) as any;

  await sendSmtpMail({
    to: "client@example.com",
    subject: "Sujet",
    text: "Texte",
  });

  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0].from, {
    name: "Les Gîtes de Brocéliande",
    address: "contact@example.com",
  });
  assert.deepEqual(sentPayloads[0].envelope, {
    from: "contact@example.com",
  });
});

test("getSmtpConfigIssues signale SMTP_FROM invalide sans adresse de repli", () => {
  env.SMTP_HOST = "smtp.example.com";
  env.SMTP_USER = "";
  env.SMTP_REPLY_TO = "";
  env.SMTP_FROM = "Les Gîtes de Brocéliande";

  assert.deepEqual(getSmtpConfigIssues(), ["SMTP_FROM"]);
});

test("sendSmtpMail echoue si le serveur SMTP n'accepte aucun destinataire", async () => {
  env.SMTP_HOST = "smtp.example.com";
  env.SMTP_PORT = 587;
  env.SMTP_SECURE = false;
  env.SMTP_USER = "contact@example.com";
  env.SMTP_PASS = "secret";
  env.SMTP_FROM = "Les Gîtes de Brocéliande <contact@example.com>";
  env.SMTP_REPLY_TO = "";
  resetSmtpTransportForTests();

  let sendCalls = 0;
  nodemailer.createTransport = () =>
    ({
      verify: async () => true,
      sendMail: async () => {
        sendCalls += 1;
        return {
          envelope: { from: "contact@example.com", to: "client@example.com" },
          messageId: "message-1",
          accepted: [],
          rejected: ["client@example.com"],
          pending: [],
          response: "550 5.7.1 Sender rejected",
        };
      },
    }) as any;

  await assert.rejects(
    sendSmtpMail({
      to: "client@example.com",
      subject: "Sujet",
      text: "Texte",
    }),
    (error: unknown) => {
      assert.ok(error instanceof SmtpDeliveryError);
      assert.match(error.message, /aucun destinataire n'a ete accepte|aucun destinataire n'a été accepté/i);
      assert.match(error.message, /550 5\.7\.1 Sender rejected/);
      return true;
    },
  );

  assert.equal(sendCalls, 2);
});

test("sendSmtpMail echoue avec une erreur de configuration si SMTP_FROM reste non resoluble", async () => {
  env.SMTP_HOST = "smtp.example.com";
  env.SMTP_USER = "";
  env.SMTP_REPLY_TO = "";
  env.SMTP_FROM = "Les Gîtes de Brocéliande";
  resetSmtpTransportForTests();

  await assert.rejects(
    sendSmtpMail({
      to: "client@example.com",
      subject: "Sujet",
      text: "Texte",
    }),
    (error: unknown) => {
      assert.ok(error instanceof SmtpConfigurationError);
      assert.deepEqual(error.keys, ["SMTP_FROM"]);
      return true;
    },
  );
});
