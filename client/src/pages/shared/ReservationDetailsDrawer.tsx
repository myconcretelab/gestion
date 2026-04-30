import { createPortal } from "react-dom";
import { useEffect, useId, type ReactNode } from "react";

type ReservationDetailsDrawerProps = {
  open: boolean;
  title: string;
  eyebrow?: string;
  summary?: string[];
  headerAside?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
};

const APP_SCROLL_LOCK_CLASS = "app-scroll-locked";

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ReservationDetailsDrawer = ({
  open,
  title,
  eyebrow = "Réservation",
  summary = [],
  headerAside,
  footer,
  busy = false,
  onClose,
  children,
}: ReservationDetailsDrawerProps) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add(APP_SCROLL_LOCK_CLASS);
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS);
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="contract-return-drawer-backdrop reservation-details-drawer-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section
        className="contract-return-drawer reservation-details-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contract-return-drawer__header reservation-details-drawer__header">
          <div className="reservation-details-drawer__header-copy">
            <p className="contract-return-drawer__eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
            {summary.length ? (
              <div className="contract-return-drawer__summary">
                {summary.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="reservation-details-drawer__header-side">
            {headerAside}
            <button
              type="button"
              className="contract-return-drawer__close"
              onClick={onClose}
              disabled={busy}
              aria-label="Fermer"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="contract-return-drawer__body reservation-details-drawer__body">{children}</div>

        {footer ? <div className="contract-return-drawer__footer reservation-details-drawer__footer">{footer}</div> : null}
      </section>
    </div>,
    document.body
  );
};

export default ReservationDetailsDrawer;
