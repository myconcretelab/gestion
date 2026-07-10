import crypto from "node:crypto";
import axios from "axios";
import { env } from "../config/env.js";

type OvhSmsJobResponse = {
  totalCreditsRemoved?: number;
  ids?: number[];
  invalidReceivers?: string[];
  validReceivers?: string[];
};

type SendSmsParams = {
  recipient: string;
  message: string;
};

type OvhSmsErrorDetails = {
  provider: "ovh";
  provider_status?: number;
  provider_message?: string;
  required_right?: string;
  hint?: string;
};

export class OvhSmsError extends Error {
  statusCode: number;
  code: string;
  details: OvhSmsErrorDetails;

  constructor(message: string, options: { statusCode?: number; code?: string; details: OvhSmsErrorDetails }) {
    super(message);
    this.name = "OvhSmsError";
    this.statusCode = options.statusCode ?? 502;
    this.code = options.code ?? "ovh_sms_error";
    this.details = options.details;
  }
}

export const getSmsConfigurationStatus = () => {
  const missing = [
    ["SMS_APP_KEY", env.SMS_APP_KEY],
    ["SMS_SECRET", env.SMS_APP_SECRET],
    ["SMS_CONSUMER_KEY", env.SMS_CONSUMER_KEY],
    ["SMS_SERVICE_NAME", env.SMS_SERVICE_NAME],
  ]
    .filter(([, value]) => !String(value ?? "").trim())
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
  };
};

export const normalizeSmsRecipient = (value: string) => {
  const compact = String(value ?? "").replace(/[^\d+]/g, "");
  if (!compact) throw new Error("Numero SMS manquant.");

  let normalized = compact;
  if (normalized.startsWith("+")) normalized = `00${normalized.slice(1)}`;
  else if (normalized.startsWith("0")) normalized = `0033${normalized.slice(1)}`;
  else if (normalized.startsWith("33")) normalized = `00${normalized}`;

  if (!/^00\d{8,15}$/.test(normalized)) {
    throw new Error("Numero SMS invalide. Utilisez un numero francais ou international.");
  }

  return normalized;
};

export const buildOvhSignature = (params: {
  appSecret: string;
  consumerKey: string;
  method: string;
  url: string;
  body: string;
  timestamp: number;
}) => {
  const source = [
    params.appSecret,
    params.consumerKey,
    params.method.toUpperCase(),
    params.url,
    params.body,
    params.timestamp,
  ].join("+");

  return `$1$${crypto.createHash("sha1").update(source).digest("hex")}`;
};

const getOvhTimestamp = async () => {
  const response = await axios.get<number>(`${env.SMS_API_BASE_URL}/auth/time`, {
    timeout: 10_000,
  });
  return Number(response.data);
};

const stringifyOvhMessage = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
};

const toOvhSmsError = (error: unknown, requiredRight: string) => {
  if (!axios.isAxiosError(error)) return error;

  const providerStatus = error.response?.status;
  const providerMessage = stringifyOvhMessage(error.response?.data);
  const isForbidden = providerStatus === 403;
  const isSenderMissing = /sender\b.*does not exists/i.test(providerMessage ?? "");
  const hint = isForbidden
    ? isSenderMissing
      ? "OVH ne trouve pas l'expéditeur SMS demandé. Créez un expéditeur dans OVH SMS, puis renseignez exactement ce nom dans SMS_SENDER, ou vérifiez qu'OVH accepte l'envoi sans expéditeur personnalisé sur ce compte."
      : `La Consumer Key OVH n'a pas le droit requis. Ajoutez le droit ${requiredRight}, puis remplacez SMS_CONSUMER_KEY avec la nouvelle clé.`
    : providerStatus
      ? "OVH a refusé la demande SMS. Vérifiez les identifiants, le service SMS, l'expéditeur et le solde de crédits."
      : "Impossible de joindre l'API SMS OVH. Vérifiez la connexion du serveur et SMS_API_BASE_URL.";

  return new OvhSmsError(
    isSenderMissing
      ? "OVH refuse l'envoi SMS: expéditeur SMS introuvable."
      : isForbidden
      ? "OVH refuse l'envoi SMS: droit API insuffisant."
      : `OVH refuse l'envoi SMS${providerStatus ? ` (${providerStatus})` : ""}.`,
    {
      statusCode: 502,
      code: isSenderMissing
        ? "ovh_sms_sender_missing"
        : isForbidden
          ? "ovh_sms_forbidden"
          : "ovh_sms_request_failed",
      details: {
        provider: "ovh",
        ...(providerStatus ? { provider_status: providerStatus } : {}),
        ...(providerMessage ? { provider_message: providerMessage } : {}),
        required_right: requiredRight,
        hint,
      },
    },
  );
};

export const sendOvhSms = async ({ recipient, message }: SendSmsParams) => {
  const status = getSmsConfigurationStatus();
  if (!status.configured) {
    throw new Error(`Configuration SMS incomplete: ${status.missing.join(", ")}.`);
  }

  const normalizedRecipient = normalizeSmsRecipient(recipient);
  const trimmedMessage = String(message ?? "").trim();
  if (!trimmedMessage) throw new Error("Message SMS manquant.");
  if (trimmedMessage.length > 1000) throw new Error("Message SMS trop long.");

  const method = "POST";
  const requiredRight = `POST /sms/${env.SMS_SERVICE_NAME}/jobs`;
  const url = `${env.SMS_API_BASE_URL}/sms/${encodeURIComponent(env.SMS_SERVICE_NAME)}/jobs`;
  const payload = {
    charset: "UTF-8",
    coding: "7bit",
    message: trimmedMessage,
    noStopClause: env.SMS_NO_STOP_CLAUSE,
    receivers: [normalizedRecipient],
    ...(env.SMS_SENDER.trim() ? { sender: env.SMS_SENDER.trim() } : {}),
  };
  const body = JSON.stringify(payload);
  const timestamp = await getOvhTimestamp().catch((error) => {
    throw toOvhSmsError(error, "GET /auth/time");
  });

  const response = await axios.post<OvhSmsJobResponse>(url, body, {
    timeout: 15_000,
    headers: {
      "Content-Type": "application/json",
      "X-Ovh-Application": env.SMS_APP_KEY,
      "X-Ovh-Consumer": env.SMS_CONSUMER_KEY,
      "X-Ovh-Timestamp": String(timestamp),
      "X-Ovh-Signature": buildOvhSignature({
        appSecret: env.SMS_APP_SECRET,
        consumerKey: env.SMS_CONSUMER_KEY,
        method,
        url,
        body,
        timestamp,
      }),
    },
  }).catch((error) => {
    throw toOvhSmsError(error, requiredRight);
  });

  return {
    recipient: normalizedRecipient,
    provider: "ovh",
    ...response.data,
  };
};
