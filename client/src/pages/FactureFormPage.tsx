import { applyIndividualVatPreset, changedVatLineIds, individualVatPresetHint, type AppliedInvoiceVatPresets } from "./shared/invoiceVatPreset";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultInvoiceTheme, resolveInvoiceTheme, type InvoiceThemeId, type InvoiceFiscalInput, type InvoiceFiscalLine } from "@contrats/shared";
import InvoiceThemePicker from "./shared/InvoiceThemePicker";
import { reconcileInvoiceGeneratedLines, shouldSyncInvoiceGeneratedLines } from "./shared/invoiceFormLines";
import { createInvoiceFormInput } from "./shared/invoiceFormDefaults";
import { invoiceReservationPrefill } from "./shared/invoiceReservationPrefill";
import InvoiceBuyerEditor from "./shared/InvoiceBuyerEditor";
import InvoiceCompletionAssistant from "./shared/InvoiceCompletionAssistant";
import InvoiceFormHeader from "./shared/InvoiceFormHeader";
import { focusInvoiceField, invoiceFormCompletion, type InvoiceValidationOptions } from "./shared/invoiceFormCompletion";
import InvoiceFiscalEditor from "./shared/InvoiceFiscalEditor";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Contrat, Facture, ContratOptions, Reservation } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  addDays,
  defaultOptions,
  extractValidationFieldErrors,
  formatDateInput,
  mergeOptions,
  nextDayFromInput,
  nightsBetweenInputs,
  toDateInputValue,
} from "./shared/rentalForm";
import DocumentPreviewFrame from "./shared/DocumentPreviewFrame";
import { buildReservationDocumentPrefill, isDocumentDateRangeValid, useDocumentGites } from "./shared/documentFormShared";
import { useDocumentFieldErrors } from "./shared/useDocumentFieldErrors";
import { type RuleOptionKey, type ServiceOptionKey, useRentalFormPricing } from "./shared/rentalFormPricing";
import { useHtmlPreview } from "./shared/useHtmlPreview";
import { useDocumentSubmit } from "./shared/useDocumentSubmit";
const INVOICE_GUARANTEE_AMOUNT = 0;

type InvoiceExtraFeeRow = {
  id: string;
  libelle: string;
  montant: string;
  source_reservation_id?: string;
};

const createInvoiceExtraFeeRow = (values?: { libelle?: string | null; montant?: number | string | null; source_reservation_id?: string }): InvoiceExtraFeeRow => ({
  id:
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  libelle: values?.libelle ?? "",
  source_reservation_id: values?.source_reservation_id,
  montant:
    values?.montant === null || values?.montant === undefined || Number(values.montant) === 0
      ? ""
      : String(values.montant),
});

const normalizeInvoiceExtraFees = (rows: InvoiceExtraFeeRow[]) =>
  rows
    .map((row) => ({
      libelle: row.libelle.trim() || "Frais complémentaires",
      montant: Math.round(Number(row.montant || 0) * 100) / 100,
      ...(row.source_reservation_id ? { source_reservation_id: row.source_reservation_id } : {}),
    }))
    .filter((fee) => Number.isFinite(fee.montant) && fee.montant > 0);

type ContractFieldKey =
  | "gite_id"
  | "locataire_nom"
  | "locataire_adresse"
  | "locataire_tel"
  | "locataire_email"
  | "date_debut"
  | "heure_arrivee"
  | "date_fin"
  | "heure_depart"
  | "prix_par_nuit"
  | "remise_montant"
  | "arrhes_montant"
  | "arrhes_date_limite"
  | "statut_paiement";

type FieldErrors = Partial<Record<ContractFieldKey, string>>;

const contractFieldKeys: ContractFieldKey[] = [
  "gite_id",
  "locataire_nom",
  "locataire_adresse",
  "locataire_tel",
  "locataire_email",
  "date_debut",
  "heure_arrivee",
  "date_fin",
  "heure_depart",
  "prix_par_nuit",
  "remise_montant",
  "arrhes_montant",
  "arrhes_date_limite",
  "statut_paiement",
];

const contractFieldKeySet = new Set<ContractFieldKey>(contractFieldKeys);

const getValidationFieldErrors = (error: unknown): FieldErrors =>
  extractValidationFieldErrors(error, contractFieldKeySet, "date_fin");

const FactureFormPage = () => {
  const [fiscalInput, setFiscalInput] = useState<InvoiceFiscalInput>(createInvoiceFormInput);
  const [invoiceTheme, setInvoiceTheme] = useState<InvoiceThemeId>(defaultInvoiceTheme);
  const [savedDraft, setSavedDraft] = useState<Facture | null>(null);
  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null);
  const [linesManual, setLinesManual] = useState(false);
  const [preparingLines, setPreparingLines] = useState(false);
  const [linesRetry, setLinesRetry] = useState(0);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [validationOptions, setValidationOptions] = useState<InvoiceValidationOptions>({});
  const [validationGiteId, setValidationGiteId] = useState("");
  const appliedVatPresetsRef = useRef<AppliedInvoiceVatPresets>({});
  const touchedVatLinesRef = useRef(new Map<string, InvoiceFiscalLine>());
  const proposedLinesRef = useRef<InvoiceFiscalLine[]>();
  const reservationPickerButtonRef = useRef<HTMLButtonElement>(null);
  const currentFiscalRef = useRef(fiscalInput);
  currentFiscalRef.current = fiscalInput;
  const pricedGiteRef = useRef<string | null>(null);
  const fiscalContextRef = useRef<string | null>(null);
  const handledHashNavigationRef = useRef<string | null>(null);
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const fromContractId = (searchParams.get("fromContractId") ?? "").trim();
  const fromReservationId = (searchParams.get("fromReservationId") ?? "").trim();
  useEffect(() => { if (!isEdit) setInvoiceTheme(defaultInvoiceTheme); }, [isEdit, fromContractId, fromReservationId]);
  const [giteId, setGiteId] = useState("");
  const [locataireNom, setLocataireNom] = useState("");
  const [locataireAdresse, setLocataireAdresse] = useState("");
  const [locataireTel, setLocataireTel] = useState("");
  const [locataireEmail, setLocataireEmail] = useState("");
  const [nbAdultes, setNbAdultes] = useState(1);
  const [nbEnfants, setNbEnfants] = useState(0);
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [heureArrivee, setHeureArrivee] = useState("17:00");
  const [heureDepart, setHeureDepart] = useState("12:00");
  const [prixParNuit, setPrixParNuit] = useState(0);
  const [remiseMode, setRemiseMode] = useState<"euro" | "percent">("euro");
  const [remiseValue, setRemiseValue] = useState("");
  const [remiseReason, setRemiseReason] = useState("");
  const [fraisSupplementaires, setFraisSupplementaires] = useState<InvoiceExtraFeeRow[]>([]);
  const [options, setOptions] = useState<ContratOptions>(defaultOptions);
  const [arrhesDateLimite, setArrhesDateLimite] = useState("");
  const [clausesText, setClausesText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [createdContract, setCreatedContract] = useState<Facture | null>(null);
  const [createdPayloadKey, setCreatedPayloadKey] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState<Facture | null>(null);
  const [loadingContract, setLoadingContract] = useState(false);
  const [loadingFromContract, setLoadingFromContract] = useState(false);
  const [sourceContractNumber, setSourceContractNumber] = useState<string | null>(null);
  const [prefilledContractGiteId, setPrefilledContractGiteId] = useState<string | null>(null);
  const [loadingFromReservation, setLoadingFromReservation] = useState(false);
  const [sourceReservationLabel, setSourceReservationLabel] = useState<string | null>(null);
  const [prefilledReservationGiteId, setPrefilledReservationGiteId] = useState<string | null>(null);
  const [linkedReservationId, setLinkedReservationId] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [existingInvoices, setExistingInvoices] = useState<Facture[]>([]);
  const [selectedReservationIds, setSelectedReservationIds] = useState<string[]>([]);
  const [reservationSearch, setReservationSearch] = useState("");
  const [reservationPickerOpen, setReservationPickerOpen] = useState(false);
  const gites = useDocumentGites({
    setSelectedGiteId: setGiteId,
    setError,
  });
  const isMultiReservation = selectedReservationIds.length >= 2;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiFetch<Reservation[]>("/reservations/invoice-options", { signal: controller.signal }),
      apiFetch<Facture[]>("/invoices", { signal: controller.signal }),
    ])
      .then(([reservationData, invoiceData]) => {
        setReservations(reservationData);
        setExistingInvoices(invoiceData);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(err instanceof Error ? err.message : "Erreur lors du chargement des réservations.");
      });
    return () => controller.abort();
  }, []);

  const invoiceByReservationId = useMemo(() => {
    const links = new Map<string, Facture>();
    existingInvoices.forEach((invoice) => {
      if (invoice.document_kind === "credit_note") return;
      if (invoice.id === id) return;
      if (invoice.reservation_id) links.set(invoice.reservation_id, invoice);
      invoice.reservation_items?.forEach((item) => links.set(item.reservation_id, invoice));
    });
    return links;
  }, [existingInvoices, id]);

  const filteredReservations = useMemo(() => {
    const query = reservationSearch.trim().toLocaleLowerCase("fr");
    return reservations
      .filter((reservation) => reservation.gite_id)
      .filter((reservation) => {
        if (!query) return true;
        return [reservation.hote_nom, reservation.gite?.nom, reservation.date_entree, reservation.date_sortie]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("fr").includes(query));
      })
      .slice(0, 80);
  }, [reservations, reservationSearch]);

  const selectedReservations = useMemo(
    () => selectedReservationIds.map((reservationId) => reservations.find((item) => item.id === reservationId)).filter((item): item is Reservation => Boolean(item)),
    [reservations, selectedReservationIds]
  );
  const selectedReservationsTotal = useMemo(
    () => selectedReservations.reduce(
      (sum, reservation) => sum + Number(reservation.prix_total ?? 0) - Number(reservation.remise_montant ?? 0) + Number(reservation.frais_optionnels_montant ?? 0),
      0
    ),
    [selectedReservations]
  );
  const selectedReservationsNights = useMemo(
    () => selectedReservations.reduce((sum, reservation) => sum + Number(reservation.nb_nuits ?? 0), 0),
    [selectedReservations]
  );

  const applyReservationSelection = (ids: string[]) => {
    const selected = ids.map((reservationId) => reservations.find((item) => item.id === reservationId)).filter((item): item is Reservation => Boolean(item));
    setSelectedReservationIds(ids);
    setLinkedReservationId(ids[0] ?? null);
    if (!selected.length) return;
    setFraisSupplementaires((previous) => previous.filter((row) => !row.source_reservation_id));

    const first = selected[0];
    const prefill = buildReservationDocumentPrefill(first);
    setGiteId(prefill.giteId);
    if (ids.length === 1 || !locataireNom.trim()) {
      setLocataireNom(prefill.locataireNom);
      setLocataireTel(prefill.locataireTel);
      setLocataireEmail(prefill.locataireEmail);
    }
    setDateDebut(selected.map((item) => toDateInputValue(item.date_entree)).sort()[0]);
    setDateFin(selected.map((item) => toDateInputValue(item.date_sortie)).sort().at(-1) ?? prefill.dateFin);
    setNbAdultes(ids.length === 1 ? prefill.nbAdultes : 1);
    setNbEnfants(ids.length === 1 ? prefill.nbEnfants : 0);
    setPrixParNuit(prefill.prixParNuit);
    setRemiseMode("euro");
    setRemiseValue(ids.length === 1 ? prefill.remiseValue : "");
    const invoicePrefill = invoiceReservationPrefill(first, gites.find((gite) => gite.id === first.gite_id));
    setOptions(ids.length === 1 ? invoicePrefill.options : defaultOptions);
    if (ids.length === 1) setFraisSupplementaires((previous) => [
      ...previous,
      ...invoicePrefill.fees.map((fee) => createInvoiceExtraFeeRow({ ...fee, source_reservation_id: first.id })),
    ]);
  };

  const toggleReservation = (reservationId: string) => {
    const next = selectedReservationIds.includes(reservationId)
      ? selectedReservationIds.filter((id) => id !== reservationId)
      : [...selectedReservationIds, reservationId];
    applyReservationSelection(next);
    setReservationPickerOpen(false);
    setReservationSearch("");
    reservationPickerButtonRef.current?.focus({ preventScroll: true });
  };

  const minDateFin = useMemo(() => {
    if (!dateDebut) return undefined;
    return nextDayFromInput(dateDebut) || undefined;
  }, [dateDebut]);

  const nbNuitsSelection = useMemo(() => nightsBetweenInputs(dateDebut, dateFin), [dateDebut, dateFin]);

  useEffect(() => {
    if (!isEdit || !id) return;
    const controller = new AbortController();
    let active = true;
    setLoadingContract(true);
    apiFetch<Facture>(`/invoices/${id}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setEditingContract(data);
        proposedLinesRef.current = undefined;
        appliedVatPresetsRef.current = {};
        touchedVatLinesRef.current.clear();
        setFiscalInput(data.fiscal_input ?? createInvoiceFormInput());
        setInvoiceTheme(resolveInvoiceTheme(data.clauses));
        setLinesManual(Boolean(data.fiscal_input?.lines.length));
        setGiteId(data.gite_id);
        setLocataireNom(data.locataire_nom);
        setLocataireAdresse(data.locataire_adresse);
        setLocataireTel(data.locataire_tel);
        setLocataireEmail(data.locataire_email ?? "");
        setNbAdultes(data.nb_adultes);
        setNbEnfants(data.nb_enfants_2_17);
        setDateDebut(toDateInputValue(data.date_debut));
        setDateFin(toDateInputValue(data.date_fin));
        setHeureArrivee(data.heure_arrivee);
        setHeureDepart(data.heure_depart);
        setPrixParNuit(Number(data.prix_par_nuit ?? 0));
        setRemiseMode("euro");
        setRemiseValue(data.remise_montant ? String(data.remise_montant) : "");
        setRemiseReason(typeof data.clauses?.remise_raison === "string" ? data.clauses.remise_raison : "");
        setFraisSupplementaires((data.frais_supplementaires ?? []).map((fee) => createInvoiceExtraFeeRow(fee)));
        setOptions(mergeOptions(data.options));
        setArrhesDateLimite(toDateInputValue(data.arrhes_date_limite));
        setClausesText(typeof data.clauses?.texte_additionnel === "string" ? data.clauses.texte_additionnel : "");

        setSourceContractNumber(null);
        setPrefilledContractGiteId(null);
        setSourceReservationLabel(null);
        setPrefilledReservationGiteId(null);
        setLinkedReservationId(data.reservation_id ?? null);
        setSelectedReservationIds(
          data.reservation_items?.length
            ? data.reservation_items.map((item) => item.reservation_id)
            : data.reservation_id
              ? [data.reservation_id]
              : []
        );
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Erreur lors du chargement de la facture.");
      })
      .finally(() => {
        if (!active) return;
        setLoadingContract(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, isEdit]);

  useEffect(() => {
    if (isEdit || !fromContractId) return;
    const controller = new AbortController();
    let active = true;
    setError(null);
    setSourceContractNumber(null);
    setPrefilledContractGiteId(null);
    setClausesText("");
    setLoadingFromContract(true);
    apiFetch<Contrat>(`/contracts/${fromContractId}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setSourceContractNumber(data.numero_contrat);
        setPrefilledContractGiteId(data.gite_id);
        setGiteId(data.gite_id);
        setLocataireNom(data.locataire_nom);
        setLocataireAdresse(data.locataire_adresse);
        setLocataireTel(data.locataire_tel);
        setLocataireEmail(data.locataire_email ?? "");
        setNbAdultes(data.nb_adultes);
        setNbEnfants(data.nb_enfants_2_17);
        setDateDebut(toDateInputValue(data.date_debut));
        setDateFin(toDateInputValue(data.date_fin));
        setHeureArrivee(data.heure_arrivee);
        setHeureDepart(data.heure_depart);
        setPrixParNuit(Number(data.prix_par_nuit ?? 0));
        setRemiseMode("euro");
        setRemiseValue(data.remise_montant ? String(data.remise_montant) : "");
        setRemiseReason(typeof data.clauses?.remise_raison === "string" ? data.clauses.remise_raison : "");
        setFraisSupplementaires([]);
        setOptions(mergeOptions(data.options));
        setArrhesDateLimite(toDateInputValue(data.arrhes_date_limite));
        setClausesText("");
        setSourceReservationLabel(null);
        setPrefilledReservationGiteId(null);
        setLinkedReservationId(data.reservation_id ?? null);
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setSourceContractNumber(null);
        setPrefilledContractGiteId(null);
        setLinkedReservationId(null);
        setLocataireEmail("");
        setError(err instanceof Error ? err.message : "Erreur lors du préremplissage depuis le contrat.");
      })
      .finally(() => {
        if (!active) return;
        setLoadingFromContract(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isEdit, fromContractId]);

  useEffect(() => {
    if (isEdit || fromContractId || fromReservationId) return;
    setSourceContractNumber(null);
    setPrefilledContractGiteId(null);
    setLoadingFromContract(false);
    setSourceReservationLabel(null);
    setPrefilledReservationGiteId(null);
    setLoadingFromReservation(false);
    setLinkedReservationId(null);
    setSelectedReservationIds([]);
    setLocataireEmail("");
    setFraisSupplementaires([]);
  }, [isEdit, fromContractId, fromReservationId]);

  useEffect(() => {
    if (isEdit || fromContractId || !fromReservationId || !gites.length) return;
    const controller = new AbortController();
    let active = true;
    setError(null);
    setSourceContractNumber(null);
    setPrefilledContractGiteId(null);
    setSourceReservationLabel(null);
    setPrefilledReservationGiteId(null);
    setLoadingFromReservation(true);
    apiFetch<Reservation>(`/reservations/prefill/${fromReservationId}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        const prefill = buildReservationDocumentPrefill(data);
        setLinkedReservationId(prefill.linkedReservationId);
        setSelectedReservationIds([prefill.linkedReservationId]);
        setSourceReservationLabel(data.hote_nom);
        setPrefilledReservationGiteId(prefill.giteId);
        setGiteId(prefill.giteId);
        setLocataireNom(prefill.locataireNom);
        setLocataireAdresse(prefill.locataireAdresse);
        setLocataireTel(prefill.locataireTel);
        setLocataireEmail(prefill.locataireEmail);
        setNbAdultes(prefill.nbAdultes);
        setNbEnfants(prefill.nbEnfants);
        setDateDebut(prefill.dateDebut);
        setDateFin(prefill.dateFin);
        setPrixParNuit(prefill.prixParNuit);
        setRemiseMode("euro");
        setRemiseValue(prefill.remiseValue);
        setRemiseReason("");
        const invoicePrefill = invoiceReservationPrefill(data, gites.find((gite) => gite.id === prefill.giteId));
        setFraisSupplementaires(invoicePrefill.fees.map((fee) => createInvoiceExtraFeeRow({ ...fee, source_reservation_id: data.id })));
        setOptions(invoicePrefill.options);
        setClausesText("");
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setLinkedReservationId(null);
        setSourceReservationLabel(null);
        setPrefilledReservationGiteId(null);
        setLocataireEmail("");
        setError(err instanceof Error ? err.message : "Erreur lors du préremplissage depuis la réservation.");
      })
      .finally(() => {
        if (!active) return;
        setLoadingFromReservation(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isEdit, fromContractId, fromReservationId, gites]);

  const {
    selectedGite,
    prixNuitListe,
    remiseMontant,
    totals,
    drapsTarif,
    lingeTarif,
    menageTarif,
    departTardifTarif,
    chiensTarif,
    regleAnimauxAcceptes,
    regleBoisPremiereFlambee,
    regleTiersPersonnesInfo,
  } = useRentalFormPricing({
    gites,
    giteId,
    dateDebut,
    dateFin,
    prixParNuit,
    remiseMode,
    remiseValue,
    nbAdultes,
    nbEnfants,
    arrhesMontant: String(fiscalInput.paid_amount),
    options,
  });

  const effectiveHeureArrivee = heureArrivee || selectedGite?.heure_arrivee_defaut || "17:00";
  const effectiveHeureDepart = heureDepart || selectedGite?.heure_depart_defaut || "12:00";

  const updateOption = (key: ServiceOptionKey, value: any) => {
    setOptions((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  };

  const updateRule = (key: RuleOptionKey, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const addFraisSupplementaire = () => {
    setFraisSupplementaires((prev) => [...prev, createInvoiceExtraFeeRow()]);
  };

  const updateFraisSupplementaire = (id: string, value: Partial<Omit<InvoiceExtraFeeRow, "id">>) => {
    setFraisSupplementaires((prev) => prev.map((row) => (row.id === id ? { ...row, ...value } : row)));
  };

  const removeFraisSupplementaire = (id: string) => {
    setFraisSupplementaires((prev) => prev.filter((row) => row.id !== id));
  };

  const fraisSupplementairesPayload = useMemo(
    () => normalizeInvoiceExtraFees(fraisSupplementaires),
    [fraisSupplementaires]
  );

  const fraisSupplementairesTotal = useMemo(
    () => fraisSupplementairesPayload.reduce((sum, fee) => sum + fee.montant, 0),
    [fraisSupplementairesPayload]
  );

  useEffect(() => {
    if (!selectedGite || pricedGiteRef.current === selectedGite.id) return;
    pricedGiteRef.current = selectedGite.id;
    if (isEdit || fromContractId || fromReservationId || selectedReservationIds.length) return;
    if (prixNuitListe.length) setPrixParNuit(prixNuitListe[0]);
  }, [selectedGite, prixNuitListe, isEdit, fromContractId, fromReservationId, selectedReservationIds.length]);

  useEffect(() => {
    if (!selectedGite) return;
    if (isEdit && editingContract && selectedGite.id === editingContract.gite_id) return;
    if (
      !isEdit &&
      ((prefilledContractGiteId && selectedGite.id === prefilledContractGiteId) ||
        (prefilledReservationGiteId && selectedGite.id === prefilledReservationGiteId))
    ) {
      return;
    }
    setHeureArrivee(selectedGite.heure_arrivee_defaut || "17:00");
    setHeureDepart(selectedGite.heure_depart_defaut || "12:00");
  }, [selectedGite, isEdit, editingContract, prefilledContractGiteId, prefilledReservationGiteId]);

  useEffect(() => {
    if (!selectedGite) return;
    if (isEdit && editingContract && selectedGite.id === editingContract.gite_id) return;
    if (
      !isEdit &&
      ((prefilledContractGiteId && selectedGite.id === prefilledContractGiteId) ||
        (prefilledReservationGiteId && selectedGite.id === prefilledReservationGiteId))
    ) {
      return;
    }
    setOptions((prev) => ({
      ...prev,
      regle_animaux_acceptes: selectedGite.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selectedGite.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selectedGite.regle_tiers_personnes_info,
    }));
  }, [selectedGite?.id, isEdit, editingContract, prefilledContractGiteId, prefilledReservationGiteId]);

  useEffect(() => {
    if (regleAnimauxAcceptes) return;
    setOptions((prev) => {
      const chiens = prev.chiens ?? { enabled: false, nb: 0, offert: false };
      if (!chiens.enabled && !chiens.offert && (chiens.nb ?? 0) === 0) return prev;
      return { ...prev, chiens: { ...chiens, enabled: false, offert: false, nb: 0 } };
    });
  }, [regleAnimauxAcceptes]);

  useEffect(() => {
    if (!arrhesDateLimite) {
      setArrhesDateLimite(formatDateInput(addDays(new Date(), 15)));
    }
  }, [arrhesDateLimite]);

  const clausesPayload = useMemo(() => {
    const next: Record<string, unknown> = { invoice_theme: invoiceTheme };
    const trimmedAdditionalText = clausesText.trim();
    const trimmedRemiseReason = remiseReason.trim();

    if (trimmedAdditionalText) next.texte_additionnel = trimmedAdditionalText;
    if (trimmedRemiseReason) next.remise_raison = trimmedRemiseReason;

    return next;
  }, [clausesText, remiseReason, invoiceTheme]);

  const expectedTotal = (isMultiReservation ? selectedReservationsTotal : totals?.totalGlobal ?? 0) + fraisSupplementairesTotal;
  const draftReady = Boolean(giteId && locataireNom.trim() && dateDebut && dateFin && dateFin > dateDebut);
  const previewPayload = useMemo(() => {
    const payload: any = {
      fiscal_input: fiscalInput,
      gite_id: giteId,
      locataire_nom: locataireNom,
      locataire_adresse: [fiscalInput.buyer.address_line1, fiscalInput.buyer.address_line2, fiscalInput.buyer.postal_code, fiscalInput.buyer.city, fiscalInput.buyer.country_code].filter(Boolean).join(" · "),
      locataire_tel: locataireTel,
      locataire_email: locataireEmail,
      nb_adultes: nbAdultes,
      nb_enfants_2_17: nbEnfants,
      date_debut: dateDebut,
      heure_arrivee: effectiveHeureArrivee,
      date_fin: dateFin,
      heure_depart: effectiveHeureDepart,
      prix_par_nuit: prixParNuit,
      remise_montant: remiseMontant,
      frais_supplementaires: fraisSupplementairesPayload,
      options,
      arrhes_montant: fiscalInput.paid_amount,
      arrhes_date_limite: fiscalInput.payment_due_date || arrhesDateLimite,
      caution_montant: INVOICE_GUARANTEE_AMOUNT,
      cheque_menage_montant: INVOICE_GUARANTEE_AMOUNT,
      afficher_caution_phrase: false,
      afficher_cheque_menage_phrase: false,
      clauses: clausesPayload,
      statut_paiement: fiscalInput.paid_amount >= expectedTotal ? "reglee" : "non_reglee",
      reservation_id: linkedReservationId,
      reservation_ids: selectedReservationIds,
    };

    return payload;
  }, [
    fiscalInput,
    giteId,
    locataireNom,
    locataireTel,
    locataireEmail,
    nbAdultes,
    nbEnfants,
    dateDebut,
    effectiveHeureArrivee,
    dateFin,
    effectiveHeureDepart,
    prixParNuit,
    remiseMontant,
    fraisSupplementairesPayload,
    options,
    arrhesDateLimite,
    clausesPayload,
    expectedTotal,
    linkedReservationId,
    selectedReservationIds,
  ]);

  useEffect(() => {
    if (!locataireAdresse) return;
    setFiscalInput((previous) => previous.buyer.address_line1 ? previous : { ...previous, buyer: { ...previous.buyer, address_line1: locataireAdresse } });
  }, [locataireAdresse]);

  const pricingContextKey = JSON.stringify({ gite_id: giteId, date_debut: dateDebut, date_fin: dateFin, prix_par_nuit: prixParNuit,
    remise_montant: remiseMontant, options, frais_supplementaires: fraisSupplementairesPayload, reservation_ids: selectedReservationIds,
    nb_adultes: nbAdultes, nb_enfants_2_17: nbEnfants });
  const fiscalSourceReady = !isEdit || Boolean(editingContract);
  useEffect(() => {
    const pricingContext = JSON.parse(pricingContextKey);
    if (!pricingContext.gite_id || !pricingContext.date_debut || !pricingContext.date_fin ||
      pricingContext.date_fin <= pricingContext.date_debut || !fiscalSourceReady || loadingFromContract || loadingFromReservation) {
      setPreparingLines(false);
      return;
    }
    const controller = new AbortController();
    setPreparingLines(true);
    setLinesError(null);
    const timer = window.setTimeout(() => {
      apiFetch<{ fiscal_input: InvoiceFiscalInput; validation_options: InvoiceValidationOptions }>("/invoices/fiscal-preview", {
        method: "POST", json: pricingContext, signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return;
        setValidationOptions(result.validation_options);
        setValidationGiteId(pricingContext.gite_id);
        const baseline = proposedLinesRef.current;
        const proposed = result.fiscal_input.lines;
        const shouldSync = shouldSyncInvoiceGeneratedLines(linesManual, currentFiscalRef.current.lines, proposed, baseline);
        if (shouldSync) {
          setLinesManual(false);
          setFiscalInput((previous) => {
            const lines = reconcileInvoiceGeneratedLines(previous.lines, proposed, baseline);
            return JSON.stringify(lines) === JSON.stringify(previous.lines) ? previous : { ...previous, lines, reviewed: false, tourist_tax_reviewed: false };
          });
        }
        proposedLinesRef.current = proposed;
      }).catch((err) => {
        if (!isAbortError(err)) setLinesError(err instanceof Error ? err.message : "Préparation des lignes impossible.");
      }).finally(() => { if (!controller.signal.aborted) setPreparingLines(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pricingContextKey, linesManual, fiscalSourceReady, loadingFromContract, loadingFromReservation, linesRetry]);

  const vatPresetContext = {
    giteId,
    vatRegime: validationGiteId === giteId ? validationOptions?.vatRegime : undefined,
    sellerCountryCode: validationGiteId === giteId ? validationOptions?.sellerCountryCode : undefined,
    grouped: isMultiReservation,
  };
  const vatPresetContextKey = JSON.stringify(vatPresetContext);
  useEffect(() => {
    const result = applyIndividualVatPreset(fiscalInput, JSON.parse(vatPresetContextKey), appliedVatPresetsRef.current, touchedVatLinesRef.current);
    appliedVatPresetsRef.current = result.applied;
    if (result.input !== fiscalInput) setFiscalInput(result.input);
  }, [fiscalInput, vatPresetContextKey]);

  const completionItems = [...(linesError ? [{ label: "Actualiser les lignes et les vérifications du séjour", target: "invoice-lines" }] : []), ...invoiceFormCompletion(fiscalInput, expectedTotal, validationOptions, {
    name: locataireNom, giteId, start: dateDebut, end: dateFin, email: locataireEmail,
  })];

  const payloadKey = useMemo(() => JSON.stringify(previewPayload), [previewPayload]);
  const fiscalContextKey = JSON.stringify({ ...previewPayload, fiscal_input: undefined, clauses: { ...clausesPayload, invoice_theme: undefined } });
  useEffect(() => {
    if (isEdit && !editingContract) return;
    if (fiscalContextRef.current !== null && fiscalContextRef.current !== fiscalContextKey) {
      setFiscalInput((previous) => ({ ...previous, reviewed: false, tourist_tax_reviewed: false }));
    }
    fiscalContextRef.current = fiscalContextKey;
  }, [fiscalContextKey, isEdit, editingContract]);

  const previewDatesValid = useMemo(() => {
    return isDocumentDateRangeValid(dateDebut, dateFin);
  }, [dateDebut, dateFin]);

  const previewReady = Boolean(giteId && (!dateDebut || !dateFin || previewDatesValid));
  const { previewHtml, previewError, previewLoading, previewOverflow } = useHtmlPreview({
    url: "/api/invoices/preview-html",
    payload: previewPayload,
    ready: previewReady,
    overflowHeader: "X-Invoice-Overflow",
    overflowAfterHeader: "X-Invoice-Overflow-After",
    compactHeader: "X-Invoice-Compact",
  });

  const previewOverflowStatus =
    !previewLoading && !previewError && previewOverflow?.after
      ? { tone: "error" as const, message: "Le détail dépasse une page : réduisez le texte ou répartissez les réservations avant validation." }
      : !previewLoading && !previewError && previewOverflow?.before && !previewOverflow.after
        ? {
            tone: "ok" as const,
            message: "Mise en page adaptée au détail de la facture, sur plusieurs pages si nécessaire.",
          }
        : null;

  const { clearFieldError, getFieldClassName, renderFieldError } = useDocumentFieldErrors(fieldErrors, setFieldErrors);

  useEffect(() => {
    if (createdContract && createdPayloadKey && payloadKey !== createdPayloadKey) {
      setCreatedContract(null);
      setCreatedPayloadKey(null);
    }
  }, [payloadKey, createdContract, createdPayloadKey]);

  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (!targetId) {
      handledHashNavigationRef.current = null;
      return;
    }
    const navigationKey = `${id ?? "new"}:${location.hash}`;
    if (handledHashNavigationRef.current === navigationKey) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(targetId));
      if (!target) return;
      handledHashNavigationRef.current = navigationKey;
      focusInvoiceField(decodeURIComponent(targetId));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fiscalInput, id, location.hash]);

  const submit = useDocumentSubmit<Facture, ContractFieldKey>({
    endpointBase: "/invoices",
    id: id ?? savedDraft?.id,
    isEdit: isEdit || Boolean(savedDraft),
    canSubmit: draftReady && !preparingLines,
    payload: { ...previewPayload, ...((isEdit || savedDraft) ? { revision: editingContract?.revision ?? savedDraft?.revision } : {}) },
    payloadKey,
    getValidationFieldErrors,
    setSaving,
    setError,
    setFieldErrors,
    setCreatedDocument: (document) => {
      setCreatedContract(document);
      if (document) { setSavedDraft(document); setLastSavedKey(payloadKey); }
    },
    setCreatedPayloadKey,
    setEditingDocument: setEditingContract,
    unknownErrorMessage: "Erreur lors de l'enregistrement de la facture.",
  });

  const downloadPdf = () => {
    if (!createdContract) return;
    window.open(`/api/invoices/${createdContract.id}/pdf`, "_blank");
  };

  const handleDateDebutChange = (value: string) => {
    setDateDebut(value);
    if (!value) return;

    const nextMinDateFin = nextDayFromInput(value);
    if (!nextMinDateFin) return;

    setDateFin((previous) => {
      if (!previous) return nextMinDateFin;
      return previous < nextMinDateFin ? nextMinDateFin : previous;
    });
  };

  const hasStaySource = Boolean(
    linkedReservationId || selectedReservationIds.length || sourceContractNumber,
  );
  const stayDatesEditor = (
    <div className="field-group">
      <div className="field-group__header">
        <div className="field-group__label">Dates</div>
        <div
          className={`nights-chip${nbNuitsSelection ? "" : " nights-chip--muted"}`}
        >
          {isMultiReservation
            ? `${selectedReservationsNights} nuit${selectedReservationsNights > 1 ? "s" : ""} au total`
            : nbNuitsSelection
              ? `${nbNuitsSelection} nuit${nbNuitsSelection > 1 ? "s" : ""}`
              : "Durée à définir"}
        </div>
      </div>
      <div className="field-row">
        <label className={getFieldClassName("date_debut")}>
          Début
          <input
            id="invoice-start"
            type="date"
            disabled={isMultiReservation}
            value={dateDebut}
            onChange={(e) => {
              clearFieldError("date_debut");
              handleDateDebutChange(e.target.value);
            }}
          />
          {renderFieldError("date_debut")}
        </label>
        <label className={getFieldClassName("date_fin")}>
          Fin
          <input
            type="date"
            disabled={isMultiReservation}
            value={dateFin}
            min={minDateFin}
            onChange={(e) => {
              clearFieldError("date_fin");
              setDateFin(e.target.value);
            }}
          />
          {renderFieldError("date_fin")}
        </label>
      </div>
    </div>
  );
  const optionsEditor = (
    <details
      className={`invoice-form__optional invoice-pricing__options${isMultiReservation ? " invoice-single-reservation-only" : ""}`}
    >
      <summary>
        Prestations & options <span>Draps, ménage, animaux…</span>
      </summary>
      <div className="option-grid">
        <div className="option-card option-card--rules">
          <div className="option-title">Règles du gîte</div>
          <div className="rule-list">
            <div className="rule-row">
              <div className="rule-info">
                <div className="rule-title">Animaux acceptés</div>
                <div className="rule-sub">
                  Active l'option chiens sur la facture.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={regleAnimauxAcceptes}
                  onChange={(e) =>
                    updateRule("regle_animaux_acceptes", e.target.checked)
                  }
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-row">
              <div className="rule-info">
                <div className="rule-title">Bois première flambée</div>
                <div className="rule-sub">
                  Mention dans les notes de la facture.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={regleBoisPremiereFlambee}
                  onChange={(e) =>
                    updateRule("regle_bois_premiere_flambee", e.target.checked)
                  }
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-row">
              <div className="rule-info">
                <div className="rule-title">Info tiers personnes</div>
                <div className="rule-sub">
                  Mention dans les notes de la facture.
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={regleTiersPersonnesInfo}
                  onChange={(e) =>
                    updateRule("regle_tiers_personnes_info", e.target.checked)
                  }
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="option-card">
          <div className="option-row">
            <div>
              <div className="option-title">Draps</div>
              <div className="option-sub">
                {formatEuro(drapsTarif)} / lit / séjour
              </div>
            </div>
            <div className="option-actions">
              <div className="switch-group">
                <span>Activer</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={options.draps?.enabled}
                    onChange={(e) =>
                      updateOption("draps", {
                        enabled: e.target.checked,
                        offert: e.target.checked
                          ? (options.draps?.offert ?? false)
                          : false,
                      })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group">
                <span>Offert</span>
                <label className="switch switch--pink">
                  <input
                    type="checkbox"
                    checked={options.draps?.offert}
                    disabled={!options.draps?.enabled}
                    onChange={(e) =>
                      updateOption("draps", { offert: e.target.checked })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>
          <div className="option-inputs">
            <label className="field field-inline">
              Lits
              <input
                type="number"
                value={options.draps?.nb_lits ?? 0}
                disabled={!options.draps?.enabled}
                onChange={(e) =>
                  updateOption("draps", { nb_lits: Number(e.target.value) })
                }
              />
            </label>
            <label className="field field-inline">
              Prix / lit
              <input
                type="number"
                min={0}
                step={1}
                value={options.draps?.prix_unitaire ?? drapsTarif}
                disabled={!options.draps?.enabled}
                onChange={(e) =>
                  updateOption("draps", { prix_unitaire: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>

        <div className="option-card">
          <div className="option-row">
            <div>
              <div className="option-title">Linge de toilette</div>
              <div className="option-sub">
                {formatEuro(lingeTarif)} / personne / séjour
              </div>
            </div>
            <div className="option-actions">
              <div className="switch-group">
                <span>Activer</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={options.linge_toilette?.enabled}
                    onChange={(e) =>
                      updateOption("linge_toilette", {
                        enabled: e.target.checked,
                        offert: e.target.checked
                          ? (options.linge_toilette?.offert ?? false)
                          : false,
                      })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group">
                <span>Offert</span>
                <label className="switch switch--pink">
                  <input
                    type="checkbox"
                    checked={options.linge_toilette?.offert}
                    disabled={!options.linge_toilette?.enabled}
                    onChange={(e) =>
                      updateOption("linge_toilette", { offert: e.target.checked })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>
          <div className="option-inputs">
            <label className="field field-inline">
              Personnes
              <input
                type="number"
                value={options.linge_toilette?.nb_personnes ?? 0}
                disabled={!options.linge_toilette?.enabled}
                onChange={(e) =>
                  updateOption("linge_toilette", {
                    nb_personnes: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </div>

        <div className="option-card">
          <div className="option-row">
            <div>
              <div className="option-title">Ménage fin de séjour</div>
              <div className="option-sub">Forfait {formatEuro(menageTarif)}</div>
            </div>
            <div className="option-actions">
              <div className="switch-group">
                <span>Activer</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={options.menage?.enabled}
                    onChange={(e) =>
                      updateOption("menage", {
                        enabled: e.target.checked,
                        offert: e.target.checked
                          ? (options.menage?.offert ?? false)
                          : false,
                      })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group">
                <span>Offert</span>
                <label className="switch switch--pink">
                  <input
                    type="checkbox"
                    checked={options.menage?.offert}
                    disabled={!options.menage?.enabled}
                    onChange={(e) =>
                      updateOption("menage", { offert: e.target.checked })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="option-card">
          <div className="option-row">
            <div>
              <div className="option-title">Départ tardif</div>
              <div className="option-sub">
                Forfait actuel {formatEuro(departTardifTarif)}
              </div>
            </div>
            <div className="option-actions">
              <div className="switch-group">
                <span>Activer</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={options.depart_tardif?.enabled}
                    onChange={(e) => {
                      updateOption("depart_tardif", {
                        enabled: e.target.checked,
                        offert: e.target.checked
                          ? (options.depart_tardif?.offert ?? false)
                          : false,
                      });
                      if (e.target.checked) {
                        clearFieldError("heure_depart");
                        setHeureDepart("17:00");
                      }
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group">
                <span>Offert</span>
                <label className="switch switch--pink">
                  <input
                    type="checkbox"
                    checked={options.depart_tardif?.offert}
                    disabled={!options.depart_tardif?.enabled}
                    onChange={(e) =>
                      updateOption("depart_tardif", { offert: e.target.checked })
                    }
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>
          </div>
          <div className="option-inputs">
            <label className="field field-inline">
              Prix forfait
              <input
                type="number"
                min={0}
                step={1}
                value={options.depart_tardif?.prix_forfait ?? departTardifTarif}
                disabled={!options.depart_tardif?.enabled}
                onChange={(e) =>
                  updateOption("depart_tardif", {
                    prix_forfait: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        </div>

        {regleAnimauxAcceptes && (
          <div className="option-card">
            <div className="option-row">
              <div>
                <div className="option-title">Chiens</div>
                <div className="option-sub">
                  {formatEuro(chiensTarif)} / nuit / chien
                </div>
              </div>
              <div className="option-actions">
                <div className="switch-group">
                  <span>Activer</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={options.chiens?.enabled}
                      onChange={(e) =>
                        updateOption("chiens", {
                          enabled: e.target.checked,
                          offert: e.target.checked
                            ? (options.chiens?.offert ?? false)
                            : false,
                        })
                      }
                    />
                    <span className="slider" />
                  </label>
                </div>
                <div className="switch-group">
                  <span>Offert</span>
                  <label className="switch switch--pink">
                    <input
                      type="checkbox"
                      checked={options.chiens?.offert}
                      disabled={!options.chiens?.enabled}
                      onChange={(e) =>
                        updateOption("chiens", { offert: e.target.checked })
                      }
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
            </div>
            <div className="option-inputs">
              <label className="field field-inline">
                Chiens
                <input
                  type="number"
                  value={options.chiens?.nb ?? 0}
                  disabled={!options.chiens?.enabled}
                  onChange={(e) =>
                    updateOption("chiens", { nb: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </details>
  );
  const pricingEditor = (
    <div className="invoice-pricing">
      <div
        className={`field-group${isMultiReservation ? " invoice-single-reservation-only" : ""}`}
      >
        <label className={getFieldClassName("prix_par_nuit")}>
          Prix par nuit
          <input
            id="invoice-nightly-price"
            type="number"
            min="0"
            step="0.01"
            list="invoice-nightly-rates"
            value={prixParNuit}
            onChange={(e) => {
              clearFieldError("prix_par_nuit");
              setPrixParNuit(Number(e.target.value));
            }}
          />
          <datalist id="invoice-nightly-rates">
            {prixNuitListe.map((prix) => (
              <option key={prix} value={prix}>
                {formatEuro(prix)}
              </option>
            ))}
          </datalist>
          {renderFieldError("prix_par_nuit")}
        </label>
        <div className={getFieldClassName("remise_montant")}>
          Remise
          <div className="field-row field-row--compact">
            <input
              type="number"
              step={1}
              value={remiseValue}
              onChange={(e) => {
                clearFieldError("remise_montant");
                setRemiseValue(e.target.value);
              }}
            />
            <select
              value={remiseMode}
              onChange={(e) =>
                setRemiseMode(e.target.value as "euro" | "percent")
              }
            >
              <option value="euro">€</option>
              <option value="percent">%</option>
            </select>
          </div>
          <div className="field-hint">Soit {formatEuro(remiseMontant)}</div>
          {renderFieldError("remise_montant")}
        </div>
        <label className="field field--small">
          Raison de la remise (optionnel)
          <input
            type="text"
            maxLength={120}
            value={remiseReason}
            onChange={(e) => setRemiseReason(e.target.value)}
            placeholder="Ex: remise fidélité"
          />
        </label>
      </div>
      <div className="invoice-extra-fees">
        <div className="invoice-extra-fees__header">
          <div>
            <div className="invoice-extra-fees__title">Frais supplémentaires</div>
            <div className="field-hint">Ajoutés uniquement à cette facture.</div>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={addFraisSupplementaire}
          >
            Ajouter
          </button>
        </div>
        {fraisSupplementaires.length > 0 ? (
          <div className="invoice-extra-fees__list">
            {fraisSupplementaires.map((fee, index) => (
              <div className="invoice-extra-fees__row" key={fee.id}>
                <label className="field">
                  Libellé
                  <input
                    type="text"
                    maxLength={120}
                    value={fee.libelle}
                    onChange={(e) =>
                      updateFraisSupplementaire(fee.id, {
                        libelle: e.target.value,
                      })
                    }
                    placeholder={`Frais ${index + 1}`}
                  />
                </label>
                <label className="field invoice-extra-fees__amount">
                  Montant
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fee.montant}
                    onChange={(e) =>
                      updateFraisSupplementaire(fee.id, {
                        montant: e.target.value,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary invoice-extra-fees__remove"
                  onClick={() => removeFraisSupplementaire(fee.id)}
                >
                  Retirer
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="field-hint">Aucun frais ajouté.</div>
        )}
        <div className="field-hint">
          Total frais: {formatEuro(fraisSupplementairesTotal)}
        </div>
      </div>
      {optionsEditor}
    </div>
  );

  if (isEdit && loadingContract && !editingContract) return <div>Chargement...</div>;
  if (isEdit && editingContract && (editingContract.lifecycle_status !== "draft" || editingContract.document_kind === "credit_note")) {
    return <div className="card"><p>Le contenu de ce document est verrouillé.</p><Link to={`/factures/${editingContract.id}`}>Consulter le document</Link></div>;
  }

  return (
    <div className="invoice-form">
      {error && <div className="note">{error}</div>}
      <InvoiceFormHeader isEdit={isEdit} />
      {!isEdit && loadingFromContract && <div className="note">Préremplissage depuis le contrat...</div>}
      {!isEdit && loadingFromReservation && <div className="note">Préremplissage depuis la réservation...</div>}
      {!isEdit && !loadingFromContract && sourceContractNumber && (
        <div className="note note--success">Facture préremplie depuis le contrat {sourceContractNumber}.</div>
      )}
      {!isEdit && !loadingFromReservation && sourceReservationLabel && (
        <div className="note note--success">Facture préremplie depuis la réservation de {sourceReservationLabel}.</div>
      )}
      <InvoiceBuyerEditor value={fiscalInput} onChange={setFiscalInput}>
        <div className="grid-2">
          <label className={getFieldClassName("gite_id")}>
            Gîte
            <select
              id="invoice-gite"
              value={giteId}
              disabled={isMultiReservation}
              onChange={(e) => {
                clearFieldError("gite_id");
                setGiteId(e.target.value);
              }}
            >
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
            {renderFieldError("gite_id")}
          </label>
          <label className={getFieldClassName("locataire_nom")}>
            {fiscalInput.buyer.kind === "business" ? "Raison sociale" : "Nom et prénom"}
            <input
              id="invoice-buyer-name"
              value={locataireNom}
              onChange={(e) => {
                clearFieldError("locataire_nom");
                setLocataireNom(e.target.value);
              }}
            />
            {renderFieldError("locataire_nom")}
          </label>
          <label className={getFieldClassName("locataire_tel")}>
            Téléphone client (optionnel)
            <input
              value={locataireTel}
              onChange={(e) => {
                clearFieldError("locataire_tel");
                setLocataireTel(e.target.value);
              }}
            />
            {renderFieldError("locataire_tel")}
          </label>
          <label className={getFieldClassName("locataire_email")}>
            Email client (optionnel)
            <input
              id="invoice-buyer-email"
              type="email"
              value={locataireEmail}
              onChange={(e) => {
                clearFieldError("locataire_email");
                setLocataireEmail(e.target.value);
              }}
            />
            {renderFieldError("locataire_email")}
          </label>
        </div>
      </InvoiceBuyerEditor>

      <div className="card invoice-reservations">
        <div className="invoice-reservations__header">
          <div>
            <div className="section-title">Réservations incluses</div>
            <div className="field-hint">
              {selectedReservationIds.length
                ? `${selectedReservationIds.length} réservation${selectedReservationIds.length > 1 ? "s" : ""} liée${selectedReservationIds.length > 1 ? "s" : ""} à la facture.`
                : "Vous pouvez créer une facture libre ou sélectionner une ou plusieurs réservations."}
            </div>
          </div>
          <button ref={reservationPickerButtonRef} type="button" className="secondary" onClick={() => setReservationPickerOpen((open) => !open)} aria-expanded={reservationPickerOpen}>
            {reservationPickerOpen ? "Fermer" : "Ajouter une réservation"}
          </button>
        </div>

        {selectedReservations.length > 0 && (
          <div className="invoice-reservations__selected">
            {selectedReservations.map((reservation) => {
              const amount = Number(reservation.prix_total ?? 0) - Number(reservation.remise_montant ?? 0) + Number(reservation.frais_optionnels_montant ?? 0);
              return (
                <div className="invoice-reservation-card" key={reservation.id}>
                  <div>
                    <strong>{reservation.gite?.nom ?? "Gîte"} · {reservation.hote_nom}</strong>
                    <div className="field-hint">
                      {formatDate(reservation.date_entree)} — {formatDate(reservation.date_sortie)} · {reservation.nb_nuits} nuit{reservation.nb_nuits > 1 ? "s" : ""}
                    </div>
                  </div>
                  <strong>{formatEuro(amount)}</strong>
                  <button type="button" className="secondary" onClick={() => toggleReservation(reservation.id)}>
                    Retirer de la facture
                  </button>
                </div>
              );
            })}
            {isMultiReservation && (
              <div className="invoice-reservations__total">
                <span>Total des {selectedReservations.length} réservations</span>
                <strong>{formatEuro(selectedReservationsTotal)}</strong>
              </div>
            )}
          </div>
        )}

        {isMultiReservation && (
          <div className="note note--success">
            Les séjours, leurs dates et leurs montants sont repris automatiquement. Les coordonnées ci-dessus désignent le destinataire de la facture.
          </div>
        )}

        {reservationPickerOpen && (
          <div className="invoice-reservation-picker">
            <label className="field">
              Rechercher par client, gîte ou date
              <input value={reservationSearch} onChange={(event) => setReservationSearch(event.target.value)} autoFocus />
            </label>
            <div className="invoice-reservation-picker__list">
              {filteredReservations.map((reservation) => {
                const linkedInvoice = invoiceByReservationId.get(reservation.id);
                return (
                <label className={`invoice-reservation-choice${linkedInvoice ? " invoice-reservation-choice--disabled" : ""}`} key={reservation.id}>
                  <input
                    type="checkbox"
                    checked={selectedReservationIds.includes(reservation.id)}
                    disabled={Boolean(linkedInvoice)}
                    onChange={() => toggleReservation(reservation.id)}
                  />
                  <span>
                    <strong>{reservation.hote_nom}</strong>
                    <small>{reservation.gite?.nom ?? "Sans gîte"} · {formatDate(reservation.date_entree)} — {formatDate(reservation.date_sortie)}</small>
                    {linkedInvoice && <small>Déjà incluse dans la facture {linkedInvoice.numero_facture}</small>}
                  </span>
                  <strong>{formatEuro(Number(reservation.prix_total ?? 0) - Number(reservation.remise_montant ?? 0) + Number(reservation.frais_optionnels_montant ?? 0))}</strong>
                </label>
                );
              })}
              {!filteredReservations.length && <div className="field-hint">Aucune réservation trouvée.</div>}
            </div>
          </div>
        )}
        {hasStaySource ? (
          <>
            {(!selectedReservations.length || (selectedReservations.length === 1 && (dateDebut !== toDateInputValue(selectedReservations[0].date_entree) || dateFin !== toDateInputValue(selectedReservations[0].date_sortie)))) && dateDebut && dateFin && <p className="field-hint">Séjour facturé du {formatDate(dateDebut)} au {formatDate(dateFin)} · {nbNuitsSelection} nuit{(nbNuitsSelection ?? 0) > 1 ? "s" : ""}.</p>}
            <details className="invoice-reservations__dates">
              <summary>Dates facturées · consulter ou ajuster</summary>
              {stayDatesEditor}
            </details>
          </>
        ) : stayDatesEditor}
      </div>

      <details className="card invoice-form__optional">
        <summary>Une précision à ajouter ? <span>Clause additionnelle</span></summary>
        <div className="grid-2">
          <label className="field">
            Clause additionnelle
            <textarea value={clausesText} onChange={(e) => setClausesText(e.target.value)} rows={3} />
          </label>
        </div>
      </details>

      {linesError && <p role="alert" className="note">{linesError} <button type="button" className="secondary" onClick={() => setLinesRetry((retry) => retry + 1)}>Réessayer la préparation</button></p>}
      <InvoiceFiscalEditor value={fiscalInput} onChange={(next) => {
        const changedVatIds = new Set(changedVatLineIds(fiscalInput, next));
        next.lines.forEach((line) => {
          if (changedVatIds.has(line.id) || touchedVatLinesRef.current.has(line.id)) touchedVatLinesRef.current.set(line.id, line);
        });
        const pricingLines = (input: InvoiceFiscalInput) => input.lines.map(({ id, quantity, unit, unit_price_ttc }) => ({ id, quantity, unit, unit_price_ttc }));
        if (JSON.stringify(pricingLines(next)) !== JSON.stringify(pricingLines(fiscalInput))) setLinesManual(true);
        setFiscalInput(next);

      }} payload={previewPayload} expectedTotal={expectedTotal} touristTaxRequired={Boolean(validationOptions?.touristTax)} pricingEditor={pricingEditor} onReprepared={(options) => {
        setLinesManual(false);
        if (options) { setValidationOptions(options); setValidationGiteId(giteId); }
        touchedVatLinesRef.current.clear(); appliedVatPresetsRef.current = {};
      }} manualLines={linesManual} vatPresetHint={fiscalInput.buyer.kind === "individual" ? individualVatPresetHint(vatPresetContext) : undefined}>
        <footer className="invoice-save" id="invoice-save" data-invoice-step="3" tabIndex={-1} aria-label="Enregistrement de la facture">
          <div><strong>{lastSavedKey === payloadKey ? "Toutes vos modifications sont enregistrées" : "Enregistrez les informations de cette facture"}</strong>
            <p aria-live="polite">{saving ? "Enregistrement en cours…" : lastSavedKey === payloadKey ? "Votre brouillon est sauvegardé. Vous pouvez passer à la vérification." : "Le client, le séjour, les lignes et le paiement seront sauvegardés ensemble. Le brouillon reste modifiable."}</p>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="actions">
            <button type="button" onClick={submit} disabled={saving || preparingLines || !draftReady || lastSavedKey === payloadKey}>
              {saving ? "Enregistrement…" : lastSavedKey === payloadKey ? "✓ Modifications enregistrées" : savedDraft || isEdit ? "Enregistrer les modifications" : "Enregistrer ma facture en brouillon"}
            </button>
            {savedDraft && lastSavedKey === payloadKey && <Link className="invoice-save__next" to={`/factures/${savedDraft.id}`}>Ouvrir la fiche pour vérifier et valider →</Link>}
            {createdContract && <button type="button" className="secondary" onClick={downloadPdf}>Télécharger le brouillon PDF</button>}
          </div>
          {!!completionItems.length && <p className="field-hint">{draftReady ? "Le brouillon peut être enregistré maintenant. L’assistant vous guide pour compléter les informations avant validation." : "Choisissez un gîte, renseignez le nom du client et les dates pour enregistrer un premier brouillon."}</p>}
        </footer>
      </InvoiceFiscalEditor>

      <div className="card">
        <div className="preview-header">
          <div className="section-title">Prévisualisation de votre facture</div>
          {previewOverflowStatus && (
            <span className={`preview-status-chip preview-status-chip--${previewOverflowStatus.tone}`}>
              {previewOverflowStatus.message}
            </span>
          )}
        </div>
        <InvoiceThemePicker value={invoiceTheme} onChange={setInvoiceTheme} />
        <div className="preview-shell">
          {previewHtml ? (
            <DocumentPreviewFrame html={previewHtml} title="Prévisualisation facture" />
          ) : (
            <div className="preview-placeholder">
              {!giteId
                ? "Sélectionnez un gîte pour activer la prévisualisation."
                : dateDebut && dateFin && !previewDatesValid
                  ? "La date de fin doit être postérieure à la date de début."
                  : previewLoading
                    ? "Prévisualisation en cours..."
                    : !dateDebut || !dateFin
                      ? "Prévisualisation disponible même sans dates (valeurs par défaut)."
                      : "Prévisualisation en cours..."}
            </div>
          )}
        </div>
        <div className="preview-meta">
          <span>
            {previewReady
              ? previewLoading
                ? "Mise à jour en cours..."
                : "Prévisualisation HTML mise à jour automatiquement."
              : !giteId
                ? "Prévisualisation inactive tant qu'aucun gîte n'est sélectionné."
                : "Prévisualisation inactive : dates invalides."}
          </span>
          {previewError && <span className="preview-error">{previewError}</span>}
        </div>
      </div>
      <InvoiceCompletionAssistant items={completionItems} checking={preparingLines} />
    </div>
  );
};

export default FactureFormPage;
