import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch, isApiError } from "../../utils/api";
import { formatDate, formatEuro } from "../../utils/format";
import { computeReservationOptionsPreview, mergeReservationOptions } from "../../utils/reservationOptions";
import type { Contrat, ContratOptions, Reservation } from "../../utils/types";
import ReservationOptionsEditor from "./ReservationOptionsEditor";
import { toDateInputValue } from "./rentalForm";

type ContractReturnDrawerProps = {
  open: boolean;
  contract: Contrat | null;
  onClose: () => void;
  onUpdated: (updated: Contrat) => void;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";

const RESERVATION_PAYMENT_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

const ARRHES_PAYMENT_MODES = ["Chèque", "Virement", "Espèces", "A définir"] as const;

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ContractReturnDrawer = ({ open, contract, onClose, onUpdated }: ContractReturnDrawerProps) => {
  const titleId = useId();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkingReservation, setLinkingReservation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contractReceived, setContractReceived] = useState(false);
  const [receptionDate, setReceptionDate] = useState("");
  const [arrhesPaid, setArrhesPaid] = useState(false);
  const [arrhesDate, setArrhesDate] = useState("");
  const [arrhesPaymentMode, setArrhesPaymentMode] = useState("");
  const [reservationPaymentSource, setReservationPaymentSource] = useState("");
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<ContratOptions>(mergeReservationOptions());

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add(APP_SCROLL_LOCK_CLASS);
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS);
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open, saving]);

  useEffect(() => {
    if (!open || !contract) return;
    let active = true;
    const controller = new AbortController();

    setLoading(Boolean(contract.reservation_id));
    setSaving(false);
    setLinkingReservation(false);
    setError(null);
    setReservation(null);
    setContractReceived(contract.statut_reception_contrat === "recu");
    setReceptionDate(
      toDateInputValue(contract.date_reception_contrat) ||
        (contract.statut_reception_contrat === "recu" ? todayInputValue() : "")
    );
    setArrhesPaid(contract.statut_paiement_arrhes === "recu");
    setArrhesDate(
      toDateInputValue(contract.date_paiement_arrhes) ||
        (contract.statut_paiement_arrhes === "recu" ? todayInputValue() : "")
    );
    setArrhesPaymentMode(contract.mode_paiement_arrhes ?? "");
    setReservationPaymentSource("");
    setNotes(contract.notes ?? "");
    setOptions(mergeReservationOptions(contract.options));

    if (!contract.reservation_id) {
      setLoading(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    apiFetch<Reservation>(`/reservations/${contract.reservation_id}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setReservation(data);
        setReservationPaymentSource(data.source_paiement ?? "");
        setOptions(mergeReservationOptions(data.options ?? contract.options));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Impossible de charger la réservation liée.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [contract, open]);

  const optionPreview = useMemo(
    () =>
      computeReservationOptionsPreview(options, {
        nights: Math.max(0, Number(reservation?.nb_nuits ?? contract?.nb_nuits ?? 0)),
        gite: contract?.gite ?? null,
      }),
    [contract?.gite, contract?.nb_nuits, options, reservation?.nb_nuits]
  );

  const submit = async () => {
    if (!contract) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${contract.id}/return-processing`, {
        method: "PATCH",
        json: {
          statut_reception_contrat: contractReceived ? "recu" : "non_recu",
          date_reception_contrat: contractReceived ? receptionDate || null : null,
          statut_paiement_arrhes: arrhesPaid ? "recu" : "non_recu",
          date_paiement_arrhes: arrhesPaid ? arrhesDate || null : null,
          mode_paiement_arrhes: arrhesPaid ? arrhesPaymentMode || null : null,
          notes,
          reservation: {
            source_paiement: reservationPaymentSource || null,
            options,
          },
        },
      });
      setError(null);
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(
        isApiError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Impossible d'enregistrer le retour du contrat."
      );
    } finally {
      setSaving(false);
    }
  };

  const createAndLinkReservation = async () => {
    if (!contract) return;
    setLinkingReservation(true);
    try {
      const updated = await apiFetch<Contrat>(`/contracts/${contract.id}/create-linked-reservation`, {
        method: "POST",
      });
      setError(null);
      onUpdated(updated);
    } catch (err) {
      setError(
        isApiError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : "Impossible de créer la réservation liée."
      );
    } finally {
      setLinkingReservation(false);
    }
  };

  if (!open || !contract || typeof document === "undefined") return null;

  const hasReservation = Boolean(contract.reservation_id);

  return createPortal(
    <div className="contract-return-drawer-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <section
        className="contract-return-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contract-return-drawer__header">
          <div>
            <p className="contract-return-drawer__eyebrow">Traitement du retour</p>
            <h2 id={titleId}>Contrat {contract.numero_contrat}</h2>
            <div className="contract-return-drawer__summary">
              <span>{contract.locataire_nom}</span>
              <span>{contract.gite?.nom ?? "Gîte non renseigné"}</span>
              <span>
                {formatDate(contract.date_debut)} - {formatDate(contract.date_fin)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="contract-return-drawer__close"
            onClick={onClose}
            disabled={saving || linkingReservation}
            aria-label="Fermer"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="contract-return-drawer__body">
          <p className="contract-return-drawer__intro">
            Le contrat envoyé reste figé. Les modifications ci-dessous mettent à jour le suivi du retour et la réservation liée.
          </p>
          {error ? <div className="note note--error">{error}</div> : null}

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Retour courrier</strong>
            </div>
            <div className="contract-return-drawer__grid">
              <div className="field contract-return-drawer__toggle-field">
                <span>Contrat reçu</span>
                <label className="switch">
                  <input
                    ref={firstFieldRef}
                    type="checkbox"
                    checked={contractReceived}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setContractReceived(checked);
                      if (checked && !receptionDate) setReceptionDate(todayInputValue());
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>

              <label className="field">
                Date de réception
                <input
                  type="date"
                  value={receptionDate}
                  disabled={!contractReceived}
                  onChange={(event) => setReceptionDate(event.target.value)}
                />
              </label>

              <div className="field contract-return-drawer__toggle-field">
                <span>Arrhes reçues</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={arrhesPaid}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setArrhesPaid(checked);
                      if (checked && !arrhesDate) setArrhesDate(todayInputValue());
                    }}
                  />
                  <span className="slider" />
                </label>
              </div>

              <label className="field">
                Date de paiement
                <input
                  type="date"
                  value={arrhesDate}
                  disabled={!arrhesPaid}
                  onChange={(event) => setArrhesDate(event.target.value)}
                />
              </label>

              <label className="field">
                Mode de paiement des arrhes
                <select
                  value={arrhesPaymentMode}
                  disabled={!arrhesPaid}
                  onChange={(event) => setArrhesPaymentMode(event.target.value)}
                >
                  <option value="">À renseigner</option>
                  {ARRHES_PAYMENT_MODES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div className="contract-return-drawer__amount-card">
                <span>Montant des arrhes prévues</span>
                <strong>{formatEuro(contract.arrhes_montant)}</strong>
              </div>
            </div>
          </section>

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Réservation actuelle</strong>
              <span>
                {hasReservation
                  ? "Les options ci-dessous alimentent le calcul de la réservation."
                  : "Aucune réservation liée à ce contrat."}
              </span>
            </div>

            {hasReservation ? (
              <>
                {loading ? <div className="note">Chargement de la réservation liée...</div> : null}
                <div className="contract-return-drawer__grid contract-return-drawer__grid--compact">
                  <label className="field">
                    Source de paiement réservation
                    <select
                      value={reservationPaymentSource}
                      onChange={(event) => setReservationPaymentSource(event.target.value)}
                    >
                      <option value="">À renseigner</option>
                      {RESERVATION_PAYMENT_SOURCES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="contract-return-drawer__amount-card contract-return-drawer__amount-card--soft">
                    <span>Options recalculées</span>
                    <strong>{formatEuro(optionPreview.total)}</strong>
                    <small>{optionPreview.label || "Aucune option sélectionnée"}</small>
                  </div>
                </div>

                <ReservationOptionsEditor
                  options={options}
                  preview={optionPreview}
                  gite={contract.gite ?? null}
                  guestCount={reservation?.nb_adultes ?? contract.nb_adultes}
                  layout="compact"
                  onChange={setOptions}
                />
              </>
            ) : (
              <div className="contract-return-drawer__empty-state">
                <p>Aucune réservation liée pour ce contrat.</p>
                <button
                  type="button"
                  className="table-action table-action--neutral contract-return-drawer__link-btn"
                  onClick={createAndLinkReservation}
                  disabled={saving || linkingReservation}
                >
                  {linkingReservation ? "Création..." : "Créer et lier la réservation"}
                </button>
              </div>
            )}
          </section>

          <section className="contract-return-drawer__section">
            <div className="contract-return-drawer__section-head">
              <strong>Notes internes</strong>
              <span>Visible seulement en gestion.</span>
            </div>
            <label className="field">
              Notes
              <textarea
                className="contract-return-drawer__textarea"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
              />
            </label>
          </section>
        </div>

        <div className="contract-return-drawer__footer">
          <button type="button" className="secondary" onClick={onClose} disabled={saving}>
            Annuler
          </button>
          <button type="button" onClick={submit} disabled={saving || loading || linkingReservation}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
};

export default ContractReturnDrawer;
