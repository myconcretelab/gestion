import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import {
  buildDefaultSmartlifeAutomationConfig,
  getSmartlifeRuleCommandValue,
  hasSmartlifeCredentials,
  isSmartlifeDeviceCommandAction,
  mergeSmartlifeAutomationConfig,
  readSmartlifeAutomationConfig,
  writeSmartlifeAutomationConfig,
  type SmartlifeAutomationConfig,
  type SmartlifeAutomationRule,
} from "./smartlifeSettings.js";
import {
  buildDefaultSmartlifeAutomationRunState,
  pruneExecutedEventKeys,
  readSmartlifeAutomationRunState,
  updateSmartlifeAutomationRunState,
  type SmartlifeAutomationRunItem,
  type SmartlifeAutomationRunStatus,
  type SmartlifeAutomationRunSummary,
} from "./smartlifeRunState.js";
import {
  listSmartlifeDevices,
  sendSmartlifeCommand,
  type SmartlifeDevice,
} from "./smartlifeClient.js";
import { trackSmartlifeEnergyForAutomationEvent } from "./smartlifeEnergyTracking.js";
import { recordSmartlifeMonthlyEnergySnapshots } from "./smartlifeMonthlyEnergy.js";

const CRON_INTERVAL_MS = 60 * 1000;
const EXECUTION_GRACE_MS = 24 * 60 * 60 * 1000;
const RESULT_ITEMS_LIMIT = 20;

export type SmartlifeAutomationState = {
  config: SmartlifeAutomationConfig;
  scheduler: "internal" | "external";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: SmartlifeAutomationRunStatus;
  last_error: string | null;
  last_result: SmartlifeAutomationRunSummary | null;
  credentials_configured: boolean;
};

type ReservationCandidate = {
  id: string;
  gite_id: string | null;
  hote_nom: string;
  date_entree: Date;
  date_sortie: Date;
  gite: {
    id: string;
    nom: string;
    heure_arrivee_defaut: string;
    heure_depart_defaut: string;
  } | null;
};

type DueEvent = SmartlifeAutomationRunItem & {
  scheduledDate: Date;
  rule: SmartlifeAutomationRule;
};

let cronTimer: NodeJS.Timeout | null = null;
let cronNextRunAt: Date | null = null;
let cronRunning = false;
let cronConfig = readSmartlifeAutomationConfig(
  buildDefaultSmartlifeAutomationConfig(),
);
let activeRunPromise: Promise<SmartlifeAutomationRunSummary> | null = null;

const computeNextRunDate = () => {
  const next = new Date();
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next;
};

const formatDateLabel = (value: Date) =>
  value.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const combineDateWithTime = (value: Date, time: string) => {
  const [hoursRaw, minutesRaw] = String(time ?? "00:00").split(":");
  const hours = Number.parseInt(hoursRaw ?? "0", 10);
  const minutes = Number.parseInt(minutesRaw ?? "0", 10);
  const next = new Date(value);
  next.setHours(
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0,
  );
  return next;
};

const buildSummary = (
  params: Omit<SmartlifeAutomationRunSummary, "checked_at"> & {
    checkedAt: Date;
  },
): SmartlifeAutomationRunSummary => ({
  checked_at: params.checkedAt.toISOString(),
  scanned_rules_count: params.scanned_rules_count,
  scanned_reservations_count: params.scanned_reservations_count,
  due_events_count: params.due_events_count,
  executed_count: params.executed_count,
  skipped_count: params.skipped_count,
  error_count: params.error_count,
  note: params.note,
  items: params.items.slice(0, RESULT_ITEMS_LIMIT),
});

const scheduleNextRun = () => {
  cronNextRunAt = computeNextRunDate();
  const waitMs = Math.max(5_000, cronNextRunAt.getTime() - Date.now());

  cronTimer = setTimeout(async () => {
    cronRunning = true;
    try {
      await runSmartlifeAutomation({ triggered_by: "scheduler" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inconnue lors de l'automatisation Smart Life.";
      // eslint-disable-next-line no-console
      console.error("[smartlife-automation] scheduled run failed:", message);
    } finally {
      cronRunning = false;
      scheduleNextRun();
    }
  }, waitMs);
};

const applyCronConfig = () => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;
  if (env.SMARTLIFE_AUTOMATION_SCHEDULER === "internal") {
    scheduleNextRun();
  }
};

const buildReservationQueryWindow = (
  config: SmartlifeAutomationConfig,
  now: Date,
) => {
  const maxOffsetMinutes = Math.max(
    0,
    ...config.rules.map((rule) => Number(rule.offset_minutes) || 0),
  );
  const start = new Date(
    now.getTime() - EXECUTION_GRACE_MS - maxOffsetMinutes * 60 * 1000,
  );
  start.setHours(0, 0, 0, 0);

  const end = new Date(
    now.getTime() + maxOffsetMinutes * 60 * 1000 + 2 * 24 * 60 * 60 * 1000,
  );
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const loadReservationCandidates = async (
  config: SmartlifeAutomationConfig,
  now: Date,
): Promise<ReservationCandidate[]> => {
  const enabledRules = config.rules.filter(
    (rule) => rule.enabled && rule.gite_ids.length > 0,
  );
  const giteIds = [...new Set(enabledRules.flatMap((rule) => rule.gite_ids))];
  if (giteIds.length === 0) return [];

  const { start, end } = buildReservationQueryWindow(config, now);
  return prisma.reservation.findMany({
    where: {
      gite_id: { in: giteIds },
      OR: [
        {
          date_entree: {
            gte: start,
            lte: end,
          },
        },
        {
          date_sortie: {
            gte: start,
            lte: end,
          },
        },
      ],
    },
    select: {
      id: true,
      gite_id: true,
      hote_nom: true,
      date_entree: true,
      date_sortie: true,
      gite: {
        select: {
          id: true,
          nom: true,
          heure_arrivee_defaut: true,
          heure_depart_defaut: true,
        },
      },
    },
    orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
};

const buildDueEvents = (
  config: SmartlifeAutomationConfig,
  reservations: ReservationCandidate[],
  now: Date,
): DueEvent[] => {
  const dueEvents: DueEvent[] = [];

  for (const reservation of reservations) {
    if (!reservation.gite_id || !reservation.gite) continue;

    for (const rule of config.rules) {
      if (!rule.enabled) continue;
      if (!rule.gite_ids.includes(reservation.gite_id)) continue;
      if (!rule.device_id.trim()) continue;
      if (
        isSmartlifeDeviceCommandAction(rule.action) &&
        !rule.command_code.trim()
      ) {
        continue;
      }

      const baseDate =
        rule.trigger === "before-departure" ||
        rule.trigger === "after-departure"
          ? reservation.date_sortie
          : reservation.date_entree;
      const baseTime =
        rule.trigger === "before-departure" ||
        rule.trigger === "after-departure"
          ? reservation.gite.heure_depart_defaut
          : reservation.gite.heure_arrivee_defaut;
      const anchorDate = combineDateWithTime(baseDate, baseTime);
      const direction =
        rule.trigger === "after-arrival" ||
        rule.trigger === "after-departure"
          ? 1
          : -1;
      const scheduledDate = new Date(
        anchorDate.getTime() + direction * rule.offset_minutes * 60 * 1000,
      );

      if (scheduledDate.getTime() > now.getTime()) continue;
      if (now.getTime() - scheduledDate.getTime() > EXECUTION_GRACE_MS) continue;

      const key = [
        rule.id,
        reservation.id,
        reservation.gite_id,
        rule.device_id.trim(),
        rule.action,
        rule.command_code.trim(),
        getSmartlifeRuleCommandValue(rule.action) ? "1" : "0",
        scheduledDate.toISOString(),
      ].join("|");

      dueEvents.push({
        key,
        reservation_id: reservation.id,
        gite_id: reservation.gite_id,
        gite_nom: reservation.gite.nom,
        reservation_label: `${reservation.hote_nom} (${formatDateLabel(
          reservation.date_entree,
        )} -> ${formatDateLabel(reservation.date_sortie)})`,
        rule_id: rule.id,
        rule_label: rule.label,
        device_id: rule.device_id.trim(),
        device_name: rule.device_name.trim() || rule.device_id.trim(),
        action: rule.action,
        command_code: rule.command_code.trim(),
        command_value: getSmartlifeRuleCommandValue(rule.action),
        trigger: rule.trigger,
        scheduled_at: scheduledDate.toISOString(),
        executed_at: null,
        status: "skipped",
        message: null,
        scheduledDate,
        rule,
      });
    }
  }

  return dueEvents.sort(
    (left, right) => left.scheduledDate.getTime() - right.scheduledDate.getTime(),
  );
};

export const runSmartlifeAutomation = async (options?: {
  triggered_by?: "manual" | "scheduler" | "startup" | "http";
  now?: Date;
}): Promise<SmartlifeAutomationRunSummary> => {
  if (activeRunPromise) return activeRunPromise;

  activeRunPromise = (async () => {
    const now = options?.now ?? new Date();
    const stateBefore = readSmartlifeAutomationRunState();

    updateSmartlifeAutomationRunState({
      running: true,
      last_started_at: now.toISOString(),
      last_status: "running",
      last_error: null,
    });

    try {
      if (!cronConfig.enabled) {
        const summary = buildSummary({
          checkedAt: now,
          scanned_rules_count: cronConfig.rules.length,
          scanned_reservations_count: 0,
          due_events_count: 0,
          executed_count: 0,
          skipped_count: 0,
          error_count: 0,
          note: "Automatisation désactivée.",
          items: [],
        });
        updateSmartlifeAutomationRunState({
          running: false,
          last_run_at: now.toISOString(),
          last_status: "skipped",
          last_result: summary,
          last_error: null,
        });
        return summary;
      }

      if (!hasSmartlifeCredentials(cronConfig)) {
        throw new Error(
          "Smart Life activé mais les identifiants Tuya ne sont pas configurés.",
        );
      }

      const monthlyEnergyCapture = await recordSmartlifeMonthlyEnergySnapshots(
        cronConfig,
        now,
      );
      const reservations = await loadReservationCandidates(cronConfig, now);
      const dueEvents = buildDueEvents(cronConfig, reservations, now);
      const executedEventKeys = {
        ...stateBefore.executed_event_keys,
      };

      const items: SmartlifeAutomationRunItem[] = [];
      let executedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const event of dueEvents) {
        if (executedEventKeys[event.key]) {
          skippedCount += 1;
          items.push({
            ...event,
            status: "skipped",
            message: "Commande déjà exécutée pour ce créneau.",
          });
          continue;
        }

        try {
          if (isSmartlifeDeviceCommandAction(event.action)) {
            await sendSmartlifeCommand(cronConfig, {
              device_id: event.device_id,
              command_code: event.command_code,
              command_value: event.command_value,
            });
          }

          const executedAt = new Date().toISOString();
          let executionMessage: string | null = null;
          try {
            executionMessage =
              (await trackSmartlifeEnergyForAutomationEvent(cronConfig, {
                reservation_id: event.reservation_id,
                gite_id: event.gite_id,
                device_id: event.device_id,
                device_name: event.device_name,
                action: event.action,
                command_value: event.command_value,
                rule_id: event.rule_id,
              })) ?? null;
          } catch (trackingError) {
            executionMessage =
              trackingError instanceof Error
                ? `Énergie: ${trackingError.message}`
                : "Énergie: suivi impossible.";
          }
          executedEventKeys[event.key] = executedAt;
          executedCount += 1;
          items.push({
            ...event,
            executed_at: executedAt,
            status: "executed",
            message: executionMessage,
          });
        } catch (error) {
          errorCount += 1;
          items.push({
            ...event,
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Erreur inconnue lors de l'envoi Tuya.",
          });
        }
      }

      const nextExecutedKeys = pruneExecutedEventKeys(executedEventKeys);
      const noteParts = [
        dueEvents.length === 0
          ? "Aucune commande à déclencher pour l'instant."
          : errorCount > 0 && executedCount > 0
            ? "Certaines commandes Smart Life ont échoué."
            : errorCount > 0
              ? "Toutes les commandes dues ont échoué."
              : executedCount > 0
                ? "Commandes Smart Life exécutées."
                : "Toutes les commandes dues avaient déjà été exécutées.",
      ];
      if (
        monthlyEnergyCapture.triggered &&
        (monthlyEnergyCapture.opened_count > 0 ||
          monthlyEnergyCapture.closed_count > 0)
      ) {
        noteParts.push(
          `Relevés mensuels énergie: ${monthlyEnergyCapture.opened_count} ouverture(s), ${monthlyEnergyCapture.closed_count} clôture(s).`,
        );
      }
      if (monthlyEnergyCapture.error_count > 0) {
        noteParts.push(
          `${monthlyEnergyCapture.error_count} erreur(s) lors des relevés mensuels énergie.`,
        );
      }
      const note = noteParts.join(" ");
      const summary = buildSummary({
        checkedAt: now,
        scanned_rules_count: cronConfig.rules.length,
        scanned_reservations_count: reservations.length,
        due_events_count: dueEvents.length,
        executed_count: executedCount,
        skipped_count: skippedCount,
        error_count: errorCount,
        note,
        items,
      });

      const lastStatus: SmartlifeAutomationRunStatus =
        errorCount > 0 && executedCount > 0
          ? "partial"
          : errorCount > 0
            ? "error"
            : executedCount > 0
              ? "success"
              : "skipped";

      updateSmartlifeAutomationRunState({
        running: false,
        last_run_at: now.toISOString(),
        last_success_at:
          errorCount === 0 ? now.toISOString() : stateBefore.last_success_at,
        last_status: lastStatus,
        last_error:
          errorCount > 0
            ? `${errorCount} commande(s) Smart Life en échec.`
            : null,
        last_result: summary,
        executed_event_keys: nextExecutedKeys,
      });

      return summary;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inconnue lors de l'automatisation Smart Life.";
      updateSmartlifeAutomationRunState({
        running: false,
        last_run_at: now.toISOString(),
        last_status: "error",
        last_error: message,
      });
      throw error;
    }
  })().finally(() => {
    activeRunPromise = null;
  });

  return activeRunPromise;
};

export const getSmartlifeAutomationState = (): SmartlifeAutomationState => {
  const state = readSmartlifeAutomationRunState();
  return {
    config: cronConfig,
    scheduler:
      env.SMARTLIFE_AUTOMATION_SCHEDULER as SmartlifeAutomationState["scheduler"],
    running: cronRunning || Boolean(activeRunPromise) || state.running,
    next_run_at:
      env.SMARTLIFE_AUTOMATION_SCHEDULER === "internal" && cronNextRunAt
        ? cronNextRunAt.toISOString()
        : null,
    last_run_at: state.last_run_at,
    last_success_at: state.last_success_at,
    last_status: state.last_status,
    last_error: state.last_error,
    last_result: state.last_result,
    credentials_configured: hasSmartlifeCredentials(cronConfig),
  };
};

export const updateSmartlifeAutomationConfig = async (
  patch: Partial<SmartlifeAutomationConfig>,
) => {
  cronConfig = mergeSmartlifeAutomationConfig(
    readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig()),
    patch,
  );
  writeSmartlifeAutomationConfig(cronConfig);
  applyCronConfig();
  return cronConfig;
};

export const listSmartlifeDevicesForSettings = async (): Promise<SmartlifeDevice[]> =>
  listSmartlifeDevices(cronConfig);

export const sendSmartlifeTestCommand = async (input: {
  device_id: string;
  command_code: string;
  command_value: boolean;
}) => sendSmartlifeCommand(cronConfig, input);

export const startSmartlifeAutomationCron = () => {
  cronConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
  const current = readSmartlifeAutomationRunState();
  if (current.running) {
    updateSmartlifeAutomationRunState({
      running: false,
      last_status: current.last_status === "running" ? "idle" : current.last_status,
    });
  }
  applyCronConfig();
  if (
    cronConfig.enabled &&
    env.SMARTLIFE_AUTOMATION_SCHEDULER === "internal"
  ) {
    void runSmartlifeAutomation({ triggered_by: "startup" }).catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur inconnue lors du démarrage Smart Life.";
      // eslint-disable-next-line no-console
      console.error("[smartlife-automation] startup run failed:", message);
    });
  }
};

export const stopSmartlifeAutomationCron = () => {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
  cronNextRunAt = null;
};
