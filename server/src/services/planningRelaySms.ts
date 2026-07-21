import { addDays } from "date-fns";
import prisma from "../db/prisma.js";
import { env } from "../config/env.js";
import { buildPlanningRelayShortCode } from "./planningRelayShare.js";
import { encodeJsonField, fromJsonString } from "../utils/jsonFields.js";
import { sendOvhSms } from "./ovhSms.js";

const PARIS_TIME_ZONE = "Europe/Paris";

type SmsOptionState = {
  enabled?: boolean;
  nb_lits?: number;
  nb_personnes?: number;
};

type ReservationOptions = {
  draps?: SmsOptionState;
  linge_toilette?: SmsOptionState;
  menage?: SmsOptionState;
  depart_tardif?: SmsOptionState;
};

type ProgramReservation = {
  id: string;
  date_entree: Date;
  date_sortie: Date;
  options: unknown;
  gite_id: string | null;
  nb_nuits?: number;
  gite: {
    id: string;
    nom: string;
    ordre: number;
    heure_arrivee_defaut: string;
    heure_depart_defaut: string;
  } | null;
};

type ProgramContractTime = {
  reservation_id: string | null;
  heure_arrivee: string;
  heure_depart: string;
};

type PlanningRelaySmsRecipientPeriod = {
  sms_recipient?: string | null;
  sms_worker?: {
    telephone: string | null;
  } | null;
};

export type PlanningRelaySmsSendDay = "previous_day" | "same_day";

export const PLANNING_RELAY_SMS_DEFAULT_TEMPLATE = "{{programme}}";

export type PlanningRelaySmsConfig = {
  id: string;
  worker_id: string;
  enabled: boolean;
  send_time: string;
  send_day: PlanningRelaySmsSendDay;
  template: string;
  last_sent_for_date: string | null;
  last_attempt_for_date: string | null;
};

const isSmsConfig = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizePlanningRelaySmsConfigs = (
  value: unknown,
  legacy?: {
    sms_enabled?: boolean;
    sms_worker_id?: string | null;
    sms_send_time?: string | null;
    sms_send_day?: string | null;
    sms_last_sent_for_date?: string | null;
    sms_last_attempt_for_date?: string | null;
  },
): PlanningRelaySmsConfig[] => {
  const parsed = fromJsonString<unknown[]>(value, []);
  const configs = parsed.filter(isSmsConfig).flatMap((config) => {
    const id = typeof config.id === "string" ? config.id.trim() : "";
    const workerId = typeof config.worker_id === "string" ? config.worker_id.trim() : "";
    if (!id || !workerId) return [];
    return [{
      id,
      worker_id: workerId,
      enabled: config.enabled !== false,
      send_time: normalizePlanningRelaySmsTime(typeof config.send_time === "string" ? config.send_time : null),
      send_day: normalizePlanningRelaySmsSendDay(typeof config.send_day === "string" ? config.send_day : null),
      template: typeof config.template === "string" && config.template.trim()
        ? config.template.trim().slice(0, 1000)
        : PLANNING_RELAY_SMS_DEFAULT_TEMPLATE,
      last_sent_for_date: typeof config.last_sent_for_date === "string" ? config.last_sent_for_date : null,
      last_attempt_for_date: typeof config.last_attempt_for_date === "string" ? config.last_attempt_for_date : null,
    }];
  });
  if (configs.length > 0 || !legacy?.sms_worker_id) return configs.slice(0, 1);
  return [{
    id: "legacy",
    worker_id: legacy.sms_worker_id,
    enabled: Boolean(legacy.sms_enabled),
    send_time: normalizePlanningRelaySmsTime(legacy.sms_send_time),
    send_day: normalizePlanningRelaySmsSendDay(legacy.sms_send_day),
    template: PLANNING_RELAY_SMS_DEFAULT_TEMPLATE,
    last_sent_for_date: legacy.sms_last_sent_for_date ?? null,
    last_attempt_for_date: legacy.sms_last_attempt_for_date ?? null,
  }];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const parsePlanningRelayIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

export const toPlanningRelayIsoDate = (value: Date) => value.toISOString().slice(0, 10);

export const addPlanningRelayIsoDays = (value: string, days: number) =>
  toPlanningRelayIsoDate(new Date(parsePlanningRelayIsoDate(value).getTime() + days * DAY_MS));

export const getParisDateTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: PARIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
};

export const normalizePlanningRelaySmsTime = (value: string | null | undefined) => {
  const match = String(value ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "18:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};

export const normalizePlanningRelaySmsSendDay = (value: string | null | undefined): PlanningRelaySmsSendDay =>
  value === "same_day" ? "same_day" : "previous_day";

export const getPlanningRelayProgramTargetIsoDate = (currentIsoDate: string, sendDay: string | null | undefined) =>
  addPlanningRelayIsoDays(currentIsoDate, normalizePlanningRelaySmsSendDay(sendDay) === "previous_day" ? 1 : 0);

export const getPlanningRelayProgramHeading = (sendDay: string | null | undefined) =>
  normalizePlanningRelaySmsSendDay(sendDay) === "same_day" ? "Programme aujourd'hui" : "Programme demain";

const formatPlanningRelaySmsHeadingDate = (isoDate: string) =>
  parsePlanningRelayIsoDate(isoDate).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

export const getPlanningRelayTestProgramHeading = (targetIsoDate: string) =>
  `TEST - Programme du ${formatPlanningRelaySmsHeadingDate(targetIsoDate)}`;

export const renderPlanningRelaySmsTemplate = (template: string, variables: {
  date: string;
  programme: string;
  intervenant: string;
  periode: string;
  lien: string;
}) => stripSmsAccents(
  (template.trim() || PLANNING_RELAY_SMS_DEFAULT_TEMPLATE).replace(
    /{{\s*(date|programme|intervenant|periode|lien)\s*}}/gi,
    (_match, key: string) => variables[key.toLowerCase() as keyof typeof variables],
  ),
);

export const isPlanningRelaySmsDue = (params: {
  nowTime: string;
  sendTime: string;
  targetIsoDate: string;
  lastAttemptForDate?: string | null;
}) =>
  params.nowTime >= normalizePlanningRelaySmsTime(params.sendTime) &&
  params.lastAttemptForDate !== params.targetIsoDate;

const stripSmsAccents = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"");

const formatSmsTime = (value: string | null | undefined) => {
  const time = normalizePlanningRelaySmsTime(value);
  const [hours, minutes] = time.split(":");
  return minutes === "00" ? `${Number(hours)}h` : `${Number(hours)}h${minutes}`;
};

const getPlanningRelaySmsRecipient = (period: PlanningRelaySmsRecipientPeriod) =>
  period.sms_worker?.telephone?.trim() || period.sms_recipient?.trim() || "";

const getOperationSchedule = (departureTime: string | null, arrivalTime: string | null) => {
  if (departureTime && arrivalTime) return `Entre ${departureTime} et ${arrivalTime}`;
  if (departureTime) return `A partir de ${departureTime}`;
  if (arrivalTime) return `Avant ${arrivalTime}`;
  return "";
};

const optionsFromValue = (value: unknown): ReservationOptions =>
  fromJsonString<ReservationOptions>(value, {});

const isSameIsoDate = (value: Date, isoDate: string) => value.toISOString().slice(0, 10) === isoDate;

const buildReservationTimes = (contracts: ProgramContractTime[]) => {
  const times = new Map<string, { heure_arrivee: string; heure_depart: string }>();
  for (const contract of contracts) {
    if (contract.reservation_id && !times.has(contract.reservation_id)) {
      times.set(contract.reservation_id, {
        heure_arrivee: contract.heure_arrivee,
        heure_depart: contract.heure_depart,
      });
    }
  }
  return times;
};

const buildAlreadyHandledArrivalKeys = (
  reservations: ProgramReservation[],
  contextStartIsoDate: string,
  targetIsoDate: string,
) => {
  const rowsByKey = new Map<string, {
    date: string;
    giteId: string;
    giteOrder: number;
    giteName: string;
    hasArrival: boolean;
    hasDeparture: boolean;
  }>();

  const getRow = (reservation: ProgramReservation, date: string) => {
    if (!reservation.gite || !reservation.gite_id) return null;
    const key = `${date}-${reservation.gite_id}`;
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        date,
        giteId: reservation.gite_id,
        giteOrder: reservation.gite.ordre,
        giteName: reservation.gite.nom,
        hasArrival: false,
        hasDeparture: false,
      };
      rowsByKey.set(key, row);
    }
    return row;
  };

  for (const reservation of reservations) {
    const arrivalDate = toPlanningRelayIsoDate(reservation.date_entree);
    const departureDate = toPlanningRelayIsoDate(reservation.date_sortie);

    if (departureDate >= contextStartIsoDate && departureDate <= targetIsoDate) {
      const row = getRow(reservation, departureDate);
      if (row) row.hasDeparture = true;
    }

    if (arrivalDate >= contextStartIsoDate && arrivalDate <= targetIsoDate) {
      const row = getRow(reservation, arrivalDate);
      if (row) row.hasArrival = true;
    }
  }

  const pendingDepartureByGite = new Set<string>();
  const handledArrivalRows = new Set<string>();
  const rows = [...rowsByKey.values()].sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.giteOrder - right.giteOrder ||
    left.giteName.localeCompare(right.giteName, "fr") ||
    left.giteId.localeCompare(right.giteId)
  );

  for (const row of rows) {
    if (row.hasArrival && row.hasDeparture) {
      pendingDepartureByGite.delete(row.giteId);
      continue;
    }

    if (row.hasDeparture) {
      pendingDepartureByGite.add(row.giteId);
      continue;
    }

    if (row.hasArrival && pendingDepartureByGite.has(row.giteId)) {
      handledArrivalRows.add(`${row.date}-${row.giteId}`);
      pendingDepartureByGite.delete(row.giteId);
    }
  }

  return handledArrivalRows;
};

export const buildPlanningRelayProgramSmsMessages = (params: {
  targetIsoDate: string;
  contextStartIsoDate?: string;
  heading?: string;
  reservations: ProgramReservation[];
  contracts?: ProgramContractTime[];
}) => {
  const timesByReservationId = buildReservationTimes(params.contracts ?? []);
  const rowsByGite = new Map<string, {
    giteOrder: number;
    giteName: string;
    arrivalTime: string | null;
    departureTime: string | null;
    hasArrival: boolean;
    hasDeparture: boolean;
    hasCleaning: boolean;
  }>();
  const heading = params.heading ?? "Programme demain";
  const handledArrivalRows = buildAlreadyHandledArrivalKeys(
    params.reservations,
    params.contextStartIsoDate ?? params.targetIsoDate,
    params.targetIsoDate,
  );

  const sortedReservations = [...params.reservations].sort((left, right) =>
    (left.gite?.ordre ?? 0) - (right.gite?.ordre ?? 0) ||
    (left.gite?.nom ?? "").localeCompare(right.gite?.nom ?? "", "fr") ||
    left.id.localeCompare(right.id)
  );

  for (const reservation of sortedReservations) {
    if (!reservation.gite || !reservation.gite_id) continue;
    const options = optionsFromValue(reservation.options);
    const times = timesByReservationId.get(reservation.id);
    let row = rowsByGite.get(reservation.gite_id);
    if (!row) {
      row = {
        giteOrder: reservation.gite.ordre,
        giteName: reservation.gite.nom,
        arrivalTime: null,
        departureTime: null,
        hasArrival: false,
        hasDeparture: false,
        hasCleaning: false,
      };
      rowsByGite.set(reservation.gite_id, row);
    }

    if (isSameIsoDate(reservation.date_sortie, params.targetIsoDate)) {
      row.hasDeparture = true;
      row.departureTime ??= formatSmsTime(times?.heure_depart ?? reservation.gite.heure_depart_defaut);
      if (options.menage?.enabled) row.hasCleaning = true;
    }

    if (isSameIsoDate(reservation.date_entree, params.targetIsoDate)) {
      if (handledArrivalRows.has(`${params.targetIsoDate}-${reservation.gite_id}`)) continue;
      row.hasArrival = true;
      row.arrivalTime ??= formatSmsTime(times?.heure_arrivee ?? reservation.gite.heure_arrivee_defaut);
    }
  }

  const lines = [...rowsByGite.values()]
    .filter((row) => row.hasArrival || row.hasDeparture)
    .sort((left, right) =>
      left.giteOrder - right.giteOrder ||
      left.giteName.localeCompare(right.giteName, "fr")
    )
    .map((row) => {
      const kinds = row.hasArrival && row.hasDeparture
        ? "entree + sortie"
        : row.hasArrival
          ? "entree"
          : "sortie";
      const cleaning = row.hasCleaning ? " + menage" : "";
      return `${row.giteName}: ${getOperationSchedule(row.departureTime, row.arrivalTime)} (${kinds})${cleaning}`;
    });

  if (lines.length === 0) return [];
  return [stripSmsAccents([`${heading}:`, ...lines].join("\n"))];
};

export const buildPlanningRelayProgramSmsForPeriod = async (period: {
  gite_ids: unknown;
  date_debut?: Date;
  stay_nights?: number | null;
}, targetIsoDate: string, heading = "Programme demain") => {
  const giteIds = [
    ...new Set(
      fromJsonString<unknown[]>(period.gite_ids, [])
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    ),
  ];
  if (giteIds.length === 0) return null;

  const targetDate = parsePlanningRelayIsoDate(targetIsoDate);
  const contextStartDate = period.date_debut && period.date_debut < targetDate
    ? period.date_debut
    : targetDate;
  const contextStartIsoDate = toPlanningRelayIsoDate(contextStartDate);
  const nextDate = addDays(targetDate, 1);
  const reservations = await prisma.reservation.findMany({
    where: {
      gite_id: { in: giteIds },
      date_entree: { lt: nextDate },
      date_sortie: { gte: contextStartDate },
      ...(period.stay_nights ? { nb_nuits: { gte: period.stay_nights } } : {}),
    },
    select: {
      id: true,
      gite_id: true,
      date_entree: true,
      date_sortie: true,
      nb_nuits: true,
      options: true,
      gite: {
        select: {
          id: true,
          nom: true,
          ordre: true,
          heure_arrivee_defaut: true,
          heure_depart_defaut: true,
        },
      },
    },
    orderBy: [{ gite: { ordre: "asc" } }, { date_sortie: "asc" }, { date_entree: "asc" }],
  });

  const contracts = reservations.length > 0
    ? await prisma.contrat.findMany({
        where: { reservation_id: { in: reservations.map((reservation) => reservation.id) } },
        select: { reservation_id: true, heure_arrivee: true, heure_depart: true },
        orderBy: { date_derniere_modif: "desc" },
      })
    : [];

  return buildPlanningRelayProgramSmsMessages({ targetIsoDate, contextStartIsoDate, heading, reservations, contracts });
};

export const sendPlanningRelayProgramSms = async (period: {
  id: string;
  gite_ids: unknown;
  date_debut?: Date;
  sms_recipient: string | null;
  sms_worker?: {
    telephone: string | null;
  } | null;
  sms_send_day?: string | null;
  stay_nights?: number | null;
}, targetIsoDate: string) => {
  const recipient = getPlanningRelaySmsRecipient(period);
  if (!recipient) throw new Error("Numero SMS manquant pour la periode relais.");
  const messages = await buildPlanningRelayProgramSmsForPeriod(
    period,
    targetIsoDate,
    getPlanningRelayProgramHeading(period.sms_send_day),
  );
  if (!messages || messages.length === 0) return { sent: false as const, reason: "empty" as const };

  await prisma.planningRelayPeriod.update({
    where: { id: period.id },
    data: { sms_last_attempt_for_date: targetIsoDate },
  });
  const results = [];
  for (const message of messages) {
    results.push(await sendOvhSms({ recipient, message }));
  }
  await prisma.planningRelayPeriod.update({
    where: { id: period.id },
    data: {
      sms_last_sent_for_date: targetIsoDate,
      sms_last_attempt_for_date: targetIsoDate,
    },
  });

  return { sent: true as const, messages, results };
};

const buildConfigMessage = async (period: {
  id: string;
  label: string;
  gite_ids: unknown;
  date_debut: Date;
  stay_nights?: number | null;
  share_nonce: string;
}, config: PlanningRelaySmsConfig, worker: { nom: string }, targetIsoDate: string, test = false) => {
  const heading = test
    ? getPlanningRelayTestProgramHeading(targetIsoDate)
    : getPlanningRelayProgramHeading(config.send_day);
  const messages = await buildPlanningRelayProgramSmsForPeriod(period, targetIsoDate, heading);
  if (!messages?.length) return null;
  return renderPlanningRelaySmsTemplate(config.template, {
    date: formatPlanningRelaySmsHeadingDate(targetIsoDate),
    programme: messages.join("\n"),
    intervenant: worker.nom,
    periode: period.label,
    lien: new URL(`/r/${buildPlanningRelayShortCode(period.share_nonce)}`, env.CLIENT_ORIGIN).toString(),
  });
};

export const previewPlanningRelayConfigSms = async (period: {
  id: string;
  label: string;
  gite_ids: unknown;
  date_debut: Date;
  date_fin: Date;
  stay_nights?: number | null;
  share_nonce: string;
}, config: PlanningRelaySmsConfig, worker: { nom: string }) => {
  let targetIsoDate = toPlanningRelayIsoDate(period.date_debut);
  const endIsoDate = toPlanningRelayIsoDate(period.date_fin);
  while (targetIsoDate <= endIsoDate) {
    const message = await buildConfigMessage(period, config, worker, targetIsoDate);
    if (message) return { targetIsoDate, message };
    targetIsoDate = addPlanningRelayIsoDays(targetIsoDate, 1);
  }
  return null;
};

export const sendPlanningRelayConfigTestSms = async (period: {
  id: string;
  label: string;
  gite_ids: unknown;
  date_debut: Date;
  date_fin: Date;
  stay_nights?: number | null;
  share_nonce: string;
}, config: PlanningRelaySmsConfig, worker: { nom: string; telephone: string }, currentIsoDate = getParisDateTimeParts().isoDate) => {
  let targetIsoDate = period.date_debut > parsePlanningRelayIsoDate(currentIsoDate)
    ? toPlanningRelayIsoDate(period.date_debut)
    : currentIsoDate;
  const endIsoDate = toPlanningRelayIsoDate(period.date_fin);
  while (targetIsoDate <= endIsoDate) {
    const message = await buildConfigMessage(period, config, worker, targetIsoDate, true);
    if (message) {
      const result = await sendOvhSms({ recipient: worker.telephone, message });
      return { sent: true as const, targetIsoDate, messages: [message], results: [result] };
    }
    targetIsoDate = addPlanningRelayIsoDays(targetIsoDate, 1);
  }
  return { sent: false as const, reason: "no_intervention" as const };
};

export const sendPlanningRelayProgramTestSms = async (period: {
  gite_ids: unknown;
  date_debut: Date;
  date_fin: Date;
  sms_recipient: string | null;
  sms_worker?: {
    telephone: string | null;
  } | null;
}, currentIsoDate = getParisDateTimeParts().isoDate) => {
  const recipient = getPlanningRelaySmsRecipient(period);
  if (!recipient) throw new Error("Numero SMS manquant pour la periode relais.");

  let targetIsoDate = period.date_debut > parsePlanningRelayIsoDate(currentIsoDate)
    ? toPlanningRelayIsoDate(period.date_debut)
    : currentIsoDate;
  const endIsoDate = toPlanningRelayIsoDate(period.date_fin);

  while (targetIsoDate <= endIsoDate) {
    const messages = await buildPlanningRelayProgramSmsForPeriod(
      period,
      targetIsoDate,
      getPlanningRelayTestProgramHeading(targetIsoDate),
    );
    if (messages?.length) {
      const results = [];
      for (const message of messages) {
        results.push(await sendOvhSms({ recipient, message }));
      }
      return { sent: true as const, targetIsoDate, messages, results };
    }
    targetIsoDate = addPlanningRelayIsoDays(targetIsoDate, 1);
  }

  return { sent: false as const, reason: "no_intervention" as const };
};

export const runPlanningRelaySmsSchedule = async (now = new Date()) => {
  const { isoDate, time } = getParisDateTimeParts(now);
  const todayDate = parsePlanningRelayIsoDate(isoDate);
  const tomorrowDate = parsePlanningRelayIsoDate(addPlanningRelayIsoDays(isoDate, 1));
  const periods = await prisma.planningRelayPeriod.findMany({
    where: {
      is_active: true,
      date_debut: { lte: tomorrowDate },
      date_fin: { gte: todayDate },
    },
    include: { sms_worker: true },
    orderBy: [{ createdAt: "asc" }],
  });

  let sentCount = 0;
  for (const period of periods) {
    const configs = normalizePlanningRelaySmsConfigs(period.sms_configs, period);
    for (const config of configs.filter((item) => item.enabled)) {
      const targetIsoDate = getPlanningRelayProgramTargetIsoDate(isoDate, config.send_day);
      const targetDate = parsePlanningRelayIsoDate(targetIsoDate);
      if (period.date_debut > targetDate || period.date_fin < targetDate) continue;
      if (!isPlanningRelaySmsDue({
        nowTime: time,
        sendTime: config.send_time,
        targetIsoDate,
        lastAttemptForDate: config.last_attempt_for_date,
      })) continue;

      const configIndex = configs.findIndex((item) => item.id === config.id);
      configs[configIndex] = { ...config, last_attempt_for_date: targetIsoDate };
      await prisma.planningRelayPeriod.update({
        where: { id: period.id },
        data: { sms_configs: encodeJsonField(configs) },
      });

      try {
        const worker = await prisma.planningRelayWorker.findUnique({ where: { id: config.worker_id } });
        if (!worker?.telephone.trim()) throw new Error("Intervenant SMS ou numero manquant.");
        const message = await buildConfigMessage(period, config, worker, targetIsoDate);
        if (!message) continue;
        await sendOvhSms({ recipient: worker.telephone, message });
        configs[configIndex] = { ...configs[configIndex], last_sent_for_date: targetIsoDate };
        await prisma.planningRelayPeriod.update({
          where: { id: period.id },
          data: { sms_configs: encodeJsonField(configs) },
        });
        sentCount += 1;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `Erreur envoi SMS planning relais ${period.id}/${config.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return { checkedCount: periods.length, sentCount };
};

let planningRelaySmsTimer: NodeJS.Timeout | null = null;
let planningRelaySmsRunIsActive = false;

export const startPlanningRelaySmsCron = () => {
  if (planningRelaySmsTimer) return;

  const tick = async () => {
    if (planningRelaySmsRunIsActive) return;
    planningRelaySmsRunIsActive = true;
    try {
      await runPlanningRelaySmsSchedule();
    } finally {
      planningRelaySmsRunIsActive = false;
    }
  };

  planningRelaySmsTimer = setInterval(() => {
    void tick();
  }, 60_000);
  void tick();
};
