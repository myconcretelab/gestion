import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BOOKING_SOURCES, createTouristTaxStay, isReservationPaymentTracking } from "@contrats/shared";
import { apiFetch, isApiError } from "../../utils/api";
import { canCurrentUserAccessPage, canCurrentUserViewAmounts, canCurrentUserWritePage } from "../../utils/auth";
import { formatDate, formatEuro } from "../../utils/format";
import { computeReservationOptionsPreview } from "../../utils/reservationOptions";
import type { Gite, Reservation } from "../../utils/types";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";
import ReservationOptionsEditor from "./ReservationOptionsEditor";
import ReservationPaymentsEditor from "./ReservationPaymentsEditor";
import { ReservationPaymentDetails } from "./ReservationPaymentSummary";
import TouristTaxStayEditor from "./TouristTaxStayEditor";
import { buildReservationEditPayload, createReservationEditDraft, recalculateReservationEditPrice, reservationEditFees, reservationEditNights, type ReservationEditDraft } from "./reservationEditDraft";

type PendingAction = { kind: "close" } | { kind: "select"; id: string } | { kind: "open" };

export default function TodayReservationDetailsDrawer({ reservations, initialReservationId, onClose, onOpenReservation, onSaved }: {
  reservations: Array<{ label: string; reservation: Reservation }>;
  initialReservationId: string;
  onClose: () => void;
  onOpenReservation: (reservation: Reservation) => void;
  onSaved: (reservation: Reservation) => void;
}) {
  const formId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const [selectedId, setSelectedId] = useState(initialReservationId);
  const [loaded, setLoaded] = useState<Reservation | null>(null);
  const [gites, setGites] = useState<Gite[]>([]);
  const [draft, setDraft] = useState<ReservationEditDraft | null>(null);
  const [initialDraft, setInitialDraft] = useState<ReservationEditDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const selected = reservations.find((item) => item.reservation.id === selectedId) ?? reservations[0];
  const reservation = loaded?.id === selected.reservation.id ? { ...selected.reservation, ...loaded } : selected.reservation;
  const loading = loaded?.id !== selected.reservation.id || !draft;
  const busy = saving || paymentBusy;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const showAmounts = canCurrentUserViewAmounts();
  const canEdit = canCurrentUserWritePage("reservations") && showAmounts;
  const canOpenReservation = canCurrentUserAccessPage("reservations");
  const gite = gites.find((item) => item.id === draft?.gite_id) ?? null;
  const nights = draft ? reservationEditNights(draft) : reservation.nb_nuits;
  const preview = computeReservationOptionsPreview(draft?.options, { nights, gite });
  const fees = draft ? reservationEditFees(draft, reservation, gite) : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setDraft(null);
    setInitialDraft(null);
    setLoadError(null);
    setSaveError(null);
    setNotice("");
    void Promise.all([
      apiFetch<Reservation>(`/reservations/${encodeURIComponent(selected.reservation.id)}`, { signal: controller.signal }),
      apiFetch<Gite[]>("/gites", { signal: controller.signal }),
    ]).then(([details, availableGites]) => {
      if (controller.signal.aborted) return;
      const next = createReservationEditDraft(details, availableGites.find((item) => item.id === details.gite_id) ?? null);
      setGites(availableGites);
      setLoaded(details);
      setDraft(next);
      setInitialDraft(next);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError("Impossible de charger la réservation et ses tarifs.");
    });
    return () => controller.abort();
  }, [selected.reservation.id, retry]);

  useEffect(() => {
    if (saveError) errorRef.current?.focus();
  }, [saveError]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  const performAction = (action: PendingAction, current = reservation) => {
    setPendingAction(null);
    if (action.kind === "close") onClose();
    else if (action.kind === "open") onOpenReservation(current);
    else setSelectedId(action.id);
  };
  const requestAction = (action: PendingAction) => {
    if (busy || savingRef.current) return;
    if (dirty) setPendingAction(action);
    else performAction(action);
  };

  const update = (patch: Partial<ReservationEditDraft>) => {
    setDraft((current) => {
      if (!current) return current;
      let next = { ...current, ...patch };
      if (patch.prix_par_nuit !== undefined) next.price_driver = "nightly";
      if (patch.prix_total !== undefined) next.price_driver = "total";
      if (patch.date_entree !== undefined || patch.date_sortie !== undefined) next.feesChanged = true;
      if (patch.gite_id !== undefined && patch.gite_id !== current.gite_id) {
        const target = gites.find((item) => item.id === patch.gite_id);
        next.options = { ...next.options, tourist_tax: target?.taxe_sejour_config ? createTouristTaxStay(target.taxe_sejour_config) : undefined };
        next.feesChanged = true;
      }
      if (patch.prix_par_nuit !== undefined || patch.prix_total !== undefined || patch.date_entree !== undefined || patch.date_sortie !== undefined) {
        next = recalculateReservationEditPrice(next);
      }
      return next;
    });
    setSaveError(null);
    setNotice("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !loaded || !canEdit || busy || savingRef.current) return;
    setSaveError(null);
    setNotice("");
    try {
      const payload = buildReservationEditPayload(draft, loaded, gite);
      savingRef.current = true;
      setSaving(true);
      const updated = await apiFetch<Reservation>(`/reservations/${encodeURIComponent(loaded.id)}`, { method: "PUT", json: payload });
      const next = createReservationEditDraft(updated, gites.find((item) => item.id === updated.gite_id) ?? null);
      setLoaded(updated);
      setDraft(next);
      setInitialDraft(next);
      setNotice("Réservation enregistrée.");
      onSaved(updated);
      if (pendingAction) performAction(pendingAction, updated);
    } catch (error) {
      const conflicts = isApiError(error) && "conflicts" in error.payload && Array.isArray(error.payload.conflicts)
        ? error.payload.conflicts.map((conflict: { label?: string }) => conflict.label).filter(Boolean).join(" · ") : "";
      setSaveError([error instanceof Error ? error.message : "Impossible d’enregistrer la réservation.", conflicts].filter(Boolean).join(" "));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <ReservationDetailsDrawer
      open
      className="today-reservation-drawer"
      eyebrow={canEdit ? "Modifier la réservation" : "Détail de la réservation"}
      title={reservation.hote_nom || "Hôte non renseigné"}
      summary={[
        reservation.gite?.nom ?? "Gîte non renseigné",
        `${formatDate(reservation.date_entree)} → ${formatDate(reservation.date_sortie)}`,
      ]}
      busy={busy}
      onClose={() => requestAction({ kind: "close" })}
      footer={pendingAction ? (
        <div className="today-reservation-drawer__pending" role="alert">
          <p>Des modifications ne sont pas enregistrées.</p>
          <div>
            <button type="submit" form={formId} disabled={busy}>Enregistrer et continuer</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => performAction(pendingAction)}>Abandonner les modifications</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setPendingAction(null)}>Continuer l’édition</button>
          </div>
        </div>
      ) : <div className="today-reservation-drawer__footer">
        <div>
          <button type="button" className="secondary" disabled={busy} onClick={() => {
            setDraft(initialDraft); setSaveError(null); setNotice("");
            if (!dirty) onClose();
          }}>{dirty ? "Annuler" : "Fermer"}</button>
          {canOpenReservation ? <button type="button" className="secondary" disabled={busy} onClick={() => requestAction({ kind: "open" })}>Page Réservations</button> : null}
        </div>
        {canEdit ? <button type="submit" form={formId} disabled={busy || loading || !dirty}>{saving ? "Enregistrement…" : "Enregistrer"}</button> : null}
        <p role="status">{notice || (dirty ? "Modifications non enregistrées." : "")}</p>
      </div>}
    >
      {reservations.length > 1 ? (
        <div className="today-reservation-drawer__choices" role="group" aria-label="Réservations de la rotation">
          {reservations.map((item) => (
            <button type="button" key={item.reservation.id} aria-pressed={item.reservation.id === selectedId}
              disabled={busy} onClick={() => { if (item.reservation.id !== selectedId) requestAction({ kind: "select", id: item.reservation.id }); }}>
              {item.label} · {item.reservation.hote_nom}
            </button>
          ))}
        </div>
      ) : null}
      {loadError ? <div role="alert">{loadError} <button type="button" className="secondary" onClick={() => setRetry((current) => current + 1)}>Réessayer</button></div> : loading || !draft ? <p role="status">Chargement de la réservation…</p> : (
        <>
          {saveError ? <div ref={errorRef} role="alert" tabIndex={-1} className="today-reservation-drawer__error">{saveError}</div> : null}
          <form id={formId} onSubmit={(event) => void save(event)} aria-label="Édition de la réservation">
            <fieldset className="today-reservation-drawer__fieldset" disabled={busy || !canEdit}>
              <section className="today-reservation-drawer__section">
                <h3>Séjour et coordonnées</h3>
                <div className="today-reservation-drawer__fields">
                  <label className="field">Gîte<select aria-label="Gîte" value={draft.gite_id} onChange={(event) => update({ gite_id: event.target.value })}>
                    {!draft.gite_id ? <option value="">Gîte non renseigné</option> : null}
                    {gites.map((item) => <option value={item.id} key={item.id}>{item.nom}</option>)}
                  </select></label>
                  <label className="field">Nom de l’hôte<input required value={draft.hote_nom} onChange={(event) => update({ hote_nom: event.target.value })} /></label>
                  <label className="field">Téléphone<input type="tel" value={draft.telephone} onChange={(event) => update({ telephone: event.target.value })} /></label>
                  <label className="field">Email<input type="email" value={draft.email} onChange={(event) => update({ email: event.target.value })} /></label>
                  <label className="field">Date d’entrée<input type="date" required value={draft.date_entree} onChange={(event) => update({ date_entree: event.target.value })} /></label>
                  <label className="field">Date de sortie<input type="date" required value={draft.date_sortie} onChange={(event) => update({ date_sortie: event.target.value })} /></label>
                  <label className="field">Adultes<input type="number" min={0} step={1} required value={draft.nb_adultes} onChange={(event) => update({ nb_adultes: Number(event.target.value) })} /></label>
                  <label className="field">Enfants de 2 à 17 ans<input type="number" min={0} step={1} required value={draft.nb_enfants_2_17} onChange={(event) => update({ nb_enfants_2_17: Number(event.target.value) })} /></label>
                  <label className="field">Origine de la réservation<select aria-label="Origine de la réservation" value={draft.booking_source} onChange={(event) => update({ booking_source: event.target.value })}>
                    {BOOKING_SOURCES.map((source) => <option key={source}>{source}</option>)}
                  </select></label>
                  <label className="field">Lien Airbnb<input type="url" value={draft.airbnb_url} onChange={(event) => update({ airbnb_url: event.target.value })} /></label>
                </div>
                <p className="field-hint">{Math.max(0, nights)} nuit{nights > 1 ? "s" : ""}</p>
                <label className="field">Notes<textarea aria-label="Notes" rows={3} value={draft.commentaire} onChange={(event) => update({ commentaire: event.target.value })} /></label>
              </section>
              {showAmounts ? <>
                <section className="today-reservation-drawer__section">
                  <h3>Tarif du séjour</h3>
                  <div className="today-reservation-drawer__fields">
                    <label className="field">Prix par nuit (€)<input type="number" min={0} step={0.01} required value={draft.prix_par_nuit} onChange={(event) => update({ prix_par_nuit: Number(event.target.value) })} /></label>
                    <label className="field">Prix de l’hébergement (€)<input type="number" min={0} step={0.01} required value={draft.prix_total} onChange={(event) => update({ prix_total: Number(event.target.value) })} /></label>
                  </div>
                  <p className="field-hint">Options en supplément : {formatEuro(fees?.amount ?? 0)}. La taxe de séjour suit le barème enregistré ci-dessous.</p>
                </section>
                <section className="today-reservation-drawer__section">
                  <h3>Options du séjour</h3>
                  <ReservationOptionsEditor options={draft.options} preview={preview} gite={gite} guestCount={draft.nb_adultes} layout="drawer"
                    onChange={(options) => update({ options, feesChanged: true })} />
                  <div className="today-reservation-drawer__fields">
                    <label className="field">Options complémentaires — libellé<input value={draft.additionalFeesLabel} onChange={(event) => update({ additionalFeesLabel: event.target.value, feesChanged: true })} /></label>
                    <label className="field">Options complémentaires — montant (€)<input type="number" min={0} step={0.01} value={draft.additionalFeesAmount} onChange={(event) => update({ additionalFeesAmount: Number(event.target.value), feesChanged: true })} /></label>
                  </div>
                  <TouristTaxStayEditor value={draft.options.tourist_tax} settings={gite?.taxe_sejour_config}
                    nights={nights} adults={draft.nb_adultes} children={draft.nb_enfants_2_17} accommodation={draft.prix_total} start={draft.date_entree}
                    onChange={(tourist_tax) => update({ options: { ...draft.options, tourist_tax } })} />
                </section>
              </> : null}
              <section className="today-reservation-drawer__section">
                <h3>Conditions du séjour</h3>
                {([
                  ["regle_animaux_acceptes", "Animaux acceptés"],
                  ["regle_bois_premiere_flambee", "Bois fourni pour la première flambée"],
                  ["regle_tiers_personnes_info", "Informer avant d’accueillir des personnes supplémentaires"],
                ] as const).map(([key, label]) => <label className="today-reservation-drawer__check" key={key}>
                  <input type="checkbox" checked={Boolean(draft.options[key])} onChange={(event) => update({ options: { ...draft.options, [key]: event.target.checked } })} />{label}
                </label>)}
              </section>
            </fieldset>
          </form>
          {showAmounts ? (
            <section className="today-reservation-drawer__section"><h3>Règlements</h3>
              {dirty ? <p className="field-hint">Enregistrez le séjour pour actualiser le montant à régler et gérer ses règlements.</p> : (
                <fieldset className="today-reservation-drawer__fieldset" disabled={saving}>
                  {isReservationPaymentTracking(reservation.payment_tracking) ? (
                    <ReservationPaymentsEditor key={reservation.id} reservation={reservation} tracking={reservation.payment_tracking} showOrigin={false}
                      onBusyChange={setPaymentBusy} onUpdated={(payment_tracking) => setLoaded((current) => current ? { ...current, payment_tracking } : current)} />
                  ) : <ReservationPaymentDetails reservation={reservation} detailsId={`today-payment-${reservation.id}`} onChangeSource={() => onOpenReservation(reservation)} />}
                </fieldset>
              )}
            </section>
          ) : null}
          {showAmounts && (reservation.energy_live_cost_eur || reservation.energy_cost_eur) ? (
            <section className="today-reservation-drawer__section"><h3>Consommation d’énergie</h3><p>{formatEuro(reservation.energy_live_cost_eur || reservation.energy_cost_eur)}</p></section>
          ) : null}
        </>
      )}
    </ReservationDetailsDrawer>
  );
}
