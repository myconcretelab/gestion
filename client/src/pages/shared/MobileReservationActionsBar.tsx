import type { ReactNode } from "react";
import ReservationContractIcon from "./ReservationContractIcon";

export type MobileReservationActionsBarMode = "actions" | "rotation-choice";

type MobileReservationActionsBarProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
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
  highlightedCard?: {
    label: string;
    value: string;
    hint?: string;
    onClick?: () => void;
    disabled?: boolean;
  };
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
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path
      d="M29.524 22.279c-.372-1.044-.752-1.907-1.183-2.74v-.038c-2.361-5.006-4.551-9.507-6.632-13.551l-.139-.204c-1.483-3.04-2.544-4.866-5.627-4.866-3.049 0-4.344 2.118-5.667 4.871l-.101.2C8.089 9.995 5.9 14.502 3.548 19.506v.066l-.699 1.525c-.262.63-.396.96-.431 1.058a6.41 6.41 0 0 0-.441 2.332c0 3.526 2.859 6.385 6.385 6.385.02 0 .04 0 .06-.001a1.6 1.6 0 0 0 .331-.034h.465c2.744-.574 5.073-2.061 6.71-4.121 1.656 2.082 3.983 3.568 6.65 4.132l.075.013h.465c.099.021.214.034.331.034h.059c3.526 0 6.384-2.858 6.384-6.384 0-.84-.162-1.642-.457-2.376zm-1.525 2.987a4.49 4.49 0 0 1-2.749 3.478c-2.815 1.225-5.602-.729-7.988-3.379 3.945-4.937 4.674-8.782 2.98-11.269a4.89 4.89 0 0 0-4.015-2.123c-.08 0-.159.002-.237.006h-.065a5.098 5.098 0 0 0-4.82 6.726c.782 2.574 2.032 4.8 3.665 6.686-.978 1.128-2.103 2.094-3.352 2.879l-.062.036a4.95 4.95 0 0 1-2.285.761 4.52 4.52 0 0 1-.62.043 4.48 4.48 0 0 1-4.161-6.142c.165-.431.494-1.225 1.056-2.451l.031-.066c1.829-3.971 4.051-8.485 6.604-13.49l.066-.165.725-1.395a4.63 4.63 0 0 1 1.689-2.053 2.92 2.92 0 0 1 1.557-.394 3.22 3.22 0 0 1 2.516 1.259c.197.299.431.696.727 1.191l.697 1.361.1.199c2.551 5.004 4.775 9.507 6.597 13.489l.033.031.666 1.525.397.955c.199.493.314 1.065.314 1.664 0 .232-.017.46-.051.683zM16.001 23.841c-1.367-1.544-2.407-3.411-2.991-5.47l-.024-.099a3.39 3.39 0 0 1 .364-3.094 2.98 2.98 0 0 1 2.65-1.311c1.099-.046 2.116.485 2.649 1.339a3.35 3.35 0 0 1 .357 3.081c-.624 2.155-1.661 4.019-3.029 5.588z"
      fill="currentColor"
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
  className,
}: {
  children: ReactNode;
  href?: string | null;
  label: string;
  text?: string;
  onClick?: () => void;
  className?: string;
}) => {
  const buttonClassName = `mobile-reservation-actions__icon-button${text ? " mobile-reservation-actions__icon-button--labeled" : ""}${className ? ` ${className}` : ""}`;
  const content = (
    <>
      {children}
      {text ? <span>{text}</span> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={buttonClassName} aria-label={label} title={label} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={buttonClassName} aria-label={label} title={label} onClick={onClick}>
      {content}
    </button>
  );
};

const MobileReservationActionsBar = ({
  open,
  title,
  subtitle,
  details,
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
  highlightedCard,
}: MobileReservationActionsBarProps) => {
  if (!open) return null;

  const hasThreePrimaryActions = Boolean(onEdit && smsHref && phoneHref && !airbnbUrl);

  return (
    <div className="mobile-reservation-actions" role="status" aria-live="polite">
      <div className="mobile-reservation-actions__panel">
        <div className="mobile-reservation-actions__header">
          <div className="mobile-reservation-actions__copy">
            <strong>{title}</strong>
            {subtitle ? <span className="mobile-reservation-actions__subtitle">{subtitle}</span> : null}
            {details?.length ? (
              <div className="mobile-reservation-actions__details">
                {details.map((detail) => (
                  <div key={`${detail.label}-${detail.value}`} className="mobile-reservation-actions__detail">
                    <span className="mobile-reservation-actions__detail-label">{detail.label}</span>
                    <strong className="mobile-reservation-actions__detail-value">{detail.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {highlightedCard ? (
              highlightedCard.onClick && !highlightedCard.disabled ? (
                <button
                  type="button"
                  className="mobile-reservation-actions__highlight-card mobile-reservation-actions__highlight-card--interactive"
                  onClick={highlightedCard.onClick}
                >
                  <span className="mobile-reservation-actions__highlight-icon" aria-hidden="true">
                    <ReservationContractIcon />
                  </span>
                  <span className="mobile-reservation-actions__highlight-copy">
                    <span className="mobile-reservation-actions__highlight-label">{highlightedCard.label}</span>
                    <strong className="mobile-reservation-actions__highlight-value">{highlightedCard.value}</strong>
                    {highlightedCard.hint ? (
                      <span className="mobile-reservation-actions__highlight-hint">{highlightedCard.hint}</span>
                    ) : null}
                  </span>
                </button>
              ) : (
                <div className="mobile-reservation-actions__highlight-card">
                  <span className="mobile-reservation-actions__highlight-icon" aria-hidden="true">
                    <ReservationContractIcon />
                  </span>
                  <span className="mobile-reservation-actions__highlight-copy">
                    <span className="mobile-reservation-actions__highlight-label">{highlightedCard.label}</span>
                    <strong className="mobile-reservation-actions__highlight-value">{highlightedCard.value}</strong>
                    {highlightedCard.hint ? (
                      <span className="mobile-reservation-actions__highlight-hint">{highlightedCard.hint}</span>
                    ) : null}
                  </span>
                </div>
              )
            ) : null}
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
          <div
            className={[
              "mobile-reservation-actions__buttons",
              hasThreePrimaryActions ? "mobile-reservation-actions__buttons--triple" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
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
              <ActionButton href={airbnbUrl} label="Ouvrir Airbnb" className="mobile-reservation-actions__icon-button--airbnb">
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
