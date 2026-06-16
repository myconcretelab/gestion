import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError, isApiError } from "../utils/api";
import type { BookingRequest, Gite } from "../utils/types";
import { formatDate, formatEuro } from "../utils/format";
import {
  buildBookingRequestApprovedEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";

type ApprovalEmailComposerState = {
  requestId: string;
  recipient: string;
  subject: string;
  body: string;
};

const toDateInputValue = (value: string) => value.slice(0, 10);

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
  const [submittingAction, setSubmittingAction] = useState<"approve" | "approve-email" | "reject" | null>(null);
  const [dateEditor, setDateEditor] = useState<{ requestId: string; date_entree: string; date_sortie: string } | null>(null);
  const [savingDates, setSavingDates] = useState(false);
  const [emailComposer, setEmailComposer] =
    useState<ApprovalEmailComposerState | null>(null);

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
    setDateEditor(null);
  }, [selectedRequest?.id]);

  const applyUpdatedRequest = (updated: BookingRequest) => {
    setRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  const approveRequest = async (
    email?: { recipient: string; subject: string; body: string },
  ) => {
    if (!selectedRequest) return;
    setSubmittingAction(email ? "approve-email" : "approve");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${selectedRequest.id}/approve`, {
        method: "POST",
        json: { decision_note: decisionNote, ...(email ? { email } : {}) },
      });
      applyUpdatedRequest(updated);
      setEmailComposer(null);
      setNotice(
        email || selectedRequest.email
          ? "Demande approuvée et email envoyé."
          : "Demande approuvée.",
      );
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

  const rejectRequest = async () => {
    if (!selectedRequest) return;
    setSubmittingAction("reject");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${selectedRequest.id}/reject`, {
        method: "POST",
        json: { decision_note: decisionNote },
      });
      applyUpdatedRequest(updated);
      setNotice("Demande rejetée.");
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

  const openDateEditor = () => {
    if (!selectedRequest || selectedRequest.status !== "pending") return;
    setDateEditor({
      requestId: selectedRequest.id,
      date_entree: toDateInputValue(selectedRequest.date_entree),
      date_sortie: toDateInputValue(selectedRequest.date_sortie),
    });
    setError(null);
    setNotice(null);
  };

  const saveDateEditor = async () => {
    if (!selectedRequest || !dateEditor || dateEditor.requestId !== selectedRequest.id) return;
    setSavingDates(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${selectedRequest.id}/dates`, {
        method: "POST",
        json: {
          date_entree: dateEditor.date_entree,
          date_sortie: dateEditor.date_sortie,
        },
      });
      applyUpdatedRequest(updated);
      setDateEditor(null);
      setNotice("Dates de la demande mises à jour.");
    } catch (actionError) {
      if (isApiError(actionError)) {
        setError(actionError.message);
      } else {
        setError(actionError instanceof Error ? actionError.message : "Mise à jour des dates impossible.");
      }
    } finally {
      setSavingDates(false);
    }
  };

  const openApprovalEmailComposer = async () => {
    if (!selectedRequest) return;
    setSubmittingAction("approve-email");
    setError(null);
    setNotice(null);
    try {
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
      );
      const draft = buildBookingRequestApprovedEmailDraft(
        selectedRequest,
        buildDocumentEmailTemplateSettings(emailTextSettings),
      );
      setEmailComposer({
        requestId: selectedRequest.id,
        recipient: draft.recipient ?? selectedRequest.email ?? "",
        subject: draft.subject,
        body: draft.body,
      });
    } catch (composerError) {
      setError(
        composerError instanceof Error
          ? composerError.message
          : "Impossible de préparer l'email.",
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const sendComposedApproval = async () => {
    if (!emailComposer || !selectedRequest || emailComposer.requestId !== selectedRequest.id) return;
    await approveRequest({
      recipient: emailComposer.recipient,
      subject: emailComposer.subject,
      body: emailComposer.body,
    });
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
                  <div className="booking-requests-page__date-summary">
                    <strong>Dates</strong><br />
                    {formatDate(selectedRequest.date_entree)} → {formatDate(selectedRequest.date_sortie)}
                    {selectedRequest.status === "pending" ? (
                      <button
                        type="button"
                        className="button-secondary booking-requests-page__date-edit-button"
                        onClick={openDateEditor}
                        disabled={savingDates || Boolean(submittingAction)}
                      >
                        Modifier les dates
                      </button>
                    ) : null}
                  </div>
                  <div><strong>Voyageurs</strong><br />{selectedRequest.nb_adultes} adulte(s), {selectedRequest.nb_enfants_2_17} enfant(s)</div>
                  <div><strong>Contact</strong><br />{selectedRequest.telephone || "Téléphone absent"}<br />{selectedRequest.email || "Email absent"}</div>
                  <div><strong>Blocage jusqu’au</strong><br />{new Date(selectedRequest.hold_expires_at).toLocaleString("fr-FR")}</div>
                </div>

                {dateEditor?.requestId === selectedRequest.id ? (
                  <div className="booking-requests-page__date-editor">
                    <label className="field">
                      Arrivée
                      <input
                        type="date"
                        value={dateEditor.date_entree}
                        onChange={(event) =>
                          setDateEditor((current) =>
                            current ? { ...current, date_entree: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      Départ
                      <input
                        type="date"
                        value={dateEditor.date_sortie}
                        onChange={(event) =>
                          setDateEditor((current) =>
                            current ? { ...current, date_sortie: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <div className="booking-requests-page__date-editor-actions">
                      <button
                        type="button"
                        onClick={() => void saveDateEditor()}
                        disabled={savingDates || Boolean(submittingAction)}
                      >
                        {savingDates ? "Enregistrement…" : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setDateEditor(null)}
                        disabled={savingDates}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : null}

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
                    onClick={() => void openApprovalEmailComposer()}
                    disabled={selectedRequest.status !== "pending" || Boolean(submittingAction)}
                  >
                    {submittingAction === "approve-email" ? "Préparation…" : "Prévisualiser puis approuver"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void approveRequest()}
                    disabled={selectedRequest.status !== "pending" || Boolean(submittingAction)}
                  >
                    {submittingAction === "approve"
                      ? "Envoi…"
                      : selectedRequest.email
                        ? "Approuver sans relecture"
                        : "Approuver sans email"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void rejectRequest()}
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

      <DocumentEmailComposerDialog
        open={Boolean(emailComposer)}
        title="Email d'acceptation Booked"
        recipient={emailComposer?.recipient ?? ""}
        subject={emailComposer?.subject ?? ""}
        body={emailComposer?.body ?? ""}
        deliveryMode="download_link"
        showDeliveryMode={false}
        sending={submittingAction === "approve-email"}
        onClose={() => setEmailComposer(null)}
        onRecipientChange={(value) =>
          setEmailComposer((previous) =>
            previous ? { ...previous, recipient: value } : previous,
          )
        }
        onSubjectChange={(value) =>
          setEmailComposer((previous) =>
            previous ? { ...previous, subject: value } : previous,
          )
        }
        onBodyChange={(value) =>
          setEmailComposer((previous) =>
            previous ? { ...previous, body: value } : previous,
          )
        }
        onDeliveryModeChange={() => undefined}
        onSubmit={() => void sendComposedApproval()}
      />
    </main>
  );
};

export default BookingRequestsPage;
