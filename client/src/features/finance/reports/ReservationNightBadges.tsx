import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  nightGuestGroupsLabel,
  type NightSummaryResponse,
} from "@contrats/shared";
import { apiFetch } from "../../../utils/api";
import { useTimelineYearsData } from "../../../utils/useTimelineYearsData";

export function useReservationNightSummaries(years: number[], revision: number, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const { data, errors } = useTimelineYearsData(years, revision + attempt, enabled, (year, signal) =>
    apiFetch<NightSummaryResponse>(`/reports/night-summaries?year=${year}`, { signal }),
  );
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAttempt((value) => value + 1), 250);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled]);
  return (year: number) => ({
    data: data[year] ?? null,
    error: Boolean(errors[year]),
    enabled,
    retry: () => setAttempt((value) => value + 1),
  });
}

export default function ReservationNightBadges({
  summary,
  propertyIds,
  month,
}: {
  summary: ReturnType<ReturnType<typeof useReservationNightSummaries>>;
  propertyIds: string[];
  month: number;
}) {
  if (!summary.enabled || !propertyIds.length) return null;
  if (!summary.data)
    return summary.error ? (
      <button
        type="button"
        className="reservations-summary-pill"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          summary.retry();
        }}
      >
        Nuitées indisponibles · Réessayer
      </button>
    ) : (
      <span className="reservations-summary-pill">Nuitées · chargement…</span>
    );
  const data = summary.data;
  const properties = data.properties.filter((property) =>
    propertyIds.includes(property.id),
  );
  const rows = properties.flatMap((property) =>
    property.months.filter((row) => row.month === month),
  );
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const included = rows.reduce((sum, row) => sum + row.included, 0);
  const review = rows.some((row) => row.reviewCount > 0);
  const inScope = properties.some((property) => property.inScope);
  const groups = nightGuestGroupsLabel(data.report?.guestGroups);
  return (
    <>
      <span
        className="reservations-summary-pill reservations-summary-pill--guest-nights"
        title={groups}
      >
        Total {total} nuitée{total > 1 ? "s" : ""}
        {groups === "Adultes uniquement" ? " adultes" : ""}
      </span>
      {data.report && (
        <Link
          className="reservations-summary-pill reservations-summary-pill--guest-nights"
          to={`/rapports/${encodeURIComponent(data.report.id)}?periode=${data.year}-${String(month).padStart(2, "0")}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          title={`${data.report.name} · ${groups}`}
        >
          {!inScope
            ? "Nuitées · hors périmètre"
            : `${included} à déclarer${review ? " · à vérifier" : ""}`}
        </Link>
      )}
    </>
  );
}
