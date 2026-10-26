import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  isReservationPaymentTracking,
  type ReservationPaymentTracking,
} from "@contrats/shared";
import { canCurrentUserViewAmounts } from "../../utils/auth";
import { formatEuro } from "../../utils/format";
import { getReservationPaymentSummary } from "../../utils/reservationPaymentSummary";
import type { Reservation } from "../../utils/types";
import ReservationPaymentsEditor from "./ReservationPaymentsEditor";
import { actionMenuPosition } from "./actionMenuPosition";

type Props = {
  reservation: Reservation;
  onUpdated: (
    tracking: ReservationPaymentTracking,
    bookingSource?: string,
  ) => void;
};

export default function ReservationPaymentPopover({
  reservation,
  onUpdated,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<ReturnType<
    typeof actionMenuPosition
  > | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const summary = getReservationPaymentSummary(reservation);
  const showAmounts = canCurrentUserViewAmounts();
  const close = useCallback(
    (restoreFocus = false) => {
      if (busy) return;
      setOpen(false);
      setPosition(null);
      if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    },
    [busy],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !panel.current) return;
      const viewport = window.visualViewport;
      const bounds = {
        width: viewport?.width ?? document.documentElement.clientWidth,
        height: viewport?.height ?? window.innerHeight,
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
      };
      if (
        anchor.bottom <= bounds.top ||
        anchor.top >= bounds.top + bounds.height ||
        anchor.right <= bounds.left ||
        anchor.left >= bounds.left + bounds.width
      ) {
        close();
        return;
      }
      const next = actionMenuPosition(
        anchor,
        bounds,
        panel.current.scrollHeight + 2,
        400,
      );
      setPosition((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) reposition();
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    const observer = new ResizeObserver(reposition);
    if (panel.current) observer.observe(panel.current);
    if (panel.current?.lastElementChild)
      observer.observe(panel.current.lastElementChild);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (open && position && focusPending.current) {
      focusPending.current = false;
      panel.current?.focus({ preventScroll: true });
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close();
    };
    const other = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("app:action-menu-open", other);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("app:action-menu-open", other);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close, id]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`reservation-payment-balance reservation-payment-balance--${summary.state}`}
        aria-label={`Règlements de ${reservation.hote_nom} : ${summary.remaining === null ? summary.label : formatEuro(summary.remaining)} restant à payer`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close(true);
          else {
            document.dispatchEvent(
              new CustomEvent("app:action-menu-open", { detail: id }),
            );
            focusPending.current = true;
            setOpen(true);
          }
        }}
      >
        <strong>
          {summary.remaining === null
            ? "Non renseigné"
            : formatEuro(summary.remaining)}
        </strong>
        <span className="reservation-payment-balance__status">
          {summary.state === "paid" ? "✓ " : ""}
          {summary.label}
        </span>
        {showAmounts && summary.state !== "unknown" ? (
          <span
            className="reservation-payment-tile__track"
            role="progressbar"
            aria-label="Part du séjour réglée"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.progress}
          >
            <span style={{ width: `${summary.progress}%` }} />
          </span>
        ) : null}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-labelledby={`${id}-title`}
            tabIndex={-1}
            className="reservation-payment-popover"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: position?.width,
              maxHeight: position?.maxHeight,
              visibility: position ? "visible" : "hidden",
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                !trigger.current?.contains(event.relatedTarget as Node)
              )
                close();
            }}
          >
            <div className="reservation-payment-popover__header">
              <div>
                <strong id={`${id}-title`}>Règlements</strong>
                <span>{reservation.hote_nom}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label="Fermer les règlements"
                onClick={() => close(true)}
              >
                ×
              </button>
            </div>
            {isReservationPaymentTracking(reservation.payment_tracking) ? (
              <ReservationPaymentsEditor
                reservation={reservation}
                tracking={reservation.payment_tracking}
                onUpdated={onUpdated}
                onBusyChange={setBusy}
              />
            ) : (
              <p>Le suivi des règlements est indisponible.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
