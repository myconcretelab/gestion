import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiFetch, isAbortError, isApiError } from "../utils/api";
import { formatDate, formatEuro } from "../utils/format";
import type { BookingRequest } from "../utils/types";
import {
  buildBookingRequestApprovedEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import {
  formatBookingRequestCreatedAt,
  getRequestTimelineLabel,
  getRequestTimelineValue,
  requestStatusDetail,
  requestStatusLabels,
} from "./bookingRequestUi";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";

type ApprovalEmailComposerState = {
  requestId: string;
  recipient: string;
  subject: string;
  body: string;
};

type BookingRequestLocationState = {
  from?: string;
};

const toDateInputValue = (value: string) => value.slice(0, 10);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const BookingRequestDetailPage = () => {
  const { requestId = "" } = useParams();
  const location = useLocation();
  const locationState = location.state as BookingRequestLocationState | null;
  const backTarget = locationState?.from?.startsWith("/demandes") ? locationState.from : "/demandes";
  const [request, setRequest] = useState<BookingRequest | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "approve-email" | "reject" | null>(null);
  const [dateEditor, setDateEditor] = useState<{ date_entree: string; date_sortie: string } | null>(null);
  const [savingDates, setSavingDates] = useState(false);
  const [emailComposer, setEmailComposer] = useState<ApprovalEmailComposerState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiFetch<BookingRequest>(`/booking-requests/${requestId}`, { signal: controller.signal })
      .then((loadedRequest) => {
        setRequest(loadedRequest);
        setDecisionNote(loadedRequest.decision_note ?? "");
      })
      .catch((fetchError) => {
        if (isAbortError(fetchError)) return;
        setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger la demande.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [requestId]);

  const approveRequest = async (email?: { recipient: string; subject: string; body: string }) => {
    if (!request) return;
    setSubmittingAction(email ? "approve-email" : "approve");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/approve`, {
        method: "POST",
        json: { decision_note: decisionNote, ...(email ? { email } : {}) },
      });
      setRequest(updated);
      setEmailComposer(null);
      setNotice(email || request.email ? "Demande approuvée et email envoyé." : "Demande approuvée.");
    } catch (actionError) {
      setError(
        isApiError(actionError) || actionError instanceof Error
          ? actionError.message
          : "Action impossible.",
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const rejectRequest = async () => {
    if (!request) return;
    setSubmittingAction("reject");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/reject`, {
        method: "POST",
        json: { decision_note: decisionNote },
      });
      setRequest(updated);
      setNotice("Demande rejetée.");
    } catch (actionError) {
      setError(
        isApiError(actionError) || actionError instanceof Error
          ? actionError.message
          : "Action impossible.",
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const openDateEditor = () => {
    if (!request || request.status !== "pending") return;
    setDateEditor({
      date_entree: toDateInputValue(request.date_entree),
      date_sortie: toDateInputValue(request.date_sortie),
    });
    setError(null);
    setNotice(null);
  };

  const saveDateEditor = async () => {
    if (!request || !dateEditor) return;
    setSavingDates(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/dates`, {
        method: "POST",
        json: dateEditor,
      });
      setRequest(updated);
      setDateEditor(null);
      setNotice("Dates de la demande mises à jour.");
    } catch (actionError) {
      setError(
        isApiError(actionError) || actionError instanceof Error
          ? actionError.message
          : "Mise à jour des dates impossible.",
      );
    } finally {
      setSavingDates(false);
    }
  };

  const openApprovalEmailComposer = async () => {
    if (!request) return;
    setSubmittingAction("approve-email");
    setError(null);
    setNotice(null);
    try {
      const emailTextSettings = await apiFetch<DocumentEmailTextSettings>("/settings/document-email-texts");
      const draft = buildBookingRequestApprovedEmailDraft(
        request,
        buildDocumentEmailTemplateSettings(emailTextSettings),
      );
      setEmailComposer({
        requestId: request.id,
        recipient: draft.recipient ?? request.email ?? "",
        subject: draft.subject,
        body: draft.body,
      });
    } catch (composerError) {
      setError(composerError instanceof Error ? composerError.message : "Impossible de préparer l'email.");
    } finally {
      setSubmittingAction(null);
    }
  };

  const sendComposedApproval = async () => {
    if (!emailComposer || !request || emailComposer.requestId !== request.id) return;
    await approveRequest({
      recipient: emailComposer.recipient,
      subject: emailComposer.subject,
      body: emailComposer.body,
    });
  };

  return (
    <main className="page-shell booking-request-detail-page">
      <Link to={backTarget} className="booking-request-detail-page__back">
        <BackIcon />
        Retour aux demandes
      </Link>

      <section className="card booking-request-detail-page__card">
        {loading ? <div className="note">Chargement…</div> : null}
        {error ? <div className="note note--danger">{error}</div> : null}
        {!loading && !request && !error ? <div className="note">Demande introuvable.</div> : null}

        {request ? (
          <>
            <div className="booking-request-detail-page__heading">
              <div>
                <span className="booking-request-detail-page__eyebrow">Demande de réservation</span>
                <h1>{request.hote_nom || "Client sans nom"}</h1>
                <p>{request.gite?.nom ?? request.gite_id}</p>
              </div>
              <span className={`badge badge--${request.status}`}>{requestStatusLabels[request.status]}</span>
            </div>

            <div className={`booking-requests-page__status booking-requests-page__status--${request.status}`}>
              <div>
                <strong>{requestStatusDetail[request.status].title}</strong>
                <span>{requestStatusDetail[request.status].description}</span>
              </div>
            </div>

            {notice ? <div className="note">{notice}</div> : null}

            <div className="booking-requests-page__grid">
              <div className="booking-requests-page__date-summary">
                <strong>Dates du séjour</strong>
                <span>{formatDate(request.date_entree)} → {formatDate(request.date_sortie)}</span>
                <small>{request.nb_nuits} nuit{request.nb_nuits > 1 ? "s" : ""}</small>
                {request.status === "pending" ? (
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
              <div><strong>Voyageurs</strong><br />{request.nb_adultes} adulte(s), {request.nb_enfants_2_17} enfant(s)</div>
              <div><strong>Contact</strong><br />{request.telephone || "Téléphone absent"}<br />{request.email || "Email absent"}</div>
              <div><strong>Demande reçue</strong><br />{formatBookingRequestCreatedAt(request.createdAt)}</div>
              <div><strong>{getRequestTimelineLabel(request)}</strong><br />{getRequestTimelineValue(request)}</div>
            </div>

            {dateEditor ? (
              <div className="booking-requests-page__date-editor">
                <label className="field">
                  Arrivée
                  <input
                    type="date"
                    value={dateEditor.date_entree}
                    onChange={(event) => setDateEditor((current) => current ? { ...current, date_entree: event.target.value } : current)}
                  />
                </label>
                <label className="field">
                  Départ
                  <input
                    type="date"
                    value={dateEditor.date_sortie}
                    onChange={(event) => setDateEditor((current) => current ? { ...current, date_sortie: event.target.value } : current)}
                  />
                </label>
                <div className="booking-requests-page__date-editor-actions">
                  <button type="button" onClick={() => void saveDateEditor()} disabled={savingDates || Boolean(submittingAction)}>
                    {savingDates ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setDateEditor(null)} disabled={savingDates}>
                    Annuler
                  </button>
                </div>
              </div>
            ) : null}

            <div className="booking-request-detail-page__content-grid">
              <div>
                {request.message_client ? (
                  <div className="booking-request-detail-page__message">
                    <strong>Message du client</strong>
                    <p>{request.message_client}</p>
                  </div>
                ) : null}

                {request.status === "pending" ? (
                  <label className="field booking-request-detail-page__decision-note">
                    Note de décision
                    <textarea
                      rows={4}
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                      placeholder="Optionnel"
                    />
                  </label>
                ) : (
                  <div className="booking-requests-page__decision">
                    <strong>Note de décision</strong>
                    <p>{request.decision_note || "Aucune note enregistrée."}</p>
                    {request.approved_reservation?.id ? (
                      <Link to="/reservations" className="button-secondary">Voir la réservation créée</Link>
                    ) : null}
                  </div>
                )}
              </div>

              <aside className="booking-requests-page__pricing">
                <h2>Estimation</h2>
                <div><span>Hébergement</span><strong>{formatEuro(request.pricing_snapshot.montant_hebergement)}</strong></div>
                <div><span>Options</span><strong>{formatEuro(request.pricing_snapshot.total_options)}</strong></div>
                <div><span>Taxe de séjour</span><strong>{formatEuro(request.pricing_snapshot.taxe_sejour)}</strong></div>
                <div className="booking-requests-page__pricing-total"><span>Total</span><strong>{formatEuro(request.pricing_snapshot.total_global)}</strong></div>
              </aside>
            </div>

            {request.status === "pending" ? (
              <div className="actions booking-request-detail-page__actions">
                <button type="button" onClick={() => void openApprovalEmailComposer()} disabled={Boolean(submittingAction)}>
                  {submittingAction === "approve-email" ? "Préparation…" : "Prévisualiser puis approuver"}
                </button>
                <button type="button" className="button-secondary" onClick={() => void approveRequest()} disabled={Boolean(submittingAction)}>
                  {submittingAction === "approve" ? "Envoi…" : request.email ? "Approuver sans relecture" : "Approuver sans email"}
                </button>
                <button type="button" className="button-secondary" onClick={() => void rejectRequest()} disabled={Boolean(submittingAction)}>
                  {submittingAction === "reject" ? "Refus…" : "Rejeter"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
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
        onRecipientChange={(value) => setEmailComposer((previous) => previous ? { ...previous, recipient: value } : previous)}
        onSubjectChange={(value) => setEmailComposer((previous) => previous ? { ...previous, subject: value } : previous)}
        onBodyChange={(value) => setEmailComposer((previous) => previous ? { ...previous, body: value } : previous)}
        onDeliveryModeChange={() => undefined}
        onSubmit={() => void sendComposedApproval()}
      />
    </main>
  );
};

export default BookingRequestDetailPage;
