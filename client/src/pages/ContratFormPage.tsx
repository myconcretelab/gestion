import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import type { Contrat, ContratOptions, Gite } from "../utils/types";
import { formatEuro } from "../utils/format";
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
import { type RuleOptionKey, type ServiceOptionKey, useRentalFormPricing } from "./shared/rentalFormPricing";
import { useHtmlPreview } from "./shared/useHtmlPreview";
import { useDocumentSubmit } from "./shared/useDocumentSubmit";

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
  | "caution_montant"
  | "cheque_menage_montant"
  | "statut_paiement_arrhes";

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
  "caution_montant",
  "cheque_menage_montant",
  "statut_paiement_arrhes",
];

const contractFieldKeySet = new Set<ContractFieldKey>(contractFieldKeys);

const getValidationFieldErrors = (error: unknown): FieldErrors =>
  extractValidationFieldErrors(error, contractFieldKeySet, "date_fin");

const ContratFormPage = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
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
  const [options, setOptions] = useState<ContratOptions>(defaultOptions);
  const [arrhesMontant, setArrhesMontant] = useState("");
  const [arrhesDateLimite, setArrhesDateLimite] = useState("");
  const [arrhesAuto, setArrhesAuto] = useState(true);
  const [arrhesDateTouched, setArrhesDateTouched] = useState(false);
  const [cautionMontant, setCautionMontant] = useState(0);
  const [chequeMenageMontant, setChequeMenageMontant] = useState(0);
  const [cautionTouched, setCautionTouched] = useState(false);
  const [chequeMenageTouched, setChequeMenageTouched] = useState(false);
  const [afficherCautionPhrase, setAfficherCautionPhrase] = useState(true);
  const [afficherChequeMenagePhrase, setAfficherChequeMenagePhrase] = useState(true);
  const [clausesText, setClausesText] = useState("");
  const [statutArrhes, setStatutArrhes] = useState<"non_recu" | "recu">("non_recu");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [createdContract, setCreatedContract] = useState<Contrat | null>(null);
  const [createdPayloadKey, setCreatedPayloadKey] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState<Contrat | null>(null);
  const [loadingContract, setLoadingContract] = useState(false);

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
    apiFetch<Contrat>(`/contracts/${id}`)
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
        setOptions(mergeOptions(data.options));
        setArrhesAuto(false);
        setArrhesMontant(Number(data.arrhes_montant ?? 0).toFixed(2));
        setArrhesDateTouched(true);
        setArrhesDateLimite(toDateInputValue(data.arrhes_date_limite));
        setCautionTouched(true);
        setChequeMenageTouched(true);
        setCautionMontant(Number(data.caution_montant ?? 0));
        setChequeMenageMontant(Number(data.cheque_menage_montant ?? 0));
        setAfficherCautionPhrase(data.afficher_caution_phrase ?? true);
        setAfficherChequeMenagePhrase(data.afficher_cheque_menage_phrase ?? true);
        setClausesText(typeof data.clauses?.texte_additionnel === "string" ? data.clauses.texte_additionnel : "");
        setStatutArrhes(data.statut_paiement_arrhes ?? "non_recu");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingContract(false));
  }, [id, isEdit]);

  useEffect(() => {
    if (isEdit && editingContract && giteId === editingContract.gite_id) return;
    setCautionTouched(false);
    setChequeMenageTouched(false);
  }, [giteId, isEdit, editingContract]);

  const {
    selectedGite,
    prixNuitListe,
    remiseMontant,
    totals,
    arrhesRate,
    arrhesAutoValue,
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
    arrhesMontant,
    options,
  });

  const updateOption = (key: ServiceOptionKey, value: any) => {
    setOptions((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
  };

  const updateRule = (key: RuleOptionKey, value: boolean) => {
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
    setHeureArrivee(selectedGite.heure_arrivee_defaut || "17:00");
    setHeureDepart(selectedGite.heure_depart_defaut || "12:00");
  }, [selectedGite, isEdit, editingContract]);

  useEffect(() => {
    if (!selectedGite) return;
    if (isEdit && editingContract && selectedGite.id === editingContract.gite_id) return;
    setOptions((prev) => ({
      ...prev,
      regle_animaux_acceptes: selectedGite.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selectedGite.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selectedGite.regle_tiers_personnes_info,
    }));
  }, [selectedGite?.id, isEdit, editingContract]);

  useEffect(() => {
    if (regleAnimauxAcceptes) return;
    setOptions((prev) => {
      const chiens = prev.chiens ?? { enabled: false, nb: 0, offert: false };
      if (!chiens.enabled && !chiens.offert && (chiens.nb ?? 0) === 0) return prev;
      return { ...prev, chiens: { ...chiens, enabled: false, offert: false, nb: 0 } };
    });
  }, [regleAnimauxAcceptes]);

  useEffect(() => {
    if (!selectedGite) return;
    if (!cautionTouched) setCautionMontant(Number(selectedGite.caution_montant_defaut ?? 0));
    if (!chequeMenageTouched) setChequeMenageMontant(Number(selectedGite.cheque_menage_montant_defaut ?? 0));
  }, [selectedGite, cautionTouched, chequeMenageTouched]);

  useEffect(() => {
    if (!arrhesDateTouched && !arrhesDateLimite) {
      setArrhesDateLimite(formatDateInput(addDays(new Date(), 15)));
    }
  }, [arrhesDateLimite, arrhesDateTouched]);

  useEffect(() => {
    if (!arrhesAuto) return;
    if (Number.isFinite(arrhesAutoValue)) setArrhesMontant(arrhesAutoValue.toFixed(2));
  }, [arrhesAuto, arrhesAutoValue]);

  const previewPayload = useMemo(() => {
    const payload: any = {
      gite_id: giteId,
      locataire_nom: locataireNom,
      locataire_adresse: locataireAdresse,
      locataire_tel: locataireTel,
      nb_adultes: nbAdultes,
      nb_enfants_2_17: nbEnfants,
      date_debut: dateDebut,
      heure_arrivee: heureArrivee,
      date_fin: dateFin,
      heure_depart: heureDepart,
      prix_par_nuit: prixParNuit,
      remise_montant: remiseMontant,
      options,
      arrhes_date_limite: arrhesDateLimite,
      caution_montant: cautionMontant,
      cheque_menage_montant: chequeMenageMontant,
      afficher_caution_phrase: afficherCautionPhrase,
      afficher_cheque_menage_phrase: afficherChequeMenagePhrase,
      clauses: clausesText ? { texte_additionnel: clausesText } : {},
      statut_paiement_arrhes: statutArrhes,
    };

    if (arrhesMontant.trim()) {
      payload.arrhes_montant = Number(arrhesMontant);
    }

    return payload;
  }, [
    giteId,
    locataireNom,
    locataireAdresse,
    locataireTel,
    nbAdultes,
    nbEnfants,
    dateDebut,
    heureArrivee,
    dateFin,
    heureDepart,
    prixParNuit,
    remiseMontant,
    options,
    arrhesDateLimite,
    cautionMontant,
    chequeMenageMontant,
    afficherCautionPhrase,
    afficherChequeMenagePhrase,
    clausesText,
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
  const { previewHtml, previewError, previewLoading, previewOverflow } = useHtmlPreview({
    url: "/api/contracts/preview-html",
    payload: previewPayload,
    ready: previewReady,
    overflowHeader: "X-Contract-Overflow",
    overflowAfterHeader: "X-Contract-Overflow-After",
    compactHeader: "X-Contract-Compact",
  });

  const previewOverflowStatus =
    !previewLoading && !previewError && previewOverflow?.after
      ? {
          tone: "error" as const,
          message:
            "Dépassement persistant : le contrat dépasse encore une page malgré plusieurs niveaux de réduction.",
        }
      : !previewLoading && !previewError && previewOverflow?.before && !previewOverflow.after
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

  const submit = useDocumentSubmit<Contrat, ContractFieldKey>({
    endpointBase: "/contracts",
    id,
    isEdit,
    canSubmit: Boolean(giteId),
    payload: previewPayload,
    payloadKey,
    getValidationFieldErrors,
    setSaving,
    setError,
    setFieldErrors,
    setCreatedDocument: setCreatedContract,
    setCreatedPayloadKey,
    setEditingDocument: setEditingContract,
    unknownErrorMessage: "Erreur lors de l'enregistrement du contrat.",
  });

  const downloadPdf = () => {
    if (!createdContract) return;
    window.open(`/api/contracts/${createdContract.id}/pdf`, "_blank");
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
      <div className="card">
        <div className="section-title">Infos locataire</div>
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
            Nom locataire
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
            Adresse locataire (optionnel)
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
            Téléphone locataire
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
        <div className="grid-2">
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
          <div className="field-group">
            <div className="field-group__label">Horaires</div>
            <div className="field-row">
              <label className={getFieldClassName("heure_arrivee")}>
                Arrivée
                <input
                  type="time"
                  value={heureArrivee}
                  onChange={(e) => {
                    clearFieldError("heure_arrivee");
                    setHeureArrivee(e.target.value);
                  }}
                />
                {renderFieldError("heure_arrivee")}
              </label>
              <label className={getFieldClassName("heure_depart")}>
                Départ
                <input
                  type="time"
                  value={heureDepart}
                  onChange={(e) => {
                    clearFieldError("heure_depart");
                    setHeureDepart(e.target.value);
                  }}
                />
                {renderFieldError("heure_depart")}
              </label>
            </div>
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
          </div>

          <div className="field-group">
            <div className="field-group__label">Arrhes</div>
            <div className={getFieldClassName("arrhes_montant")}>
              Montant
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
                {Math.round(arrhesRate * 100)}% du séjour: {formatEuro(arrhesAutoValue)}
              </div>
              {renderFieldError("arrhes_montant")}
            </div>
            <label className={getFieldClassName("arrhes_date_limite")}>
              Date limite arrhes
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
            <label className={getFieldClassName("statut_paiement_arrhes")}>
              Statut arrhes
              <select
                value={statutArrhes}
                onChange={(e) => {
                  clearFieldError("statut_paiement_arrhes");
                  setStatutArrhes(e.target.value as any);
                }}
              >
                <option value="non_recu">Non reçues</option>
                <option value="recu">Reçues</option>
              </select>
              {renderFieldError("statut_paiement_arrhes")}
            </label>
          </div>

          <div className="field-group">
            <div className="field-group__label">Garanties</div>
            <label className={getFieldClassName("caution_montant")}>
              Caution
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={cautionMontant}
                  onChange={(e) => {
                    clearFieldError("caution_montant");
                    setCautionTouched(true);
                    setCautionMontant(Number(e.target.value));
                  }}
                />
                <div className="switch-group">
                  <span>Afficher</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={afficherCautionPhrase}
                      onChange={(e) => setAfficherCautionPhrase(e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
              {renderFieldError("caution_montant")}
            </label>
            <label className={getFieldClassName("cheque_menage_montant")}>
              Chèque ménage
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={chequeMenageMontant}
                  onChange={(e) => {
                    clearFieldError("cheque_menage_montant");
                    setChequeMenageTouched(true);
                    setChequeMenageMontant(Number(e.target.value));
                  }}
                />
                <div className="switch-group">
                  <span>Afficher</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={afficherChequeMenagePhrase}
                      onChange={(e) => setAfficherChequeMenagePhrase(e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
              {renderFieldError("cheque_menage_montant")}
            </label>
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
                  <div className="rule-sub">Active l'option chiens sur le contrat.</div>
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
                  <div className="rule-sub">Mention dans les notes du contrat.</div>
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
                  <div className="rule-sub">Mention dans les notes du contrat.</div>
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
            {saving ? (isEdit ? "Mise à jour..." : "Création...") : isEdit ? "Mettre à jour le contrat" : "Créer le contrat"}
          </button>
          {createdContract && (
            <button className="secondary" onClick={downloadPdf}>
              Télécharger le PDF
            </button>
          )}
        </div>
        {createdContract && (
          <div className="note note--success" style={{ marginTop: 12 }}>
            Contrat {createdContract.numero_contrat} {isEdit ? "mis à jour" : "créé"}.
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
            <iframe className="preview-frame" title="Prévisualisation contrat" srcDoc={previewHtml} />
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

export default ContratFormPage;
