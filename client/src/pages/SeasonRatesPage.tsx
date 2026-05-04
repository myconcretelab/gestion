import { useEffect, useState } from "react";
import { apiFetch, isAbortError, isApiError } from "../utils/api";
import type { Gite, SeasonRate } from "../utils/types";
import { formatEuro } from "../utils/format";

type SeasonRateForm = {
  id: string | null;
  date_debut: string;
  date_fin: string;
  prix_par_nuit: string;
  min_nuits: string;
};

const emptyForm: SeasonRateForm = {
  id: null,
  date_debut: "",
  date_fin: "",
  prix_par_nuit: "",
  min_nuits: "1",
};

const SeasonRatesPage = () => {
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedGiteId, setSelectedGiteId] = useState("");
  const [rates, setRates] = useState<SeasonRate[]>([]);
  const [form, setForm] = useState<SeasonRateForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Gite[]>("/gites", { signal: controller.signal })
      .then((rows) => {
        setGites(rows);
        setSelectedGiteId((current) => current || rows[0]?.id || "");
      })
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger les gîtes.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedGiteId) return;
    const controller = new AbortController();
    setLoading(true);
    apiFetch<SeasonRate[]>(`/gites/${selectedGiteId}/season-rates`, { signal: controller.signal })
      .then((rows) => setRates(rows))
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger les saisons.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedGiteId]);

  const resetForm = () => setForm(emptyForm);

  const submitForm = async () => {
    if (!selectedGiteId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        date_debut: form.date_debut,
        date_fin: form.date_fin,
        prix_par_nuit: Number(form.prix_par_nuit),
        min_nuits: Number(form.min_nuits),
      };
      const method = form.id ? "PUT" : "POST";
      const path = form.id
        ? `/gites/${selectedGiteId}/season-rates/${form.id}`
        : `/gites/${selectedGiteId}/season-rates`;
      const saved = await apiFetch<SeasonRate>(path, {
        method,
        json: payload,
      });
      setRates((current) => {
        if (form.id) return current.map((item) => (item.id === saved.id ? saved : item));
        return [...current, saved].sort((a, b) => a.date_debut.localeCompare(b.date_debut));
      });
      setNotice(form.id ? "Saison mise à jour." : "Saison créée.");
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRate = async (id: string) => {
    if (!selectedGiteId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/gites/${selectedGiteId}/season-rates/${id}`, { method: "DELETE" });
      setRates((current) => current.filter((item) => item.id !== id));
      if (form.id === id) resetForm();
      setNotice("Saison supprimée.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Suppression impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page-shell season-rates-page">
      <section className="card">
        <div className="section-title-row">
          <div>
            <h1>Tarifs saisonniers</h1>
            <p className="section-subtitle">Source de tarification pour le plugin public `booked`.</p>
          </div>
        </div>

        <label className="field season-rates-page__gite-select">
          Gîte
          <select value={selectedGiteId} onChange={(event) => setSelectedGiteId(event.target.value)}>
            {gites.map((gite) => (
              <option key={gite.id} value={gite.id}>
                {gite.nom}
              </option>
            ))}
          </select>
        </label>

        {notice ? <div className="note">{notice}</div> : null}
        {error ? <div className="note note--danger">{error}</div> : null}

        <div className="season-rates-page__layout">
          <div className="card">
            <h2>{form.id ? "Modifier une saison" : "Nouvelle saison"}</h2>
            <div className="season-rates-page__form">
              <label className="field">
                Début
                <input type="date" value={form.date_debut} onChange={(event) => setForm((current) => ({ ...current, date_debut: event.target.value }))} />
              </label>
              <label className="field">
                Fin
                <input type="date" value={form.date_fin} onChange={(event) => setForm((current) => ({ ...current, date_fin: event.target.value }))} />
              </label>
              <label className="field">
                Prix / nuit
                <input value={form.prix_par_nuit} onChange={(event) => setForm((current) => ({ ...current, prix_par_nuit: event.target.value }))} />
              </label>
              <label className="field">
                Séjour min.
                <input value={form.min_nuits} onChange={(event) => setForm((current) => ({ ...current, min_nuits: event.target.value }))} />
              </label>
            </div>
            <div className="actions">
              <button type="button" onClick={() => void submitForm()} disabled={saving || !selectedGiteId}>
                {saving ? "Enregistrement…" : form.id ? "Mettre à jour" : "Créer"}
              </button>
              <button type="button" className="button-secondary" onClick={resetForm} disabled={saving}>
                Annuler
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Saisons</h2>
            {loading ? <div className="note">Chargement…</div> : null}
            {!loading && rates.length === 0 ? <div className="note">Aucune saison configurée.</div> : null}
            <div className="season-rates-page__list">
              {rates.map((rate) => (
                <div key={rate.id} className="season-rates-page__item">
                  <div>
                    <strong>{rate.date_debut}</strong> → <strong>{rate.date_fin}</strong>
                  </div>
                  <div>{formatEuro(rate.prix_par_nuit)} / nuit</div>
                  <div>Min. {rate.min_nuits} nuit(s)</div>
                  <div className="actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setForm({
                        id: rate.id,
                        date_debut: rate.date_debut.slice(0, 10),
                        date_fin: rate.date_fin.slice(0, 10),
                        prix_par_nuit: String(rate.prix_par_nuit),
                        min_nuits: String(rate.min_nuits),
                      })}
                    >
                      Modifier
                    </button>
                    <button type="button" className="button-secondary" onClick={() => void deleteRate(rate.id)} disabled={saving}>
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default SeasonRatesPage;
