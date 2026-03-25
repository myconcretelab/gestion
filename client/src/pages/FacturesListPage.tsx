import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import type { Facture, Gite } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import { buildMailtoHref } from "../utils/documentEmail";
import { useDebouncedValue } from "./shared/useDebouncedValue";

const FacturesListPage = () => {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [q, setQ] = useState("");
  const [giteId, setGiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
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

    apiFetch<Facture[]>(`/invoices${debouncedQueryString ? `?${debouncedQueryString}` : ""}`, {
      signal: controller.signal,
    })
      .then((facturesData) => {
        setError(null);
        setFactures(facturesData);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Erreur lors du chargement des factures.");
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQueryString]);

  const togglePayment = async (facture: Facture) => {
    const nextStatus = facture.statut_paiement === "reglee" ? "non_reglee" : "reglee";
    setStatusUpdating((prev) => ({ ...prev, [facture.id]: true }));
    try {
      const updated = await apiFetch<Facture>(`/invoices/${facture.id}/payment`, {
        method: "PATCH",
        json: { statut_paiement: nextStatus },
      });
      setFactures((prev) => prev.map((item) => (item.id === facture.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStatusUpdating((prev) => {
        const next = { ...prev };
        delete next[facture.id];
        return next;
      });
    }
  };

  const remove = async (facture: Facture) => {
    const confirmed = window.confirm(
      `Supprimer la facture ${facture.numero_facture} (${facture.locataire_nom}) ?`
    );
    if (!confirmed) return;
    setDeletingId(facture.id);
    try {
      await apiFetch(`/invoices/${facture.id}`, { method: "DELETE" });
      setFactures((prev) => prev.filter((item) => item.id !== facture.id));
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
            Client / N° facture
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
          <div className="section-title">Factures</div>
          <Link className="contracts-add contracts-add--invoice" to="/factures/nouvelle" aria-label="Créer une facture">
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
              <th>Client</th>
              <th>Total</th>
              <th>Réglée</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {factures.map((facture) => {
              const totalMontant = Number(facture.solde_montant ?? 0) + Number(facture.arrhes_montant ?? 0);
              const pdfUrl = new URL(`/api/invoices/${facture.id}/pdf`, window.location.origin).toString();
              const mailHref = buildMailtoHref({
                recipient: facture.locataire_email,
                subject: `Facture ${facture.numero_facture}`,
                body: `Bonjour,\n\nVoici votre facture :\n${pdfUrl}`,
              });
              return (
                <tr key={facture.id}>
                  <td>
                    {formatDate(facture.date_debut)} - {formatDate(facture.date_fin)}
                  </td>
                  <td>{facture.gite?.nom ?? ""}</td>
                  <td>{facture.locataire_nom}</td>
                  <td>{formatEuro(totalMontant)}</td>
                  <td>
                    <div className="switch-group switch-group--table">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={facture.statut_paiement === "reglee"}
                          disabled={Boolean(statusUpdating[facture.id])}
                          onChange={() => togglePayment(facture)}
                        />
                        <span className="slider" />
                      </label>
                      <span>{facture.statut_paiement === "reglee" ? "Oui" : "Non"}</span>
                    </div>
                  </td>
                  <td className="table-actions-cell">
                    <div className="table-actions">
                      <Link className="table-action table-action--neutral" to={`/factures/${facture.id}`}>
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
                          title="Email client non renseigné"
                        >
                          Email
                        </button>
                      )}
                      <button
                        className="table-action table-action--danger"
                        onClick={() => remove(facture)}
                        disabled={deletingId === facture.id}
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

export default FacturesListPage;
