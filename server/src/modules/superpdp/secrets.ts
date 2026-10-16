import crypto from "node:crypto";
import { env } from "../../config/env.js";

export const superPdpError = (code: string, message: string, status = 409) =>
  Object.assign(new Error(message), { code, status });
export const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const CALLBACK_PATH = "/api/fiscal-entities/superpdp/oauth/callback";

const key = () => {
  const value = env.SUPERPDP_SECRETS_KEY;
  const decoded = Buffer.from(value, "base64");
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    decoded.length !== 32 ||
    decoded.toString("base64") !== value
  ) {
    throw superPdpError(
      "SUPERPDP_CONFIGURATION",
      "La clé de chiffrement SuperPDP doit être configurée côté serveur (32 octets en base64).",
      503,
    );
  }
  return decoded;
};
export const sandboxConfig = () => {
  if (!env.SUPERPDP_SANDBOX_ENABLED)
    throw superPdpError(
      "SUPERPDP_DISABLED",
      "La connexion SuperPDP de test n’est pas activée sur ce serveur.",
      503,
    );
  key();
  let redirect: URL;
  try {
    redirect = new URL(env.SUPERPDP_SANDBOX_REDIRECT_URI);
  } catch {
    throw superPdpError(
      "SUPERPDP_CONFIGURATION",
      "L’URL de retour OAuth de test doit être configurée côté serveur.",
      503,
    );
  }
  const local =
    env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) &&
    redirect.protocol === "http:";
  if (
    (redirect.protocol !== "https:" && !local) ||
    redirect.pathname !== CALLBACK_PATH ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (env.NODE_ENV === "production" &&
      redirect.origin !== new URL(env.APP_PUBLIC_URL).origin)
  ) {
    throw superPdpError(
      "SUPERPDP_CONFIGURATION",
      "L’URL de retour OAuth doit être une URL HTTPS fixe de l’application (HTTP local autorisé en développement).",
      503,
    );
  }
  return { redirectUri: redirect.href };
};
export const sandboxAvailability = () => {
  try {
    sandboxConfig();
    return { available: true, reason: null };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error ? error.message : "Configuration indisponible.",
    };
  }
};

export type SecretContext = {
  organization_id: string;
  fiscal_entity_id: string;
  environment: string;
};
const aad = (context: SecretContext, purpose: string) =>
  Buffer.from(
    JSON.stringify([
      "superpdp",
      context.organization_id,
      context.fiscal_entity_id,
      context.environment,
      purpose,
    ]),
  );
export const seal = (
  plaintext: string,
  context: SecretContext,
  purpose: string,
) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(aad(context, purpose));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};
export const unseal = (
  encrypted: string,
  context: SecretContext,
  purpose: string,
) => {
  try {
    const [version, iv, tag, ciphertext, ...extra] = encrypted.split(".");
    if (
      version !== "v1" ||
      extra.length ||
      !iv ||
      !tag ||
      !ciphertext ||
      Buffer.from(iv, "base64url").length !== 12 ||
      Buffer.from(tag, "base64url").length !== 16
    )
      throw new Error();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(aad(context, purpose));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw superPdpError(
      "SUPERPDP_DECRYPTION",
      "Les secrets SuperPDP ne peuvent pas être déchiffrés. Vérifiez la clé du serveur ; ne la remplacez pas sans procédure de rotation.",
      503,
    );
  }
};
