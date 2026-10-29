import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { formatReportValue, type ReportReminder } from "@contrats/shared";
import { apiFetch, isAbortError } from "../../../utils/api";
import { dispatchAppNotice } from "../../../utils/appNotices";
import { ReportIcon } from "./ReportUi";
import "./reservationReminders.css";

export default function ReservationDeclarationReminders({
  year,
  propertyId,
  refreshKey,
  currentTimeMs,
}: {
  year: number;
  propertyId?: string;
  refreshKey: unknown;
  currentTimeMs: number;
}) {
  const currentMonth = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(currentTimeMs));
  const headingId = useId();
  const [reminders, setReminders] = useState<ReportReminder[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<{
    key: string;
    pending: boolean;
  } | null>(null);
  const copyKey = (item: ReportReminder) => `${item.id}:${item.total}`;
  const copy = async (item: ReportReminder) => {
    if (!item.canCopy) return;
    const key = copyKey(item);
    setCopyState({ key, pending: true });
    try {
      const value =
        item.kind === "tourist"
          ? String(item.total)
          : new Intl.NumberFormat("fr-FR", {
              useGrouping: false,
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(item.total / 100);
      await navigator.clipboard.writeText(value);
      setCopyState({ key, pending: false });
      dispatchAppNotice({
        label: "Copie",
        message:
          item.kind === "tourist"
            ? "Nombre de nuitées copié."
            : "Montant copié.",
        tone: "success",
        timeoutMs: 2500,
      });
    } catch {
      setCopyState(null);
      dispatchAppNotice({
        label: "Copie",
        message: "Copie impossible. Sélectionnez le montant pour le copier.",
        tone: "error",
        timeoutMs: 4500,
      });
    }
  };
  useEffect(() => {
    let controller: AbortController | undefined;
    let disposed = false;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const request = controller;
      try {
        const data = await apiFetch<{ reminders: ReportReminder[] }>(
          `/reports/reminders?year=${year}`,
          { signal: controller.signal },
        );
        if (!disposed && !request.signal.aborted) {
          setReminders(data.reminders);
          setError(false);
        }
      } catch (err) {
        if (!disposed && !isAbortError(err)) {
          setError(true);
          setReminders([]);
        }
      }
    };
    const timer = window.setTimeout(() => void load(), 250);
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [year, refreshKey, attempt, currentMonth]);
  const visible = reminders.filter(
    (item) => !propertyId || item.propertyIds.includes(propertyId),
  );
  if (error)
    return (
      <div className="reservation-declarations-error" role="status">
        <span>Les rappels de déclaration sont indisponibles.</span>
        <button
          className="secondary"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Réessayer
        </button>
      </div>
    );
  if (!visible.length) return null;
  return (
    <section className="reservation-declarations" aria-labelledby={headingId}>
      <div className="reservation-declarations__heading">
        <span className="reservation-declarations__icon">
          <ReportIcon name="clock" />
        </span>
        <h2 id={headingId}>
          Déclarations à traiter{" "}
          <span className="reservation-declarations__count">
            {visible.length}
          </span>
        </h2>
        <Link
          className="reservation-declarations__all"
          to={`/rapports?periode=${visible[0].month}`}
        >
          Tous les rapports <ReportIcon name="arrow" />
        </Link>
      </div>
      <ul className="reservation-declarations__list">
        {(expanded ? visible : visible.slice(0, 3)).map((item) => (
          <li key={item.id}>
            <div className="reservation-declarations__identity">
              <strong>{item.name}</strong>
              <span>
                {item.period} · {item.recipient}
              </span>
            </div>
            <div className="reservation-declarations__value">
              <strong>{formatReportValue(item, item.total)}</strong>
              {!item.canCopy && <span>Total inclus · à vérifier</span>}
            </div>
            <span
              className={`reservation-declarations__status${item.status === "review" || item.status === "changed" ? " is-review" : ""}`}
            >
              {item.status === "changed"
                ? "Écart à examiner"
                : item.status === "review"
                  ? `${item.reviewCount} à vérifier`
                  : item.status === "ready"
                    ? "Prêt à déclarer"
                    : "À préparer"}
            </span>
            <div className="reservation-declarations__actions">
              {item.canCopy && (
                <button
                  type="button"
                  className="reservation-declarations__copy"
                  disabled={
                    copyState?.key === copyKey(item) && copyState.pending
                  }
                  aria-label={`Copier ${item.kind === "tourist" ? "le nombre de nuitées" : "le montant"} : ${item.name}, ${item.period}, ${item.recipient}`}
                  onClick={() => void copy(item)}
                >
                  <ReportIcon
                    name={
                      copyState?.key === copyKey(item) && !copyState.pending
                        ? "check"
                        : "copy"
                    }
                  />
                  {copyState?.key === copyKey(item) && !copyState.pending
                    ? "Copié"
                    : "Copier"}
                </button>
              )}
              <Link
                className="reservation-declarations__open"
                to={`/rapports/${encodeURIComponent(item.reportId)}?periode=${item.month}`}
                aria-label={`Ouvrir ${item.name}, ${item.period}, ${item.recipient}`}
              >
                Ouvrir <ReportIcon name="arrow" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {visible.length > 3 && (
        <button
          className="reservation-declarations__more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Réduire la liste"
            : `Voir ${visible.length - 3} autre${visible.length - 3 > 1 ? "s" : ""} déclaration${visible.length - 3 > 1 ? "s" : ""}`}
        </button>
      )}
    </section>
  );
}
