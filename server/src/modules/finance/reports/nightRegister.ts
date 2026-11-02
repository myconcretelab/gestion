import { createHash } from "node:crypto";
import {
  computeTouristTax,
  evaluateReport,
  getReportPeriod,
  reportDefinitionSchema,
  reportPeriodKey,
  touristTaxStaySchema,
  type NightRegister,
  type NightRegisterRow,
  type ReportState,
} from "@contrats/shared";
import prisma from "../../../db/prisma.js";
import { fromJsonString } from "../../../utils/jsonFields.js";
import { loadReservationPaymentTracking } from "../../reservationPayments/ledger.js";
import { loadReportFacts } from "./facts.js";

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const day = (date: Date) => date.toISOString().slice(0, 10);
const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
const parisDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A current source register. Missing tax collection evidence is never inferred from calendar nights. */
export async function getNightRegister(
  reportId: string,
  month: string,
): Promise<NightRegister> {
  return prisma.$transaction(
    async (db) => {
      const store = await db.financeReportStore.findFirst();
      const config = fromJsonString<ReportState | null>(store?.data_json, null);
      const raw = config?.reports.find((report) => report.id === reportId);
      if (!raw) throw fail("Rapport introuvable.", 404);
      if (raw.kind !== "tourist")
        throw fail("Le registre des séjours concerne les rapports de nuitées.");
      const report = reportDefinitionSchema.parse(raw);
      const facts = await loadReportFacts(db);
      if (
        report.propertyIds.some(
          (id) => !facts.properties.some((property) => property.id === id),
        )
      )
        throw fail(
          "Un gîte du rapport n’existe plus. Vérifiez son périmètre avant de télécharger le registre.",
        );
      const period = getReportPeriod(month, report.cadence);
      if (
        report.managerId &&
        (!facts.managers.some((manager) => manager.id === report.managerId) ||
          report.propertyIds.some(
            (id) => facts.propertyManagers[id] !== report.managerId,
          ))
      )
        throw fail(
          "Le rattachement au gestionnaire a changé. Vérifiez le périmètre du rapport avant de télécharger le registre.",
        );
      const gites = await db.gite.findMany({
        where: { id: { in: report.propertyIds } },
        orderBy: [{ ordre: "asc" }, { id: "asc" }],
      });
      const properties = gites.map((gite) => ({
        id: gite.id,
        name: gite.nom,
        address: [gite.adresse_ligne1, gite.adresse_ligne2]
          .filter(Boolean)
          .join(", "),
        registrationNumber: null,
      }));
      const evaluated = evaluateReport(
        report,
        month,
        config!.overrides[reportPeriodKey(report, month)],
        facts.operations,
        { ...facts, operationEdits: {} },
      );
      const ids = [
        ...new Set(
          evaluated.rows
            .filter((row) => row.status !== "excluded")
            .flatMap((row) => (row.reservationId ? [row.reservationId] : [])),
        ),
      ];
      const reservations = await db.reservation.findMany({
        where: { id: { in: ids } },
        include: { gite: true },
        orderBy: [{ date_entree: "asc" }, { id: "asc" }],
      });
      const groupIds = [
        ...new Set(
          reservations.flatMap((row) =>
            row.stay_group_id ? [row.stay_group_id] : [],
          ),
        ),
      ];
      const siblings = groupIds.length
        ? await db.reservation.findMany({
            where: { stay_group_id: { in: groupIds } },
            orderBy: [{ date_entree: "asc" }, { id: "asc" }],
          })
        : [];
      const tracking = await loadReservationPaymentTracking(ids, db);
      const rows: NightRegisterRow[] = [];
      for (const [index, reservation] of reservations.entries()) {
        const group = reservation.stay_group_id
          ? siblings.filter(
              (row) => row.stay_group_id === reservation.stay_group_id,
            )
          : [reservation];
        const first = group[0] ?? reservation;
        const options = fromJsonString<{ tourist_tax?: unknown }>(
          first.options,
          {},
        );
        const checked = touristTaxStaySchema.safeParse(options.tourist_tax);
        const stayTax = checked.success ? checked.data : null;
        const nightsInGroup = group.reduce((sum, row) => sum + row.nb_nuits, 0);
        const accommodation =
          group.reduce((sum, row) => sum + Number(row.prix_total), 0) -
          Number(first.remise_montant);
        const tax = stayTax
          ? computeTouristTax({
              stay: stayTax,
              nights: nightsInGroup,
              adults: first.nb_adultes,
              children: first.nb_enfants_2_17,
              accommodation,
              start: day(first.date_entree),
            })
          : null;
        const arrival = day(reservation.date_entree),
          departure = day(reservation.date_sortie);
        const start = arrival > period.start ? arrival : period.start;
        const end = departure < period.end ? departure : period.end;
        const nights = Math.max(
          0,
          Math.round((Date.parse(end) - Date.parse(start)) / 86400000),
        );
        const infantsRecorded =
          typeof options.tourist_tax === "object" &&
          options.tourist_tax !== null &&
          Object.hasOwn(options.tourist_tax, "infants");
        const infants = stayTax && infantsRecorded ? stayTax.infants : null;
        const occupants =
          infants === null
            ? null
            : reservation.nb_adultes + reservation.nb_enfants_2_17 + infants;
        const issues: string[] = [];
        const address = [
          reservation.gite?.adresse_ligne1,
          reservation.gite?.adresse_ligne2,
        ]
          .filter(Boolean)
          .join(", ");
        if (!address) issues.push("Adresse du gîte à compléter.");
        issues.push("Numéro d’enregistrement à compléter s’il s’applique.");
        if (!stayTax)
          issues.push(
            "Barème du séjour, collecteur, bébés et exonérations non enregistrés.",
          );
        else if (infants === null)
          issues.push(
            "Nombre de bébés non enregistré ; nombre total de personnes à compléter.",
          );
        if (tax?.issues.length) issues.push(...tax.issues);
        if (group.length > 1)
          issues.push(
            "Séjour regroupé : ventilation entre hébergements et périodes à vérifier.",
          );
        const crossesPeriod = arrival < period.start || departure > period.end;
        if (crossesPeriod)
          issues.push(
            "Séjour à cheval sur plusieurs périodes : affectation de la taxe collectée à compléter sans la compter deux fois.",
          );
        const classified = stayTax?.settings.classified ?? null;
        const flatPrice =
          cents(Number(reservation.prix_par_nuit)) * reservation.nb_nuits ===
            cents(Number(reservation.prix_total)) &&
          Number(reservation.remise_montant) === 0;
        const netCents = tax ? cents(tax.accommodation_amount) : null;
        const nightlyPriceCents =
          flatPrice &&
          group.length === 1 &&
          netCents !== null &&
          reservation.nb_nuits > 0 &&
          netCents % reservation.nb_nuits === 0
            ? netCents / reservation.nb_nuits
            : null;
        if (classified === null)
          issues.push("Classement du gîte au moment du séjour à vérifier.");
        if (classified !== true && nightlyPriceCents === null)
          issues.push(
            "Prix de chaque nuitée hors taxe de séjour à compléter ; aucun prix moyen n’est substitué à un tarif non vérifiable.",
          );
        const reasons = [
          reservation.nb_enfants_2_17 || infants ? "Personnes mineures" : "",
          stayTax?.exemption_reason,
        ]
          .filter(Boolean)
          .join(" ; ");
        const exemptionReason = stayTax
          ? reasons || "Aucune exonération renseignée"
          : null;
        if (stayTax?.collector === "platform")
          issues.push(
            "Taxe collectée par la plateforme : renseigner ses perceptions, sans la présenter comme collectée par l’hébergeur.",
          );
        const entries = (tracking.get(reservation.id)?.entries ?? []).filter(
          (entry) =>
            !entry.voided_at &&
            entry.amount > 0 &&
            (entry.purpose === "tourist_tax" ||
              entry.ota?.category === "tourist_tax"),
        );
        const collections =
          group.length === 1 && stayTax?.collector === "host" ? entries : [];
        if (!collections.length && stayTax?.collector !== "not_applicable")
          issues.push(
            "Date et montant réels de perception de la taxe non identifiés. Un règlement global n’est pas assimilé à une perception de taxe.",
          );
        for (const [collectionIndex, entry] of (collections.length
          ? collections
          : [null]
        ).entries()) {
          const lineIssues = [...issues];
          const collectionDate =
            entry?.paid_on && !entry.paid_on_estimated
              ? parisDate.format(new Date(entry.paid_on))
              : null;
          if (entry && !collectionDate)
            lineIssues.push("Date de perception non enregistrée ou estimée.");
          if ((entry?.refunded_amount ?? 0) > 0)
            lineIssues.push(
              "Remboursement présent : perception nette et date du remboursement à vérifier.",
            );
          const collectedTaxCents =
            entry && !crossesPeriod && !(entry.refunded_amount ?? 0)
              ? (entry.ota?.grossCents ?? cents(entry.amount))
              : stayTax?.collector === "not_applicable"
                ? 0
                : null;
          const additionalTaxes =
            stayTax?.collector === "not_applicable"
              ? "Sans perception : non-application déclarée"
              : stayTax?.settings.additional_percentage === 0
                ? "Aucune selon le barème enregistré"
                : null;
          if (!additionalTaxes)
            lineIssues.push(
              "Ventilation et montants collectés par taxe additionnelle à compléter s’ils s’appliquent.",
            );
          const operationIssues = evaluated.rows
            .filter(
              (row) =>
                row.reservationId === reservation.id && row.status === "review",
            )
            .flatMap((row) => row.issues.map((issue) => issue.message));
          lineIssues.push(...operationIssues);
          rows.push({
            reference: `Séjour ${index + 1}${collections.length > 1 ? ` / perception ${collectionIndex + 1}` : ""}`,
            reservationId: reservation.id,
            propertyId: reservation.gite_id!,
            propertyName: reservation.gite?.nom ?? "Gîte à vérifier",
            address,
            registrationNumber: null,
            arrival,
            departure,
            periodStart: start,
            periodEnd: end,
            collectionDate,
            collector: stayTax?.collector ?? "unknown",
            adults: reservation.nb_adultes,
            children: reservation.nb_enfants_2_17,
            infants,
            occupants,
            nights,
            personNights: occupants === null ? null : occupants * nights,
            classified,
            nightlyPriceCents,
            collectedTaxCents,
            collectedBaseTaxCents:
              stayTax?.collector === "not_applicable" ||
              stayTax?.settings.additional_percentage === 0
                ? collectedTaxCents
                : null,
            calculatedStayTaxCents: tax ? cents(tax.amount) : null,
            additionalTaxes,
            exemptionReason,
            source:
              evaluated.rows.find((row) => row.reservationId === reservation.id)
                ?.bookingSource ??
              evaluated.rows.find((row) => row.reservationId === reservation.id)
                ?.channel ??
              "",
            issues: [...new Set(lineIssues)],
          });
        }
      }
      rows.sort(
        (a, b) =>
          (a.collectionDate ?? "9999").localeCompare(
            b.collectionDate ?? "9999",
          ) ||
          a.arrival.localeCompare(b.arrival) ||
          a.reference.localeCompare(b.reference, "fr", { numeric: true }),
      );
      return {
        reportId,
        reportName: report.name,
        recipient: report.recipient,
        period: { label: period.label, start: period.start, end: period.end },
        generatedAt: new Date().toISOString(),
        revision: createHash("sha256")
          .update(
            JSON.stringify({
              report,
              rows,
              properties,
              factsRevision: facts.factsRevision,
              revision: store!.revision,
            }),
          )
          .digest("hex"),
        reportNights: evaluated.total,
        stayCount: reservations.length,
        incompleteCount: new Set(
          rows
            .filter((row) => row.issues.length)
            .map((row) => row.reservationId),
        ).size,
        properties,
        rows,
      };
    },
    { timeout: 60_000 },
  );
}
