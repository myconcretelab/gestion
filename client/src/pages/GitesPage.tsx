import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../utils/api";
import type { Gite } from "../utils/types";

const emptyForm = {
  nom: "",
  prefixe_contrat: "",
  adresse_ligne1: "",
  adresse_ligne2: "",
  capacite_max: 1,
  proprietaires_noms: "",
  proprietaires_adresse: "",
  site_web: "",
  email: "",
  caracteristiques: "",
  telephones: "",
  taxe_sejour_par_personne_par_nuit: 0,
  iban: "",
  bic: "",
  titulaire: "",
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 0,
  options_linge_toilette_par_personne: 0,
  options_menage_forfait: 0,
  options_depart_tardif_forfait: 0,
  options_chiens_forfait: 0,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0.2,
  prix_nuit_liste: "",
};

type FormState = typeof emptyForm;

const GitesPage = () => {
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selected = useMemo(() => gites.find((g) => g.id === selectedId) ?? null, [gites, selectedId]);

  const load = async () => {
    const data = await apiFetch<Gite[]>("/gites");
    setGites(data);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) {
      setForm(emptyForm);
      return;
    }
    setForm({
      nom: selected.nom,
      prefixe_contrat: selected.prefixe_contrat,
      adresse_ligne1: selected.adresse_ligne1,
      adresse_ligne2: selected.adresse_ligne2 ?? "",
      capacite_max: selected.capacite_max,
      proprietaires_noms: selected.proprietaires_noms,
      proprietaires_adresse: selected.proprietaires_adresse,
      site_web: selected.site_web ?? "",
      email: selected.email ?? "",
      caracteristiques: selected.caracteristiques ?? "",
      telephones: Array.isArray(selected.telephones) ? selected.telephones.join(", ") : "",
      taxe_sejour_par_personne_par_nuit: selected.taxe_sejour_par_personne_par_nuit,
      iban: selected.iban,
      bic: selected.bic ?? "",
      titulaire: selected.titulaire,
      regle_animaux_acceptes: selected.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selected.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selected.regle_tiers_personnes_info,
      options_draps_par_lit: selected.options_draps_par_lit,
      options_linge_toilette_par_personne: selected.options_linge_toilette_par_personne,
      options_menage_forfait: selected.options_menage_forfait,
      options_depart_tardif_forfait: selected.options_depart_tardif_forfait,
      options_chiens_forfait: selected.options_chiens_forfait,
      heure_arrivee_defaut: selected.heure_arrivee_defaut ?? "17:00",
      heure_depart_defaut: selected.heure_depart_defaut ?? "12:00",
      caution_montant_defaut: selected.caution_montant_defaut ?? 0,
      cheque_menage_montant_defaut: selected.cheque_menage_montant_defaut ?? 0,
      arrhes_taux_defaut: selected.arrhes_taux_defaut ?? 0.2,
      prix_nuit_liste: Array.isArray(selected.prix_nuit_liste) ? selected.prix_nuit_liste.join(", ") : "",
    });
  }, [selected]);

  const handleChange = (key: keyof FormState, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setLoading(true);
    setError(null);
    try {
      const prixNuitListe = form.prix_nuit_liste
        .split(/[,;\n]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const payload = {
        ...form,
        heure_arrivee_defaut: form.heure_arrivee_defaut || "17:00",
        heure_depart_defaut: form.heure_depart_defaut || "12:00",
        prix_nuit_liste: prixNuitListe,
        telephones: form.telephones
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (selectedId) {
        await apiFetch(`/gites/${selectedId}`, { method: "PUT", json: payload });
      } else {
        await apiFetch(`/gites`, { method: "POST", json: payload });
      }
      await load();
      setSelectedId(null);
      setForm(emptyForm);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const duplicate = async (id: string) => {
    setError(null);
    try {
      const created = await apiFetch<Gite>(`/gites/${id}/duplicate`, { method: "POST" });
      await load();
      setSelectedId(created.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (gite: Gite) => {
    const contratsCount = gite.contrats_count ?? 0;
    const message =
      contratsCount > 0
        ? `Supprimer ce gîte et ses ${contratsCount} contrats ?`
        : "Supprimer ce gîte ?";
    if (!confirm(message)) return;
    try {
      await apiFetch(`/gites/${gite.id}`, { method: "DELETE" });
      await load();
      if (selectedId === gite.id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="section-title">Gîtes</div>
        {error && <div className="note">{error}</div>}
        <table className="table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Préfixe</th>
              <th>Capacité</th>
              <th>Contrats</th>
              <th className="table-actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {gites.map((gite) => (
              <tr key={gite.id}>
                <td>{gite.nom}</td>
                <td>{gite.prefixe_contrat}</td>
                <td>{gite.capacite_max}</td>
                <td>
                  <span className="badge">{gite.contrats_count ?? 0}</span>
                </td>
                <td className="table-actions-cell">
                  <div className="table-actions">
                    <button className="table-action table-action--neutral" onClick={() => setSelectedId(gite.id)}>
                      Éditer
                    </button>
                    <button className="table-action table-action--neutral" onClick={() => duplicate(gite.id)}>
                      Dupliquer
                    </button>
                    <button className="table-action table-action--danger" onClick={() => remove(gite)}>
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-title">{selected ? "Éditer" : "Créer"} un gîte</div>
        <div className="form-section">
          <div className="section-subtitle">Identité du gîte</div>
          <div className="grid-2">
            <label className="field">
              Nom
              <input value={form.nom} onChange={(e) => handleChange("nom", e.target.value)} />
            </label>
            <label className="field">
              Préfixe contrat
              <input
                value={form.prefixe_contrat}
                onChange={(e) => handleChange("prefixe_contrat", e.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              Capacité max
              <input
                type="number"
                value={form.capacite_max}
                onChange={(e) => handleChange("capacite_max", Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Adresse du gîte</div>
          <div className="grid-2">
            <label className="field">
              Adresse ligne 1
              <input
                value={form.adresse_ligne1}
                onChange={(e) => handleChange("adresse_ligne1", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse ligne 2
              <input
                value={form.adresse_ligne2}
                onChange={(e) => handleChange("adresse_ligne2", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Propriétaires & contact</div>
          <div className="grid-2">
            <label className="field">
              Propriétaires
              <input
                value={form.proprietaires_noms}
                onChange={(e) => handleChange("proprietaires_noms", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse propriétaires
              <input
                value={form.proprietaires_adresse}
                onChange={(e) => handleChange("proprietaires_adresse", e.target.value)}
              />
            </label>
            <label className="field">
              Site web
              <input value={form.site_web} onChange={(e) => handleChange("site_web", e.target.value)} />
            </label>
            <label className="field">
              Email
              <input value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
            </label>
            <label className="field">
              Téléphones (séparés par des virgules)
              <input value={form.telephones} onChange={(e) => handleChange("telephones", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Fiscalité & paiement</div>
          <div className="grid-2">
            <label className="field">
              Taxe de séjour / personne / nuit
              <input
                type="number"
                step="0.01"
                value={form.taxe_sejour_par_personne_par_nuit}
                onChange={(e) => handleChange("taxe_sejour_par_personne_par_nuit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              IBAN
              <input value={form.iban} onChange={(e) => handleChange("iban", e.target.value)} />
            </label>
            <label className="field">
              BIC
              <input value={form.bic} onChange={(e) => handleChange("bic", e.target.value)} />
            </label>
            <label className="field">
              Titulaire
              <input value={form.titulaire} onChange={(e) => handleChange("titulaire", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Options & services (tarifs par défaut)</div>
          <div className="grid-2">
            <label className="field">
              Draps / lit (par séjour)
              <input
                type="number"
                step="0.01"
                value={form.options_draps_par_lit}
                onChange={(e) => handleChange("options_draps_par_lit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Linge toilette / personne (par séjour)
              <input
                type="number"
                step="0.01"
                value={form.options_linge_toilette_par_personne}
                onChange={(e) => handleChange("options_linge_toilette_par_personne", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Ménage forfait
              <input
                type="number"
                step="0.01"
                value={form.options_menage_forfait}
                onChange={(e) => handleChange("options_menage_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Départ tardif forfait
              <input
                type="number"
                step="0.01"
                value={form.options_depart_tardif_forfait}
                onChange={(e) => handleChange("options_depart_tardif_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chiens / nuit
              <input
                type="number"
                step="0.01"
                value={form.options_chiens_forfait}
                onChange={(e) => handleChange("options_chiens_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Heure d'arrivée par défaut
              <input
                type="time"
                value={form.heure_arrivee_defaut}
                onChange={(e) => handleChange("heure_arrivee_defaut", e.target.value)}
              />
            </label>
            <label className="field">
              Heure de départ par défaut
              <input
                type="time"
                value={form.heure_depart_defaut}
                onChange={(e) => handleChange("heure_depart_defaut", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Garanties & arrhes</div>
          <div className="grid-2">
            <label className="field">
              Caution par défaut
              <input
                type="number"
                step="0.01"
                value={form.caution_montant_defaut}
                onChange={(e) => handleChange("caution_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chèque ménage par défaut
              <input
                type="number"
                step="0.01"
                value={form.cheque_menage_montant_defaut}
                onChange={(e) => handleChange("cheque_menage_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Arrhes par défaut (%)
              <input
                type="number"
                step="0.1"
                value={Math.round((form.arrhes_taux_defaut ?? 0) * 1000) / 10}
                onChange={(e) => handleChange("arrhes_taux_defaut", Number(e.target.value) / 100)}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Caractéristiques</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Caractéristiques (1 ligne = 1 bullet PDF)
              <textarea
                value={form.caracteristiques}
                onChange={(e) => handleChange("caracteristiques", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Tarifs de nuit</div>
          <div className="grid-2">
            <label className="field">
              Prix/nuit (liste séparée par virgules ou retours ligne)
              <textarea
                value={form.prix_nuit_liste}
                onChange={(e) => handleChange("prix_nuit_liste", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-subtitle">Règles du gîte</div>
          <div className="rules-grid">
            <div className="rule-card">
              <div>
                <div className="rule-title">Animaux acceptés</div>
                <div className="rule-sub">Autoriser la présence d'animaux dans le gîte.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_animaux_acceptes}
                  onChange={(e) => handleChange("regle_animaux_acceptes", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Bois première flambée</div>
                <div className="rule-sub">Inclure du bois pour l'arrivée des locataires.</div>
              </div>
              <label className="switch switch--pink">
                <input
                  type="checkbox"
                  checked={form.regle_bois_premiere_flambee}
                  onChange={(e) => handleChange("regle_bois_premiere_flambee", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Info tiers personnes</div>
                <div className="rule-sub">Informer des passages éventuels de tiers.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_tiers_personnes_info}
                  onChange={(e) => handleChange("regle_tiers_personnes_info", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button onClick={save} disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
          {selected && (
            <button className="secondary" onClick={() => setSelectedId(null)}>
              Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitesPage;
