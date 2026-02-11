import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import type { Contrat, ContratOptions, Gite } from "../utils/types";
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

const ContratFormPage = () => {
  const [gites, setGites] = useState<Gite[]>([]);
  const [giteId, setGiteId] = useState("");
  const [locataireNom, setLocataireNom] = useState("");
  const [locataireAdresse, setLocataireAdresse] = useState("");
  const [locataireTel, setLocataireTel] = useState("");
  const [nbAdultes, setNbAdultes] = useState(2);
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
  const [saving, setSaving] = useState(false);
  const [createdContract, setCreatedContract] = useState<Contrat | null>(null);
  const [createdPayloadKey, setCreatedPayloadKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    apiFetch<Gite[]>("/gites")
      .then((data) => {
        setGites(data);
        if (!giteId && data[0]) setGiteId(data[0].id);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setCautionTouched(false);
    setChequeMenageTouched(false);
  }, [giteId]);

  const selectedGite = useMemo(() => gites.find((g) => g.id === giteId) ?? null, [gites, giteId]);
  const prixNuitListe = useMemo(() => {
    const list = Array.isArray(selectedGite?.prix_nuit_liste) ? selectedGite?.prix_nuit_liste : [];
    return list
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
  }, [selectedGite]);

  const capaciteMax = Math.max(1, selectedGite?.capacite_max ?? 1);
  const adultOptions = useMemo(
    () => Array.from({ length: capaciteMax }, (_, index) => index + 1),
    [capaciteMax]
  );
  const maxEnfants = Math.max(0, capaciteMax - nbAdultes);
  const enfantOptions = useMemo(
    () => Array.from({ length: maxEnfants + 1 }, (_, index) => index),
    [maxEnfants]
  );

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
    setOptions((prev) => ({
      ...prev,
      regle_animaux_acceptes: selectedGite.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selectedGite.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selectedGite.regle_tiers_personnes_info,
    }));
  }, [selectedGite?.id]);

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

  useEffect(() => {
    if (nbAdultes < 1) {
      setNbAdultes(1);
      return;
    }
    if (nbAdultes > capaciteMax) setNbAdultes(capaciteMax);
  }, [nbAdultes, capaciteMax]);

  useEffect(() => {
    if (nbEnfants > maxEnfants) setNbEnfants(maxEnfants);
  }, [maxEnfants, nbEnfants]);

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
      setPreviewUrl(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await fetch(`${API_BASE}/contracts/preview`, {
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

        const blob = await response.blob();
        const nextUrl = URL.createObjectURL(blob);
        setPreviewUrl(nextUrl);
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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const submit = async () => {
    if (!giteId) return;
    setSaving(true);
    setError(null);
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

      const created = await apiFetch<Contrat>("/contracts", {
        method: "POST",
        json: payload,
      });
      setCreatedContract(created);
      setCreatedPayloadKey(payloadKey);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = () => {
    if (!createdContract) return;
    window.open(`/api/contracts/${createdContract.id}/pdf`, "_blank");
  };

  return (
    <div>
      {error && <div className="note">{error}</div>}
      <div className="card">
        <div className="section-title">Infos locataire</div>
        <div className="grid-2">
          <label className="field">
            Gîte
            <select value={giteId} onChange={(e) => setGiteId(e.target.value)}>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Nom locataire
            <input value={locataireNom} onChange={(e) => setLocataireNom(e.target.value)} />
          </label>
          <label className="field">
            Adresse locataire
            <input value={locataireAdresse} onChange={(e) => setLocataireAdresse(e.target.value)} />
          </label>
          <label className="field">
            Téléphone locataire
            <input value={locataireTel} onChange={(e) => setLocataireTel(e.target.value)} />
          </label>
          <label className="field">
            Adultes
            <select value={nbAdultes} onChange={(e) => setNbAdultes(Number(e.target.value))}>
              {adultOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <div className="field-hint">Capacité max: {capaciteMax} personnes</div>
          </label>
          <label className="field">
            Enfants (2-17)
            <select value={nbEnfants} onChange={(e) => setNbEnfants(Number(e.target.value))}>
              {enfantOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Période</div>
        <div className="grid-2">
          <div className="field-group">
            <div className="field-group__label">Dates</div>
            <div className="field-row">
              <label className="field">
                Début
                <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
              </label>
              <label className="field">
                Fin
                <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
              </label>
            </div>
          </div>
          <div className="field-group">
            <div className="field-group__label">Horaires</div>
            <div className="field-row">
              <label className="field">
                Arrivée
                <input type="time" value={heureArrivee} onChange={(e) => setHeureArrivee(e.target.value)} />
              </label>
              <label className="field">
                Départ
                <input type="time" value={heureDepart} onChange={(e) => setHeureDepart(e.target.value)} />
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
            <label className="field">
              Prix par nuit
              {prixNuitListe.length > 0 ? (
                <select value={prixParNuit} onChange={(e) => setPrixParNuit(Number(e.target.value))}>
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
                    onChange={(e) => setPrixParNuit(Number(e.target.value))}
                  />
                  <div className="field-hint">Ajoutez des tarifs dans la gestion des gîtes.</div>
                </>
              )}
            </label>
            <div className="field">
              Remise
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={remiseValue}
                  onChange={(e) => setRemiseValue(e.target.value)}
                />
                <select value={remiseMode} onChange={(e) => setRemiseMode(e.target.value as "euro" | "percent")}>
                  <option value="euro">€</option>
                  <option value="percent">%</option>
                </select>
              </div>
              <div className="field-hint">Soit {formatEuro(remiseMontant)}</div>
            </div>
          </div>

          <div className="field-group">
            <div className="field-group__label">Arrhes</div>
            <div className="field">
              Montant
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={arrhesMontant}
                  onChange={(e) => {
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
            </div>
            <label className="field">
              Date limite arrhes
              <input
                type="date"
                value={arrhesDateLimite}
                onChange={(e) => {
                  setArrhesDateTouched(true);
                  setArrhesDateLimite(e.target.value);
                }}
              />
            </label>
            <label className="field">
              Statut arrhes
              <select value={statutArrhes} onChange={(e) => setStatutArrhes(e.target.value as any)}>
                <option value="non_recu">Non reçues</option>
                <option value="recu">Reçues</option>
              </select>
            </label>
          </div>

          <div className="field-group">
            <div className="field-group__label">Garanties</div>
            <label className="field">
              Caution
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={cautionMontant}
                  onChange={(e) => {
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
            </label>
            <label className="field">
              Chèque ménage
              <div className="field-row field-row--compact">
                <input
                  type="number"
                  step="0.01"
                  value={chequeMenageMontant}
                  onChange={(e) => {
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
        <div className="section-title">Création</div>
        <div className="actions">
          <button onClick={submit} disabled={saving}>
            {saving ? "Création..." : "Créer le contrat"}
          </button>
          {createdContract && (
            <button className="secondary" onClick={downloadPdf}>
              Télécharger le PDF
            </button>
          )}
        </div>
        {createdContract && (
          <div className="note note--success" style={{ marginTop: 12 }}>
            Contrat {createdContract.numero_contrat} créé.
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Prévisualisation (page 1)</div>
        <div className="preview-shell">
          {previewUrl ? (
            <iframe className="preview-frame" title="Prévisualisation contrat" src={previewUrl} />
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
                : "PDF mis à jour automatiquement."
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
