import prisma from "../db/prisma.js";
import { type OptionsInput } from "./contractCalculator.js";
import { sanitizeReservationAmount } from "./reservationPricing.js";
import { round2 } from "../utils/money.js";
import { encodeJsonField } from "../utils/jsonFields.js";
import { buildReservationOriginData } from "../utils/reservationOrigin.js";

type SyncReservationFromDocumentParams = {
  explicitReservationId?: string | null;
  existingReservationId?: string | null;
  giteId: string;
  locataireNom: string;
  locataireTel: string;
  locataireEmail?: string | null;
  dateDebut: Date;
  dateFin: Date;
  nbNuits: number;
  nbAdultes: number;
  prixParNuit: number;
  prixTotal: number;
  remiseMontant: number;
  options: OptionsInput;
  optionsTotal: number;
};

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const toReservationOptionsSummary = (options: OptionsInput) => {
  const labels: string[] = [];
  const declarationFlags: boolean[] = [];

  if (options.draps?.enabled) {
    labels.push(`Draps x${Math.max(0, Math.round(options.draps.nb_lits ?? 0))}${options.draps.offert ? " offerts" : ""}`);
    declarationFlags.push(Boolean(options.draps.declared));
  }
  if (options.linge_toilette?.enabled) {
    labels.push(
      `Linge x${Math.max(0, Math.round(options.linge_toilette.nb_personnes ?? 0))}${
        options.linge_toilette.offert ? " offert" : ""
      }`
    );
    declarationFlags.push(Boolean(options.linge_toilette.declared));
  }
  if (options.menage?.enabled) {
    labels.push(`Ménage${options.menage.offert ? " offert" : ""}`);
    declarationFlags.push(Boolean(options.menage.declared));
  }
  if (options.depart_tardif?.enabled) {
    labels.push(`Départ tardif${options.depart_tardif.offert ? " offert" : ""}`);
    declarationFlags.push(Boolean(options.depart_tardif.declared));
  }
  if (options.chiens?.enabled) {
    labels.push(`Chiens x${Math.max(0, Math.round(options.chiens.nb ?? 0))}${options.chiens.offert ? " offerts" : ""}`);
    declarationFlags.push(Boolean(options.chiens.declared));
  }

  return {
    label: labels.join(" · "),
    allDeclared: declarationFlags.length > 0 && declarationFlags.every(Boolean),
  };
};

const isSameDate = (left: Date | string, right: Date | string) => new Date(left).getTime() === new Date(right).getTime();

export const syncReservationFromDocument = async (params: SyncReservationFromDocumentParams) => {
  const {
    explicitReservationId,
    existingReservationId,
    giteId,
    locataireNom,
    locataireTel,
    locataireEmail,
    dateDebut,
    dateFin,
    nbNuits,
    nbAdultes,
    prixParNuit,
    prixTotal,
    remiseMontant,
    options,
    optionsTotal,
  } = params;
  const sourceReservationId = explicitReservationId ?? existingReservationId ?? null;
  const normalizedHost = normalizeTextKey(locataireNom);
  const summary = toReservationOptionsSummary(options);

  let targetReservationId: string | null = null;
  if (sourceReservationId) {
    const linked = await prisma.reservation.findUnique({
      where: { id: sourceReservationId },
      select: {
        id: true,
        gite_id: true,
      },
    });
    if (linked && (!linked.gite_id || linked.gite_id === giteId)) {
      targetReservationId = linked.id;
    }
  }

  if (!targetReservationId) {
    const overlaps = await prisma.reservation.findMany({
      where: {
        gite_id: giteId,
        date_entree: { lt: dateFin },
        date_sortie: { gt: dateDebut },
      },
      orderBy: [{ date_entree: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        hote_nom: true,
        date_entree: true,
        date_sortie: true,
      },
    });

    const exactHostAndDates = overlaps.find(
      (reservation) =>
        normalizeTextKey(reservation.hote_nom) === normalizedHost &&
        isSameDate(reservation.date_entree, dateDebut) &&
        isSameDate(reservation.date_sortie, dateFin)
    );
    const exactDates = overlaps.find(
      (reservation) => isSameDate(reservation.date_entree, dateDebut) && isSameDate(reservation.date_sortie, dateFin)
    );
    const hostOverlap = overlaps.find((reservation) => normalizeTextKey(reservation.hote_nom) === normalizedHost);
    const fallback = overlaps.length === 1 ? overlaps[0] : null;

    targetReservationId = exactHostAndDates?.id ?? exactDates?.id ?? hostOverlap?.id ?? fallback?.id ?? null;
  }

  const normalizedOptionsTotal = sanitizeReservationAmount(optionsTotal);
  const normalizedRemiseMontant = sanitizeReservationAmount(remiseMontant);

  const reservationData = {
    gite_id: giteId,
    placeholder_id: null,
    hote_nom: locataireNom,
    telephone: locataireTel.trim() || null,
    email: locataireEmail?.trim() || null,
    date_entree: dateDebut,
    date_sortie: dateFin,
    nb_nuits: nbNuits,
    nb_adultes: nbAdultes,
    prix_par_nuit: round2(prixParNuit),
    prix_total: round2(prixTotal),
    remise_montant: round2(normalizedRemiseMontant),
    frais_optionnels_montant: round2(normalizedOptionsTotal),
    frais_optionnels_libelle: summary.label || null,
    frais_optionnels_declares: summary.allDeclared,
    options: encodeJsonField(options),
  };

  if (targetReservationId) {
    const updated = await prisma.reservation.update({
      where: { id: targetReservationId },
      data: reservationData,
      select: { id: true },
    });
    return updated.id;
  }

  const created = await prisma.reservation.create({
    data: {
      ...buildReservationOriginData({ originSystem: "app", exportToIcal: true }),
      ...reservationData,
      source_paiement: "A définir",
      commentaire: null,
    },
    select: { id: true },
  });
  return created.id;
};
