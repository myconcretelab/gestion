import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import {
  runAppLoadIcalSync,
  setPumpFollowUpRunnerForTests,
  syncIcalReservations,
  updateIcalSyncCronConfig,
} from "../src/services/icalSync.ts";
import { readIcalConflictRecords, writeIcalConflictRecords } from "../src/services/icalConflicts.ts";
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

const createSourceWithType = (type: string) => [
  {
    ...createActiveSource()[0],
    type,
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

test("syncIcalReservations supprime les reservations iCal plateforme absentes du flux", async () => {
  const conflictsBackup = backupFile(path.join(env.DATA_DIR, "ical-conflicts.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    writeIcalConflictRecords([]);
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-platform",
        gite_id: "gite-1",
        hote_nom: "Client Test",
        date_entree: new Date("2026-03-21T00:00:00.000Z"),
        date_sortie: new Date("2026-03-24T00:00:00.000Z"),
        origin_system: "ical",
        export_to_ical: false,
        source_paiement: "Airbnb",
        commentaire: null,
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour un conflit iCal absent.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation plateforme supprimee.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();
    const conflicts = readIcalConflictRecords();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.to_verify_marked_count, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.type, "deleted");
    assert.equal(conflicts[0]?.reservation_id, "reservation-platform");
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
    restoreFile(conflictsBackup);
  }
});

test("syncIcalReservations supprime une reservation iCal absente meme hors source plateforme", async () => {
  const conflictsBackup = backupFile(path.join(env.DATA_DIR, "ical-conflicts.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    writeIcalConflictRecords([]);
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-virement",
        gite_id: "gite-1",
        hote_nom: "Client Test",
        date_entree: new Date("2026-03-21T00:00:00.000Z"),
        date_sortie: new Date("2026-03-24T00:00:00.000Z"),
        origin_system: "ical",
        export_to_ical: false,
        source_paiement: "Virement",
        commentaire: null,
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour une reservation iCal absente.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation iCal supprimee.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();
    const conflicts = readIcalConflictRecords();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.to_verify_marked_count, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.type, "deleted");
    assert.equal(conflicts[0]?.reservation_id, "reservation-virement");
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
    restoreFile(conflictsBackup);
  }
});

test("syncIcalReservations supprime une reservation plateforme absente meme si elle semble creee dans l'app", async () => {
  const conflictsBackup = backupFile(path.join(env.DATA_DIR, "ical-conflicts.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    writeIcalConflictRecords([]);
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-app-airbnb",
        gite_id: "gite-1",
        hote_nom: "Client Test",
        date_entree: new Date("2026-03-21T00:00:00.000Z"),
        date_sortie: new Date("2026-03-24T00:00:00.000Z"),
        origin_system: "app",
        export_to_ical: true,
        source_paiement: "Airbnb",
        commentaire: null,
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour une reservation plateforme absente.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation plateforme supprimee.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();
    const conflicts = readIcalConflictRecords();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.to_verify_marked_count, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.type, "deleted");
    assert.equal(conflicts[0]?.reservation_id, "reservation-app-airbnb");
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
    restoreFile(conflictsBackup);
  }
});

test("syncIcalReservations ne supprime pas une reservation manuelle absente hors source plateforme", async () => {
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-app-virement",
        gite_id: "gite-1",
        hote_nom: "Client Test",
        date_entree: new Date("2026-03-21T00:00:00.000Z"),
        date_sortie: new Date("2026-03-24T00:00:00.000Z"),
        origin_system: "app",
        export_to_ical: true,
        source_paiement: "Virement",
        commentaire: null,
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour une reservation manuelle hors plateforme.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation manuelle hors plateforme.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.to_verify_marked_count, 0);
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
  }
});

test("syncIcalReservations ne supprime pas une reservation iCal enrichie absente du flux", async () => {
  const conflictsBackup = backupFile(path.join(env.DATA_DIR, "ical-conflicts.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    writeIcalConflictRecords([]);
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-enriched-missing",
        gite_id: "gite-1",
        hote_nom: "Juliette JOVET",
        date_entree: new Date("2026-04-04T00:00:00.000Z"),
        date_sortie: new Date("2026-04-07T00:00:00.000Z"),
        origin_system: "ical",
        export_to_ical: false,
        source_paiement: "A définir",
        commentaire: null,
        telephone: "06 38 82 42 36",
        email: null,
        prix_total: 210,
        prix_par_nuit: 70,
        gite: {
          nom: "Gite test",
        },
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour une reservation iCal enrichie.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation iCal enrichie absente.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR",
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();
    const conflicts = readIcalConflictRecords();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.to_verify_marked_count, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.type, "deleted");
    assert.equal(conflicts[0]?.reservation_id, "reservation-enriched-missing");
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
    restoreFile(conflictsBackup);
  }
});

test("syncIcalReservations ne supprime pas une reservation iCal si le flux courant se chevauche sur une autre periode", async () => {
  const conflictsBackup = backupFile(path.join(env.DATA_DIR, "ical-conflicts.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindFirst = prisma.reservation.findFirst;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalDelete = prisma.reservation.delete;
  const originalUpdate = prisma.reservation.update;
  const originalFetch = global.fetch;

  try {
    writeIcalConflictRecords([]);
    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findFirst = async ({ where }: any) => {
      if (where.date_entree instanceof Date && where.date_sortie instanceof Date) {
        return null;
      }

      if (where.date_entree?.lt instanceof Date && where.date_sortie?.gt instanceof Date) {
        return { id: "reservation-overlap" } as any;
      }

      return null;
    };
    prisma.reservation.findMany = async () => [
      {
        id: "reservation-overlap",
        gite_id: "gite-1",
        hote_nom: "Juliette JOVET",
        date_entree: new Date("2026-04-04T00:00:00.000Z"),
        date_sortie: new Date("2026-04-07T00:00:00.000Z"),
        origin_system: "ical",
        export_to_ical: false,
        source_paiement: "A définir",
        commentaire: null,
        telephone: null,
        email: null,
        prix_total: 0,
        prix_par_nuit: 0,
        gite: {
          nom: "Gite test",
        },
      },
    ];
    prisma.reservation.delete = async () => {
      throw new Error("reservation.delete ne doit pas etre appele pour une reservation iCal qui se chevauche avec le flux courant.");
    };
    prisma.reservation.update = async () => {
      throw new Error("reservation.update ne doit pas etre appele pour une reservation iCal qui se chevauche avec le flux courant.");
    };
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:airbnb-shifted-period
DTSTART;VALUE=DATE:20260405
DTEND;VALUE=DATE:20260407
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`,
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();
    const conflicts = readIcalConflictRecords();

    assert.equal(result.deleted_count, 0);
    assert.equal(result.counts.conflict, 1);
    assert.equal(result.to_verify_marked_count, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.type, "deleted");
    assert.equal(conflicts[0]?.reservation_id, "reservation-overlap");
  } finally {
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findFirst = originalFindFirst;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.delete = originalDelete;
    prisma.reservation.update = originalUpdate;
    global.fetch = originalFetch;
    restoreFile(conflictsBackup);
  }
});

test("syncIcalReservations relance Pump apres creation Airbnb si l'option est activee", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindFirst = prisma.reservation.findFirst;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalCreate = prisma.reservation.create;
  const originalFetch = global.fetch;
  let pumpTriggerCount = 0;

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: false,
      auto_run_pump_for_new_airbnb_ical: true,
    });
    setPumpFollowUpRunnerForTests(async () => {
      pumpTriggerCount += 1;
      return {
        created_count: 0,
        updated_count: 1,
        skipped_count: 2,
        pump: {
          session_id: "pump-session-1",
          updated_at: "2026-03-21T10:00:00.000Z",
          reservation_count: 3,
        },
      };
    });

    prisma.icalSource.findMany = async () => createActiveSource();
    prisma.reservation.findFirst = async () => null;
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => ({ id: "reservation-1", ...data });
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => ICS_SAMPLE,
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();

    assert.equal(result.created_count, 1);
    assert.equal(pumpTriggerCount, 1);
    assert.equal(result.pump_follow_up?.status, "success");
    assert.equal(result.pump_follow_up?.updated_count, 1);
    assert.equal(result.pump_follow_up?.reservation_count, 3);
  } finally {
    setPumpFollowUpRunnerForTests(null);
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findFirst = originalFindFirst;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.create = originalCreate;
    global.fetch = originalFetch;
    restoreFile(settingsBackup);
  }
});

test("syncIcalReservations ne relance pas Pump si la creation iCal n'est pas Airbnb", async () => {
  const settingsBackup = backupFile(path.join(env.DATA_DIR, "ical-cron-settings.json"));
  const originalFindManySources = prisma.icalSource.findMany;
  const originalFindFirst = prisma.reservation.findFirst;
  const originalFindManyReservations = prisma.reservation.findMany;
  const originalCreate = prisma.reservation.create;
  const originalFetch = global.fetch;
  let pumpTriggerCount = 0;

  try {
    await updateIcalSyncCronConfig({
      enabled: true,
      auto_sync_on_app_load: false,
      auto_run_pump_for_new_airbnb_ical: true,
    });
    setPumpFollowUpRunnerForTests(async () => {
      pumpTriggerCount += 1;
      return {
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        pump: {
          session_id: "pump-session-2",
          updated_at: "2026-03-21T10:00:00.000Z",
          reservation_count: 0,
        },
      };
    });

    prisma.icalSource.findMany = async () => createSourceWithType("Virement");
    prisma.reservation.findFirst = async () => null;
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => ({ id: "reservation-2", ...data });
    global.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => ICS_SAMPLE,
      }) as Response) as typeof fetch;

    const result = await syncIcalReservations();

    assert.equal(result.created_count, 1);
    assert.equal(pumpTriggerCount, 0);
    assert.equal(result.pump_follow_up, undefined);
  } finally {
    setPumpFollowUpRunnerForTests(null);
    prisma.icalSource.findMany = originalFindManySources;
    prisma.reservation.findFirst = originalFindFirst;
    prisma.reservation.findMany = originalFindManyReservations;
    prisma.reservation.create = originalCreate;
    global.fetch = originalFetch;
    restoreFile(settingsBackup);
  }
});
