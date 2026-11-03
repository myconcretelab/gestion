import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  BOOKING_SOURCES,
  getBookingSource,
  getSuggestedReservationPayment,
  getReservationPaymentShortcutValue,
  DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
  legacyPaymentMethod,
  RESERVATION_PAYMENT_METHODS,
  RESERVATION_MANUAL_PAYMENT_METHODS,
  type ReservationPaymentTracking,
  type ReservationPaymentShortcut,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import {
  canCurrentUserViewAmounts,
  canCurrentUserWritePage,
} from "../../utils/auth";
import { formatDate, formatEuro } from "../../utils/format";
import { getContrastTextColor } from "../../utils/paymentColors";
import { getReservationOptionBadges } from "../../utils/reservationOptionBadges";
import type { Reservation } from "../../utils/types";
import OtaReservationPricing from "./OtaReservationPricing";
import ReservationOptionDetails from "./ReservationOptionDetails";

export const reservationPaymentChanged = "reservation:payment-changed";
type Props = {
  reservation: Pick<
    Reservation,
    "id" | "source_paiement" | "booking_source" | "options"
  >;
  tracking: ReservationPaymentTracking;
  detailsId?: string;
  monthlyTotal?: number;
  showOrigin?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onUpdated?: (
    tracking: ReservationPaymentTracking,
    bookingSource?: string,
  ) => void;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const purposeLabel = (purpose: string) =>
  purpose === "deposit"
    ? "Arrhes"
    : purpose === "balance"
      ? "Solde"
      : purpose === "full"
        ? "Séjour"
        : "Versement";
type PaymentInput = {
  id: string;
  amount: number;
  method: string;
  purpose: string;
  paid_on: string;
  note: string | null;
  shortcut_id?: string;
  channel?: string;
  category?: "accommodation" | "cleaning" | "linen" | "extras" | "tourist_tax";
  fee_amount?: number;
};

export default function ReservationPaymentsEditor({
  reservation,
  tracking: initial,
  detailsId,
  monthlyTotal,
  showOrigin = true,
  onUpdated,
  onBusyChange,
}: Props) {
  const [tracking, setTracking] = useState(initial);
  const optionBadges = getReservationOptionBadges(reservation.options);
  const bookingSource = getBookingSource(reservation);
  const [source, setSource] = useState(bookingSource);
  useEffect(() => {
    setTracking(initial);
  }, [initial]);
  useEffect(() => {
    setSource(bookingSource);
  }, [bookingSource]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const [error, setError] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);
  const [dateEdit, setDateEdit] = useState<{
    id: string;
    paidOn: string;
    expectedPaidOn: string | null;
  } | null>(null);
  const [methodEdit, setMethodEdit] = useState<{
    id: string;
    method: string;
    expectedMethod: string | null;
  } | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const shortcutRequest = useRef<{ key: string; id: string } | null>(null);
  const depositDue = tracking.platform
    ? 0
    : Math.max(
        0,
        Math.min(tracking.remaining, tracking.deposit - tracking.received),
      );
  const suggestion = getSuggestedReservationPayment(tracking);
  const [purpose, setPurpose] = useState<string>(suggestion.purpose);
  const [amount, setAmount] = useState(String(suggestion.amount));
  const [method, setMethod] = useState(
    legacyPaymentMethod(reservation.source_paiement) || "Virement",
  );
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [paymentChannel, setPaymentChannel] = useState(
    bookingSource === "Direct" ? "Airbnb" : bookingSource,
  );
  const [paymentCategory, setPaymentCategory] =
    useState<NonNullable<PaymentInput["category"]>>("extras");
  const [feeAmount, setFeeAmount] = useState("");
  const formId = useId();
  const unconfirmedHistory =
    !tracking.managed &&
    !tracking.platform &&
    !tracking.entries.length &&
    Boolean(legacyPaymentMethod(reservation.source_paiement));
  const canWrite =
    canCurrentUserViewAmounts() && canCurrentUserWritePage("reservations");
  const publish = (
    next: ReservationPaymentTracking,
    bookingSource = source,
  ) => {
    setTracking(next);
    onUpdated?.(next, bookingSource);
    window.dispatchEvent(
      new CustomEvent(reservationPaymentChanged, {
        detail: {
          reservationId: reservation.id,
          tracking: next,
          booking_source: bookingSource,
        },
      }),
    );
  };
  const recordPayment = async (input: PaymentInput) => {
    if (busy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<ReservationPaymentTracking>(
        `/reservations/${reservation.id}/payments`,
        {
          method: "POST",
          json: input,
        },
      );
      publish(next);
      setExpanded(false);
      setNote("");
      requestId.current = crypto.randomUUID();
      shortcutRequest.current = null;
      setAmount(String(next.remaining));
      setPurpose("balance");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer le règlement.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await recordPayment({
      id: requestId.current,
      amount: Number(amount.replace(",", ".")),
      method,
      purpose,
      paid_on: paidOn,
      note: note.trim() || null,
      ...(method === "Versement plateforme"
        ? {
            channel: paymentChannel,
            category: paymentCategory,
            ...(feeAmount === ""
              ? {}
              : { fee_amount: Number(feeAmount.replace(",", ".")) }),
          }
        : {}),
    });
  };
  const useShortcut = async (shortcut: ReservationPaymentShortcut) => {
    if (busy || saving.current || !canWrite || tracking.requires_review) return;
    const value = getReservationPaymentShortcutValue(tracking, shortcut);
    if (value.amount <= 0) return;
    const paid_on = today();
    const key = JSON.stringify([shortcut.id, value, shortcut.method, paid_on]);
    if (shortcutRequest.current?.key !== key)
      shortcutRequest.current = { key, id: crypto.randomUUID() };
    await recordPayment({
      id: shortcutRequest.current.id,
      ...value,
      method: shortcut.method,
      paid_on,
      note: null,
      shortcut_id: shortcut.id,
    });
  };
  const voidEntry = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<ReservationPaymentTracking>(
        `/reservations/${reservation.id}/payments/${encodeURIComponent(id)}/void`,
        { method: "POST" },
      );
      publish(next);
      setConfirmVoid(null);
      setAmount(String(next.remaining));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible d’annuler cette saisie.",
      );
    } finally {
      setBusy(false);
    }
  };
  const changeSource = async (booking_source: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/reservations/${reservation.id}/booking-source`, {
        method: "PATCH",
        json: { booking_source },
      });
      setSource(booking_source);
      const next = await apiFetch<ReservationPaymentTracking>(`/reservations/${reservation.id}/payments`);
      publish(next, booking_source);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible de modifier l’origine.",
      );
    } finally {
      setBusy(false);
    }
  };
  const savePaymentDate = async (event: FormEvent) => {
    event.preventDefault();
    if (!dateEdit || busy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<ReservationPaymentTracking>(
        `/reservations/${reservation.id}/payments/${encodeURIComponent(dateEdit.id)}/date`,
        {
          method: "PATCH",
          json: {
            paid_on: dateEdit.paidOn,
            expected_paid_on: dateEdit.expectedPaidOn,
          },
        },
      );
      publish(next);
      setDateEdit(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible de modifier la date du règlement.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const savePaymentMethod = async (event: FormEvent) => {
    event.preventDefault();
    if (!methodEdit || busy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<ReservationPaymentTracking>(
        `/reservations/${reservation.id}/payments/${encodeURIComponent(methodEdit.id)}/method`,
        {
          method: "PATCH",
          json: {
            method: methodEdit.method,
            expected_method: methodEdit.expectedMethod,
          },
        },
      );
      publish(next);
      setMethodEdit(null);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le moyen de paiement.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      id={detailsId}
      className="reservation-payment-details"
      aria-label="Détail du règlement"
    >
      {showOrigin ? (
        <label className="reservation-ledger__origin">
          <span>Origine de la réservation</span>
          <select
            aria-label="Origine de la réservation"
            value={source}
            disabled={busy || !canWrite}
            onChange={(event) => void changeSource(event.target.value)}
          >
            {[...new Set([...BOOKING_SOURCES, ...(tracking.payment_channels ?? []), source])].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      ) : null}
      {tracking.platform && canWrite && (
        <OtaReservationPricing
          reservationId={reservation.id}
          disabled={busy}
          onBusyChange={setBusy}
          onSaved={(next) => publish(next)}
        />
      )}
      <div className="reservation-payment-details__row">
        <span>Total du séjour</span>
        <strong>{formatEuro(tracking.total)}</strong>
      </div>
      {monthlyTotal !== undefined &&
      Math.abs(monthlyTotal - tracking.total) > 0.01 ? (
        <div className="reservation-payment-details__row">
          <span>Part du mois affiché</span>
          <strong>{formatEuro(monthlyTotal)}</strong>
        </div>
      ) : null}
      {!tracking.entries.length ? (
        <p>
          {legacyPaymentMethod(reservation.source_paiement)
            ? `Moyen historique : ${reservation.source_paiement}. Aucun montant ni date de règlement n’a été renseigné.`
            : "Aucun règlement enregistré."}
        </p>
      ) : null}
      {tracking.entries.map((entry) => {
        const canEditDate =
          canWrite && !entry.voided_at && entry.origin !== "stripe";
        const platformPayment =
          entry.method === "Versement plateforme" ||
          entry.origin === "platform";
        const canEditMethod = canEditDate && !platformPayment && !entry.ota;
        const methodAction = `${entry.method ? "Modifier" : "Renseigner"} le moyen de paiement`;
        const methodFormId = `${formId}-method-${entry.id}`;
        const dateText = entry.paid_on
          ? formatDate(entry.paid_on)
          : "Date non renseignée";
        const dateAction = `${entry.paid_on ? "Modifier" : "Renseigner"} la date ${platformPayment ? "du versement plateforme" : "d’encaissement"}${entry.paid_on ? ` : ${dateText}` : ""}`;
        const dateFormId = `${formId}-date-${entry.id}`;
        return (
          <div
            className={`reservation-ledger__entry${entry.voided_at ? " reservation-ledger__entry--void" : ""}`}
            key={entry.id}
          >
            <div className="reservation-payment-details__row">
              <span>
                {entry.voided_at
                  ? "Saisie annulée · "
                  : entry.origin === "platform"
                    ? "≈ "
                    : "✓ "}
                {entry.origin === "platform"
                  ? "Hébergement"
                  : purposeLabel(entry.purpose)}
                <small>
                  {canEditMethod ? (
                    <button
                      type="button"
                      className="reservation-ledger__payment-date"
                      aria-label={methodAction}
                      title={methodAction}
                      aria-expanded={methodEdit?.id === entry.id}
                      aria-controls={methodFormId}
                      disabled={busy}
                      onClick={() => {
                        setConfirmVoid(null);
                        setDateEdit(null);
                        setExpanded(false);
                        setError(null);
                        setMethodEdit(
                          methodEdit?.id === entry.id
                            ? null
                            : {
                                id: entry.id,
                                method: RESERVATION_MANUAL_PAYMENT_METHODS.some(
                                  (method) => method === entry.method,
                                )
                                  ? entry.method!
                                  : "",
                                expectedMethod: entry.method,
                              },
                        );
                      }}
                    >
                      <span>{entry.method || "Moyen non renseigné"}</span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m16 4 4 4M4 20l4-1L20 7a2.12 2.12 0 0 0-3-3L5 16l-1 4Z" />
                      </svg>
                    </button>
                  ) : (
                    entry.method || "Moyen non renseigné"
                  )}{" "}
                  ·{" "}
                  {canEditDate ? (
                    <button
                      type="button"
                      className="reservation-ledger__payment-date"
                      aria-label={dateAction}
                      title={dateAction}
                      aria-expanded={dateEdit?.id === entry.id}
                      aria-controls={dateFormId}
                      disabled={busy}
                      onClick={() => {
                        setConfirmVoid(null);
                        setMethodEdit(null);
                        setExpanded(false);
                        setError(null);
                        setDateEdit(
                          dateEdit?.id === entry.id
                            ? null
                            : {
                                id: entry.id,
                                paidOn: entry.paid_on?.slice(0, 10) ?? today(),
                                expectedPaidOn: entry.paid_on,
                              },
                        );
                      }}
                    >
                      <span>{dateText}</span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m16 4 4 4M4 20l4-1L20 7a2.12 2.12 0 0 0-3-3L5 16l-1 4Z" />
                      </svg>
                    </button>
                  ) : (
                    dateText
                  )}
                  {entry.paid_on_estimated ? " · Date estimée" : ""}
                </small>
                {entry.origin === "legacy" ? (
                  <small>Historique repris</small>
                ) : null}
                {entry.note && entry.origin !== "platform" ? (
                  <small>{entry.note}</small>
                ) : null}
                {entry.ota && (
                  <small>
                    {entry.ota.channel} · Brut{" "}
                    {formatEuro(entry.ota.grossCents / 100)} · Frais{" "}
                    {formatEuro(entry.ota.feeCents / 100)} · Net{" "}
                    {formatEuro(entry.ota.netCents / 100)}
                    {entry.ota.source === "rate"
                      ? " · commission calculée"
                      : ""}
                  </small>
                )}
                {entry.refunded_amount ? (
                  <small>
                    Après remboursement de {formatEuro(entry.refunded_amount)}
                  </small>
                ) : null}
              </span>
              <strong>{formatEuro(entry.amount)}</strong>
            </div>
            {canEditMethod && methodEdit?.id === entry.id ? (
              <form
                id={methodFormId}
                className="reservation-ledger__date-form"
                onSubmit={savePaymentMethod}
                aria-label="Modifier le moyen de paiement"
              >
                <label>
                  Moyen de paiement
                  <select
                    autoFocus
                    required
                    value={methodEdit.method}
                    disabled={busy}
                    onChange={(event) =>
                      setMethodEdit({
                        ...methodEdit,
                        method: event.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      Choisir un moyen
                    </option>
                    {RESERVATION_MANUAL_PAYMENT_METHODS.map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </label>
                <div className="reservation-ledger__form-actions">
                  <button type="submit" disabled={busy}>
                    Enregistrer le moyen
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMethodEdit(null)}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            ) : null}
            {canEditDate && dateEdit?.id === entry.id ? (
              <form
                id={dateFormId}
                className="reservation-ledger__date-form"
                onSubmit={savePaymentDate}
                aria-label="Modifier la date du règlement"
              >
                <label>
                  {platformPayment
                    ? "Date du versement plateforme"
                    : "Date d’encaissement"}
                  <input
                    autoFocus
                    type="date"
                    required
                    value={dateEdit.paidOn}
                    disabled={busy}
                    onChange={(event) =>
                      setDateEdit({ ...dateEdit, paidOn: event.target.value })
                    }
                  />
                </label>
                <div className="reservation-ledger__form-actions">
                  <button type="submit" disabled={busy}>
                    Enregistrer la date
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDateEdit(null)}
                  >
                    Annuler
                  </button>
                </div>
              </form>
            ) : null}
            {canWrite &&
            !entry.voided_at &&
            entry.origin !== "stripe" &&
            entry.origin !== "platform" ? (
              confirmVoid === entry.id ? (
                <div className="reservation-ledger__void-confirm">
                  <span>Annuler cette saisie ?</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void voidEntry(entry.id)}
                  >
                    Confirmer l’annulation
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmVoid(null)}
                  >
                    Conserver
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="reservation-ledger__text-button"
                  disabled={busy}
                  onClick={() => {
                    setDateEdit(null);
                    setMethodEdit(null);
                    setConfirmVoid(entry.id);
                  }}
                >
                  Annuler la saisie
                </button>
              )
            ) : null}
          </div>
        );
      })}
      {optionBadges.length > 0 || tracking.platform ? (
        <div className="reservation-ledger__extras">
          <ReservationOptionDetails options={reservation.options} />
          {tracking.platform && tracking.platform.expected > 0 ? (
            <div className="reservation-payment-details__row">
              <span>Attendu de {tracking.platform.source}</span>
              <strong>{formatEuro(tracking.platform.expected)}</strong>
            </div>
          ) : null}
          {tracking.platform ? (
            <div className="reservation-payment-details__row">
              <span>Options et taxe à encaisser sur place</span>
              <strong>{formatEuro(tracking.platform.extras_remaining)}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="reservation-payment-details__balance">
        <span>
          {unconfirmedHistory
            ? "Règlements à renseigner"
            : tracking.requires_review
              ? "Reste à vérifier"
              : tracking.total > 0 && tracking.remaining === 0
                ? "✓ Séjour payé"
                : "Reste à payer"}
        </span>
        <strong>
          {unconfirmedHistory
            ? "Non renseigné"
            : formatEuro(tracking.remaining)}
        </strong>
      </div>
      {tracking.overpaid > 0 ? (
        <p>Trop-perçu : {formatEuro(tracking.overpaid)}</p>
      ) : null}
      {tracking.requires_review ? (
        <p role="status">
          Un paiement Stripe ou un remboursement nécessite une vérification.
        </p>
      ) : null}
      {error ? (
        <p className="reservation-ledger__error" role="alert">
          {error}
        </p>
      ) : null}
      {canWrite &&
      tracking.remaining > 0 &&
      !tracking.requires_review &&
      !expanded ? (
        <div className="reservation-ledger__add-row">
          <button
            type="button"
            className="reservation-ledger__add"
            aria-expanded={false}
            aria-controls={formId}
            disabled={busy}
            onClick={() => {
              const next = getSuggestedReservationPayment(tracking);
              setPurpose(next.purpose);
              setAmount(String(next.amount));
              requestId.current = crypto.randomUUID();
              setExpanded(true);
            }}
          >
            ＋ Ajouter un règlement
          </button>
          <div
            className="reservation-ledger__shortcuts"
            role="group"
            aria-label="Règlements en un clic"
          >
            {(
              tracking.payment_shortcuts ??
              DEFAULT_RESERVATION_PAYMENT_SHORTCUTS
            ).map((shortcut) => {
              const value = getReservationPaymentShortcutValue(
                tracking,
                shortcut,
              );
              if (value.amount <= 0) return null;
              const label = `${shortcut.target === "deposit" ? "Encaisser les arrhes restantes" : "Encaisser tout le reste à payer"} : ${formatEuro(value.amount)} par ${shortcut.method.toLowerCase()}`;
              return (
                <button
                  key={shortcut.id}
                  type="button"
                  className="reservation-ledger__shortcut"
                  style={{
                    backgroundColor: shortcut.color,
                    color: getContrastTextColor(shortcut.color),
                  }}
                  aria-label={label}
                  title={label}
                  disabled={busy}
                  onClick={() => void useShortcut(shortcut)}
                >
                  <span>{shortcut.label}</span>
                  <small>
                    {formatEuro(value.amount, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {expanded ? (
        <form
          id={formId}
          className="reservation-ledger__form"
          onSubmit={submit}
          aria-label="Ajouter un règlement"
        >
          <div className="reservation-ledger__form-grid">
            <label>
              Nature
              <select
                aria-label="Nature"
                value={purpose}
                disabled={busy}
                onChange={(event) => {
                  setPurpose(event.target.value);
                  requestId.current = crypto.randomUUID();
                  if (event.target.value === "deposit" && depositDue > 0)
                    setAmount(String(depositDue));
                  if (
                    event.target.value === "balance" ||
                    event.target.value === "full"
                  )
                    setAmount(String(tracking.remaining));
                }}
              >
                {tracking.received === 0 && !tracking.platform ? (
                  <option value="full">Totalité du séjour</option>
                ) : null}
                <option value="deposit">Arrhes</option>
                <option value="balance">Solde</option>
                <option value="payment">Versement partiel</option>
                <option value="extras">Règlement de prestations</option>
              </select>
            </label>
            <label>
              Montant (€)
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                min="0.01"
                max={tracking.remaining}
                step="0.01"
                required
                value={amount}
                disabled={busy}
                onChange={(event) => {
                  setAmount(event.target.value);
                  requestId.current = crypto.randomUUID();
                }}
              />
            </label>
            <label>
              Moyen
              <select
                aria-label="Moyen"
                value={method}
                disabled={busy}
                onChange={(event) => {
                  setMethod(event.target.value as typeof method);
                  if (
                    event.target.value === "Versement plateforme" &&
                    paymentCategory !== "accommodation"
                  )
                    setPurpose("extras");
                  requestId.current = crypto.randomUUID();
                }}
              >
                {RESERVATION_PAYMENT_METHODS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            {method === "Versement plateforme" && (
              <>
                <label>
                  Canal du règlement
                  <select
                    aria-label="Canal du règlement"
                    value={paymentChannel}
                    onChange={(event) => {
                      setPaymentChannel(event.target.value);
                      requestId.current = crypto.randomUUID();
                    }}
                  >
                    {[
                      ...new Set([
                        ...(tracking.payment_channels ?? [
                          "Airbnb",
                          "Abritel",
                          "Booking.com",
                          "Gites de France",
                          "Autre",
                        ]),
                        paymentChannel,
                      ]),
                    ].map((channel) => (
                      <option key={channel}>{channel}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Prestation réglée
                  <select
                    aria-label="Prestation réglée"
                    value={paymentCategory}
                    onChange={(event) => {
                      setPaymentCategory(
                        event.target.value as typeof paymentCategory,
                      );
                      if (event.target.value !== "accommodation")
                        setPurpose("extras");
                      requestId.current = crypto.randomUUID();
                    }}
                  >
                    <option value="extras">Autres prestations</option>
                    <option value="linen">Linge et draps</option>
                    <option value="cleaning">Ménage</option>
                    <option value="accommodation">Hébergement</option>
                    <option value="tourist_tax">Taxe de séjour</option>
                  </select>
                </label>
                <label>
                  Commission (€)
                  <input
                    aria-label="Commission du règlement"
                    type="number"
                    min="0"
                    max={amount}
                    step="0.01"
                    value={feeAmount}
                    placeholder="Taux daté si vide"
                    onChange={(event) => {
                      setFeeAmount(event.target.value);
                      requestId.current = crypto.randomUUID();
                    }}
                  />
                  <small>
                    Montant payé par le voyageur ci-dessus. Saisissez 0 si le
                    canal ne prélève aucun frais, ou laissez vide pour utiliser
                    le taux daté.
                  </small>
                </label>
              </>
            )}
            <label>
              {method === "Versement plateforme"
                ? "Date du versement plateforme"
                : "Reçu le"}
              <input
                type="date"
                required
                value={paidOn}
                disabled={busy}
                onChange={(event) => {
                  setPaidOn(event.target.value);
                  requestId.current = crypto.randomUUID();
                }}
              />
            </label>
          </div>
          <label>
            Note facultative
            <input
              value={note}
              maxLength={500}
              disabled={busy}
              onChange={(event) => {
                setNote(event.target.value);
                requestId.current = crypto.randomUUID();
              }}
              placeholder="Référence du virement, numéro du chèque…"
            />
          </label>
          <div className="reservation-ledger__form-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer le règlement"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setExpanded(false);
                setError(null);
              }}
            >
              Fermer
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
