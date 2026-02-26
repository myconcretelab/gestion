import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import type { Contrat, Facture, ContratOptions, Gite } from "../utils/types";
import { computeTotals } from "../utils/contractCalc";
import { formatEuro } from "../utils/format";

const defaultOptions: ContratOptions = {
  draps: { enabled: false, nb_lits: 0, offert: false },
  linge_toilette: { enabled: false, nb_personnes: 0, offert: false },
  menage: { enabled: false, offert: false },
  depart_tardif: { enabled: false, offert: false },
  chiens: { enabled: false, nb: 0, offert: false },
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
};

const DEFAULT_ARRHES_RATE = 0.2;
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const INVOICE_GUARANTEE_AMOUNT = 0;

const round2 = (value: number) => Math.round(value * 100) / 100;

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseDateInput = (value: string) => {
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const nextDayFromInput = (value: string) => {
  const date = parseDateInput(value);
  if (!date) return "";
  return formatDateInput(addDays(date, 1));
};

const utcDayFromInput = (value: string) => {
  const date = parseDateInput(value);
  if (!date) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (1000 * 60 * 60 * 24);
};

const nightsBetweenInputs = (startValue: string, endValue: string) => {
  const startDay = utcDayFromInput(startValue);
  const endDay = utcDayFromInput(endValue);
  if (startDay === null || endDay === null) return null;
  const diff = endDay - startDay;
  return diff > 0 ? diff : null;
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return "";
  return value.includes("T") ? value.split("T")[0] : value;
};

const mergeOptions = (value?: ContratOptions | null): ContratOptions => ({
  ...defaultOptions,
  ...(value ?? {}),
  draps: { ...defaultOptions.draps, ...(value?.draps ?? {}) },
  linge_toilette: { ...defaultOptions.linge_toilette, ...(value?.linge_toilette ?? {}) },
  menage: { ...defaultOptions.menage, ...(value?.menage ?? {}) },
  depart_tardif: { ...defaultOptions.depart_tardif, ...(value?.depart_tardif ?? {}) },
  chiens: { ...defaultOptions.chiens, ...(value?.chiens ?? {}) },
});

type ContractFieldKey =
  | "gite_id"
  | "locataire_nom"
  | "locataire_adresse"
  | "locataire_tel"
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

const getValidationFieldErrors = (error: unknown): FieldErrors => {
  const result: FieldErrors = {};
  if (!isApiError(error)) return result;

  const rawFieldErrors = error.payload.details?.fieldErrors;
  if (rawFieldErrors && typeof rawFieldErrors === "object") {
    for (const [field, messages] of Object.entries(rawFieldErrors)) {
      if (!contractFieldKeySet.has(field as ContractFieldKey) || !Array.isArray(messages)) continue;
      const firstMessage = messages.find((message): message is string => typeof message === "string" && message.trim().length > 0);
      if (firstMessage) result[field as ContractFieldKey] = firstMessage;
    }
  }

  const normalizedMessage = error.message.toLowerCase();
  if (!result.date_fin && normalizedMessage.includes("date de fin")) {
    result.date_fin = error.message;
  }

  return result;
};

const FactureFormPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const fromContractId = (searchParams.get("fromContractId") ?? "").trim();
  const [gites, setGites] = useState<Gite[]>([]);
  const [giteId, setGiteId] = useState("");
  const [locataireNom, setLocataireNom] = useState("");
  const [locataireAdresse, setLocataireAdresse] = useState("");
  const [locataireTel, setLocataireTel] = useState("");
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
  const [options, setOptions] = useState<ContratOptions>(defaultOptions);
  const [arrhesMontant, setArrhesMontant] = useState("0.00");
  const [arrhesDateLimite, setArrhesDateLimite] = useState("");
  const [arrhesAuto, setArrhesAuto] = useState(false);
  const [arrhesDateTouched, setArrhesDateTouched] = useState(false);
  const [clausesText, setClausesText] = useState("");
  const [statutArrhes, setStatutArrhes] = useState<"non_reglee" | "reglee">("non_reglee");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [createdContract, setCreatedContract] = useState<Facture | null>(null);
  const [createdPayloadKey, setCreatedPayloadKey] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOverflow, setPreviewOverflow] = useState<{
    before: boolean;
    after: boolean;
    compact: boolean;
  } | null>(null);
  const [editingContract, setEditingContract] = useState<Facture | null>(null);
  const [loadingContract, setLoadingContract] = useState(false);
  const [loadingFromContract, setLoadingFromContract] = useState(false);
  const [sourceContractNumber, setSourceContractNumber] = useState<string | null>(null);
  const [prefilledContractGiteId, setPrefilledContractGiteId] = useState<string | null>(null);

  const minDateFin = useMemo(() => {
    if (!dateDebut) return undefined;
    return nextDayFromInput(dateDebut) || undefined;
  }, [dateDebut]);

  const nbNuitsSelection = useMemo(() => nightsBetweenInputs(dateDebut, dateFin), [dateDebut, dateFin]);

  useEffect(() => {
    apiFetch<Gite[]>("/gites")
      .then((data) => {
        setGites(data);
        if (!giteId && data[0]) setGiteId(data[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isEdit || !id) return;
    setLoadingContract(true);
    apiFetch<Facture>(`/invoices/${id}`)
      .then((data) => {
        setEditingContract(data);
        setGiteId(data.gite_id);
        setLocataireNom(data.locataire_nom);
        setLocataireAdresse(data.locataire_adresse);
        setLocataireTel(data.locataire_tel);
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
        setOptions(mergeOptions(data.options));
        setArrhesAuto(false);
        setArrhesMontant(Number(data.arrhes_montant ?? 0).toFixed(2));
        setArrhesDateTouched(true);
        setArrhesDateLimite(toDateInputValue(data.arrhes_date_limite));
        setClausesText(typeof data.clauses?.texte_additionnel === "string" ? data.clauses.texte_additionnel : "");
        setStatutArrhes(data.statut_paiement ?? "non_reglee");
        setSourceContractNumber(null);
        setPrefilledContractGiteId(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingContract(false));
  }, [id, isEdit]);

  useEffect(() => {
    if (isEdit || !fromContractId) return;
    setError(null);
    setSourceContractNumber(null);
    setPrefilledContractGiteId(null);
    setLoadingFromContract(true);
    apiFetch<Contrat>(`/contracts/${fromContractId}`)
      .then((data) => {
        setSourceContractNumber(data.numero_contrat);
        setPrefilledContractGiteId(data.gite_id);
        setGiteId(data.gite_id);
        setLocataireNom(data.locataire_nom);
        setLocataireAdresse(data.locataire_adresse);
        setLocataireTel(data.locataire_tel);
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
        setOptions(mergeOptions(data.options));
        setArrhesAuto(false);
        setArrhesMontant(Number(data.arrhes_montant ?? 0).toFixed(2));
        setArrhesDateTouched(true);
        setArrhesDateLimite(toDateInputValue(data.arrhes_date_limite));
        setClausesText(typeof data.clauses?.texte_additionnel === "string" ? data.clauses.texte_additionnel : "");
        setStatutArrhes("non_reglee");
      })
      .catch((err) => {
        setSourceContractNumber(null);
        setPrefilledContractGiteId(null);
        setError(err.message);
      })
      .finally(() => setLoadingFromContract(false));
  }, [isEdit, fromContractId]);

  useEffect(() => {
    if (isEdit || fromContractId) return;
    setSourceContractNumber(null);
    setPrefilledContractGiteId(null);
    setLoadingFromContract(false);
  }, [isEdit, fromContractId]);

  const selectedGite = useMemo(() => gites.find((g) => g.id === giteId) ?? null, [gites, giteId]);
  const effectiveHeureArrivee = heureArrivee || selectedGite?.heure_arrivee_defaut || "17:00";
  const effectiveHeureDepart = heureDepart || selectedGite?.heure_depart_defaut || "12:00";
  const prixNuitListe = useMemo(() => {
    const list = Array.isArray(selectedGite?.prix_nuit_liste) ? selectedGite?.prix_nuit_liste : [];
    return list
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
  }, [selectedGite]);

  const montantBase = useMemo(() => {
    const start = new Date(dateDebut);
    const end = new Date(dateFin);
    const hasDateDebut = Boolean(dateDebut);
    const hasDateFin = Boolean(dateFin);
    const startValid = Number.isFinite(start.getTime());
    const endValid = Number.isFinite(end.getTime());
    if (startValid && endValid && end > start) {
      const nbNuits = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      return round2(nbNuits * prixParNuit);
    }
    if (!hasDateDebut || !hasDateFin) return round2(prixParNuit);
    return 0;
  }, [dateDebut, dateFin, prixParNuit]);

  const remiseMontant = useMemo(() => {
    const value = Number(remiseValue || 0);
    if (!Number.isFinite(value)) return 0;
    if (remiseMode === "percent") return round2((montantBase * value) / 100);
    return round2(value);
  }, [montantBase, remiseMode, remiseValue]);

  const totals = useMemo(
    () =>
      computeTotals({
        dateDebut,
        dateFin,
        prixParNuit,
        remiseMontant,
        nbAdultes,
        nbEnfants,
        arrhesMontant: Number(arrhesMontant || 0),
        options,
        gite: selectedGite,
      }),
    [dateDebut, dateFin, prixParNuit, remiseMontant, nbAdultes, nbEnfants, arrhesMontant, options, selectedGite]
  );

  const arrhesRate = selectedGite?.arrhes_taux_defaut ?? DEFAULT_ARRHES_RATE;
  const arrhesAutoValue = useMemo(() => {
    if (!Number.isFinite(totals.totalSansOptions)) return 0;
    return round2(totals.totalSansOptions * arrhesRate);
  }, [totals.totalSansOptions, arrhesRate]);

  const drapsTarif = Number(selectedGite?.options_draps_par_lit ?? 0);
  const lingeTarif = Number(selectedGite?.options_linge_toilette_par_personne ?? 0);
  const menageTarif = Number(selectedGite?.options_menage_forfait ?? 0);
  const departTardifTarif = Number(selectedGite?.options_depart_tardif_forfait ?? 0);
  const chiensTarif = Number(selectedGite?.options_chiens_forfait ?? 0);

  const regleAnimauxAcceptes = options.regle_animaux_acceptes ?? false;
  const regleBoisPremiereFlambee = options.regle_bois_premiere_flambee ?? false;
  const regleTiersPersonnesInfo = options.regle_tiers_personnes_info ?? false;

  type ServiceOptionKey = "draps" | "linge_toilette" | "menage" | "depart_tardif" | "chiens";

  const updateOption = (key: ServiceOptionKey, value: any) => {
    setOptions((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  };

  const updateRule = (key: "regle_animaux_acceptes" | "regle_bois_premiere_flambee" | "regle_tiers_personnes_info", value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!selectedGite) return;
    if (prixNuitListe.length > 0 && !prixNuitListe.includes(prixParNuit)) {
      setPrixParNuit(prixNuitListe[0]);
    }
  }, [selectedGite, prixNuitListe, prixParNuit]);

  useEffect(() => {
    if (!selectedGite) return;
    if (isEdit && editingContract && selectedGite.id === editingContract.gite_id) return;
    if (!isEdit && prefilledContractGiteId && selectedGite.id === prefilledContractGiteId) return;
    setHeureArrivee(selectedGite.heure_arrivee_defaut || "17:00");
    setHeureDepart(selectedGite.heure_depart_defaut || "12:00");
  }, [selectedGite, isEdit, editingContract, prefilledContractGiteId]);

  useEffect(() => {
    if (!selectedGite) return;
    if (isEdit && editingContract && selectedGite.id === editingContract.gite_id) return;
    if (!isEdit && prefilledContractGiteId && selectedGite.id === prefilledContractGiteId) return;
    setOptions((prev) => ({
      ...prev,
      regle_animaux_acceptes: selectedGite.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selectedGite.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selectedGite.regle_tiers_personnes_info,
    }));
  }, [selectedGite?.id, isEdit, editingContract, prefilledContractGiteId]);

  useEffect(() => {
    if (regleAnimauxAcceptes) return;
    setOptions((prev) => {
      const chiens = prev.chiens ?? { enabled: false, nb: 0, offert: false };
      if (!chiens.enabled && !chiens.offert && (chiens.nb ?? 0) === 0) return prev;
      return { ...prev, chiens: { ...chiens, enabled: false, offert: false, nb: 0 } };
    });
  }, [regleAnimauxAcceptes]);

  useEffect(() => {
    if (!arrhesDateTouched && !arrhesDateLimite) {
      setArrhesDateLimite(formatDateInput(addDays(new Date(), 15)));
    }
  }, [arrhesDateLimite, arrhesDateTouched]);

  useEffect(() => {
    if (!arrhesAuto) return;
    if (Number.isFinite(arrhesAutoValue)) setArrhesMontant(arrhesAutoValue.toFixed(2));
  }, [arrhesAuto, arrhesAutoValue]);

  const clausesPayload = useMemo(() => {
    const next: Record<string, unknown> = {};
    const trimmedAdditionalText = clausesText.trim();
    const trimmedRemiseReason = remiseReason.trim();

    if (trimmedAdditionalText) next.texte_additionnel = trimmedAdditionalText;
    if (trimmedRemiseReason) next.remise_raison = trimmedRemiseReason;

    return next;
  }, [clausesText, remiseReason]);

  const showPaymentDeadline = statutArrhes === "non_reglee";

  const previewPayload = useMemo(() => {
    const payload: any = {
      gite_id: giteId,
      locataire_nom: locataireNom,
      locataire_adresse: locataireAdresse,
      locataire_tel: locataireTel,
      nb_adultes: nbAdultes,
      nb_enfants_2_17: nbEnfants,
      date_debut: dateDebut,
      heure_arrivee: effectiveHeureArrivee,
      date_fin: dateFin,
      heure_depart: effectiveHeureDepart,
      prix_par_nuit: prixParNuit,
      remise_montant: remiseMontant,
      options,
      arrhes_montant: Number(arrhesMontant || 0),
      arrhes_date_limite: arrhesDateLimite,
      caution_montant: INVOICE_GUARANTEE_AMOUNT,
      cheque_menage_montant: INVOICE_GUARANTEE_AMOUNT,
      afficher_caution_phrase: false,
      afficher_cheque_menage_phrase: false,
      clauses: clausesPayload,
      statut_paiement: statutArrhes,
    };

    return payload;
  }, [
    giteId,
    locataireNom,
    locataireAdresse,
    locataireTel,
    nbAdultes,
    nbEnfants,
    dateDebut,
    effectiveHeureArrivee,
    dateFin,
    effectiveHeureDepart,
    prixParNuit,
    remiseMontant,
    options,
    arrhesDateLimite,
    clausesPayload,
    statutArrhes,
    arrhesMontant,
  ]);

  const payloadKey = useMemo(() => JSON.stringify(previewPayload), [previewPayload]);

  const previewDatesValid = useMemo(() => {
    if (!dateDebut || !dateFin) return false;
    const start = new Date(dateDebut);
    const end = new Date(dateFin);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
    return end > start;
  }, [dateDebut, dateFin]);

  const previewReady = Boolean(giteId && (!dateDebut || !dateFin || previewDatesValid));
  const previewOverflowStatus =
    !previewLoading && !previewError && previewOverflow?.before && !previewOverflow.after
        ? {
            tone: "ok" as const,
            message: "Dépassement détecté puis corrigé : après ajustement, la page 1 ne dépasse plus.",
          }
        : null;

  const clearFieldError = (field: ContractFieldKey) => {
    setFieldErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  };

  const getFieldClassName = (field: ContractFieldKey, className = "field") =>
    `${className}${fieldErrors[field] ? " field--error" : ""}`;

  const renderFieldError = (field: ContractFieldKey) => {
    const message = fieldErrors[field];
    if (!message) return null;
    return <div className="field-error">{message}</div>;
  };

  useEffect(() => {
    if (createdContract && createdPayloadKey && payloadKey !== createdPayloadKey) {
      setCreatedContract(null);
      setCreatedPayloadKey(null);
    }
  }, [payloadKey, createdContract, createdPayloadKey]);

  useEffect(() => {
    if (!previewReady) {
      setPreviewError(null);
      setPreviewLoading(false);
      setPreviewHtml(null);
      setPreviewOverflow(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewOverflow(null);
      try {
        const response = await fetch(`${API_BASE}/invoices/preview-html`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(previewPayload),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Erreur preview (${response.status})`;
          try {
            const payload = await response.json();
            if (payload?.error) message = payload.error;
          } catch {
            // ignore
          }
          throw new Error(message);
        }

        const overflowBefore = response.headers.get("X-Invoice-Overflow") === "1";
        const overflowAfter = response.headers.get("X-Invoice-Overflow-After") === "1";
        const compact = response.headers.get("X-Invoice-Compact") === "1";
        setPreviewOverflow({ before: overflowBefore, after: overflowAfter, compact });

        const html = await response.text();
        setPreviewHtml(html);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setPreviewError(err?.message ?? "Erreur lors de la prévisualisation.");
      } finally {
        setPreviewLoading(false);
      }
    }, 600);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [previewPayload, previewReady]);

  const submit = async () => {
    if (!giteId) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setCreatedContract(null);
    setCreatedPayloadKey(null);
    try {
      const payload: any = {
        gite_id: giteId,
        locataire_nom: locataireNom,
        locataire_adresse: locataireAdresse,
        locataire_tel: locataireTel,
        nb_adultes: nbAdultes,
        nb_enfants_2_17: nbEnfants,
        date_debut: dateDebut,
        heure_arrivee: effectiveHeureArrivee,
        date_fin: dateFin,
        heure_depart: effectiveHeureDepart,
        prix_par_nuit: prixParNuit,
        remise_montant: remiseMontant,
        options,
        arrhes_montant: Number(arrhesMontant || 0),
        arrhes_date_limite: arrhesDateLimite,
        caution_montant: INVOICE_GUARANTEE_AMOUNT,
        cheque_menage_montant: INVOICE_GUARANTEE_AMOUNT,
        afficher_caution_phrase: false,
        afficher_cheque_menage_phrase: false,
        clauses: clausesPayload,
        statut_paiement: statutArrhes,
      };

      const endpoint = isEdit && id ? `/invoices/${id}` : "/invoices";
      const method = isEdit ? "PUT" : "POST";
      const saved = await apiFetch<Facture>(endpoint, {
        method,
        json: payload,
      });
      setCreatedContract(saved);
      if (isEdit) setEditingContract(saved);
      setCreatedPayloadKey(payloadKey);
    } catch (err: unknown) {
      const validationErrors = getValidationFieldErrors(err);
      const hasFieldErrors = Object.keys(validationErrors).length > 0;
      setFieldErrors(validationErrors);
      if (hasFieldErrors) {
        setError("Veuillez corriger les champs en erreur.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Erreur lors de l'enregistrement de la facture.");
      }
    } finally {
      setSaving(false);
    }
  };

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

  if (isEdit && loadingContract && !editingContract) return <div>Chargement...</div>;

  return (
    <div>
      {error && <div className="note">{error}</div>}
      {!isEdit && loadingFromContract && <div className="note">Préremplissage depuis le contrat...</div>}
      {!isEdit && !loadingFromContract && sourceContractNumber && (
        <div className="note note--success">Facture préremplie depuis le contrat {sourceContractNumber}.</div>
      )}
      <div className="card">
        <div className="section-title">Infos client</div>
        <div className="grid-2">
          <label className={getFieldClassName("gite_id")}>
            Gîte
            <select
              value={giteId}
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
            Nom client
            <input
              value={locataireNom}
              onChange={(e) => {
                clearFieldError("locataire_nom");
                setLocataireNom(e.target.value);
              }}
            />
            {renderFieldError("locataire_nom")}
          </label>
          <label className={getFieldClassName("locataire_adresse")}>
            Adresse client (optionnel)
            <input
              value={locataireAdresse}
              onChange={(e) => {
                clearFieldError("locataire_adresse");
                setLocataireAdresse(e.target.value);
              }}
            />
            {renderFieldError("locataire_adresse")}
          </label>
          <label className={getFieldClassName("locataire_tel")}>
            Téléphone client
            <input
              value={locataireTel}
              onChange={(e) => {
                clearFieldError("locataire_tel");
                setLocataireTel(e.target.value);
              }}
            />
            {renderFieldError("locataire_tel")}
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Période</div>
        <div className="field-group">
          <div className="field-group__header">
            <div className="field-group__label">Dates</div>
            <div className={`nights-chip${nbNuitsSelection ? "" : " nights-chip--muted"}`}>
              {nbNuitsSelection ? `${nbNuitsSelection} nuit${nbNuitsSelection > 1 ? "s" : ""}` : "Durée à définir"}
            </div>
          </div>
          <div className="field-row">
            <label className={getFieldClassName("date_debut")}>
              Début
              <input
                type="date"
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
      </div>

      <div className="card">
        <div className="section-title">Tarif & Paiement</div>
        <div className="grid-2">
          <div className="field-group">
            <div className="field-group__label">Tarif séjour</div>
            <label className={getFieldClassName("prix_par_nuit")}>
              Prix par nuit
              {prixNuitListe.length > 0 ? (
                <select
                  value={prixParNuit}
                  onChange={(e) => {
                    clearFieldError("prix_par_nuit");
                    setPrixParNuit(Number(e.target.value));
                  }}
                >
                  {prixNuitListe.map((prix, index) => (
                    <option key={`${prix}-${index}`} value={prix}>
                      {formatEuro(prix)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="number"
                    step="0.01"
                    value={prixParNuit}
                    onChange={(e) => {
                      clearFieldError("prix_par_nuit");
                      setPrixParNuit(Number(e.target.value));
                    }}
                  />
                  <div className="field-hint">Ajoutez des tarifs dans la gestion des gîtes.</div>
                </>
              )}
              {renderFieldError("prix_par_nuit")}
            </label>
            <div className={getFieldClassName("remise_montant")}>
              Remise
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={remiseValue}
                  onChange={(e) => {
                    clearFieldError("remise_montant");
                    setRemiseValue(e.target.value);
                  }}
                />
                <select value={remiseMode} onChange={(e) => setRemiseMode(e.target.value as "euro" | "percent")}>
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

          <div className="field-group">
            <div className="field-group__label">Paiement facture</div>
            <div className={getFieldClassName("statut_paiement")}>
              Statut de la facture
              <div className="switch-group">
                <span>{statutArrhes === "reglee" ? "Payée" : "Non payée"}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={statutArrhes === "reglee"}
                    onChange={(e) => {
                      clearFieldError("statut_paiement");
                      const nextStatus = e.target.checked ? "reglee" : "non_reglee";
                      setStatutArrhes(nextStatus);
                      if (!arrhesDateLimite) {
                        setArrhesDateLimite(formatDateInput(addDays(new Date(), 15)));
                      }
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>
              {renderFieldError("statut_paiement")}
            </div>
            {showPaymentDeadline && (
              <label className={getFieldClassName("arrhes_date_limite")}>
                Date limite de paiement
                <input
                  type="date"
                  value={arrhesDateLimite}
                  onChange={(e) => {
                    clearFieldError("arrhes_date_limite");
                    setArrhesDateTouched(true);
                    setArrhesDateLimite(e.target.value);
                  }}
                />
                {renderFieldError("arrhes_date_limite")}
              </label>
            )}
            <div className={getFieldClassName("arrhes_montant")}>
              Acompte déduit (si déjà reçu)
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={arrhesMontant}
                  onChange={(e) => {
                    clearFieldError("arrhes_montant");
                    setArrhesAuto(false);
                    setArrhesMontant(e.target.value);
                  }}
                />
                <div className="switch-group">
                  <span>Auto</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={arrhesAuto}
                      onChange={(e) => setArrhesAuto(e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
              <div className="field-hint">
                Acompte auto ({Math.round(arrhesRate * 100)}% du séjour): {formatEuro(arrhesAutoValue)}
              </div>
              {renderFieldError("arrhes_montant")}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Options</div>
        <div className="option-grid">
          <div className="option-card option-card--rules">
            <div className="option-title">Règles du gîte</div>
            <div className="rule-list">
              <div className="rule-row">
                <div className="rule-info">
                  <div className="rule-title">Animaux acceptés</div>
                  <div className="rule-sub">Active l'option chiens sur la facture.</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={regleAnimauxAcceptes}
                    onChange={(e) => updateRule("regle_animaux_acceptes", e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="rule-row">
                <div className="rule-info">
                  <div className="rule-title">Bois première flambée</div>
                  <div className="rule-sub">Mention dans les notes de la facture.</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={regleBoisPremiereFlambee}
                    onChange={(e) => updateRule("regle_bois_premiere_flambee", e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="rule-row">
                <div className="rule-info">
                  <div className="rule-title">Info tiers personnes</div>
                  <div className="rule-sub">Mention dans les notes de la facture.</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={regleTiersPersonnesInfo}
                    onChange={(e) => updateRule("regle_tiers_personnes_info", e.target.checked)}
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
                <div className="option-sub">{formatEuro(drapsTarif)} / lit / séjour</div>
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
                          offert: e.target.checked ? options.draps?.offert ?? false : false,
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
                      onChange={(e) => updateOption("draps", { offert: e.target.checked })}
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
                  onChange={(e) => updateOption("draps", { nb_lits: Number(e.target.value) })}
                />
              </label>
            </div>
          </div>

          <div className="option-card">
            <div className="option-row">
              <div>
                <div className="option-title">Linge de toilette</div>
                <div className="option-sub">{formatEuro(lingeTarif)} / personne / séjour</div>
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
                          offert: e.target.checked ? options.linge_toilette?.offert ?? false : false,
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
                      onChange={(e) => updateOption("linge_toilette", { offert: e.target.checked })}
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
                  onChange={(e) => updateOption("linge_toilette", { nb_personnes: Number(e.target.value) })}
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
                          offert: e.target.checked ? options.menage?.offert ?? false : false,
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
                      onChange={(e) => updateOption("menage", { offert: e.target.checked })}
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
                <div className="option-sub">Forfait {formatEuro(departTardifTarif)}</div>
              </div>
              <div className="option-actions">
                <div className="switch-group">
                  <span>Activer</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={options.depart_tardif?.enabled}
                      onChange={(e) =>
                        updateOption("depart_tardif", {
                          enabled: e.target.checked,
                          offert: e.target.checked ? options.depart_tardif?.offert ?? false : false,
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
                      checked={options.depart_tardif?.offert}
                      disabled={!options.depart_tardif?.enabled}
                      onChange={(e) => updateOption("depart_tardif", { offert: e.target.checked })}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {regleAnimauxAcceptes && (
            <div className="option-card">
              <div className="option-row">
                <div>
                  <div className="option-title">Chiens</div>
                  <div className="option-sub">{formatEuro(chiensTarif)} / nuit / chien</div>
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
                            offert: e.target.checked ? options.chiens?.offert ?? false : false,
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
                        onChange={(e) => updateOption("chiens", { offert: e.target.checked })}
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
                    onChange={(e) => updateOption("chiens", { nb: Number(e.target.value) })}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Clauses</div>
        <div className="grid-2">
          <label className="field">
            Clause additionnelle
            <textarea value={clausesText} onChange={(e) => setClausesText(e.target.value)} rows={3} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">{isEdit ? "Mise à jour" : "Création"}</div>
        <div className="actions">
          <button onClick={submit} disabled={saving}>
            {saving ? (isEdit ? "Mise à jour..." : "Création...") : isEdit ? "Mettre à jour la facture" : "Créer la facture"}
          </button>
          {createdContract && (
            <button className="secondary" onClick={downloadPdf}>
              Télécharger le PDF
            </button>
          )}
        </div>
        {createdContract && (
          <div className="note note--success" style={{ marginTop: 12 }}>
            Facture {createdContract.numero_facture} {isEdit ? "mise à jour" : "créée"}.
          </div>
        )}
      </div>

      <div className="card">
        <div className="preview-header">
          <div className="section-title">Prévisualisation (page 1)</div>
          {previewOverflowStatus && (
            <span className={`preview-status-chip preview-status-chip--${previewOverflowStatus.tone}`}>
              {previewOverflowStatus.message}
            </span>
          )}
        </div>
        <div className="preview-shell">
          {previewHtml ? (
            <iframe className="preview-frame" title="Prévisualisation facture" srcDoc={previewHtml} />
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
    </div>
  );
};

export default FactureFormPage;
