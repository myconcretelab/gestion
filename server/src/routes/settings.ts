import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import {
  readTraceabilityLog,
  IMPORT_LOG_LIMIT,
} from "../services/importLog.js";
import {
  getIcalSyncCronConfig,
  getIcalCronState,
  listIcalSources,
  previewIcalReservations,
  runAppLoadIcalSync,
  runScheduledIcalSync,
  syncIcalReservations,
  updateIcalSyncCronConfig,
} from "../services/icalSync.js";
import type { IcalCronConfig } from "../services/icalCronSettings.js";
import {
  getPumpLatestReservations,
  getPumpRefreshStatus,
  normalizePumpReservation,
  triggerPumpRefresh,
} from "../services/pumpClient.js";
import {
  exportPersistedPumpSession,
  getPumpAutomationConfig,
  importPersistedPumpSession,
  importPumpAutomationConfig,
  testPumpAutomationConnection,
  testPumpAutomationScrollTarget,
  updatePumpAutomationConfig,
} from "../services/pumpAutomation.js";
import type { PumpAutomationConfig } from "../services/pumpAutomationConfig.js";
import {
  buildReservationsPreview,
  importPreviewReservations,
} from "../services/reservationImports.js";
import {
  getPumpCronState,
  runPumpCronImport,
  updatePumpCronConfig,
} from "../services/pumpCron.js";
import type { PumpCronConfig } from "../services/pumpCronSettings.js";
import {
  getPumpConnectionHealth,
  syncPumpHealthAlerts,
} from "../services/pumpHealth.js";
import {
  cancelPumpSessionCapture,
  getPumpSessionCaptureStatus,
  startPumpSessionCapture,
} from "../services/pumpSessionCapture.js";
import {
  mergeDeclarationNightsSettings,
  readDeclarationNightsSettings,
  writeDeclarationNightsSettings,
} from "../services/declarationNightsSettings.js";
import {
  mergeSourceColorSettings,
  readSourceColorSettings,
  writeSourceColorSettings,
} from "../services/sourceColorSettings.js";
import {
  buildDefaultSmsTextSettings,
  mergeSmsTextSettings,
  readSmsTextSettings,
  writeSmsTextSettings,
} from "../services/smsTextSettings.js";
import {
  buildDocumentEmailTextSettingsResponse,
  mergeDocumentEmailTemplateSettings,
  readDocumentEmailTemplateSettings,
  writeDocumentEmailTemplateSettings,
} from "../services/documentEmailTemplateSettings.js";
import {
  buildServerSecuritySettingsState,
  getServerAuthSessionIdFromRequest,
  setServerAuthCookie,
  updateServerSecuritySettings,
} from "../services/serverAuth.js";
import {
  getCronTriggerToken,
  hasValidCronTriggerToken,
} from "../utils/cronTriggerAuth.js";
import {
  generateIcalExportToken,
  shouldExportReservationToIcal,
} from "../utils/reservationOrigin.js";

const router = Router();

const emptyStringToNull = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const sourcePayloadSchema = z.object({
  gite_id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  url: z.string().trim().url("URL iCal invalide."),
  include_summary: z
    .preprocess(emptyStringToNull, z.string().trim().nullable())
    .optional()
    .default(null),
  exclude_summary: z
    .preprocess(emptyStringToNull, z.string().trim().nullable())
    .optional()
    .default(null),
  is_active: z.boolean().optional().default(true),
});
const sourceImportItemSchema = sourcePayloadSchema.extend({
  id: z.string().trim().min(1).optional(),
  ordre: z.coerce.number().int().min(0).optional(),
  gite_nom: z
    .preprocess(emptyStringToNull, z.string().trim().nullable())
    .optional(),
  gite_prefixe: z
    .preprocess(emptyStringToNull, z.string().trim().nullable())
    .optional(),
});
const sourceImportSchema = z.object({
  sources: z.array(sourceImportItemSchema).min(1),
  gite_mapping: z
    .record(z.string().trim().min(1), z.string().trim().min(1))
    .optional(),
});

const cronConfigSchema = z
  .object({
    enabled: z.boolean(),
    auto_sync_on_app_load: z.boolean().optional(),
    auto_run_pump_for_new_airbnb_ical: z.boolean().optional(),
  })
  .passthrough()
  .transform(
    (payload): IcalCronConfig => ({
      enabled: payload.enabled,
      auto_sync_on_app_load: payload.auto_sync_on_app_load ?? false,
      auto_run_pump_for_new_airbnb_ical:
        payload.auto_run_pump_for_new_airbnb_ical ?? false,
    }),
  );
const cronImportSchema = z.union([
  cronConfigSchema,
  z.object({ config: cronConfigSchema }),
]);
const pumpCronConfigSchema = z.object({
  enabled: z.boolean(),
  interval_days: z.number().int().min(1).max(30),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  run_on_start: z.boolean().optional(),
});
const pumpAutomationConfigSchema = z.object({
  baseUrl: z.string().trim().url("URL Pump invalide."),
  username: z.string().trim().default(""),
  authMode: z
    .enum(["persisted-only", "legacy-auto-login"])
    .default("persisted-only"),
  hasOTP: z.boolean().default(false),
  persistSession: z.boolean().default(true),
  manualScrollMode: z.boolean().default(false),
  manualScrollDuration: z.number().int().min(0).max(600000).default(20000),
  scrollSelector: z.string().trim().min(1, "scrollSelector est requis."),
  scrollCount: z.number().int().min(1).max(500).default(5),
  scrollDistance: z.number().int().min(1).max(20000).default(500),
  scrollDelay: z.number().int().min(0).max(120000).default(1000),
  waitBeforeScroll: z.number().int().min(0).max(120000).default(2000),
  outputFolder: z.string().trim().default(""),
  loginStrategy: z.enum(["simple", "multi-step"]).default("simple"),
  filterRules: z
    .object({
      inclusive: z
        .array(
          z.object({
            type: z.string().trim().min(1),
            pattern: z.string().optional(),
            negate: z.boolean().optional(),
          }),
        )
        .default([]),
      exclusive: z
        .array(
          z.object({
            type: z.string().trim().min(1),
            pattern: z.string().optional(),
            negate: z.boolean().optional(),
          }),
        )
        .default([]),
    })
    .default({ inclusive: [], exclusive: [] }),
  advancedSelectors: z.object({
    usernameInput: z.string().trim().min(1),
    passwordInput: z.string().trim().min(1),
    submitButton: z.string().trim().min(1),
    emailFirstButton: z.string().trim().min(1),
    continueAfterUsernameButton: z.string().trim().min(1),
    finalSubmitButton: z.string().trim().min(1),
    accountChooserContinueButton: z.string().trim().min(1),
    calendarSourceCard: z.string().trim().min(1),
    calendarSourceEditButton: z.string().trim().min(1),
    calendarSourceRefreshButton: z.string().trim().min(1),
    calendarSourceUrlField: z.string().trim().min(1),
    calendarSourceCloseButton: z.string().trim().min(1),
  }),
});
const pumpAutomationConfigImportSchema = z.object({
  config: z.any(),
});
const pumpStorageStateImportSchema = z.object({
  storageState: z.any(),
  filename: z.string().trim().optional(),
});
const declarationNightsSettingsSchema = z.object({
  excluded_sources: z.array(z.string().trim().min(1)).default([]),
});
const sourceColorSettingsSchema = z.object({
  colors: z
    .record(
      z.string().trim().min(1),
      z
        .string()
        .trim()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
    )
    .default({}),
});
const smsTextSettingsSchema = z.object({
  texts: z
    .array(
      z.object({
        id: z
          .preprocess(emptyStringToNull, z.string().trim().nullable())
          .optional(),
        title: z.string().trim().min(1),
        text: z.string().trim().min(1),
      }),
    )
    .default([]),
});
const documentEmailTextTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});
const documentEmailTextSettingsSchema = z.object({
  contrat: documentEmailTextTemplateSchema.extend({
    activitiesList: z.string().max(20_000).default(""),
    guideUrl: z.string().trim().max(2_000).default(""),
    destinationUrl: z.string().trim().max(2_000).default(""),
  }),
  facture: documentEmailTextTemplateSchema,
});
const serverSecuritySettingsSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .trim()
    .min(8, "Le nouveau mot de passe doit contenir au moins 8 caractères.")
    .optional(),
  sessionDurationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90),
});

const getIcalExportWindowStart = () => {
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  return new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);
};
type SourceImportItem = z.infer<typeof sourceImportItemSchema>;
type SourceImportPayload = z.infer<typeof sourceImportSchema>;
type SourceImportUnknownExample = {
  source_id: string | null;
  type: string | null;
  url: string | null;
};
type SourceImportUnknownGite = {
  source_gite_id: string;
  count: number;
  sample_type: string | null;
  sample_url: string | null;
  sample_source_id: string | null;
  sample_gite_nom: string | null;
  sample_gite_prefixe: string | null;
  sample_types: string[];
  sample_hosts: string[];
  examples: SourceImportUnknownExample[];
  mapped_to: string | null;
};

const extractUrlHost = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const listDeclarationSources = async () => {
  const rows = await prisma.reservation.findMany({
    select: { source_paiement: true },
    distinct: ["source_paiement"],
  });

  return [
    ...new Set(
      rows
        .map((row) => String(row.source_paiement ?? "").trim())
        .filter(Boolean),
    ),
  ].sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base" }),
  );
};

const buildDeclarationNightsSettingsResponse = async () => {
  const settings = readDeclarationNightsSettings();
  const availableSources = await listDeclarationSources();

  return {
    excluded_sources: settings.excluded_sources,
    available_sources: [
      ...new Set([...settings.excluded_sources, ...availableSources]),
    ].sort((left, right) =>
      left.localeCompare(right, "fr", { sensitivity: "base" }),
    ),
  };
};

const buildSourceColorSettingsResponse = async () => {
  const settings = readSourceColorSettings();
  const availableSources = await listDeclarationSources();
  const configuredSources = Object.keys(settings.colors ?? {})
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return {
    colors: settings.colors,
    available_sources: [
      ...new Set([...availableSources, ...configuredSources]),
    ].sort((left, right) =>
      left.localeCompare(right, "fr", { sensitivity: "base" }),
    ),
  };
};

const buildSmsTextSettingsResponse = () => {
  const settings = readSmsTextSettings(buildDefaultSmsTextSettings());
  return {
    texts: settings.texts,
  };
};

const buildImportLogResponse = (limitRaw: unknown) => {
  const rawLimit =
    typeof limitRaw === "string"
      ? Number.parseInt(limitRaw, 10)
      : Number(limitRaw);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, IMPORT_LOG_LIMIT)
      : 5;
  const entries = readTraceabilityLog();
  return {
    entries: entries.slice(0, limit),
    total: entries.length,
    limit,
  };
};

const requireCronTriggerToken = (
  req: any,
  res: any,
  next: (err?: unknown) => void,
) => {
  if (!getCronTriggerToken()) {
    return res.status(503).json({
      error: "CRON_TRIGGER_TOKEN ou INTEGRATION_API_TOKEN non configuré.",
    });
  }

  if (!hasValidCronTriggerToken(req)) {
    return res.status(401).json({ error: "Token cron invalide." });
  }

  return next();
};

const analyzeIcalSourcesImport = async (payload: SourceImportPayload) => {
  const gites = await prisma.gite.findMany({
    select: { id: true },
  });
  const localGiteIds = new Set(gites.map((gite) => gite.id));
  const mapping = payload.gite_mapping ?? {};

  const mapping_errors = Object.entries(mapping)
    .filter(([, targetGiteId]) => !localGiteIds.has(targetGiteId))
    .map(([sourceGiteId, targetGiteId]) => ({
      source_gite_id: sourceGiteId,
      mapped_to: targetGiteId,
      message: `Le gîte cible ${targetGiteId} est introuvable.`,
    }));

  const unknownBySourceId = new Map<
    string,
    {
      count: number;
      sample_type: string | null;
      sample_url: string | null;
      sample_source_id: string | null;
      sample_gite_nom: string | null;
      sample_gite_prefixe: string | null;
      sample_types: Set<string>;
      sample_hosts: Set<string>;
      examples: SourceImportUnknownExample[];
    }
  >();

  const rows = payload.sources.map((row) => {
    if (localGiteIds.has(row.gite_id)) {
      return {
        ...row,
        resolved_gite_id: row.gite_id,
      };
    }

    const previous = unknownBySourceId.get(row.gite_id) ?? {
      count: 0,
      sample_type: null,
      sample_url: null,
      sample_source_id: null,
      sample_gite_nom: null,
      sample_gite_prefixe: null,
      sample_types: new Set<string>(),
      sample_hosts: new Set<string>(),
      examples: [],
    };
    const normalizedType = row.type.trim();
    const host = extractUrlHost(row.url);
    if (normalizedType) previous.sample_types.add(normalizedType);
    if (host) previous.sample_hosts.add(host);
    if (
      previous.examples.length < 4 &&
      !previous.examples.some((example) => example.url === row.url)
    ) {
      previous.examples.push({
        source_id: row.id ?? null,
        type: row.type ?? null,
        url: row.url ?? null,
      });
    }

    unknownBySourceId.set(row.gite_id, {
      ...previous,
      count: previous.count + 1,
      sample_type: previous.sample_type ?? row.type ?? null,
      sample_url: previous.sample_url ?? row.url ?? null,
      sample_source_id: previous.sample_source_id ?? row.id ?? null,
      sample_gite_nom: previous.sample_gite_nom ?? row.gite_nom ?? null,
      sample_gite_prefixe:
        previous.sample_gite_prefixe ?? row.gite_prefixe ?? null,
    });

    const mapped = mapping[row.gite_id];
    return {
      ...row,
      resolved_gite_id: mapped && localGiteIds.has(mapped) ? mapped : null,
    };
  });

  const unknown_gites: SourceImportUnknownGite[] = [
    ...unknownBySourceId.entries(),
  ].map(([sourceGiteId, item]) => {
    const mapped = mapping[sourceGiteId];
    return {
      source_gite_id: sourceGiteId,
      count: item.count,
      sample_type: item.sample_type,
      sample_url: item.sample_url,
      sample_source_id: item.sample_source_id,
      sample_gite_nom: item.sample_gite_nom,
      sample_gite_prefixe: item.sample_gite_prefixe,
      sample_types: [...item.sample_types],
      sample_hosts: [...item.sample_hosts],
      examples: item.examples,
      mapped_to: mapped && localGiteIds.has(mapped) ? mapped : null,
    };
  });

  const unresolved_gites = unknown_gites.filter((item) => !item.mapped_to);
  const ready_count = rows.filter((row) =>
    Boolean(row.resolved_gite_id),
  ).length;

  return {
    rows,
    unknown_gites,
    unresolved_gites,
    unresolved_count: unresolved_gites.length,
    mapping_errors,
    total_count: payload.sources.length,
    ready_count,
    can_import: unresolved_gites.length === 0 && mapping_errors.length === 0,
  };
};

router.get("/security", async (req, res, next) => {
  try {
    const settings = await buildServerSecuritySettingsState(req);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

router.put("/security", async (req, res, next) => {
  try {
    const payload = serverSecuritySettingsSchema.parse(req.body);
    const result = await updateServerSecuritySettings(
      payload,
      getServerAuthSessionIdFromRequest(req),
    );
    if (result.session) {
      setServerAuthCookie(req, res, result.session);
    }
    const passwordConfigured = Boolean(
      result.settings.passwordHash && result.settings.passwordSalt,
    );
    res.json({
      settings: {
        enabled: passwordConfigured,
        passwordConfigured,
        sessionDurationHours: result.settings.sessionDurationHours,
        sessionExpiresAt: result.session?.expiresAt ?? null,
      },
      session: {
        required: passwordConfigured,
        authenticated: passwordConfigured ? Boolean(result.session) : true,
        passwordConfigured,
        sessionDurationHours: result.settings.sessionDurationHours,
        sessionExpiresAt: result.session?.expiresAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/ical-sources", async (_req, res, next) => {
  try {
    const sources = await listIcalSources(false);
    res.json(sources);
  } catch (error) {
    next(error);
  }
});

router.get("/ical-exports", async (_req, res, next) => {
  try {
    const gites = await prisma.gite.findMany({
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      select: {
        id: true,
        nom: true,
        prefixe_contrat: true,
        ordre: true,
        ical_export_token: true,
        _count: { select: { reservations: true } },
      },
    });

    const from = getIcalExportWindowStart();
    const reservationRows = await prisma.reservation.findMany({
      where: {
        gite_id: { in: gites.map((gite) => gite.id) },
        date_sortie: { gte: from },
      },
      select: {
        gite_id: true,
        origin_system: true,
        export_to_ical: true,
        commentaire: true,
        source_paiement: true,
        prix_total: true,
        prix_par_nuit: true,
      },
    });

    const exportableCountsByGite = new Map<string, number>();
    for (const reservation of reservationRows) {
      if (!reservation.gite_id || !shouldExportReservationToIcal(reservation))
        continue;
      exportableCountsByGite.set(
        reservation.gite_id,
        (exportableCountsByGite.get(reservation.gite_id) ?? 0) + 1,
      );
    }

    res.json(
      gites.map((gite) => ({
        id: gite.id,
        nom: gite.nom,
        prefixe_contrat: gite.prefixe_contrat,
        ordre: gite.ordre,
        ical_export_token: gite.ical_export_token ?? null,
        reservations_count: gite._count.reservations,
        exported_reservations_count: exportableCountsByGite.get(gite.id) ?? 0,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/ical-exports/:giteId/reset", async (req, res, next) => {
  try {
    const gite = await prisma.gite.findUnique({
      where: { id: req.params.giteId },
      select: {
        id: true,
        nom: true,
      },
    });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const from = getIcalExportWindowStart();
    const reservationRows = await prisma.reservation.findMany({
      where: {
        gite_id: gite.id,
        date_sortie: { gte: from },
      },
      select: {
        id: true,
        gite_id: true,
        origin_system: true,
        export_to_ical: true,
        commentaire: true,
        source_paiement: true,
        prix_total: true,
        prix_par_nuit: true,
      },
    });

    const exportableReservationIds = reservationRows
      .filter((reservation) => shouldExportReservationToIcal(reservation))
      .map((reservation) => reservation.id);

    let reset_count = 0;
    if (exportableReservationIds.length > 0) {
      const result = await prisma.reservation.updateMany({
        where: {
          id: { in: exportableReservationIds },
        },
        data: {
          export_to_ical: false,
        },
      });
      reset_count = result.count;
    }

    res.json({
      gite_id: gite.id,
      gite_nom: gite.nom,
      reset_count,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ical-exports/:giteId/reset-token", async (req, res, next) => {
  try {
    const gite = await prisma.gite.update({
      where: { id: req.params.giteId },
      data: { ical_export_token: generateIcalExportToken() },
      select: {
        id: true,
        nom: true,
        prefixe_contrat: true,
        ordre: true,
        ical_export_token: true,
      },
    });

    res.json({
      id: gite.id,
      nom: gite.nom,
      prefixe_contrat: gite.prefixe_contrat,
      ordre: gite.ordre,
      ical_export_token: gite.ical_export_token,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ical-sources", async (req, res, next) => {
  try {
    const payload = sourcePayloadSchema.parse(req.body);
    const gite = await prisma.gite.findUnique({
      where: { id: payload.gite_id },
      select: { id: true },
    });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const duplicate = await prisma.icalSource.findFirst({
      where: {
        gite_id: payload.gite_id,
        url: payload.url,
      },
      select: { id: true },
    });

    if (duplicate) {
      return res
        .status(409)
        .json({ error: "Cette URL iCal existe déjà pour ce gîte." });
    }

    const aggregate = await prisma.icalSource.aggregate({
      where: { gite_id: payload.gite_id },
      _max: { ordre: true },
    });

    const created = await prisma.icalSource.create({
      data: {
        ...payload,
        ordre: (aggregate._max.ordre ?? -1) + 1,
      },
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            prefixe_contrat: true,
            ordre: true,
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.get("/ical-sources/export", async (_req, res, next) => {
  try {
    const sources = await listIcalSources(false);
    const exportRows = sources.map((source) => ({
      id: source.id,
      gite_id: source.gite_id,
      gite_nom: source.gite?.nom ?? null,
      gite_prefixe: source.gite?.prefixe_contrat ?? null,
      type: source.type,
      url: source.url,
      include_summary: source.include_summary,
      exclude_summary: source.exclude_summary,
      is_active: source.is_active,
      ordre: source.ordre,
    }));

    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      sources: exportRows,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ical-sources/import", async (req, res, next) => {
  try {
    const payload = sourceImportSchema.parse(req.body);
    const analysis = await analyzeIcalSourcesImport(payload);
    if (analysis.mapping_errors.length > 0) {
      return res.status(400).json({
        error: "Le mapping des gîtes contient des cibles introuvables.",
        mapping_errors: analysis.mapping_errors,
      });
    }
    if (analysis.unresolved_count > 0) {
      return res.status(400).json({
        error:
          "Certains gîtes importés sont introuvables. Analysez et attribuez-les avant l'import.",
        unknown_gites: analysis.unknown_gites,
        unresolved_count: analysis.unresolved_count,
      });
    }
    const rows = analysis.rows.map((row) => ({
      ...row,
      gite_id: row.resolved_gite_id as string,
    }));

    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of rows) {
      if (row.id) {
        if (seenIds.has(row.id)) {
          return res.status(400).json({
            error: `Identifiant source dupliqué dans l'import: ${row.id}`,
          });
        }
        seenIds.add(row.id);
      }

      const key = `${row.gite_id}::${row.url}`;
      if (seenKeys.has(key)) {
        return res.status(400).json({
          error: `URL iCal dupliquée dans l'import pour le même gîte: ${row.url}`,
        });
      }
      seenKeys.add(key);
    }

    const giteIds = [...new Set(rows.map((row) => row.gite_id))];
    const existingGites = await prisma.gite.findMany({
      where: { id: { in: giteIds } },
      select: { id: true },
    });
    if (existingGites.length !== giteIds.length) {
      return res
        .status(400)
        .json({ error: "L'import contient un gîte introuvable." });
    }

    const existingSources = await prisma.icalSource.findMany({
      select: { id: true, gite_id: true, url: true, ordre: true },
    });
    const existingById = new Map(
      existingSources.map((source) => [source.id, source]),
    );
    const existingByKey = new Map(
      existingSources.map((source) => [
        `${source.gite_id}::${source.url}`,
        source,
      ]),
    );

    const nextOrderByGite = new Map<string, number>();
    for (const source of existingSources) {
      const current = nextOrderByGite.get(source.gite_id) ?? 0;
      if (source.ordre + 1 > current) {
        nextOrderByGite.set(source.gite_id, source.ordre + 1);
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    const normalizeSourceData = (row: SourceImportItem) => {
      const data = {
        gite_id: row.gite_id,
        type: row.type,
        url: row.url,
        include_summary: row.include_summary ?? null,
        exclude_summary: row.exclude_summary ?? null,
        is_active: row.is_active,
      };

      if (typeof row.ordre === "number") {
        return { ...data, ordre: row.ordre };
      }

      return data;
    };

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const key = `${row.gite_id}::${row.url}`;
        const existingByRowId = row.id
          ? (existingById.get(row.id) ?? null)
          : null;
        const existingByRowKey = existingByKey.get(key) ?? null;
        const target = existingByRowId ?? existingByRowKey;

        if (target) {
          await tx.icalSource.update({
            where: { id: target.id },
            data: normalizeSourceData(row),
          });

          updatedCount += 1;

          if (`${target.gite_id}::${target.url}` !== key) {
            existingByKey.delete(`${target.gite_id}::${target.url}`);
          }
          const updatedEntry = {
            id: target.id,
            gite_id: row.gite_id,
            url: row.url,
            ordre: typeof row.ordre === "number" ? row.ordre : target.ordre,
          };
          existingById.set(target.id, updatedEntry);
          existingByKey.set(key, updatedEntry);
          continue;
        }

        const nextOrder = nextOrderByGite.get(row.gite_id) ?? 0;
        const createData = {
          ...(row.id ? { id: row.id } : {}),
          ...normalizeSourceData(row),
          ordre: typeof row.ordre === "number" ? row.ordre : nextOrder,
        };

        const created = await tx.icalSource.create({
          data: createData,
          select: { id: true, gite_id: true, url: true, ordre: true },
        });

        createdCount += 1;
        nextOrderByGite.set(
          row.gite_id,
          Math.max(nextOrder + 1, created.ordre + 1),
        );
        existingById.set(created.id, created);
        existingByKey.set(`${created.gite_id}::${created.url}`, created);
      }
    });

    res.json({
      created_count: createdCount,
      updated_count: updatedCount,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ical-sources/import/preview", async (req, res, next) => {
  try {
    const payload = sourceImportSchema.parse(req.body);
    const analysis = await analyzeIcalSourcesImport(payload);
    res.json({
      total_count: analysis.total_count,
      ready_count: analysis.ready_count,
      unresolved_count: analysis.unresolved_count,
      unknown_gites: analysis.unknown_gites,
      mapping_errors: analysis.mapping_errors,
      can_import: analysis.can_import,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/ical-sources/:id", async (req, res, next) => {
  try {
    const payload = sourcePayloadSchema.parse(req.body);
    const existing = await prisma.icalSource.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Source iCal introuvable." });
    }

    const gite = await prisma.gite.findUnique({
      where: { id: payload.gite_id },
      select: { id: true },
    });
    if (!gite) {
      return res.status(404).json({ error: "Gîte introuvable." });
    }

    const duplicate = await prisma.icalSource.findFirst({
      where: {
        id: { not: existing.id },
        gite_id: payload.gite_id,
        url: payload.url,
      },
      select: { id: true },
    });

    if (duplicate) {
      return res
        .status(409)
        .json({ error: "Cette URL iCal existe déjà pour ce gîte." });
    }

    const updated = await prisma.icalSource.update({
      where: { id: existing.id },
      data: payload,
      include: {
        gite: {
          select: {
            id: true,
            nom: true,
            prefixe_contrat: true,
            ordre: true,
          },
        },
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/ical-sources/:id", async (req, res, next) => {
  try {
    const existing = await prisma.icalSource.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Source iCal introuvable." });
    }

    await prisma.icalSource.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get("/ical/cron", (_req, res) => {
  res.json(getIcalCronState());
});

router.put("/ical/cron", async (req, res, next) => {
  try {
    const payload = cronConfigSchema.parse(req.body) as IcalCronConfig;
    const config = await updateIcalSyncCronConfig(payload);
    res.json({
      config,
      state: getIcalCronState(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/ical/cron/config", (_req, res) => {
  res.json(getIcalSyncCronConfig());
});

router.get("/ical/cron/export", (_req, res) => {
  res.json({
    version: 1,
    exported_at: new Date().toISOString(),
    config: getIcalSyncCronConfig(),
  });
});

router.post("/ical/cron/import", async (req, res, next) => {
  try {
    const payload = cronImportSchema.parse(req.body);
    const patch = "config" in payload ? payload.config : payload;
    const config = await updateIcalSyncCronConfig(
      patch as Partial<IcalCronConfig>,
    );
    res.json({
      config,
      state: getIcalCronState(),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ical/preview", async (_req, res, next) => {
  try {
    const preview = await previewIcalReservations();
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/ical/sync", async (_req, res, next) => {
  try {
    const summary = await syncIcalReservations({ log_source: "ical-manual" });
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

router.post("/ical/auto-sync", async (_req, res, next) => {
  try {
    const result = await runAppLoadIcalSync();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const runIcalCronHttp = async (
  _req: any,
  res: any,
  next: (err?: unknown) => void,
) => {
  try {
    const outcome = await runScheduledIcalSync();
    res.json({
      ok: outcome.status === "success",
      status: outcome.status,
      state: getIcalCronState(),
      summary: outcome.result,
    });
  } catch (error) {
    next(error);
  }
};

router.get("/ical/cron/run", requireCronTriggerToken, runIcalCronHttp);
router.post("/ical/cron/run", requireCronTriggerToken, runIcalCronHttp);

router.get("/import-log", (req, res) => {
  res.json(buildImportLogResponse(req.query.limit));
});

router.get("/declaration-nights", async (_req, res, next) => {
  try {
    res.json(await buildDeclarationNightsSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.get("/source-colors", async (_req, res, next) => {
  try {
    res.json(await buildSourceColorSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.get("/sms-texts", (_req, res, next) => {
  try {
    res.json(buildSmsTextSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.get("/document-email-texts", (_req, res, next) => {
  try {
    res.json(buildDocumentEmailTextSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.put("/declaration-nights", async (req, res, next) => {
  try {
    const payload = declarationNightsSettingsSchema.parse(req.body);
    const current = readDeclarationNightsSettings();
    const nextSettings = mergeDeclarationNightsSettings(current, payload);
    writeDeclarationNightsSettings(nextSettings);
    res.json(await buildDeclarationNightsSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.put("/source-colors", async (req, res, next) => {
  try {
    const payload = sourceColorSettingsSchema.parse(req.body ?? {});
    const current = readSourceColorSettings();
    const merged = mergeSourceColorSettings(current, payload);
    writeSourceColorSettings(merged);
    res.json(await buildSourceColorSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.put("/sms-texts", (req, res, next) => {
  try {
    const payload = smsTextSettingsSchema.parse(req.body ?? {});
    const current = readSmsTextSettings(buildDefaultSmsTextSettings());
    const merged = mergeSmsTextSettings(current, {
      texts: payload.texts.map((item) => ({
        id: item.id ?? "",
        title: item.title,
        text: item.text,
      })),
    });
    writeSmsTextSettings(merged);
    res.json(buildSmsTextSettingsResponse());
  } catch (error) {
    next(error);
  }
});

router.put("/document-email-texts", (req, res, next) => {
  try {
    const payload = documentEmailTextSettingsSchema.parse(req.body ?? {});
    const current = readDocumentEmailTemplateSettings();
    const merged = mergeDocumentEmailTemplateSettings(current, payload);
    writeDocumentEmailTemplateSettings(merged);
    res.json(buildDocumentEmailTextSettingsResponse(merged));
  } catch (error) {
    next(error);
  }
});

router.get("/pump/cron", (_req, res) => {
  res.json(getPumpCronState());
});

router.get("/pump/config", (_req, res) => {
  res.json(getPumpAutomationConfig());
});

router.put("/pump/config", (req, res, next) => {
  try {
    const payload = pumpAutomationConfigSchema.parse(
      req.body,
    ) as PumpAutomationConfig;
    const config = updatePumpAutomationConfig(payload);
    res.json({
      config,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/pump/config/import", (req, res, next) => {
  try {
    const payload = pumpAutomationConfigImportSchema.parse(req.body);
    const config = importPumpAutomationConfig(payload.config);
    res.json({
      config,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/pump/config/test-connection", async (_req, res, next) => {
  try {
    const payload = pumpAutomationConfigSchema.partial().parse(_req.body ?? {});
    const result = await testPumpAutomationConnection(payload);
    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
});

router.post("/pump/config/test-scroll-target", async (_req, res, next) => {
  try {
    const payload = pumpAutomationConfigSchema.partial().parse(_req.body ?? {});
    const result = await testPumpAutomationScrollTarget(payload);
    res.json({ success: true, result });
  } catch (error) {
    next(error);
  }
});

router.post("/pump/session/import", (req, res, next) => {
  try {
    const payload = pumpStorageStateImportSchema.parse(req.body);
    const result = importPersistedPumpSession(payload.storageState, {
      filename: payload.filename,
    });
    void syncPumpHealthAlerts("pump-session-import").catch(() => undefined);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pump/session/export", (_req, res, next) => {
  try {
    const exported = exportPersistedPumpSession();
    res.json({
      success: true,
      ...exported,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pump/session/capture/status", (_req, res) => {
  res.json(getPumpSessionCaptureStatus());
});

router.post("/pump/session/capture/start", (_req, res, next) => {
  try {
    res.json(startPumpSessionCapture());
  } catch (error) {
    next(error);
  }
});

router.post("/pump/session/capture/cancel", async (_req, res, next) => {
  try {
    res.json(await cancelPumpSessionCapture());
  } catch (error) {
    next(error);
  }
});

router.put("/pump/cron", async (req, res, next) => {
  try {
    const payload = pumpCronConfigSchema.parse(req.body) as PumpCronConfig;
    const config = await updatePumpCronConfig(payload);
    res.json({
      config,
      state: getPumpCronState(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pump/status", async (_req, res, next) => {
  try {
    const status = await getPumpRefreshStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.get("/pump/health", async (_req, res, next) => {
  try {
    const health = await getPumpConnectionHealth();
    res.json(health);
  } catch (error) {
    next(error);
  }
});

router.post("/pump/refresh", async (_req, res, next) => {
  try {
    const result = await triggerPumpRefresh();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

const runPumpCronHttp = async (
  _req: any,
  res: any,
  next: (err?: unknown) => void,
) => {
  try {
    const outcome = await runPumpCronImport();
    const health = await getPumpConnectionHealth();
    res.json({
      ok: true,
      state: getPumpCronState(),
      health,
      summary: outcome,
    });
  } catch (error) {
    next(error);
  }
};

router.get("/pump/cron/run", requireCronTriggerToken, runPumpCronHttp);
router.post("/pump/cron/run", requireCronTriggerToken, runPumpCronHttp);

router.post("/pump/preview", async (_req, res, next) => {
  try {
    const latest = await getPumpLatestReservations();
    const preview = await buildReservationsPreview(
      latest.reservations.map(normalizePumpReservation),
    );
    res.json({
      ...preview,
      pump: {
        session_id: latest.sessionId,
        status: latest.status,
        updated_at: latest.updatedAt ?? null,
        reservation_count: latest.reservationCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/pump/import", async (req, res, next) => {
  try {
    const payload = z
      .object({
        selected_ids: z.array(z.string().trim().min(1)).optional(),
      })
      .parse(req.body);

    const latest = await getPumpLatestReservations();
    const preview = await buildReservationsPreview(
      latest.reservations.map(normalizePumpReservation),
    );
    const response = await importPreviewReservations(
      preview,
      payload.selected_ids,
      "pump",
    );
    res.json({
      ...response,
      pump: {
        session_id: latest.sessionId,
        status: latest.status,
        updated_at: latest.updatedAt ?? null,
        reservation_count: latest.reservationCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
