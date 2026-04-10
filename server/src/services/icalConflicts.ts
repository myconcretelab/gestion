import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type IcalConflictType = "deleted" | "modified";
export type IcalConflictStatus = "open" | "resolved";
export type IcalConflictResolutionAction = "keep_reservation" | "apply_ical" | "delete_reservation";

export type IcalConflictSnapshot = {
  reservation_id: string;
  gite_id: string | null;
  gite_nom: string | null;
  hote_nom: string | null;
  date_entree: string;
  date_sortie: string;
  source_paiement: string | null;
  airbnb_url: string | null;
  commentaire: string | null;
  origin_system: string | null;
  origin_reference: string | null;
  source_type?: string | null;
  final_source?: string | null;
  summary?: string | null;
  description?: string | null;
};

export type IcalConflictRecord = {
  id: string;
  type: IcalConflictType;
  status: IcalConflictStatus;
  fingerprint: string;
  reservation_id: string;
  gite_id: string | null;
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_action: IcalConflictResolutionAction | null;
  reservation_snapshot: IcalConflictSnapshot;
  incoming_snapshot: IcalConflictSnapshot | null;
};

export type IcalConflictDraft = {
  type: IcalConflictType;
  fingerprint: string;
  reservation_id: string;
  gite_id: string | null;
  reservation_snapshot: IcalConflictSnapshot;
  incoming_snapshot: IcalConflictSnapshot | null;
};

const ICAL_CONFLICTS_FILE = path.join(env.DATA_DIR, "ical-conflicts.json");

const ensureDataDir = () => {
  if (!fs.existsSync(env.DATA_DIR)) {
    fs.mkdirSync(env.DATA_DIR, { recursive: true });
  }
};

const toOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSnapshot = (value: unknown): IcalConflictSnapshot | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const reservationId = toOptionalString((value as IcalConflictSnapshot).reservation_id);
  const dateEntree = toOptionalString((value as IcalConflictSnapshot).date_entree);
  const dateSortie = toOptionalString((value as IcalConflictSnapshot).date_sortie);
  if (!reservationId || !dateEntree || !dateSortie) return null;

  return {
    reservation_id: reservationId,
    gite_id: toOptionalString((value as IcalConflictSnapshot).gite_id),
    gite_nom: toOptionalString((value as IcalConflictSnapshot).gite_nom),
    hote_nom: toOptionalString((value as IcalConflictSnapshot).hote_nom),
    date_entree: dateEntree,
    date_sortie: dateSortie,
    source_paiement: toOptionalString((value as IcalConflictSnapshot).source_paiement),
    airbnb_url: toOptionalString((value as IcalConflictSnapshot).airbnb_url),
    commentaire: toOptionalString((value as IcalConflictSnapshot).commentaire),
    origin_system: toOptionalString((value as IcalConflictSnapshot).origin_system),
    origin_reference: toOptionalString((value as IcalConflictSnapshot).origin_reference),
    source_type: toOptionalString((value as IcalConflictSnapshot).source_type),
    final_source: toOptionalString((value as IcalConflictSnapshot).final_source),
    summary: toOptionalString((value as IcalConflictSnapshot).summary),
    description: toOptionalString((value as IcalConflictSnapshot).description),
  };
};

const normalizeConflictRecord = (value: unknown): IcalConflictRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = toOptionalString((value as IcalConflictRecord).id);
  const type = (value as IcalConflictRecord).type === "modified" ? "modified" : (value as IcalConflictRecord).type === "deleted" ? "deleted" : null;
  const status =
    (value as IcalConflictRecord).status === "resolved"
      ? "resolved"
      : (value as IcalConflictRecord).status === "open"
        ? "open"
        : null;
  const fingerprint = toOptionalString((value as IcalConflictRecord).fingerprint);
  const reservationId = toOptionalString((value as IcalConflictRecord).reservation_id);
  const detectedAt = toOptionalString((value as IcalConflictRecord).detected_at);
  const updatedAt = toOptionalString((value as IcalConflictRecord).updated_at);
  const reservationSnapshot = normalizeSnapshot((value as IcalConflictRecord).reservation_snapshot);
  const incomingSnapshotRaw = (value as IcalConflictRecord).incoming_snapshot;
  const incomingSnapshot = incomingSnapshotRaw == null ? null : normalizeSnapshot(incomingSnapshotRaw);
  if (!id || !type || !status || !fingerprint || !reservationId || !detectedAt || !updatedAt || !reservationSnapshot) {
    return null;
  }

  const resolutionActionRaw = toOptionalString((value as IcalConflictRecord).resolution_action);
  const resolutionAction =
    resolutionActionRaw === "keep_reservation" ||
    resolutionActionRaw === "apply_ical" ||
    resolutionActionRaw === "delete_reservation"
      ? resolutionActionRaw
      : null;

  return {
    id,
    type,
    status,
    fingerprint,
    reservation_id: reservationId,
    gite_id: toOptionalString((value as IcalConflictRecord).gite_id),
    detected_at: detectedAt,
    updated_at: updatedAt,
    resolved_at: toOptionalString((value as IcalConflictRecord).resolved_at),
    resolution_action: resolutionAction,
    reservation_snapshot: reservationSnapshot,
    incoming_snapshot: incomingSnapshot,
  };
};

export const readIcalConflictRecords = (): IcalConflictRecord[] => {
  ensureDataDir();
  if (!fs.existsSync(ICAL_CONFLICTS_FILE)) return [];

  try {
    const raw = fs.readFileSync(ICAL_CONFLICTS_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeConflictRecord(item))
      .filter((item): item is IcalConflictRecord => Boolean(item));
  } catch {
    return [];
  }
};

export const writeIcalConflictRecords = (records: IcalConflictRecord[]) => {
  ensureDataDir();
  fs.writeFileSync(
    ICAL_CONFLICTS_FILE,
    JSON.stringify(
      records
        .map((item) => normalizeConflictRecord(item))
        .filter((item): item is IcalConflictRecord => Boolean(item)),
      null,
      2
    ),
    "utf-8"
  );
};

export const listOpenIcalConflictRecords = () =>
  readIcalConflictRecords().filter((record) => record.status === "open");

export const getIcalConflictRecord = (id: string) =>
  readIcalConflictRecords().find((record) => record.id === id) ?? null;

export const buildIcalConflictFingerprint = (draft: Omit<IcalConflictDraft, "fingerprint">) =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        type: draft.type,
        reservation_id: draft.reservation_id,
        reservation_snapshot: draft.reservation_snapshot,
        incoming_snapshot: draft.incoming_snapshot,
      })
    )
    .digest("hex");

export const syncIcalConflictRecords = (drafts: IcalConflictDraft[]) => {
  const now = new Date().toISOString();
  const current = readIcalConflictRecords();
  const recordByReservationKey = new Map<string, IcalConflictRecord>(
    current.map((record) => [`${record.reservation_id}:${record.type}`, record] as const)
  );
  const nextRecords: IcalConflictRecord[] = [];

  for (const draft of drafts) {
    const reservationKey = `${draft.reservation_id}:${draft.type}`;
    const existing =
      recordByReservationKey.get(reservationKey) ?? current.find((record) => record.fingerprint === draft.fingerprint) ?? null;

    if (!existing) {
      nextRecords.push({
        id: globalThis.crypto?.randomUUID?.() ?? crypto.randomBytes(12).toString("hex"),
        type: draft.type,
        status: "open",
        fingerprint: draft.fingerprint,
        reservation_id: draft.reservation_id,
        gite_id: draft.gite_id,
        detected_at: now,
        updated_at: now,
        resolved_at: null,
        resolution_action: null,
        reservation_snapshot: draft.reservation_snapshot,
        incoming_snapshot: draft.incoming_snapshot,
      });
      continue;
    }

    const fingerprintChanged = existing.fingerprint !== draft.fingerprint;
    nextRecords.push({
      ...existing,
      type: draft.type,
      fingerprint: draft.fingerprint,
      reservation_id: draft.reservation_id,
      gite_id: draft.gite_id,
      updated_at: now,
      reservation_snapshot: draft.reservation_snapshot,
      incoming_snapshot: draft.incoming_snapshot,
      status: fingerprintChanged ? "open" : existing.status,
      detected_at: fingerprintChanged ? now : existing.detected_at,
      resolved_at: fingerprintChanged ? null : existing.resolved_at,
      resolution_action: fingerprintChanged ? null : existing.resolution_action,
    });
  }

  nextRecords.sort((left, right) => {
    const leftTime = Date.parse(left.detected_at);
    const rightTime = Date.parse(right.detected_at);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.id.localeCompare(right.id);
  });

  writeIcalConflictRecords(nextRecords);
  return nextRecords;
};

export const updateIcalConflictRecord = (
  id: string,
  updater: (record: IcalConflictRecord) => IcalConflictRecord
) => {
  const records = readIcalConflictRecords();
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return null;

  const next = updater(records[index]);
  records[index] = normalizeConflictRecord(next) ?? records[index];
  writeIcalConflictRecords(records);
  return records[index];
};
