import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { readTraceabilityLog } from "../services/importLog.js";
import {
  getIcalConflictRecord,
  listOpenIcalConflictRecords,
  updateIcalConflictRecord,
  type IcalConflictResolutionAction,
} from "../services/icalConflicts.js";
import { readSourceColorSettings } from "../services/sourceColorSettings.js";
import { loadLiveReservationEnergySummaries } from "../services/smartlifeEnergyTracking.js";
import { buildStatisticsReservationSegments } from "../services/statistics.js";
import {
  buildDefaultSmartlifeAutomationConfig,
  hasSmartlifeCredentials,
  readSmartlifeAutomationConfig,
} from "../services/smartlifeSettings.js";
import { buildNewReservations } from "../services/dailyReservationEmail.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { toNumber } from "../utils/money.js";
import { extractAirbnbConfirmationCode } from "../utils/airbnbReservationIdentity.js";
import { isUnknownHostName } from "../utils/reservationText.js";
import {
  buildOverviewReservationsWhere,
  buildRecentAppActivity,
  createOverviewHandler,
  parseDateTime,
  parseOverviewParams,
} from "./todayOverview.shared.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 36;

type TodayRevenueAverageMetric = {
  id: "current_month" | "next_month" | "previous_month" | "last_24_months";
  label: string;
  month_count: number;
  gross_revenue: number;
  gite_expenses: number;
  personal_recurring_expenses: number;
  personal_occasional_expenses: number;
  expenses: number;
  net_average_monthly_revenue: number;
  expense_details: Array<{
    gite_id: string;
    gite_name: string;
    monthly_expenses: number;
    period_expenses: number;
  }>;
  personal_expense_details: Array<{
    id: string;
    kind: "recurring" | "occasional";
    label: string;
    category_name: string;
    manager_name: string;
    status: "paid" | "planned" | null;
    period_expenses: number;
  }>;
};

const icalConflictResolutionSchema = z.object({
  action: z.enum(["keep_reservation", "apply_ical", "delete_reservation"]),
});

const conflictReservationSelect = {
  id: true,
  gite_id: true,
  hote_nom: true,
  date_entree: true,
  date_sortie: true,
  source_paiement: true,
  commentaire: true,
  airbnb_url: true,
  origin_system: true,
  origin_reference: true,
  gite: {
    select: {
      id: true,
      nom: true,
      prefixe_contrat: true,
      ordre: true,
    },
  },
} as const;

const parseIsoDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const formatIsoDateFr = (value: Date | string) => {
  const parsed = value instanceof Date ? value : parseDateTime(value);
  if (!parsed) return String(value ?? "");
  return parsed.toLocaleDateString("fr-FR", { timeZone: "UTC" });
};

const buildOverlapConflictPayload = (conflicts: Array<{ id: string; hote_nom: string; date_entree: Date; date_sortie: Date }>) => ({
  error: "Chevauchement détecté sur ce gîte.",
  conflicts: conflicts.map((conflict) => ({
    id: conflict.id,
    hote_nom: conflict.hote_nom,
    date_entree: conflict.date_entree,
    date_sortie: conflict.date_sortie,
    label: `${conflict.hote_nom} (${formatIsoDateFr(conflict.date_entree)} - ${formatIsoDateFr(conflict.date_sortie)})`,
  })),
});

const round2 = (value: number) => Math.round(value * 100) / 100;

const normalizeRevenueLabel = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const getMonthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

const getUtcMonthStart = (date: Date, offsetMonths = 0) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));

const formatMonthName = (date: Date) =>
  date.toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" }).replace(/^./, (char) => char.toUpperCase());

const listMonthKeys = (startInclusive: Date, monthCount: number) =>
  Array.from({ length: monthCount }, (_, index) => {
    const date = getUtcMonthStart(startInclusive, index);
    return getMonthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
  });

const getRecurringExpenseAmountForMonth = (
  expense: {
    frequency: string;
    amount: number;
    start_date: Date;
    end_date: Date | null;
  },
  monthStart: Date
) => {
  const monthEnd = getUtcMonthStart(monthStart, 1);
  const activeStart = expense.start_date.getTime();
  const activeEnd = expense.end_date ? expense.end_date.getTime() + DAY_MS : Number.POSITIVE_INFINITY;
  const overlapStart = Math.max(monthStart.getTime(), activeStart);
  const overlapEnd = Math.min(monthEnd.getTime(), activeEnd);
  if (overlapEnd <= overlapStart) return 0;

  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY_MS);
  const activeDays = Math.round((overlapEnd - overlapStart) / DAY_MS);
  const monthlyAmount = expense.frequency === "annual" ? toNumber(expense.amount) / 12 : toNumber(expense.amount);
  return round2((Math.max(0, monthlyAmount) * activeDays) / daysInMonth);
};

const getGiteMonthlyExpenses = (value: unknown) => {
  const parsed = fromJsonString<any>(value, null);
  const expenses = Array.isArray(parsed?.expenses) ? parsed.expenses : [];
  return round2(
    expenses.reduce((sum: number, expense: any) => {
      const monthly = toNumber(expense?.monthly_amount);
      const annual = toNumber(expense?.annual_amount);
      const amount = monthly > 0 ? monthly : annual > 0 ? annual / 12 : 0;
      return sum + Math.max(0, amount);
    }, 0)
  );
};

const buildTodayRevenueAverageMetrics = async (today: Date): Promise<TodayRevenueAverageMetric[]> => {
  const currentMonthStart = getUtcMonthStart(today);
  const previousMonthStart = getUtcMonthStart(today, -1);
  const nextMonthStart = getUtcMonthStart(today, 1);
  const followingMonthStart = getUtcMonthStart(today, 2);
  const last24MonthsStart = getUtcMonthStart(today, -23);
  const periods = [
    {
      id: "previous_month" as const,
      label: formatMonthName(previousMonthStart),
      month_count: 1,
      monthStarts: [previousMonthStart],
      monthKeys: new Set(listMonthKeys(previousMonthStart, 1)),
    },
    {
      id: "current_month" as const,
      label: formatMonthName(currentMonthStart),
      month_count: 1,
      monthStarts: [currentMonthStart],
      monthKeys: new Set(listMonthKeys(currentMonthStart, 1)),
    },
    {
      id: "next_month" as const,
      label: formatMonthName(nextMonthStart),
      month_count: 1,
      monthStarts: [nextMonthStart],
      monthKeys: new Set(listMonthKeys(nextMonthStart, 1)),
    },
    {
      id: "last_24_months" as const,
      label: "2 ans",
      month_count: 24,
      monthStarts: Array.from({ length: 24 }, (_, index) => getUtcMonthStart(last24MonthsStart, index)),
      monthKeys: new Set(listMonthKeys(last24MonthsStart, 24)),
    },
  ];
  const [gites, reservations, personalRecurringExpenses, personalOccasionalExpenses] = await Promise.all([
    prisma.gite.findMany({
      select: { id: true, nom: true, ordre: true, frais_gestion: true },
      orderBy: [{ ordre: "asc" }, { nom: "asc" }],
    }),
    prisma.reservation.findMany({
      where: {
        gite_id: { not: null },
        date_entree: { lt: followingMonthStart },
        date_sortie: { gte: last24MonthsStart },
      },
      select: {
        id: true,
        gite_id: true,
        date_entree: true,
        date_sortie: true,
        nb_nuits: true,
        nb_adultes: true,
        prix_par_nuit: true,
        prix_total: true,
        source_paiement: true,
        frais_optionnels_montant: true,
        frais_optionnels_declares: true,
      },
    }),
    prisma.expenseRecurringRule.findMany({
      where: {
        scope: "personal",
        is_active: true,
        start_date: { lt: followingMonthStart },
        OR: [{ end_date: null }, { end_date: { gte: last24MonthsStart } }],
      },
      select: {
        id: true,
        label: true,
        frequency: true,
        amount: true,
        start_date: true,
        end_date: true,
        category: { select: { name: true } },
        gestionnaire: { select: { prenom: true, nom: true } },
      },
      orderBy: [{ label: "asc" }],
    }),
    prisma.expenseEntry.findMany({
      where: {
        scope: "personal",
        expense_date: { gte: previousMonthStart, lt: followingMonthStart },
      },
      select: {
        id: true,
        label: true,
        amount: true,
        expense_date: true,
        status: true,
        category: { select: { name: true } },
        gestionnaire: { select: { prenom: true, nom: true } },
      },
      orderBy: [{ expense_date: "asc" }, { label: "asc" }],
    }),
  ]);
  const monthlyExpensesByGite = gites.map((gite) => ({
    gite_id: gite.id,
    gite_name: gite.nom,
    monthly_expenses: getGiteMonthlyExpenses(gite.frais_gestion),
  }));
  const totalMonthlyExpenses = monthlyExpensesByGite.reduce(
    (sum, gite) => sum + gite.monthly_expenses,
    0
  );
  const grossRevenueByMonth = new Map<string, number>();

  for (const reservation of reservations) {
    if (normalizeRevenueLabel(reservation.source_paiement ?? "") === "homeexchange") continue;
    for (const segment of buildStatisticsReservationSegments({
      ...reservation,
      prix_par_nuit: toNumber(reservation.prix_par_nuit),
      prix_total: toNumber(reservation.prix_total),
      frais_optionnels_montant: toNumber(reservation.frais_optionnels_montant),
    })) {
      const key = getMonthKey(segment.year, segment.month);
      grossRevenueByMonth.set(key, round2((grossRevenueByMonth.get(key) ?? 0) + segment.revenus + segment.fraisOptionnelsTotal));
    }
  }

  return periods.map((period) => {
    const grossRevenue = round2([...period.monthKeys].reduce((sum, key) => sum + (grossRevenueByMonth.get(key) ?? 0), 0));
    const giteExpenses = round2(totalMonthlyExpenses * period.month_count);
    const recurringDetails = personalRecurringExpenses
      .map((expense) => ({
        id: expense.id,
        kind: "recurring" as const,
        label: expense.label,
        category_name: expense.category.name,
        manager_name: [expense.gestionnaire?.prenom, expense.gestionnaire?.nom].filter(Boolean).join(" "),
        status: null,
        period_expenses: round2(
          period.monthStarts.reduce(
            (sum, monthStart) => sum + getRecurringExpenseAmountForMonth(expense, monthStart),
            0
          )
        ),
      }))
      .filter((expense) => expense.period_expenses > 0);
    const occasionalDetails = period.id === "last_24_months"
      ? []
      : personalOccasionalExpenses
          .filter((expense) => period.monthKeys.has(getMonthKey(expense.expense_date.getUTCFullYear(), expense.expense_date.getUTCMonth() + 1)))
          .map((expense) => ({
            id: expense.id,
            kind: "occasional" as const,
            label: expense.label,
            category_name: expense.category.name,
            manager_name: [expense.gestionnaire?.prenom, expense.gestionnaire?.nom].filter(Boolean).join(" "),
            status: expense.status === "planned" ? ("planned" as const) : ("paid" as const),
            period_expenses: round2(Math.max(0, toNumber(expense.amount))),
          }))
          .filter((expense) => expense.period_expenses > 0);
    const personalRecurringExpensesTotal = round2(
      recurringDetails.reduce((sum, expense) => sum + expense.period_expenses, 0)
    );
    const personalOccasionalExpensesTotal = round2(
      occasionalDetails.reduce((sum, expense) => sum + expense.period_expenses, 0)
    );
    const expenses = round2(giteExpenses + personalRecurringExpensesTotal + personalOccasionalExpensesTotal);
    return {
      id: period.id,
      label: period.label,
      month_count: period.month_count,
      gross_revenue: grossRevenue,
      gite_expenses: giteExpenses,
      personal_recurring_expenses: personalRecurringExpensesTotal,
      personal_occasional_expenses: personalOccasionalExpensesTotal,
      expenses,
      net_average_monthly_revenue: period.month_count > 0 ? round2((grossRevenue - expenses) / period.month_count) : 0,
      expense_details: monthlyExpensesByGite
        .filter((gite) => gite.monthly_expenses > 0)
        .map((gite) => ({
          ...gite,
          period_expenses: round2(gite.monthly_expenses * period.month_count),
        })),
      personal_expense_details: [...recurringDetails, ...occasionalDetails],
    };
  });
};

const loadOverviewReservations = async (today: Date, endExclusive: Date) => {
  const reservations = await prisma.reservation.findMany({
    where: buildOverviewReservationsWhere(today, endExclusive),
    include: {
      gite: {
        select: {
          id: true,
          nom: true,
          prefixe_contrat: true,
          ordre: true,
          electricity_price_per_kwh: true,
        },
      },
    },
    orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
  });

  return reservations.map((reservation) => ({
    ...reservation,
    options: fromJsonString(reservation.options, {}),
  }));
};

const loadOverviewLiveEnergyByReservationId = async (today: Date, endExclusive: Date) => {
  const smartlifeConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
  if (!hasSmartlifeCredentials(smartlifeConfig)) {
    return {} as Record<
      string,
      {
        energy_live_consumption_kwh: number;
        energy_live_cost_eur: number;
        energy_live_price_per_kwh: number | null;
        energy_live_recorded_at: string;
      }
    >;
  }

  const reservations = await prisma.reservation.findMany({
    where: buildOverviewReservationsWhere(today, endExclusive),
    select: {
      id: true,
      energy_tracking: true,
      gite: {
        select: {
          electricity_price_per_kwh: true,
        },
      },
    },
  });
  if (reservations.length === 0) {
    return {};
  }

  const liveEnergyByReservationId = await loadLiveReservationEnergySummaries(smartlifeConfig, reservations);
  return Object.fromEntries(liveEnergyByReservationId.entries());
};

const loadRecentAppActivity = (since: Date) =>
  buildRecentAppActivity(since, () =>
    prisma.reservation.findMany({
      where: {
        OR: [{ createdAt: { gte: since } }, { updatedAt: { gte: since } }],
      },
      select: {
        id: true,
        gite_id: true,
        hote_nom: true,
        source_paiement: true,
        commentaire: true,
        prix_total: true,
        prix_par_nuit: true,
        origin_system: true,
        createdAt: true,
        updatedAt: true,
        gite: {
          select: {
            nom: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
  );

router.get("/overview/primary", async (req, res, next) => {
  try {
    const { days, notificationDays, today, endExclusive } = parseOverviewParams(req.query as Record<string, unknown>);
    const [gites, reservations, revenueAverages] = await Promise.all([
      prisma.gite.findMany({
        select: { id: true, nom: true, prefixe_contrat: true, ordre: true },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
      loadOverviewReservations(today, endExclusive),
      buildTodayRevenueAverageMetrics(today),
    ]);

    return res.json({
      today: toIsoDate(today),
      days,
      notification_days: notificationDays,
      gites,
      reservations,
      source_colors: readSourceColorSettings().colors,
      revenue_averages: revenueAverages,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/overview/deferred", async (req, res, next) => {
  try {
    const { days, notificationDays, today, endExclusive, notificationSince } = parseOverviewParams(
      req.query as Record<string, unknown>
    );
    const openIcalConflicts = listOpenIcalConflictRecords();
    const [unassignedCount, conflictReservations, newReservations, liveEnergyByReservationId] = await Promise.all([
      prisma.reservation.count({
        where: {
          gite_id: null,
          date_entree: { lt: endExclusive },
          date_sortie: { gte: today },
        },
      }),
      openIcalConflicts.length > 0
        ? prisma.reservation.findMany({
            where: { id: { in: openIcalConflicts.map((item) => item.reservation_id) } },
            select: conflictReservationSelect,
          })
        : Promise.resolve([]),
      buildNewReservations(notificationSince, new Date()),
      loadOverviewLiveEnergyByReservationId(today, endExclusive),
    ]);

    const conflictReservationById = new Map(conflictReservations.map((reservation) => [reservation.id, reservation]));

    return res.json({
      days,
      notification_days: notificationDays,
      unassigned_count: unassignedCount,
      new_reservations: newReservations,
      live_energy_by_reservation_id: liveEnergyByReservationId,
      ical_conflicts: openIcalConflicts.map((conflict) => ({
        ...conflict,
        reservation: conflictReservationById.get(conflict.reservation_id) ?? null,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/overview",
  createOverviewHandler({
    loadGites: () =>
      prisma.gite.findMany({
        select: { id: true, nom: true, prefixe_contrat: true, ordre: true },
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
      }),
    loadReservations: loadOverviewReservations,
    countUnassignedReservations: (today, endExclusive) =>
      prisma.reservation.count({
        where: {
          gite_id: null,
          date_entree: { lt: endExclusive },
          date_sortie: { gte: today },
        },
      }),
    loadRecentAppActivity,
    listOpenIcalConflicts: listOpenIcalConflictRecords,
    loadConflictReservations: (reservationIds) =>
      prisma.reservation.findMany({
        where: { id: { in: reservationIds } },
        select: conflictReservationSelect,
      }),
    buildNewReservations,
    loadLiveEnergyByReservationId: async (reservations) => {
      const smartlifeConfig = readSmartlifeAutomationConfig(buildDefaultSmartlifeAutomationConfig());
      if (!hasSmartlifeCredentials(smartlifeConfig)) {
        return {};
      }
      return Object.fromEntries((await loadLiveReservationEnergySummaries(smartlifeConfig, reservations)).entries());
    },
    readTraceabilityLog,
    readSourceColors: () => readSourceColorSettings().colors,
  })
);

router.post("/ical-conflicts/:id/resolve", async (req, res, next) => {
  try {
    const conflict = getIcalConflictRecord(String(req.params.id ?? "").trim());
    if (!conflict || conflict.status !== "open") {
      return res.status(404).json({ error: "Conflit iCal introuvable." });
    }

    const payload = icalConflictResolutionSchema.parse(req.body ?? {});
    const action = payload.action as IcalConflictResolutionAction;

    if (action === "keep_reservation") {
      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: "keep_reservation",
      }));
      return res.json({ ok: true, conflict: updated });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: conflict.reservation_id } });

    if (action === "delete_reservation" || (action === "apply_ical" && conflict.type === "deleted")) {
      if (reservation) {
        await prisma.reservation.delete({ where: { id: reservation.id } });
      }
      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: action,
      }));
      return res.json({ ok: true, conflict: updated });
    }

    if (action === "apply_ical" && conflict.type === "modified") {
      if (!reservation) {
        return res.status(404).json({ error: "La réservation liée au conflit est introuvable." });
      }
      if (!conflict.incoming_snapshot) {
        return res.status(400).json({ error: "Le conflit iCal ne contient pas de version entrante à appliquer." });
      }
      const incomingSnapshot = conflict.incoming_snapshot;

      const nextCheckIn = parseIsoDate(incomingSnapshot.date_entree);
      const nextCheckOut = parseIsoDate(incomingSnapshot.date_sortie);
      if (!nextCheckIn || !nextCheckOut || nextCheckOut.getTime() <= nextCheckIn.getTime()) {
        return res.status(400).json({ error: "Les dates iCal à appliquer sont invalides." });
      }

      const overlapConflicts = await prisma.reservation.findMany({
        where: {
          gite_id: reservation.gite_id,
          date_entree: { lt: nextCheckOut },
          date_sortie: { gt: nextCheckIn },
          NOT: { id: reservation.id },
        },
        orderBy: { date_entree: "asc" },
      });

      const incomingConfirmationCode = extractAirbnbConfirmationCode(
        incomingSnapshot.airbnb_url,
        incomingSnapshot.description,
        incomingSnapshot.origin_reference,
      );
      const duplicateReservations = incomingConfirmationCode
        ? overlapConflicts.filter(
            (item) =>
              extractAirbnbConfirmationCode(item.airbnb_url, item.origin_reference) === incomingConfirmationCode,
          )
        : [];
      const duplicateIds = new Set(duplicateReservations.map((item) => item.id));
      const unrelatedOverlaps = overlapConflicts.filter((item) => !duplicateIds.has(item.id));
      if (unrelatedOverlaps.length > 0 || (overlapConflicts.length > 0 && duplicateReservations.length === 0)) {
        return res.status(409).json(buildOverlapConflictPayload(unrelatedOverlaps.length > 0 ? unrelatedOverlaps : overlapConflicts));
      }

      const nbNuits = Math.max(1, Math.round((nextCheckOut.getTime() - nextCheckIn.getTime()) / DAY_MS));
      const enrichedDuplicate = duplicateReservations.find((item) => !isUnknownHostName(item.hote_nom)) ?? duplicateReservations[0];
      await prisma.$transaction(async (tx) => {
        if (duplicateReservations.length > 0) {
          const duplicateReservationIds = duplicateReservations.map((item) => item.id);
          await Promise.all([
            tx.contrat.updateMany({
              where: { reservation_id: { in: duplicateReservationIds } },
              data: { reservation_id: reservation.id },
            }),
            tx.facture.updateMany({
              where: { reservation_id: { in: duplicateReservationIds } },
              data: { reservation_id: reservation.id },
            }),
            tx.bookingRequest.updateMany({
              where: { approved_reservation_id: { in: duplicateReservationIds } },
              data: { approved_reservation_id: reservation.id },
            }),
            tx.reservation.updateMany({
              where: { stay_group_id: { in: duplicateReservationIds } },
              data: { stay_group_id: reservation.stay_group_id ?? reservation.id },
            }),
          ]);
          await tx.reservation.deleteMany({ where: { id: { in: duplicateReservationIds } } });
        }

        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            hote_nom:
              isUnknownHostName(reservation.hote_nom) && enrichedDuplicate && !isUnknownHostName(enrichedDuplicate.hote_nom)
                ? enrichedDuplicate.hote_nom
                : reservation.hote_nom,
            telephone: reservation.telephone || enrichedDuplicate?.telephone || undefined,
            email: reservation.email || enrichedDuplicate?.email || undefined,
            date_entree: nextCheckIn,
            date_sortie: nextCheckOut,
            nb_nuits: nbNuits,
            prix_par_nuit:
              Number(reservation.prix_par_nuit) > 0
                ? reservation.prix_par_nuit
                : enrichedDuplicate?.prix_par_nuit ?? reservation.prix_par_nuit,
            prix_total:
              Number(reservation.prix_total) > 0
                ? reservation.prix_total
                : enrichedDuplicate?.prix_total ?? reservation.prix_total,
            source_paiement:
              incomingSnapshot.final_source ??
              incomingSnapshot.source_paiement ??
              reservation.source_paiement ??
              enrichedDuplicate?.source_paiement,
            commentaire: reservation.commentaire || enrichedDuplicate?.commentaire || undefined,
            airbnb_url: incomingSnapshot.airbnb_url ?? reservation.airbnb_url ?? enrichedDuplicate?.airbnb_url,
          },
        });
      });

      const updated = updateIcalConflictRecord(conflict.id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_action: "apply_ical",
      }));
      return res.json({
        ok: true,
        conflict: updated,
        merged_reservation_ids: duplicateReservations.map((item) => item.id),
      });
    }

    return res.status(400).json({ error: "Action de résolution non gérée pour ce conflit." });
  } catch (error) {
    return next(error);
  }
});

export default router;
