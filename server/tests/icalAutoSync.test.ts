import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import {
  runAppLoadIcalSync,
  syncIcalReservations,
  updateIcalSyncCronConfig,
} from "../src/services/icalSync.ts";
import { env } from "../src/config/env.ts";
import { writeImportLog, type ImportLogEntry } from "../src/services/importLog.ts";

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

const createActiveSource = () => [
  {
    id: "source-1",
    gite_id: "gite-1",
    type: "Airbnb",
    url: "https://example.test/calendar.ics",
    include_summary: null,
    exclude_summary: null,
    is_active: true,
    ordre: 0,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    gite: {
      id: "gite-1",
      nom: "Gite test",
      prefixe_contrat: "GT",
      ordre: 0,
      nb_adultes_habituel: 2,
    },
  },
];

const ICS_SAMPLE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:auto-sync-test
DTSTART;VALUE=DATE:20260321
DTEND;VALUE=DATE:20260324
SUMMARY:Airbnb - Client Test
END:VEVENT
END:VCALENDAR`;

test("runAppLoadIcalSync saute l'import si l'option est desactivee", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: false,
    });

    const result = await runAppLoadIcalSync();

    assert.equal(result.status, "skipped-disabled");
    assert.equal(result.summary, null);
  } finally {
    restoreFile(settingsBackup);
  }
});

test("runAppLoadIcalSync saute l'import sans source iCal active", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));
  const originalFindMany = prisma.icalSource.findMany;

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: true,
    });

    prisma.icalSource.findMany = async () => [];

    const result = await runAppLoadIcalSync();

    assert.equal(result.status, "skipped-no-sources");
    assert.equal(result.summary, null);
  } finally {
    prisma.icalSource.findMany = originalFindMany;
    restoreFile(settingsBackup);
  }
});

test("runAppLoadIcalSync saute l'import si un import iCal recent existe deja", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));
  const importLogBackup = backupFile(path.join(env.DATA_DIR, "import-log.json"));
  const originalFindMany = prisma.icalSource.findMany;

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: true,
    });

    prisma.icalSource.findMany = async () => createActiveSource();
    writeImportLog([
      {
        id: "recent-ical-import",
        at: new Date().toISOString(),
        source: "ical-manual",
        status: "success",
        errorMessage: null,
        selectionCount: 1,
        inserted: 1,
        updated: 0,
        skipped: {
          duplicate: 0,
          invalid: 0,
          outsideYear: 0,
          unknown: 0,
        },
        perGite: {},
        insertedItems: [],
        updatedItems: [],
      } satisfies ImportLogEntry,
    ]);

    const result = await runAppLoadIcalSync();

    assert.equal(result.status, "skipped-recent");
    assert.equal(result.summary, null);
  } finally {
    prisma.icalSource.findMany = originalFindMany;
    restoreFile(importLogBackup);
    restoreFile(settingsBackup);
  }
});

test("runAppLoadIcalSync reutilise une synchro iCal deja en cours", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));
  const importLogBackup = backupFile(path.join(env.DATA_DIR, "import-log.json"));
  const originalFindMany = prisma.icalSource.findMany;
  const originalFindFirst = prisma.reservation.findFirst;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalCreate = prisma.reservation.create;
  const originalFetch = global.fetch;

  let releaseFetchText!: () => void;
  const fetchTextReady = new Promise<void>((resolve) => {
    releaseFetchText = resolve;
  });

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: true,
    });
    writeImportLog([]);

    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findFirst = async () => null;
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => ({ id: "reservation-1", ...data });
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => {
          await fetchTextReady;
          return ICS_SAMPLE;
        },
      }) as Response) as typeof fetch;

    const runningPromise = syncIcalReservations({ log_source: "ical-manual" });
    const autoSyncPromise = runAppLoadIcalSync();

    releaseFetchText();

    const [runningResult, autoSyncResult] = await Promise.all([runningPromise, autoSyncPromise]);

    assert.equal(autoSyncResult.status, "shared-running");
    assert.equal(autoSyncResult.summary?.created_count, runningResult.created_count);
    assert.equal(autoSyncResult.summary?.updated_count, runningResult.updated_count);
  } finally {
    prisma.icalSource.findMany = originalFindMany;
    prisma.reservation.findFirst = originalFindFirst;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.create = originalCreate;
    global.fetch = originalFetch;
    restoreFile(importLogBackup);
    restoreFile(settingsBackup);
  }
});
