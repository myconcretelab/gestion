import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { env } from "../src/config/env.ts";
import {
  buildIcalConflictFingerprint,
  listOpenIcalConflictRecords,
  readIcalConflictRecords,
  syncIcalConflictRecords,
  updateIcalConflictRecord,
  writeIcalConflictRecords,
  type IcalConflictDraft,
} from "../src/services/icalConflicts.ts";

type BackupFile = {
  path: string;
  existed: boolean;
  content: string | null;
};

const backupFile = (filePath: string): BackupFile => ({
  path: filePath,
  existed: fs.existsSync(filePath),
  content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null,
});

const restoreFile = (backup: BackupFile) => {
  if (backup.existed) {
    fs.mkdirSync(path.dirname(backup.path), { recursive: true });
    fs.writeFileSync(backup.path, backup.content ?? "", "utf-8");
    return;
  }

  try {
    fs.unlinkSync(backup.path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
};

test("un conflit resolu avec keep_reservation reste supprime apres un import intermediaire sans conflit", async () => {
  const conflictsPath = path.join(env.DATA_DIR, "ical-conflicts.json");
  const backup = backupFile(conflictsPath);
  const draftBase: Omit<IcalConflictDraft, "fingerprint"> = {
    type: "deleted",
    reservation_id: "reservation-1",
    gite_id: "gite-1",
    reservation_snapshot: {
      reservation_id: "reservation-1",
      gite_id: "gite-1",
      gite_nom: "Gite test",
      hote_nom: "Client Test",
      date_entree: "2026-05-01",
      date_sortie: "2026-05-04",
      source_paiement: "Airbnb",
      airbnb_url: null,
      commentaire: null,
      origin_system: "ical",
      origin_reference: "event-1",
    },
    incoming_snapshot: null,
  };
  const draft: IcalConflictDraft = {
    ...draftBase,
    fingerprint: buildIcalConflictFingerprint(draftBase),
  };

  try {
    writeIcalConflictRecords([]);

    const [created] = syncIcalConflictRecords([draft]);
    assert.equal(created?.status, "open");
    assert.equal(listOpenIcalConflictRecords().length, 1);

    const resolved = updateIcalConflictRecord(created!.id, (record) => ({
      ...record,
      status: "resolved",
      resolved_at: "2026-04-16T10:00:00.000Z",
      updated_at: "2026-04-16T10:00:00.000Z",
      resolution_action: "keep_reservation",
    }));
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.resolution_action, "keep_reservation");

    syncIcalConflictRecords([]);
    assert.equal(readIcalConflictRecords().length, 1);
    assert.equal(listOpenIcalConflictRecords().length, 0);

    const afterReplay = syncIcalConflictRecords([draft]);
    assert.equal(afterReplay.length, 1);
    assert.equal(afterReplay[0]?.status, "resolved");
    assert.equal(afterReplay[0]?.resolution_action, "keep_reservation");
    assert.equal(listOpenIcalConflictRecords().length, 0);
  } finally {
    restoreFile(backup);
  }
});
