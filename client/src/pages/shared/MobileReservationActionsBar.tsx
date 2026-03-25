import type { ReactNode } from "react";

export type MobileReservationActionsBarMode = "actions" | "rotation-choice";

type MobileReservationActionsBarProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  mode?: MobileReservationActionsBarMode;
  onClose: () => void;
  onEdit?: () => void;
  phoneHref?: string | null;
  smsHref?: string | null;
  airbnbUrl?: string | null;
  onSelectArrival?: () => void;
  onSelectDeparture?: () => void;
  arrivalLabel?: string;
  departureLabel?: string;
};

const EditIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 16.8V20h3.2L18 9.2l-3.2-3.2L4 16.8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m13.9 6.9 3.2 3.2M12 20h8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M6.9 3.2c.4-.4 1-.5 1.5-.3l2.4 1c.7.3 1 .9.9 1.6l-.4 2.5c0 .3.1.6.3.8l3 3c.2.2.5.3.8.3l2.5-.4c.7-.1 1.4.2 1.6.9l1 2.4c.2.5.1 1.1-.3 1.5l-1.7 1.7c-.6.6-1.5.9-2.3.7-2.7-.6-5.3-2.1-7.6-4.3-2.2-2.2-3.7-4.8-4.3-7.6-.2-.8.1-1.7.7-2.3Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SmsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const AirbnbIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.16" />
    <path
      d="M12 6.2c1.4 0 2.4 1 2.4 2.4 0 .8-.4 1.7-1 2.8l-1.1 2-1.1-2c-.6-1.1-1-2-1-2.8 0-1.4 1-2.4 2.4-2.4Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.8 16.4c1.2-2.2 2.4-4.3 3.4-6.2.2-.3.5-.5.8-.5s.6.2.8.5c1 1.9 2.2 4 3.4 6.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9.6 17.3c.6-.9 1.4-1.4 2.4-1.4s1.8.5 2.4 1.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ActionButton = ({
  children,
  href,
  label,
  text,
  onClick,
}: {
  children: ReactNode;
  href?: string | null;
  label: string;
  text?: string;
  onClick?: () => void;
}) => {
  const className = `mobile-reservation-actions__icon-button${text ? " mobile-reservation-actions__icon-button--labeled" : ""}`;
  const content = (
    <>
      {children}
      {text ? <span>{text}</span> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={className} aria-label={label} title={label} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={onClick}>
      {content}
    </button>
  );
};

const MobileReservationActionsBar = ({
  open,
  title,
  subtitle,
  mode = "actions",
  onClose,
  onEdit,
  phoneHref,
  smsHref,
  airbnbUrl,
  onSelectArrival,
  onSelectDeparture,
  arrivalLabel = "Arrivée",
  departureLabel = "Départ",
}: MobileReservationActionsBarProps) => {
  if (!open) return null;

  return (
    <div className="mobile-reservation-actions" role="status" aria-live="polite">
      <div className="mobile-reservation-actions__panel">
        <div className="mobile-reservation-actions__header">
          <div className="mobile-reservation-actions__copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button
            type="button"
            className="mobile-reservation-actions__close"
            aria-label="Fermer la barre d'actions"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {mode === "rotation-choice" ? (
          <div className="mobile-reservation-actions__choices">
            <button type="button" className="mobile-reservation-actions__choice" onClick={onSelectArrival}>
              {arrivalLabel}
            </button>
            <button type="button" className="mobile-reservation-actions__choice" onClick={onSelectDeparture}>
              {departureLabel}
            </button>
          </div>
        ) : (
          <div className="mobile-reservation-actions__buttons">
            {onEdit ? (
              <button type="button" className="mobile-reservation-actions__edit" onClick={onEdit}>
                <EditIcon />
                <span>Éditer</span>
              </button>
            ) : null}
            {smsHref ? (
              <ActionButton href={smsHref} label="Envoyer un SMS" text="SMS">
                <SmsIcon />
              </ActionButton>
            ) : null}
            {phoneHref ? (
              <ActionButton href={phoneHref} label="Appeler" text="Tel">
                <PhoneIcon />
              </ActionButton>
            ) : null}
            {airbnbUrl ? (
              <ActionButton href={airbnbUrl} label="Ouvrir Airbnb">
                <AirbnbIcon />
              </ActionButton>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileReservationActionsBar;
