import { useId } from "react";
import { buildTelephoneHref } from "../../utils/sms";
import { canCurrentUserWritePage } from "../../utils/auth";

type Props = {
  telephone: string;
  email: string;
  editing: boolean;
  onTelephoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onComposeEmail: () => void;
};

const ContactIcon = ({ kind }: { kind: "phone" | "compose" | "external" }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {kind === "phone" ? (
      <path d="M6.9 3.2c.4-.4 1-.5 1.5-.3l2.4 1c.7.3 1 .9.9 1.6l-.4 2.5c0 .3.1.6.3.8l3 3c.2.2.5.3.8.3l2.5-.4c.7-.1 1.4.2 1.6.9l1 2.4c.2.5.1 1.1-.3 1.5l-1.7 1.7c-.6.6-1.5.9-2.3.7-2.7-.6-5.3-2.1-7.6-4.3-2.2-2.2-3.7-4.8-4.3-7.6-.2-.8.1-1.7.7-2.3Z" />
    ) : kind === "compose" ? (
      <>
        <path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6" />
        <path d="m15 5 4 4M10 14l1-4 7-7a2.1 2.1 0 0 1 3 3l-7 7-4 1Z" />
      </>
    ) : (
      <>
        <rect x="3" y="6" width="16" height="14" rx="2" />
        <path d="m4 8 7 5 3-2M16 3h5v5M21 3l-6 6" />
      </>
    )}
  </svg>
);

export default function ReservationContactFields({
  telephone,
  email,
  editing,
  onTelephoneChange,
  onEmailChange,
  onComposeEmail,
}: Props) {
  const id = useId();
  const phoneHref = buildTelephoneHref(telephone);
  const recipient = email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  const emailHref = emailValid
    ? `mailto:${encodeURIComponent(recipient)}`
    : null;
  const actionClass = "reservation-contact-action";

  return (
    <div className="reservations-contact-card">
      <div className="reservations-contact-card__title">Contact</div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={editing ? `${id}-phone` : undefined}>Téléphone</label>
          <div className="reservation-contact-field">
            {editing ? (
              <input
                id={`${id}-phone`}
                type="tel"
                value={telephone}
                onChange={(event) => onTelephoneChange(event.target.value)}
              />
            ) : phoneHref ? (
              <a className="detail-link" href={phoneHref}>
                {telephone}
              </a>
            ) : (
              <span className="detail-value">{telephone || "—"}</span>
            )}
            {phoneHref ? (
              <a
                className={actionClass}
                href={phoneHref}
                title="Appeler"
                aria-label="Appeler"
              >
                <ContactIcon kind="phone" />
              </a>
            ) : (
              <button
                type="button"
                className={actionClass}
                disabled
                title="Téléphone non renseigné"
                aria-label="Appeler"
              >
                <ContactIcon kind="phone" />
              </button>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor={editing ? `${id}-email` : undefined}>Email</label>
          <div className="reservation-contact-field">
            {editing ? (
              <input
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
              />
            ) : emailHref ? (
              <a className="detail-link" href={emailHref}>
                {email}
              </a>
            ) : (
              <span className="detail-value">{email || "—"}</span>
            )}
            <button
              type="button"
              className={actionClass}
              onClick={onComposeEmail}
              disabled={!emailValid || !canCurrentUserWritePage("reservations")}
              title="Écrire un email dans l’application"
              aria-label="Écrire un email dans l’application"
            >
              <ContactIcon kind="compose" />
            </button>
            {emailHref ? (
              <a
                className={actionClass}
                href={emailHref}
                title="Ouvrir dans la messagerie"
                aria-label="Ouvrir dans la messagerie"
              >
                <ContactIcon kind="external" />
              </a>
            ) : (
              <button
                type="button"
                className={actionClass}
                disabled
                title="Adresse email non renseignée ou invalide"
                aria-label="Ouvrir dans la messagerie"
              >
                <ContactIcon kind="external" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
