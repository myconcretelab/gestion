import { addDays } from "date-fns";
import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";
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

export type PlanningRelaySmsSendDay = "previous_day" | "same_day";

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

export const buildPlanningRelayProgramSmsMessage = (params: {
  targetIsoDate: string;
  heading?: string;
  reservations: ProgramReservation[];
  contracts?: ProgramContractTime[];
}) => {
  const timesByReservationId = buildReservationTimes(params.contracts ?? []);
  const rowsByGite = new Map<string, {
    gite: NonNullable<ProgramReservation["gite"]>;
    parts: Array<{ rank: number; text: string }>;
  }>();

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
      row = { gite: reservation.gite, parts: [] };
      rowsByGite.set(reservation.gite_id, row);
    }

    if (isSameIsoDate(reservation.date_sortie, params.targetIsoDate)) {
      const labels = ["sortie"];
      if (options.menage?.enabled) labels.push("menage");
      row.parts.push({
        rank: 0,
        text: `${formatSmsTime(times?.heure_depart ?? reservation.gite.heure_depart_defaut)} ${labels.join(" + ")}`,
      });
    }

    if (isSameIsoDate(reservation.date_entree, params.targetIsoDate)) {
      row.parts.push({
        rank: 1,
        text: `${formatSmsTime(times?.heure_arrivee ?? reservation.gite.heure_arrivee_defaut)} entree`,
      });
    }
  }

  const lines = [...rowsByGite.values()]
    .filter((row) => row.parts.length > 0)
    .map((row) => `- ${row.gite.nom}: ${row.parts.sort((left, right) => left.rank - right.rank).map((part) => part.text).join(" / ")}`);

  if (lines.length === 0) return null;
  return stripSmsAccents([`${params.heading ?? "Programme demain"}:`, ...lines].join("\n"));
};

export const buildPlanningRelayProgramSmsForPeriod = async (period: {
  gite_ids: unknown;
}, targetIsoDate: string, heading = "Programme demain") => {
  const giteIds = [
    ...new Set(
      fromJsonString<unknown[]>(period.gite_ids, [])
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    ),
  ];
  if (giteIds.length === 0) return null;

  const targetDate = parsePlanningRelayIsoDate(targetIsoDate);
  const nextDate = addDays(targetDate, 1);
  const reservations = await prisma.reservation.findMany({
    where: {
      gite_id: { in: giteIds },
      OR: [
        { date_entree: { gte: targetDate, lt: nextDate } },
        { date_sortie: { gte: targetDate, lt: nextDate } },
      ],
    },
    select: {
      id: true,
      gite_id: true,
      date_entree: true,
      date_sortie: true,
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

  return buildPlanningRelayProgramSmsMessage({ targetIsoDate, heading, reservations, contracts });
};

export const sendPlanningRelayProgramSms = async (period: {
  id: string;
  gite_ids: unknown;
  sms_recipient: string | null;
  sms_send_day?: string | null;
}, targetIsoDate: string) => {
  if (!period.sms_recipient?.trim()) throw new Error("Numero SMS manquant pour la periode relais.");
  const message = await buildPlanningRelayProgramSmsForPeriod(
    period,
    targetIsoDate,
    getPlanningRelayProgramHeading(period.sms_send_day),
  );
  if (!message) return { sent: false as const, reason: "empty" as const };

  await prisma.planningRelayPeriod.update({
    where: { id: period.id },
    data: { sms_last_attempt_for_date: targetIsoDate },
  });
  const result = await sendOvhSms({ recipient: period.sms_recipient, message });
  await prisma.planningRelayPeriod.update({
    where: { id: period.id },
    data: {
      sms_last_sent_for_date: targetIsoDate,
      sms_last_attempt_for_date: targetIsoDate,
    },
  });

  return { sent: true as const, message, result };
};

export const runPlanningRelaySmsSchedule = async (now = new Date()) => {
  const { isoDate, time } = getParisDateTimeParts(now);
  const todayDate = parsePlanningRelayIsoDate(isoDate);
  const tomorrowDate = parsePlanningRelayIsoDate(addPlanningRelayIsoDays(isoDate, 1));
  const periods = await prisma.planningRelayPeriod.findMany({
    where: {
      is_active: true,
      sms_enabled: true,
      sms_recipient: { not: null },
      date_debut: { lte: tomorrowDate },
      date_fin: { gte: todayDate },
    },
    orderBy: [{ sms_send_time: "asc" }, { createdAt: "asc" }],
  });

  let sentCount = 0;
  for (const period of periods) {
    const targetIsoDate = getPlanningRelayProgramTargetIsoDate(isoDate, period.sms_send_day);
    const targetDate = parsePlanningRelayIsoDate(targetIsoDate);
    if (period.date_debut > targetDate || period.date_fin < targetDate) continue;

    if (
      !isPlanningRelaySmsDue({
        nowTime: time,
        sendTime: period.sms_send_time,
        targetIsoDate,
        lastAttemptForDate: period.sms_last_attempt_for_date,
      })
    ) {
      continue;
    }

    try {
      const result = await sendPlanningRelayProgramSms(period, targetIsoDate);
      if (result.sent) sentCount += 1;
    } catch (error) {
      await prisma.planningRelayPeriod.update({
        where: { id: period.id },
        data: { sms_last_attempt_for_date: targetIsoDate },
      }).catch(() => undefined);
      // eslint-disable-next-line no-console
      console.error(
        `Erreur envoi SMS planning relais ${period.id}:`,
        error instanceof Error ? error.message : error,
      );
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
