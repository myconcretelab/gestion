import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

const SECRET_FILE = path.join(env.DATA_DIR, "planning-relay-share-secret");

const readOrCreateSecret = () => {
  if (env.PLANNING_RELAY_SHARE_SECRET.trim()) return env.PLANNING_RELAY_SHARE_SECRET.trim();
  fs.mkdirSync(env.DATA_DIR, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (stored) return stored;
  }

  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
};

let cachedSecret: string | null = null;
const getSecret = () => {
  cachedSecret ??= readOrCreateSecret();
  return cachedSecret;
};

const sign = (id: string, nonce: string) =>
  crypto.createHmac("sha256", getSecret()).update(`${id}:${nonce}`).digest("base64url");

const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SHORT_CODE_LENGTH = 8;

const encodeShortCode = (input: Buffer) => {
  const base = BigInt(SHORT_CODE_ALPHABET.length);
  const modulo = base ** BigInt(SHORT_CODE_LENGTH);
  let value = input.readBigUInt64BE(0) % modulo;
  let output = "";
  for (let index = 0; index < SHORT_CODE_LENGTH; index += 1) {
    output = SHORT_CODE_ALPHABET[Number(value % base)] + output;
    value /= base;
  }
  return output;
};

export const generatePlanningRelayNonce = () => crypto.randomBytes(18).toString("base64url");

export const buildPlanningRelayShortCode = (nonce: string) =>
  encodeShortCode(crypto.createHmac("sha256", getSecret()).update(`short:${nonce}`).digest());

export const hashPlanningRelayShortCode = (code: string) =>
  crypto.createHmac("sha256", getSecret()).update(`lookup:${code}`).digest("hex");

export const isPlanningRelayShortCode = (value: string) =>
  value.length === SHORT_CODE_LENGTH && [...value].every((character) => SHORT_CODE_ALPHABET.includes(character));

export const buildPlanningRelayToken = (id: string, nonce: string) => `${id}.${sign(id, nonce)}`;

export const parsePlanningRelayToken = (token: string) => {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  return { id: token.slice(0, separator), signature: token.slice(separator + 1) };
};

export const verifyPlanningRelayToken = (token: string, nonce: string) => {
  const parsed = parsePlanningRelayToken(token);
  if (!parsed) return false;
  const expected = Buffer.from(sign(parsed.id, nonce));
  const received = Buffer.from(parsed.signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};
