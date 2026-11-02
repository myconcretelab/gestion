import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  nightGuestGroupsLabel,
  type NightSummaryResponse,
} from "@contrats/shared";
import { apiFetch } from "../../../utils/api";

export function useReservationNightSummaries(
  year: number,
  refreshKey: unknown,
  enabled: boolean,
) {
  const [result, setResult] = useState<{
    data: NightSummaryResponse | null;
    error: boolean;
  }>({ data: null, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAttempt((value) => value + 1), 250);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    setResult({ data: null, error: false });
    void apiFetch<NightSummaryResponse>(
      `/reports/night-summaries?year=${year}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ data: null, error: true });
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [year, refreshKey, enabled, attempt]);
  return {
    data: result.data?.year === year ? result.data : null,
    error: result.error,
    enabled,
    retry: () => setAttempt((value) => value + 1),
  };
}

export default function ReservationNightBadges({
  summary,
  propertyIds,
  month,
}: {
  summary: ReturnType<typeof useReservationNightSummaries>;
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
