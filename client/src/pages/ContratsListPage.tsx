import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Contrat, Gite } from "../utils/types";
import { formatDate } from "../utils/format";
import { buildDocumentMailtoHref } from "../utils/documentEmail";
import { useDebouncedValue } from "./shared/useDebouncedValue";

const ContratsListPage = () => {
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [q, setQ] = useState("");
  const [giteId, setGiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [arrhesUpdating, setArrhesUpdating] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (giteId) params.set("giteId", giteId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [q, giteId, from, to]);
  const debouncedQueryString = useDebouncedValue(queryString, 250);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<Gite[]>("/gites", { signal: controller.signal })
      .then((gitesData) => {
        setError(null);
        setGites(gitesData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Erreur lors du chargement des gîtes.");
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);

    apiFetch<Contrat[]>(`/contracts${debouncedQueryString ? `?${debouncedQueryString}` : ""}`, {
      signal: controller.signal,
    })
      .then((contratsData) => {
        setError(null);
        setContrats(contratsData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Erreur lors du chargement des contrats.");
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQueryString]);

  const toggleArrhes = async (contrat: Contrat) => {
    const nextStatus = contrat.statut_paiement_arrhes === "recu" ? "non_recu" : "recu";
    setArrhesUpdating((prev) => ({ ...prev, [contrat.id]: true }));
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${contrat.id}/arrhes`, {
        method: "PATCH",
        json: { statut_paiement_arrhes: nextStatus },
      });
      setContrats((prev) => prev.map((item) => (item.id === contrat.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArrhesUpdating((prev) => {
        const next = { ...prev };
        delete next[contrat.id];
        return next;
      });
    }
  };

  const remove = async (contrat: Contrat) => {
    const confirmed = window.confirm(
      `Supprimer le contrat ${contrat.numero_contrat} (${contrat.locataire_nom}) ?`
    );
    if (!confirmed) return;
    setDeletingId(contrat.id);
    try {
      await apiFetch(`/contracts/${contrat.id}`, { method: "DELETE" });
      setContrats((prev) => prev.filter((item) => item.id !== contrat.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="section-title">Recherche</div>
        {error && <div className="note">{error}</div>}
        <div className="grid-2">
          <label className="field">
            Nom locataire / N° contrat
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="field">
            Gîte
            <select value={giteId} onChange={(e) => setGiteId(e.target.value)}>
              <option value="">Tous</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Date début (à partir de)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            Date début (jusqu'à)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <div className="contracts-header">
          <div className="section-title">Contrats</div>
          <Link className="contracts-add" to="/contrats/nouveau" aria-label="Créer un contrat">
            <span className="contracts-add__icon" aria-hidden="true">
              +
            </span>
          </Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Dates</th>
              <th>Gîte</th>
              <th>Locataire</th>
              <th>Arrhes payées</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contrats.map((contrat) => {
              const pdfUrl = new URL(`/api/contracts/${contrat.id}/pdf`, window.location.origin).toString();
              const mailHref = buildDocumentMailtoHref({
                recipient: contrat.locataire_email,
                documentType: "contrat",
                documentNumber: contrat.numero_contrat,
                documentUrl: pdfUrl,
                locataireNom: contrat.locataire_nom,
                giteNom: contrat.gite?.nom,
                dateDebut: contrat.date_debut,
                heureArrivee: contrat.heure_arrivee,
                dateFin: contrat.date_fin,
                heureDepart: contrat.heure_depart,
                nbNuits: contrat.nb_nuits,
                arrhesMontant: contrat.arrhes_montant,
                arrhesDateLimite: contrat.arrhes_date_limite,
                soldeMontant: contrat.solde_montant,
              });

              return (
                <tr key={contrat.id}>
                  <td>
                    {formatDate(contrat.date_debut)} - {formatDate(contrat.date_fin)}
                  </td>
                  <td>
                    {contrat.gite?.nom ?? ""}
                  </td>
                  <td>{contrat.locataire_nom}</td>
                  <td>
                    <div className="switch-group switch-group--table">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={contrat.statut_paiement_arrhes === "recu"}
                          disabled={Boolean(arrhesUpdating[contrat.id])}
                          onChange={() => toggleArrhes(contrat)}
                        />
                        <span className="slider" />
                      </label>
                      <span>
                        {contrat.statut_paiement_arrhes === "recu" ? "Payées" : "Non payées"}
                      </span>
                    </div>
                  </td>
                  <td className="table-actions-cell">
                    <div className="table-actions">
                      <Link className="table-action table-action--neutral" to={`/contrats/${contrat.id}`}>
                        Détails
                      </Link>
                      {mailHref ? (
                        <a className="table-action table-action--neutral" href={mailHref}>
                          Email
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="table-action table-action--neutral"
                          disabled
                          title="Email locataire non renseigné"
                        >
                          Email
                        </button>
                      )}
                      <Link
                        className="table-action table-action--neutral"
                        to={`/factures/nouvelle?fromContractId=${encodeURIComponent(contrat.id)}`}
                      >
                        Facturer
                      </Link>
                      <button
                        className="table-action table-action--danger"
                        onClick={() => remove(contrat)}
                        disabled={deletingId === contrat.id}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContratsListPage;
