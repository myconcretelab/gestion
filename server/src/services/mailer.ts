import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { env } from "../config/env.js";

type SmtpAttachment = {
  filename: string;
  path: string;
  contentType?: string;
};

type SendSmtpMailParams = {
  from?: string;
  replyTo?: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: SmtpAttachment[];
};

export class SmtpConfigurationError extends Error {
  readonly statusCode = 503;
  readonly keys: string[];

  constructor(keys: string[]) {
    super(`SMTP non configuré. Variables manquantes: ${keys.join(", ")}.`);
    this.name = "SmtpConfigurationError";
    this.keys = keys;
  }
}

export class SmtpDeliveryError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = "SmtpDeliveryError";
  }
}

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;
let verifyPromise: Promise<void> | null = null;
let verified = false;

const buildTransportOptions = (): SMTPTransport.Options => ({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth:
    env.SMTP_USER || env.SMTP_PASS
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
});

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportOptions());
  }
  return transporter;
};

const resetTransportState = () => {
  transporter = null;
  verifyPromise = null;
  verified = false;
};

const normalizeRecipients = (value: string | string[]) =>
  (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);

const formatSmtpError = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "erreur SMTP inconnue";
};

export const getSmtpConfigIssues = (fromOverride?: string) => {
  const issues: string[] = [];
  if (!env.SMTP_HOST.trim()) issues.push("SMTP_HOST");
  if (!String(fromOverride ?? env.SMTP_FROM ?? "").trim()) issues.push("SMTP_FROM");
  return issues;
};

export const isSmtpConfigured = (fromOverride?: string) => getSmtpConfigIssues(fromOverride).length === 0;

const ensureTransportVerified = async () => {
  if (verified) return;

  if (!verifyPromise) {
    verifyPromise = getTransporter()
      .verify()
      .then(() => {
        verified = true;
      })
      .catch((error) => {
        resetTransportState();
        throw new SmtpDeliveryError(`Connexion SMTP impossible: ${formatSmtpError(error)}.`);
      })
      .finally(() => {
        verifyPromise = null;
      });
  }

  await verifyPromise;
};

export const sendSmtpMail = async (params: SendSmtpMailParams) => {
  const from = String(params.from ?? env.SMTP_FROM ?? "").trim();
  const to = normalizeRecipients(params.to);
  const issues = getSmtpConfigIssues(from);

  if (issues.length > 0) throw new SmtpConfigurationError(issues);
  if (to.length === 0) throw new SmtpDeliveryError("Aucun destinataire email n'a été fourni.");

  const sendOnce = async () =>
    getTransporter().sendMail({
      from,
      replyTo: params.replyTo?.trim() || undefined,
      to: to.join(", "),
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
    });

  try {
    await ensureTransportVerified();
    return await sendOnce();
  } catch (error) {
    if (error instanceof SmtpConfigurationError) throw error;
    resetTransportState();

    try {
      await ensureTransportVerified();
      return await sendOnce();
    } catch (retryError) {
      throw new SmtpDeliveryError(`Envoi SMTP impossible: ${formatSmtpError(retryError)}.`);
    }
  }
};

export const resetSmtpTransportForTests = () => {
  resetTransportState();
};
