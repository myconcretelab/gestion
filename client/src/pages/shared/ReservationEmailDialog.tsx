import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../../utils/api";
import { dispatchAppNotice } from "../../utils/appNotices";
import { formatDate } from "../../utils/format";
import type { Reservation } from "../../utils/types";

export default function ReservationEmailDialog({
  reservation,
  onClose,
}: {
  reservation: Pick<
    Reservation,
    "id" | "email" | "hote_nom" | "date_entree" | "date_sortie"
  >;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [recipient, setRecipient] = useState(reservation.email?.trim() ?? "");
  const [subject, setSubject] = useState(
    `Votre réservation du ${formatDate(reservation.date_entree)} au ${formatDate(reservation.date_sortie)}`,
  );
  const [body, setBody] = useState(
    `Bonjour${reservation.hote_nom?.trim() ? ` ${reservation.hote_nom.trim()}` : ""},\n\n`,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const sendingRef = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    subjectRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      await apiFetch(
        `/reservations/${encodeURIComponent(reservation.id)}/send-email`,
        {
          method: "POST",
          json: {
            recipient: recipient.trim(),
            subject: subject.trim(),
            body: body.trim(),
          },
        },
      );
      dispatchAppNotice({
        label: "Email",
        tone: "success",
        message: `Email envoyé à ${recipient.trim()}.`,
        timeoutMs: 5200,
        role: "status",
      });
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer l’email.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="reservation-email-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!sendingRef.current) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const fields = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
          ) ?? [],
        );
        const first = fields[0];
        const last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <form onSubmit={send}>
        <div className="email-composer-dialog__header">
          <h2 id={titleId}>Écrire un email</h2>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={sending}
          >
            Fermer
          </button>
        </div>
        <div className="reservation-email-dialog__body">
          {error ? (
            <p className="note note--error" role="alert">
              {error}
            </p>
          ) : null}
          <label className="field">
            Destinataire
            <input
              type="email"
              required
              value={recipient}
              disabled={sending}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label className="field">
            Sujet
            <input
              ref={subjectRef}
              type="text"
              required
              maxLength={200}
              value={subject}
              disabled={sending}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="field">
            Message
            <textarea
              required
              rows={10}
              maxLength={20000}
              value={body}
              disabled={sending}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
        </div>
        <div className="email-composer-dialog__footer">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={sending}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={
              sending || !recipient.trim() || !subject.trim() || !body.trim()
            }
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
