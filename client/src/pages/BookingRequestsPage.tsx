import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError, isApiError } from "../utils/api";
import type { BookingRequest, Gite } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";

const BookingRequestsPage = () => {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [giteId, setGiteId] = useState("");
  const [query, setQuery] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<BookingRequest[]>(
        `/booking-requests?status=${encodeURIComponent(status)}&gite_id=${encodeURIComponent(giteId)}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      ),
      apiFetch<Gite[]>("/gites", { signal: controller.signal }),
    ])
      .then(([requestRows, giteRows]) => {
        setRequests(requestRows);
        setGites(giteRows);
        setSelectedId((current) => current || requestRows[0]?.id || "");
      })
      .catch((fetchError) => {
        if (isAbortError(fetchError)) return;
        setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger les demandes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [giteId, query, status]);

  const selectedRequest = useMemo(
    () => requests.find((item) => item.id === selectedId) ?? requests[0] ?? null,
    [requests, selectedId],
  );

  useEffect(() => {
    if (!selectedRequest) return;
    setDecisionNote(selectedRequest.decision_note ?? "");
  }, [selectedRequest?.id]);

  const handleDecision = async (action: "approve" | "reject") => {
    if (!selectedRequest) return;
    setSubmittingAction(action);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${selectedRequest.id}/${action}`, {
        method: "POST",
        json: { decision_note: decisionNote },
      });
      setRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(action === "approve" ? "Demande approuvée." : "Demande rejetée.");
    } catch (actionError) {
      if (isApiError(actionError)) {
        setError(actionError.message);
      } else {
        setError(actionError instanceof Error ? actionError.message : "Action impossible.");
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <main className="page-shell booking-requests-page">
      <section className="card">
        <div className="section-title-row">
          <div>
            <h1>Demandes de réservation</h1>
            <p className="section-subtitle">Validation manuelle des demandes publiques `booked`.</p>
          </div>
        </div>

        <div className="booking-requests-page__filters">
          <label className="field">
            Statut
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tous</option>
              <option value="pending">En attente</option>
              <option value="approved">Approuvées</option>
              <option value="rejected">Refusées</option>
              <option value="expired">Expirées</option>
            </select>
          </label>
          <label className="field">
            Gîte
            <select value={giteId} onChange={(event) => setGiteId(event.target.value)}>
              <option value="">Tous</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Recherche
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nom, email, téléphone"
            />
          </label>
        </div>

        {notice ? <div className="note">{notice}</div> : null}
        {error ? <div className="note note--danger">{error}</div> : null}

        <div className="booking-requests-page__layout">
          <div className="booking-requests-page__list">
            {loading ? <div className="note">Chargement…</div> : null}
            {!loading && requests.length === 0 ? <div className="note">Aucune demande trouvée.</div> : null}
            {requests.map((request) => (
              <button
                key={request.id}
                type="button"
                className={`booking-requests-page__item${selectedRequest?.id === request.id ? " booking-requests-page__item--active" : ""}`}
                onClick={() => setSelectedId(request.id)}
              >
                <strong>{request.hote_nom}</strong>
                <span>{request.gite?.nom ?? request.gite_id}</span>
                <span>
                  {formatDate(request.date_entree)} → {formatDate(request.date_sortie)}
                </span>
                <span className={`badge badge--${request.status}`}>{request.status}</span>
              </button>
            ))}
          </div>

          <div className="card booking-requests-page__detail">
            {!selectedRequest ? (
              <div className="note">Sélectionnez une demande.</div>
            ) : (
              <>
                <div className="section-title-row">
                  <div>
                    <h2>{selectedRequest.hote_nom}</h2>
                    <p className="section-subtitle">{selectedRequest.gite?.nom ?? selectedRequest.gite_id}</p>
                  </div>
                </div>

                <div className="booking-requests-page__grid">
                  <div><strong>Dates</strong><br />{formatDate(selectedRequest.date_entree)} → {formatDate(selectedRequest.date_sortie)}</div>
                  <div><strong>Voyageurs</strong><br />{selectedRequest.nb_adultes} adulte(s), {selectedRequest.nb_enfants_2_17} enfant(s)</div>
                  <div><strong>Contact</strong><br />{selectedRequest.telephone || "Téléphone absent"}<br />{selectedRequest.email || "Email absent"}</div>
                  <div><strong>Blocage jusqu’au</strong><br />{new Date(selectedRequest.hold_expires_at).toLocaleString("fr-FR")}</div>
                </div>

                {selectedRequest.message_client ? (
                  <div className="note" style={{ marginTop: 16 }}>
                    <strong>Message client</strong><br />
                    {selectedRequest.message_client}
                  </div>
                ) : null}

                <div className="booking-requests-page__pricing">
                  <h3>Estimation</h3>
                  <div>Hébergement : {formatEuro(selectedRequest.pricing_snapshot.montant_hebergement)}</div>
                  <div>Options : {formatEuro(selectedRequest.pricing_snapshot.total_options)}</div>
                  <div>Taxe de séjour : {formatEuro(selectedRequest.pricing_snapshot.taxe_sejour)}</div>
                  <div><strong>Total : {formatEuro(selectedRequest.pricing_snapshot.total_global)}</strong></div>
                </div>

                <label className="field" style={{ marginTop: 16 }}>
                  Note de décision
                  <textarea
                    rows={4}
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder="Optionnel"
                  />
                </label>

                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => void handleDecision("approve")}
                    disabled={selectedRequest.status !== "pending" || Boolean(submittingAction)}
                  >
                    {submittingAction === "approve" ? "Approbation…" : "Approuver"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleDecision("reject")}
                    disabled={selectedRequest.status !== "pending" || Boolean(submittingAction)}
                  >
                    {submittingAction === "reject" ? "Refus…" : "Rejeter"}
                  </button>
                  {selectedRequest.approved_reservation?.id ? (
                    <Link to="/reservations" className="button-secondary">
                      Voir les réservations
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};

export default BookingRequestsPage;
