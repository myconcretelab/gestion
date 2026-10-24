import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiFetch, isAbortError, isApiError } from "../utils/api";
import { formatDate, formatEuro } from "../utils/format";
import type { BookingRequest, ContratOptions, Gite } from "../utils/types";
import { computeReservationOptionsPreview } from "../utils/reservationOptions";
import { buildPhoneHref, formatPhoneForDisplay } from "../utils/phone";
import { dispatchBookingRequestsChanged } from "../utils/bookingRequestsBadge";
import { dispatchRecentImportedReservationsCreated } from "../utils/recentImportsBadge";
import {
  buildBookingRequestApprovedEmailDraft,
  buildDocumentEmailTemplateSettings,
  type DocumentEmailTextSettings,
} from "../utils/documentEmail";
import {
  buildApprovedReservationHref,
  formatBookingRequestCreatedAt,
  getRequestTimelineLabel,
  getRequestTimelineValue,
  getBookingRequestOptionLines,
  requestStatusDetail,
  requestStatusLabels,
} from "./bookingRequestUi";
import DocumentEmailComposerDialog from "./shared/DocumentEmailComposerDialog";
import ReservationOptionsEditor from "./shared/ReservationOptionsEditor";

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
  const [internalNote, setInternalNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "approve-email" | "reject" | "refresh" | null>(null);
  const [dateEditor, setDateEditor] = useState<{ date_entree: string; date_sortie: string } | null>(null);
  const [savingDates, setSavingDates] = useState(false);
  const [savingInternalNote, setSavingInternalNote] = useState(false);
  const [emailComposer, setEmailComposer] = useState<ApprovalEmailComposerState | null>(null);
  const [optionsEditor, setOptionsEditor] = useState<{ options: ContratOptions; gite: Gite } | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const editingStay = Boolean(optionsEditor) || loadingOptions || savingOptions || Boolean(dateEditor) || savingDates;
  const phoneHref = buildPhoneHref(request?.telephone);
  const gitePhoto = request?.gite?.photos?.[0] ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotice(null);
    setOptionsEditor(null);
    setDateEditor(null);
    setEmailComposer(null);

    apiFetch<BookingRequest>(`/booking-requests/${requestId}`, { signal: controller.signal })
      .then((loadedRequest) => {
        setRequest(loadedRequest);
        setDecisionNote(loadedRequest.decision_note ?? "");
        setInternalNote(loadedRequest.internal_note ?? "");
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
        json: { decision_note: decisionNote, internal_note: internalNote, ...(email ? { email } : {}) },
      });
      setRequest(updated);
      dispatchBookingRequestsChanged();
      dispatchRecentImportedReservationsCreated(1);
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
        json: { decision_note: decisionNote, internal_note: internalNote },
      });
      setRequest(updated);
      dispatchBookingRequestsChanged();
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

  const saveInternalNote = async () => {
    if (!request || request.status === "approved") return;
    setSavingInternalNote(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/internal-note`, {
        method: "POST",
        json: { internal_note: internalNote },
      });
      setRequest(updated);
      setInternalNote(updated.internal_note ?? "");
      setNotice("Notes internes enregistrées.");
    } catch (actionError) {
      setError(
        isApiError(actionError) || actionError instanceof Error
          ? actionError.message
          : "Enregistrement des notes internes impossible.",
      );
    } finally {
      setSavingInternalNote(false);
    }
  };

  const refreshRequest = async () => {
    if (!request || request.status !== "expired") return;
    setSubmittingAction("refresh");
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/refresh`, {
        method: "POST",
      });
      setRequest(updated);
      setDecisionNote("");
      setInternalNote(updated.internal_note ?? "");
      dispatchBookingRequestsChanged();
      setNotice("Demande réactivée pour 24 heures. Les disponibilités et le tarif ont été vérifiés.");
    } catch (actionError) {
      setError(
        isApiError(actionError) || actionError instanceof Error
          ? actionError.message
          : "Réactivation impossible.",
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

  const openOptionsEditor = async () => {
    if (!request || request.status !== "pending") return;
    setLoadingOptions(true);
    setError(null);
    setNotice(null);
    try {
      const gite = await apiFetch<Gite>(`/gites/${request.gite_id}`);
      setOptionsEditor({ gite, options: {
        ...request.options,
        regle_animaux_acceptes: request.options.regle_animaux_acceptes ?? gite.regle_animaux_acceptes,
      } });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Impossible de charger les options.");
    } finally {
      setLoadingOptions(false);
    }
  };

  const saveOptionsEditor = async () => {
    if (!request || !optionsEditor) return;
    setSavingOptions(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<BookingRequest>(`/booking-requests/${request.id}/options`, {
        method: "POST", json: { options: optionsEditor.options },
      });
      setRequest(updated);
      setOptionsEditor(null);
      setEmailComposer(null);
      setNotice("Options enregistrées et total mis à jour. L’email d’approbation reprendra ces options. Aucun email n’a été envoyé.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Mise à jour des options impossible.");
    } finally {
      setSavingOptions(false);
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
              <div className="booking-request-detail-page__gite-hero">
                {gitePhoto ? (
                  <img
                    className="booking-request-detail-page__gite-photo"
                    src={gitePhoto.url}
                    alt={gitePhoto.alt || gitePhoto.title || request.gite?.nom || "Photo du gîte"}
                  />
                ) : (
                  <div className="booking-request-detail-page__gite-photo booking-request-detail-page__gite-photo--placeholder" aria-hidden="true">
                    {(request.gite?.nom ?? "G").trim().slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <span className="booking-request-detail-page__eyebrow">Demande de réservation</span>
                  <h1>{request.gite?.nom ?? request.gite_id}</h1>
                  <p>Client : <strong>{request.hote_nom || "Client sans nom"}</strong></p>
                </div>
              </div>
              <span className={`badge badge--${request.status}`}>{requestStatusLabels[request.status]}</span>
            </div>

            <div className={`booking-requests-page__status booking-requests-page__status--${request.status}`}>
              <div>
                <strong>{requestStatusDetail[request.status].title}</strong>
                <span>{requestStatusDetail[request.status].description}</span>
              </div>
            </div>

            {request.payment ? <div className="note" role="status">
              <strong>Paiement par carte — {request.payment.purpose === "deposit" ? "arrhes" : "totalité"}</strong>
              <p>{request.payment.status === "pending" ? "Paiement en cours. La réservation sera confirmée automatiquement après encaissement." : request.payment.status === "paid" ? "Paiement reçu, réservation confirmée automatiquement." : request.payment.status === "expired" ? "Paiement expiré ou annulé. Aucune confirmation." : "Ce paiement nécessite votre vérification."}</p>
              <p>Encaissé : {formatEuro(request.payment.paid_amount_cents / 100)} · Solde initial : {formatEuro(Math.max(0, request.payment.total_cents - request.payment.paid_amount_cents) / 100)}</p>
              {request.payment.refunded_amount_cents > 0 ? <p>Remboursé : {formatEuro(request.payment.refunded_amount_cents / 100)}</p> : null}
              {request.payment.review_reason ? <p>{request.payment.review_reason}</p> : null}
            </div> : null}

            {notice ? <div className="note">{notice}</div> : null}

            <div className="booking-requests-page__grid">
              <div className="booking-requests-page__date-summary">
                <strong>Dates du séjour</strong>
                <span>{formatDate(request.date_entree)} → {formatDate(request.date_sortie)}</span>
                <small>{request.nb_nuits} nuit{request.nb_nuits > 1 ? "s" : ""}</small>
                {request.status === "pending" && !request.payment ? (
                  <button
                    type="button"
                    className="button-secondary booking-requests-page__date-edit-button"
                    onClick={openDateEditor}
                    disabled={editingStay || Boolean(submittingAction)}
                  >
                    Modifier les dates
                  </button>
                ) : null}
              </div>
              <div><strong>Voyageurs</strong><br />{request.nb_adultes} adulte(s), {request.nb_enfants_2_17} enfant(s)</div>
              <div>
                <strong>Contact</strong><br />
                {phoneHref ? (
                  <a className="detail-link" href={phoneHref}>{formatPhoneForDisplay(request.telephone)}</a>
                ) : "Téléphone absent"}
                <br />{request.email || "Email absent"}
              </div>
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
                <section className="booking-request-detail-page__options">
                  <h2>Options du séjour</h2>
                  {getBookingRequestOptionLines(request).length ? (
                    <ul>
                      {getBookingRequestOptionLines(request).map((line) => (
                        <li key={line.label}><span>{line.label}</span><strong>{typeof line.amount === "number" ? formatEuro(line.amount) : ""}</strong></li>
                      ))}
                    </ul>
                  ) : <p>Aucune option choisie.</p>}
                  {request.status === "pending" && !request.payment && !optionsEditor ? (
                    <button type="button" className="button-secondary" onClick={() => void openOptionsEditor()} disabled={editingStay || Boolean(submittingAction)}>
                      {loadingOptions ? "Chargement…" : "Modifier les options"}
                    </button>
                  ) : null}
                  {optionsEditor ? (
                    <div className="booking-request-detail-page__options-editor">
                      <p>Les tarifs ci-dessous s’ajoutent au séjour. Le prix de l’hébergement est conservé.</p>
                      <fieldset disabled={savingOptions}>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={optionsEditor.options.regle_animaux_acceptes ?? false}
                            onChange={(event) => setOptionsEditor({ ...optionsEditor, options: { ...optionsEditor.options, regle_animaux_acceptes: event.target.checked,
                              ...(!event.target.checked ? { chiens: { ...optionsEditor.options.chiens, enabled: false } } : {}),
                            } })} />
                          Animaux acceptés pour ce séjour
                        </label>
                        <ReservationOptionsEditor
                          options={optionsEditor.options}
                          preview={computeReservationOptionsPreview(optionsEditor.options, { nights: request.nb_nuits, gite: optionsEditor.gite })}
                          gite={optionsEditor.gite}
                          guestCount={request.nb_adultes + request.nb_enfants_2_17}
                          onChange={(options) => setOptionsEditor({ ...optionsEditor, options })}
                          layout="compact"
                          showDeclaredToggle={false}
                        />
                      </fieldset>
                      <p><strong>Total des options : {formatEuro(computeReservationOptionsPreview(optionsEditor.options, { nights: request.nb_nuits, gite: optionsEditor.gite }).total)}</strong></p>
                      <div className="actions">
                        <button type="button" onClick={() => void saveOptionsEditor()} disabled={savingOptions}>{savingOptions ? "Enregistrement…" : "Enregistrer les options"}</button>
                        <button type="button" className="button-secondary" onClick={() => setOptionsEditor(null)} disabled={savingOptions}>Annuler</button>
                      </div>
                    </div>
                  ) : null}
                </section>
                {request.message_client ? (
                  <div className="booking-request-detail-page__message">
                    <strong>Message du client</strong>
                    <p>{request.message_client}</p>
                  </div>
                ) : null}

                {request.status === "approved" ? (
                  <div className="booking-request-detail-page__internal-note booking-request-detail-page__internal-note--saved">
                    <strong>Notes internes</strong>
                    <p>{request.internal_note || "Aucune note interne attachée à la réservation."}</p>
                    <small>Pour la modifier, ouvrez la réservation créée.</small>
                  </div>
                ) : (
                  <div className="booking-request-detail-page__internal-note">
                    <label className="field">
                      Notes internes
                      <textarea
                        rows={4}
                        value={internalNote}
                        onChange={(event) => setInternalNote(event.target.value)}
                        placeholder="Informations utiles pour le suivi de la réservation"
                      />
                      <small>Cette note sera attachée à la réservation lors de l’approbation.</small>
                    </label>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void saveInternalNote()}
                      disabled={
                        savingInternalNote ||
                        Boolean(submittingAction) ||
                        internalNote.trim() === String(request.internal_note ?? "").trim()
                      }
                    >
                      {savingInternalNote ? "Enregistrement…" : "Enregistrer les notes"}
                    </button>
                  </div>
                )}

                {request.status === "pending" && !request.payment ? (
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
                    {request.approved_reservation?.id || request.approved_reservation_id ? (
                      <Link to={buildApprovedReservationHref(request)} className="button-secondary">
                        Voir la réservation créée
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>

              <aside className="booking-requests-page__pricing">
                <h2>Estimation</h2>
                <div><span>Hébergement</span><strong>{formatEuro(request.pricing_snapshot.tourist_tax_result?.accommodation_amount ?? request.pricing_snapshot.montant_hebergement)}</strong></div>
                <div><span>Options</span><strong>{formatEuro(request.pricing_snapshot.total_options)}</strong></div>
                <div><span>Taxe de séjour</span><strong>{formatEuro(request.pricing_snapshot.taxe_sejour)}</strong></div>
                <div className="booking-requests-page__pricing-total"><span>Total</span><strong>{formatEuro(request.pricing_snapshot.total_global)}</strong></div>
              </aside>
            </div>

            {request.status === "pending" && !request.payment ? (
              <div className="actions booking-request-detail-page__actions">
                <button type="button" onClick={() => void openApprovalEmailComposer()} disabled={Boolean(submittingAction) || editingStay}>
                  {submittingAction === "approve-email" ? "Préparation…" : "Prévisualiser puis approuver"}
                </button>
                <button type="button" className="button-secondary" onClick={() => void approveRequest()} disabled={Boolean(submittingAction) || editingStay}>
                  {submittingAction === "approve" ? "Envoi…" : request.email ? "Approuver sans relecture" : "Approuver sans email"}
                </button>
                <button type="button" className="button-secondary" onClick={() => void rejectRequest()} disabled={Boolean(submittingAction) || editingStay}>
                  {submittingAction === "reject" ? "Refus…" : "Rejeter"}
                </button>
              </div>
            ) : request.status === "expired" && !request.payment ? (
              <div className="actions booking-request-detail-page__actions">
                <button type="button" onClick={() => void refreshRequest()} disabled={Boolean(submittingAction)}>
                  {submittingAction === "refresh" ? "Vérification…" : "Réactiver la demande"}
                </button>
                <span className="booking-request-detail-page__refresh-hint">
                  Vérifie les disponibilités, recalcule le tarif et bloque les dates pendant 24 heures.
                </span>
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
