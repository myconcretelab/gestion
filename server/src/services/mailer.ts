import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser/index.js";
import type Mail from "nodemailer/lib/mailer/index.js";
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

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const parseSingleAddress = (value: string) => {
  const entries = addressparser(value, { flatten: true });
  if (entries.length !== 1) return null;

  const entry = entries[0];
  return {
    name: entry.name.trim(),
    address: entry.address.trim(),
  };
};

const isValidEmailAddress = (value: string) => SIMPLE_EMAIL_PATTERN.test(value);

const getDefaultSenderAddress = () => {
  for (const candidate of [env.SMTP_USER, env.SMTP_REPLY_TO]) {
    const parsed = parseSingleAddress(String(candidate ?? "").trim());
    if (parsed?.address && isValidEmailAddress(parsed.address)) {
      return parsed.address;
    }
  }

  return "";
};

const resolveFromAddress = (value: string): Mail.Address | null => {
  const parsed = parseSingleAddress(value);
  if (!parsed) return null;

  if (parsed.address) {
    if (!isValidEmailAddress(parsed.address)) return null;
    return {
      name: parsed.name,
      address: parsed.address,
    };
  }

  if (!parsed.name) return null;

  const fallbackAddress = getDefaultSenderAddress();
  if (!fallbackAddress) return null;

  return {
    name: parsed.name,
    address: fallbackAddress,
  };
};

const getEnvelopeSender = (from: Mail.Address) => {
  const smtpUser = getDefaultSenderAddress();
  return smtpUser || from.address;
};

const formatSmtpError = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "erreur SMTP inconnue";
};

export const getSmtpConfigIssues = (fromOverride?: string) => {
  const issues: string[] = [];
  if (!env.SMTP_HOST.trim()) issues.push("SMTP_HOST");
  const from = String(fromOverride ?? env.SMTP_FROM ?? "").trim();
  if (!from || !resolveFromAddress(from)) issues.push("SMTP_FROM");
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

  const resolvedFrom = resolveFromAddress(from);
  if (!resolvedFrom) throw new SmtpConfigurationError(["SMTP_FROM"]);

  const sendOnce = async () => {
    const info = await getTransporter().sendMail({
      from: resolvedFrom,
      replyTo: params.replyTo?.trim() || undefined,
      to: to.join(", "),
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments,
      envelope: {
        from: getEnvelopeSender(resolvedFrom),
      },
    });

    if (info.accepted.length === 0) {
      const details = [
        info.rejected.length > 0 ? `${info.rejected.length} destinataire(s) refusé(s)` : "",
        info.pending.length > 0 ? `${info.pending.length} destinataire(s) en attente` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const response = info.response.trim() ? ` Réponse SMTP: ${info.response.trim()}.` : "";
      const suffix = details ? ` (${details})` : "";
      throw new SmtpDeliveryError(`Aucun destinataire n'a été accepté par le serveur SMTP${suffix}.${response}`);
    }

    return info;
  };

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
      if (retryError instanceof SmtpDeliveryError) throw retryError;
      throw new SmtpDeliveryError(`Envoi SMTP impossible: ${formatSmtpError(retryError)}.`);
    }
  }
};

export const resetSmtpTransportForTests = () => {
  resetTransportState();
};
