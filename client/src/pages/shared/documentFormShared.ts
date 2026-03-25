import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { isAbortError, apiFetch } from "../../utils/api";
import type { ContratOptions, Gite, Reservation } from "../../utils/types";
import { mergeOptions, toDateInputValue } from "./rentalForm";

type UseDocumentGitesParams = {
  setSelectedGiteId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export type ReservationDocumentPrefill = {
  linkedReservationId: string;
  giteId: string;
  locataireNom: string;
  locataireAdresse: string;
  locataireTel: string;
  locataireEmail: string;
  nbAdultes: number;
  nbEnfants: number;
  dateDebut: string;
  dateFin: string;
  prixParNuit: number;
  remiseValue: string;
  options: ContratOptions;
};

export const useDocumentGites = ({ setSelectedGiteId, setError }: UseDocumentGitesParams) => {
  const [gites, setGites] = useState<Gite[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<Gite[]>("/gites", { signal: controller.signal })
      .then((data) => {
        setGites(data);
        if (data[0]) {
          setSelectedGiteId((current) => current || data[0].id);
        }
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Erreur lors du chargement des gîtes.");
      });

    return () => {
      controller.abort();
    };
  }, [setError, setSelectedGiteId]);

  return gites;
};

export const buildReservationDocumentPrefill = (reservation: Reservation): ReservationDocumentPrefill => {
  if (!reservation.gite_id) {
    throw new Error("La réservation sélectionnée n'est pas rattachée à un gîte.");
  }

  return {
    linkedReservationId: reservation.id,
    giteId: reservation.gite_id,
    locataireNom: reservation.hote_nom,
    locataireAdresse: "",
    locataireTel: reservation.telephone ?? "",
    locataireEmail: reservation.email ?? "",
    nbAdultes: Math.max(1, reservation.nb_adultes ?? 1),
    nbEnfants: 0,
    dateDebut: toDateInputValue(reservation.date_entree),
    dateFin: toDateInputValue(reservation.date_sortie),
    prixParNuit: Number(reservation.prix_par_nuit ?? 0),
    remiseValue: reservation.remise_montant ? String(reservation.remise_montant) : "",
    options: mergeOptions(reservation.options),
  };
};

export const isDocumentDateRangeValid = (dateDebut: string, dateFin: string) => {
  if (!dateDebut || !dateFin) return false;

  const start = new Date(dateDebut);
  const end = new Date(dateFin);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  return end > start;
};
