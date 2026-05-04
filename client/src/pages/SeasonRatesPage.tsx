import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { apiFetch, isAbortError } from "../utils/api";
import { formatEuro } from "../utils/format";
import type {
  SeasonRateEditorPayload,
  SeasonRateEditorResponse,
} from "../utils/types";
import {
  addDaysToIso,
  buildDefaultSeasonRateEditorRange,
  buildPrefilledSeasonRateSegments,
  buildSeasonRateEditorPayload,
  buildSeasonRateEditorSegments,
  buildSeasonRatePrefillDraft,
  getExclusiveEndDisplayLabel,
  insertSeasonRateSegment,
  recalculateSeasonRateEditorSegments,
  removeSeasonRateSegment,
  shiftSeasonRateBoundary,
  type SeasonRateEditorSegment,
} from "../utils/seasonRateEditor";
import { formatUtcDateKey, parseIsoDateUtc } from "../utils/schoolHolidays";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
const DATE_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

type PrefillDialogState = {
  minNuits: string;
  pricesByGite: Record<
    string,
    {
      low: string;
      high: string;
    }
  >;
};

type AddPeriodDraftState = {
  dateDebut: string;
  dateFin: string;
  minNuits: string;
  pricesByGite: Record<string, string>;
};

const diffUtcDays = (from: string, to: string) => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  if (!fromDate || !toDate) return 0;
  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS));
};

const shiftIsoRangeByMonths = (range: { from: string; to: string }, months: number) => {
  const fromDate = parseIsoDateUtc(range.from);
  const toDate = parseIsoDateUtc(range.to);
  if (!fromDate || !toDate) return range;

  return {
    from: formatUtcDateKey(new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + months, 1))),
    to: formatUtcDateKey(new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() + months, 1))),
  };
};

const formatDateLabel = (value: string) => {
  const date = parseIsoDateUtc(value);
  return date ? DATE_LABEL.format(date) : value;
};

const formatRangeLabel = (from: string, to: string) => `${formatDateLabel(from)} au ${formatDateLabel(getExclusiveEndDisplayLabel(to))}`;

const getHolidayNameLabel = (segment: Pick<SeasonRateEditorSegment, "holiday_names">) => {
  if (segment.holiday_names.length === 0) return null;
  return segment.holiday_names.join(" · ");
};

const getCompactHolidayNameLabel = (segment: Pick<SeasonRateEditorSegment, "holiday_names">) => {
  const primaryName = segment.holiday_names[0]?.trim();
  if (!primaryName) return null;
  return primaryName
    .replace(/^Vacances\s+(de\s+|d['’])?/i, "")
    .replace(/^Vacances\s+/i, "")
    .trim();
};

const getHolidayStatusLabel = (segment: Pick<SeasonRateEditorSegment, "holiday_status" | "holiday_names">) => {
  const holidayName = getHolidayNameLabel(segment);
  if (segment.holiday_status === "holiday") return holidayName || "Vacances";
  if (segment.holiday_status === "mixed") return holidayName ? `Mixte · ${holidayName}` : "Mixte";
  return "Hors vacances";
};

const getCompactHolidayStatusLabel = (segment: Pick<SeasonRateEditorSegment, "holiday_status" | "holiday_names">) => {
  const compactHolidayName = getCompactHolidayNameLabel(segment);
  if (segment.holiday_status === "holiday") return compactHolidayName || "Vacances";
  if (segment.holiday_status === "mixed") return compactHolidayName ? `Mixte · ${compactHolidayName}` : "Mixte";
  return "Hors vac.";
};

const buildMonthMarkers = (from: string, to: string) => {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  const totalDays = diffUtcDays(from, to);
  if (!fromDate || !toDate || totalDays <= 0) return [];

  const markers: Array<{ key: string; label: string; left: number; width: number }> = [];
  for (
    let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
    cursor.getTime() < toDate.getTime();
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  ) {
    const monthStart = cursor.getTime() < fromDate.getTime() ? fromDate : cursor;
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const clampedMonthEnd = monthEnd.getTime() > toDate.getTime() ? toDate : monthEnd;
    const left = (diffUtcDays(from, formatUtcDateKey(monthStart)) / totalDays) * 100;
    const width = (diffUtcDays(formatUtcDateKey(monthStart), formatUtcDateKey(clampedMonthEnd)) / totalDays) * 100;
    if (width <= 0) continue;

    markers.push({
      key: `${cursor.getUTCFullYear()}-${cursor.getUTCMonth() + 1}`,
      label: MONTH_LABEL.format(cursor),
      left,
      width,
    });
  }

  return markers;
};

const normalizeEditorSegments = (
  segments: SeasonRateEditorSegment[],
  response: Pick<SeasonRateEditorResponse, "holidays" | "from" | "to">
) => recalculateSeasonRateEditorSegments(segments, response.holidays, response.from, response.to);

const cloneSegments = (segments: SeasonRateEditorSegment[]) =>
  segments.map((segment) => ({
    ...segment,
    prices_by_gite: { ...segment.prices_by_gite },
  }));

const buildAddPeriodDraft = (
  segment: SeasonRateEditorSegment | null,
  gites: Array<SeasonRateEditorResponse["gites"][number]>
): AddPeriodDraftState | null => {
  if (!segment) return null;

  const segmentLength = diffUtcDays(segment.date_debut, segment.date_fin);
  let dateDebut = segment.date_debut;
  let dateFin = segment.date_fin;

  if (segmentLength > 2) {
    dateDebut = addDaysToIso(segment.date_debut, 1);
    dateFin = addDaysToIso(segment.date_fin, -1);
  } else if (segmentLength === 2) {
    dateFin = addDaysToIso(segment.date_debut, 1);
  }

  return {
    dateDebut,
    dateFin,
    minNuits: String(segment.min_nuits ?? 1),
    pricesByGite: gites.reduce<Record<string, string>>((accumulator, gite) => {
      accumulator[gite.id] = segment.prices_by_gite[gite.id] == null ? "" : String(segment.prices_by_gite[gite.id]);
      return accumulator;
    }, {}),
  };
};

const getGiteShortLabel = (gite: SeasonRateEditorResponse["gites"][number]) =>
  String(gite.prefixe_contrat || gite.nom)
    .trim()
    .toUpperCase();

const SeasonRatesPage = () => {
  const [range, setRange] = useState(() => buildDefaultSeasonRateEditorRange());
  const [response, setResponse] = useState<SeasonRateEditorResponse | null>(null);
  const [segments, setSegments] = useState<SeasonRateEditorSegment[]>([]);
  const [initialSegments, setInitialSegments] = useState<SeasonRateEditorSegment[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [addPeriodDraft, setAddPeriodDraft] = useState<AddPeriodDraftState | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [popoverPlacement, setPopoverPlacement] = useState<"top" | "bottom">("bottom");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [prefillState, setPrefillState] = useState<PrefillDialogState>({
    minNuits: "2",
    pricesByGite: {},
  });

  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const segmentsRef = useRef<SeasonRateEditorSegment[]>([]);
  const dragStateRef = useRef<{
    segmentIndex: number;
    side: "start" | "end";
    pointerStartX: number;
    originalBoundary: string;
    trackWidth: number;
  } | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotice(null);
    setResponse(null);
    setSegments([]);
    setInitialSegments([]);
    setSelectedIndex(null);
    setAddPeriodDraft(null);
    setPopoverStyle(null);

    apiFetch<SeasonRateEditorResponse>(
      `/gites/season-rates/editor?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&zone=B`,
      { signal: controller.signal }
    )
      .then((data) => {
        const nextSegments = buildSeasonRateEditorSegments(data);
        setResponse(data);
        setInitialSegments(cloneSegments(nextSegments));
        setSegments(nextSegments);
      })
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger l'éditeur tarifaire.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [range.from, range.to]);

  useEffect(() => {
    const dragMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      const currentResponse = response;
      if (!dragState || !currentResponse || dragState.trackWidth <= 0) return;

      const totalDays = diffUtcDays(currentResponse.from, currentResponse.to);
      if (totalDays <= 0) return;

      const dayDelta = Math.round(((event.clientX - dragState.pointerStartX) / dragState.trackWidth) * totalDays);
      const nextBoundary = addDaysToIso(dragState.originalBoundary, dayDelta);
      const shifted = shiftSeasonRateBoundary(segmentsRef.current, dragState.segmentIndex, dragState.side, nextBoundary);
      if (!shifted) return;

      setSegments(normalizeEditorSegments(shifted, currentResponse));
    };

    const dragEnd = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", dragMove);
    window.addEventListener("pointerup", dragEnd);
    return () => {
      window.removeEventListener("pointermove", dragMove);
      window.removeEventListener("pointerup", dragEnd);
    };
  }, [response]);

  const gites = response?.gites ?? [];
  const months = useMemo(() => buildMonthMarkers(range.from, range.to), [range.from, range.to]);
  const totalDays = useMemo(() => diffUtcDays(range.from, range.to), [range.from, range.to]);
  const timelineCanvasWidth = useMemo(() => Math.max(1680, months.length * 220, segments.length * 160), [months.length, segments.length]);
  const selectedSegment = selectedIndex == null ? null : segments[selectedIndex] ?? null;

  useEffect(() => {
    setAddPeriodDraft(buildAddPeriodDraft(selectedSegment, gites));
  }, [gites, selectedSegment]);

  useEffect(() => {
    if (selectedIndex == null) {
      setPopoverStyle(null);
      return;
    }

    const updatePopoverPosition = () => {
      const anchor = segmentRefs.current[selectedIndex];
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 14;

      let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
      left = Math.min(Math.max(12, left), viewportWidth - popoverRect.width - 12);

      let top = anchorRect.bottom + gap;
      let placement: "top" | "bottom" = "bottom";
      if (top + popoverRect.height > viewportHeight - 12) {
        top = Math.max(12, anchorRect.top - popoverRect.height - gap);
        placement = "top";
      }

      setPopoverPlacement(placement);
      setPopoverStyle({
        top: `${Math.round(top)}px`,
        left: `${Math.round(left)}px`,
      });
    };

    const frame = window.requestAnimationFrame(updatePopoverPosition);
    const handleScroll = () => updatePopoverPosition();
    const scrollContainer = timelineScrollRef.current;
    window.addEventListener("resize", handleScroll);
    window.addEventListener("scroll", handleScroll, true);
    scrollContainer?.addEventListener("scroll", handleScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("scroll", handleScroll, true);
      scrollContainer?.removeEventListener("scroll", handleScroll);
    };
  }, [selectedIndex, segments]);

  useEffect(() => {
    if (selectedIndex == null) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) || segmentRefs.current[selectedIndex]?.contains(target)) return;
      setSelectedIndex(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedIndex(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedIndex]);

  const summary = useMemo(() => {
    const incompleteSegments = segments.filter((segment) =>
      segment.min_nuits == null || segment.has_mixed_min_nights || Object.values(segment.prices_by_gite).some((price) => price == null)
    ).length;
    const holidaySegments = segments.filter((segment) => segment.holiday_status === "holiday").length;
    const mixedSegments = segments.filter((segment) => segment.holiday_status === "mixed" || segment.has_mixed_min_nights).length;

    return {
      total: segments.length,
      incompleteSegments,
      holidaySegments,
      mixedSegments,
    };
  }, [segments]);

  const isDirty = useMemo(
    () => JSON.stringify(segments) !== JSON.stringify(initialSegments),
    [initialSegments, segments]
  );

  const applyNextSegments = (nextSegments: SeasonRateEditorSegment[], nextSelectedIndex: number | null = selectedIndex) => {
    if (!response) return;
    const normalized = normalizeEditorSegments(nextSegments, response);
    setSegments(normalized);
    if (normalized.length === 0 || nextSelectedIndex == null) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex(Math.max(0, Math.min(nextSelectedIndex, normalized.length - 1)));
  };

  const handleBoundaryDateChange = (segmentIndex: number, side: "start" | "end", value: string) => {
    if (!response || !value) return;
    const shifted = shiftSeasonRateBoundary(segments, segmentIndex, side, value);
    if (!shifted) {
      setError("La borne choisie crée un segment vide ou chevauche son voisin.");
      return;
    }
    setError(null);
    applyNextSegments(shifted, segmentIndex);
  };

  const handleSegmentValueChange = (
    segmentIndex: number,
    updater: (segment: SeasonRateEditorSegment) => SeasonRateEditorSegment
  ) => {
    const nextSegments = cloneSegments(segments);
    nextSegments[segmentIndex] = updater(nextSegments[segmentIndex]);
    setSegments(nextSegments);
  };

  const handleAddPeriod = () => {
    if (selectedIndex == null || !selectedSegment || !addPeriodDraft) return;

    const minNuits = Number(addPeriodDraft.minNuits);
    if (!Number.isInteger(minNuits) || minNuits < 1) {
      setError("Le minimum de nuits de la nouvelle période doit être un entier supérieur ou égal à 1.");
      return;
    }

    let pricesByGite: Record<string, number | null>;
    try {
      pricesByGite = gites.reduce<Record<string, number | null>>((accumulator, gite) => {
        const rawValue = addPeriodDraft.pricesByGite[gite.id];
        const price = rawValue === "" ? null : Number(rawValue);
        if (price == null || !Number.isFinite(price) || price < 0) {
          throw new Error(`Le prix de la nouvelle période est invalide pour le gîte ${gite.nom}.`);
        }
        accumulator[gite.id] = price;
        return accumulator;
      }, {});
    } catch (priceError) {
      setError(priceError instanceof Error ? priceError.message : "Prix invalide pour la nouvelle période.");
      return;
    }

    const inserted = insertSeasonRateSegment(segments, selectedIndex, {
      date_debut: addPeriodDraft.dateDebut,
      date_fin: addPeriodDraft.dateFin,
      min_nuits: minNuits,
      prices_by_gite: pricesByGite,
    });

    if (!inserted) {
      setError("La nouvelle période doit rester incluse dans le segment ouvert et modifier réellement son découpage.");
      return;
    }

    const nextSelectedIndex = selectedIndex + (selectedSegment.date_debut < addPeriodDraft.dateDebut ? 1 : 0);
    setError(null);
    applyNextSegments(inserted, nextSelectedIndex);
  };

  const handleDeleteSelectedSegment = () => {
    if (selectedIndex == null) return;
    const removed = removeSeasonRateSegment(segments, selectedIndex);
    if (!removed) {
      setError("Impossible de supprimer l'unique période de la frise.");
      return;
    }
    setError(null);
    applyNextSegments(removed, selectedIndex === 0 ? 0 : selectedIndex - 1);
  };

  const openPrefillDialog = () => {
    const { draft } = buildSeasonRatePrefillDraft(gites);
    setPrefillState({
      minNuits: "2",
      pricesByGite: draft,
    });
    setPrefillOpen(true);
  };

  const applyPrefill = () => {
    if (!response) return;

    const minNuits = Number(prefillState.minNuits);
    if (!Number.isInteger(minNuits) || minNuits < 1) {
      setError("Le minimum de nuits de préremplissage doit être un entier supérieur ou égal à 1.");
      return;
    }

    const pricesByGite = gites.reduce<Record<string, { low: number; high: number }>>((accumulator, gite) => {
      const row = prefillState.pricesByGite[gite.id];
      const low = Number(row?.low ?? "");
      const high = Number(row?.high ?? "");
      if (!Number.isFinite(low) || low < 0 || !Number.isFinite(high) || high < 0) {
        throw new Error(`Complète les tarifs haut/bas du gîte ${gite.nom}.`);
      }
      accumulator[gite.id] = { low, high };
      return accumulator;
    }, {});

    const nextSegments = buildPrefilledSeasonRateSegments({
      from: response.from,
      to: response.to,
      holidays: response.holidays,
      gites,
      pricesByGite,
      minNuits,
    });

    setError(null);
    setNotice("Préremplissage appliqué. Ajuste ensuite les bornes ou les prix si besoin.");
    setPrefillOpen(false);
    applyNextSegments(nextSegments, null);
  };

  const handleSave = async () => {
    if (!response) return;

    let payload: SeasonRateEditorPayload;
    try {
      payload = buildSeasonRateEditorPayload({
        from: response.from,
        to: response.to,
        zone: response.zone,
        segments,
      });
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Impossible de préparer les tarifs.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await apiFetch<SeasonRateEditorResponse>("/gites/season-rates/editor", {
        method: "PUT",
        json: payload,
      });
      const savedSegments = buildSeasonRateEditorSegments(saved);
      setResponse(saved);
      setInitialSegments(cloneSegments(savedSegments));
      setSegments(savedSegments);
      if (selectedIndex == null || savedSegments.length === 0) {
        setSelectedIndex(null);
      } else {
        setSelectedIndex(Math.max(0, Math.min(selectedIndex, savedSegments.length - 1)));
      }
      setNotice("Tarifs saisonniers enregistrés.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const startBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>, segmentIndex: number, side: "start" | "end") => {
    if (!response || !timelineTrackRef.current) return;

    dragStateRef.current = {
      segmentIndex,
      side,
      pointerStartX: event.clientX,
      originalBoundary: side === "start" ? segments[segmentIndex].date_debut : segments[segmentIndex].date_fin,
      trackWidth: timelineTrackRef.current.getBoundingClientRect().width,
    };
    event.preventDefault();
  };

  return (
    <main className="page-shell season-rates-page">
      <section className="card season-rates-editor">
        <div className="section-title-row">
          <div>
            <h1>Tarifs saisonniers</h1>
            <p className="section-subtitle">Éditeur visuel zone B pour les 12 mois glissants du plugin `booked`.</p>
          </div>
        </div>

        <div className="season-rates-editor__toolbar">
          <div className="season-rates-editor__range">
            <button type="button" className="button-secondary" onClick={() => setRange((current) => shiftIsoRangeByMonths(current, -12))}>
              -12 mois
            </button>
            <div className="season-rates-editor__range-label">
              <strong>{formatRangeLabel(range.from, range.to)}</strong>
              <span>Vacances scolaires zone B en surcouche</span>
            </div>
            <button type="button" className="button-secondary" onClick={() => setRange((current) => shiftIsoRangeByMonths(current, 12))}>
              +12 mois
            </button>
          </div>

          <div className="season-rates-editor__toolbar-actions">
            <button type="button" className="button-secondary" onClick={openPrefillDialog} disabled={loading || saving || gites.length === 0}>
              Préremplir vacances / hors vacances
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setSegments(cloneSegments(initialSegments));
                setSelectedIndex(null);
                setNotice("Brouillon réinitialisé.");
                setError(null);
              }}
              disabled={loading || saving || !isDirty}
            >
              Réinitialiser
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={loading || saving || !response}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>

        <div className="season-rates-editor__legend">
          <span className="season-rates-editor__legend-item">
            <span className="season-rates-editor__legend-swatch season-rates-editor__legend-swatch--holiday" />
            Vacances
          </span>
          <span className="season-rates-editor__legend-item">
            <span className="season-rates-editor__legend-swatch season-rates-editor__legend-swatch--non-holiday" />
            Hors vacances
          </span>
          <span className="season-rates-editor__legend-item">
            <span className="season-rates-editor__legend-swatch season-rates-editor__legend-swatch--mixed" />
            Mixte
          </span>
          <span className="season-rates-editor__legend-item">
            {summary.total} segment(s) · {summary.holidaySegments} vacances · {summary.mixedSegments} mixte(s)
          </span>
          <span className={`season-rates-editor__legend-item ${summary.incompleteSegments > 0 ? "season-rates-editor__legend-item--warning" : ""}`}>
            {summary.incompleteSegments > 0
              ? `${summary.incompleteSegments} segment(s) à normaliser avant sauvegarde`
              : "Tous les segments sont complets"}
          </span>
        </div>

        {notice ? <div className="note">{notice}</div> : null}
        {error ? <div className="note note--danger">{error}</div> : null}
        {loading ? <div className="note">Chargement de la frise tarifaire…</div> : null}

        {!loading && response ? (
          <div className="card season-rates-editor__timeline-card">
            <div className="season-rates-editor__card-head">
              <h2>Frise annuelle</h2>
              <p>{totalDays} nuits couvertes. Clique une période pour modifier ses bornes, ses prix et ajouter une nouvelle période.</p>
            </div>

            <div ref={timelineScrollRef} className="season-rates-editor__timeline-scroll">
              <div className="season-rates-editor__timeline-canvas" style={{ width: `${timelineCanvasWidth}px` }}>
                <div className="season-rates-editor__months">
                  {months.map((month) => (
                    <div
                      key={month.key}
                      className="season-rates-editor__month"
                      style={{ left: `${month.left}%`, width: `${month.width}%` }}
                    >
                      {month.label}
                    </div>
                  ))}
                </div>

                <div ref={timelineTrackRef} className="season-rates-editor__timeline-track">
                  {months.map((month) => (
                    <div
                      key={`${month.key}-grid`}
                      className="season-rates-editor__month-grid"
                      style={{ left: `${month.left}%`, width: `${month.width}%` }}
                    />
                  ))}

                  {segments.map((segment, index) => {
                    const left = totalDays > 0 ? (diffUtcDays(response.from, segment.date_debut) / totalDays) * 100 : 0;
                    const width = totalDays > 0 ? (diffUtcDays(segment.date_debut, segment.date_fin) / totalDays) * 100 : 0;
                    const segmentPixelWidth = totalDays > 0 ? (diffUtcDays(segment.date_debut, segment.date_fin) / totalDays) * timelineCanvasWidth : 0;
                    const isSelected = index === selectedIndex;
                    const segmentLabel = getHolidayStatusLabel(segment);
                    const compactSegmentLabel = getCompactHolidayStatusLabel(segment);
                    const showSubtitle = segmentPixelWidth >= 154;
                    const useCompactLabel = segmentPixelWidth < 148;
                    const segmentDensityClass =
                      segmentPixelWidth < 90
                        ? "season-rates-editor__segment--tiny"
                        : segmentPixelWidth < 150
                          ? "season-rates-editor__segment--compact"
                          : "";
                    const segmentPriceValues = gites
                      .map((gite) => segment.prices_by_gite[gite.id])
                      .filter((price): price is number => price != null);
                    const segmentPriceRows = gites
                      .map((gite) => {
                        const price = segment.prices_by_gite[gite.id];
                        if (price == null) return null;
                        return {
                          id: gite.id,
                          label: getGiteShortLabel(gite),
                          priceLabel: formatEuro(price, { maximumFractionDigits: 0 }),
                        };
                      })
                      .filter((row): row is { id: string; label: string; priceLabel: string } => row != null);
                    const minPrice = segmentPriceValues.length > 0 ? Math.min(...segmentPriceValues) : null;
                    const maxPrice = segmentPriceValues.length > 0 ? Math.max(...segmentPriceValues) : null;
                    const compactPriceSummary =
                      segmentPriceRows.length === 0
                        ? "Prix à saisir"
                        : segmentPriceRows.length === 1
                          ? `${segmentPriceRows[0].label} · ${segmentPriceRows[0].priceLabel}`
                          : minPrice == null || maxPrice == null
                            ? `${segmentPriceRows.length} gîtes`
                            : `${segmentPriceRows.length} gîtes · ${formatEuro(minPrice, { maximumFractionDigits: 0 })} à ${formatEuro(maxPrice, { maximumFractionDigits: 0 })}`;
                    const visiblePriceRows = segmentPriceRows.slice(0, 3);
                    const remainingPriceCount = Math.max(0, segmentPriceRows.length - visiblePriceRows.length);

                    return (
                      <div
                        key={`${segment.date_debut}:${segment.date_fin}:${index}`}
                        ref={(node) => {
                          segmentRefs.current[index] = node;
                        }}
                        className={`season-rates-editor__segment season-rates-editor__segment--${segment.holiday_status} ${
                          isSelected ? "season-rates-editor__segment--selected" : ""
                        } ${segmentDensityClass}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        role="button"
                        tabIndex={0}
                        title={`${segmentLabel} · ${formatRangeLabel(segment.date_debut, segment.date_fin)}`}
                        onClick={() => setSelectedIndex(index)}
                        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedIndex(index);
                          }
                        }}
                      >
                        {index > 0 ? (
                          <button
                            type="button"
                            className="season-rates-editor__handle season-rates-editor__handle--left"
                            onPointerDown={(event) => startBoundaryDrag(event, index, "start")}
                            aria-label={`Déplacer la borne avant le segment ${index + 1}`}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : null}
                        <span className="season-rates-editor__segment-copy">
                          <strong>{useCompactLabel ? compactSegmentLabel : segmentLabel}</strong>
                          {showSubtitle ? <span>{formatRangeLabel(segment.date_debut, segment.date_fin)}</span> : null}
                          <span className="season-rates-editor__segment-price-summary">{compactPriceSummary}</span>
                          {segmentPixelWidth >= 320 && visiblePriceRows.length > 0 ? (
                            <span className="season-rates-editor__segment-prices">
                              {visiblePriceRows.map((row) => (
                                <span key={row.id} className="season-rates-editor__segment-price-pill">
                                  <em>{row.label}</em>
                                  <strong>{row.priceLabel}</strong>
                                </span>
                              ))}
                              {remainingPriceCount > 0 ? (
                                <span className="season-rates-editor__segment-price-pill season-rates-editor__segment-price-pill--more">
                                  <strong>+{remainingPriceCount}</strong>
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="season-rates-editor__timeline-hint">
              {selectedSegment
                ? `${getHolidayStatusLabel(selectedSegment)} · ${formatRangeLabel(selectedSegment.date_debut, selectedSegment.date_fin)}`
                : "Aucun popover ouvert. Clique une période pour éditer ses prix et ses dates."}
            </div>
          </div>
        ) : null}
      </section>

      {selectedSegment ? (
        <div
          ref={popoverRef}
          className={`season-rates-editor__popover season-rates-editor__popover--${popoverPlacement}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby="season-rates-popover-title"
          style={popoverStyle ?? { top: "0px", left: "0px", visibility: "hidden", pointerEvents: "none" }}
        >
          <div className="season-rates-editor__popover-head">
            <div>
              <p className="season-rates-editor__popover-eyebrow">Période {selectedIndex == null ? "" : selectedIndex + 1}</p>
              <h2 id="season-rates-popover-title">{formatRangeLabel(selectedSegment.date_debut, selectedSegment.date_fin)}</h2>
            </div>
            <button type="button" className="button-secondary" onClick={() => setSelectedIndex(null)}>
              Fermer
            </button>
          </div>

          <div className="season-rates-editor__popover-meta">
            <span className={`badge season-rates-editor__status-badge season-rates-editor__status-badge--${selectedSegment.holiday_status}`}>
              {getHolidayStatusLabel(selectedSegment)}
            </span>
            <span className="season-rates-editor__selection-hint">
              Fin affichée: jusqu’au {formatDateLabel(getExclusiveEndDisplayLabel(selectedSegment.date_fin))}
            </span>
          </div>

          <section className="season-rates-editor__popover-section">
            <div className="season-rates-editor__popover-section-head">
              <h3>Modifier la période</h3>
              <p>Ajuste directement les bornes, le minimum de nuits et les tarifs par gîte.</p>
            </div>

            <div className="season-rates-editor__popover-fields">
              <label className="field field--small">
                Début
                <input
                  type="date"
                  value={selectedSegment.date_debut}
                  onChange={(event) => {
                    if (selectedIndex != null) {
                      handleBoundaryDateChange(selectedIndex, "start", event.target.value);
                    }
                  }}
                  disabled={selectedIndex === 0}
                />
              </label>

              <label className="field field--small">
                Fin
                <input
                  type="date"
                  value={selectedSegment.date_fin}
                  onChange={(event) => {
                    if (selectedIndex != null) {
                      handleBoundaryDateChange(selectedIndex, "end", event.target.value);
                    }
                  }}
                  disabled={selectedIndex === segments.length - 1}
                />
              </label>

              <label className="field field--small">
                Min nuits
                <input
                  type="number"
                  min="1"
                  value={selectedSegment.min_nuits ?? ""}
                  placeholder={selectedSegment.has_mixed_min_nights ? "Mixte" : "1"}
                  className={selectedSegment.has_mixed_min_nights ? "season-rates-editor__input--warning" : ""}
                  onChange={(event) => {
                    if (selectedIndex != null) {
                      handleSegmentValueChange(selectedIndex, (current) => ({
                        ...current,
                        min_nuits: event.target.value ? Number(event.target.value) : null,
                        has_mixed_min_nights: false,
                      }));
                    }
                  }}
                />
              </label>
            </div>

            <div className="season-rates-editor__popover-prices">
              {gites.map((gite) => (
                <label key={`${selectedSegment.date_debut}:${selectedSegment.date_fin}:${gite.id}`} className="field field--small season-rates-editor__popover-price-card">
                  <span className="season-rates-editor__popover-price-label">
                    <strong>{gite.nom}</strong>
                    <em>{getGiteShortLabel(gite)}</em>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={selectedSegment.prices_by_gite[gite.id] ?? ""}
                    placeholder="Prix"
                    className={selectedSegment.prices_by_gite[gite.id] == null ? "season-rates-editor__input--warning" : ""}
                    onChange={(event) => {
                      if (selectedIndex != null) {
                        handleSegmentValueChange(selectedIndex, (current) => ({
                          ...current,
                          prices_by_gite: {
                            ...current.prices_by_gite,
                            [gite.id]: event.target.value === "" ? null : Number(event.target.value),
                          },
                        }));
                      }
                    }}
                  />
                  <span className="season-rates-editor__price-hint">
                    {selectedSegment.prices_by_gite[gite.id] == null ? "Prix requis" : formatEuro(selectedSegment.prices_by_gite[gite.id] ?? 0)}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="season-rates-editor__popover-section">
            <div className="season-rates-editor__popover-section-head">
              <h3>Ajouter une période</h3>
              <p>Insère une nouvelle période à l’intérieur de celle-ci. Le reste du segment est conservé automatiquement avant et/ou après.</p>
            </div>

            {addPeriodDraft && diffUtcDays(selectedSegment.date_debut, selectedSegment.date_fin) > 1 ? (
              <>
                <div className="season-rates-editor__popover-fields">
                  <label className="field field--small">
                    Début
                    <input
                      type="date"
                      value={addPeriodDraft.dateDebut}
                      onChange={(event) =>
                        setAddPeriodDraft((current) => (current ? { ...current, dateDebut: event.target.value } : current))
                      }
                    />
                  </label>

                  <label className="field field--small">
                    Fin
                    <input
                      type="date"
                      value={addPeriodDraft.dateFin}
                      onChange={(event) =>
                        setAddPeriodDraft((current) => (current ? { ...current, dateFin: event.target.value } : current))
                      }
                    />
                  </label>

                  <label className="field field--small">
                    Min nuits
                    <input
                      type="number"
                      min="1"
                      value={addPeriodDraft.minNuits}
                      onChange={(event) =>
                        setAddPeriodDraft((current) => (current ? { ...current, minNuits: event.target.value } : current))
                      }
                    />
                  </label>
                </div>

                <div className="season-rates-editor__popover-prices">
                  {gites.map((gite) => (
                    <label key={`new-period:${gite.id}`} className="field field--small season-rates-editor__popover-price-card">
                      <span className="season-rates-editor__popover-price-label">
                        <strong>{gite.nom}</strong>
                        <em>{getGiteShortLabel(gite)}</em>
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={addPeriodDraft.pricesByGite[gite.id] ?? ""}
                        placeholder="Prix"
                        onChange={(event) =>
                          setAddPeriodDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  pricesByGite: {
                                    ...current.pricesByGite,
                                    [gite.id]: event.target.value,
                                  },
                                }
                              : current
                          )
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="season-rates-editor__popover-actions">
                  <button type="button" className="button-secondary" onClick={() => void handleAddPeriod()}>
                    Ajouter la période
                  </button>
                </div>
              </>
            ) : (
              <p className="season-rates-editor__popover-note">
                La période est trop courte pour en insérer une nouvelle sans recouvrement. Ajuste d’abord ses bornes si nécessaire.
              </p>
            )}
          </section>

          <div className="season-rates-editor__popover-footer">
            <p className="season-rates-editor__popover-note">
              La suppression retire cette période et laisse le segment voisin reprendre automatiquement sa plage.
            </p>
            <button
              type="button"
              className="button-secondary season-rates-editor__delete-button"
              onClick={() => void handleDeleteSelectedSegment()}
              disabled={segments.length <= 1}
            >
              Supprimer la période
            </button>
          </div>
        </div>
      ) : null}

      {prefillOpen ? (
        <div className="season-rates-editor__modal-backdrop" role="presentation" onClick={() => setPrefillOpen(false)}>
          <div
            className="season-rates-editor__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="season-rates-prefill-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="season-rates-editor__modal-head">
              <div>
                <p className="season-rates-editor__modal-eyebrow">Préremplissage</p>
                <h2 id="season-rates-prefill-title">Vacances / hors vacances</h2>
              </div>
              <button type="button" className="button-secondary" onClick={() => setPrefillOpen(false)}>
                Fermer
              </button>
            </div>

            <p className="season-rates-editor__modal-copy">
              Les périodes de vacances reçoivent le tarif haut, les autres le tarif bas. Ajuste les valeurs manquantes avant génération.
            </p>

            <label className="field">
              Minimum de nuits commun
              <input
                type="number"
                min="1"
                value={prefillState.minNuits}
                onChange={(event) =>
                  setPrefillState((current) => ({
                    ...current,
                    minNuits: event.target.value,
                  }))
                }
              />
            </label>

            <div className="season-rates-editor__prefill-grid">
              {gites.map((gite) => (
                <div key={gite.id} className="season-rates-editor__prefill-card">
                  <div className="season-rates-editor__prefill-card-head">
                    <strong>{gite.nom}</strong>
                    <span>
                      Suggestions:{" "}
                      {Array.isArray(gite.prix_nuit_liste) && gite.prix_nuit_liste.length > 0
                        ? gite.prix_nuit_liste.map((price) => formatEuro(price)).join(" · ")
                        : "aucune"}
                    </span>
                  </div>

                  <div className="season-rates-editor__prefill-fields">
                    <label className="field field--small">
                      Tarif bas
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={prefillState.pricesByGite[gite.id]?.low ?? ""}
                        onChange={(event) =>
                          setPrefillState((current) => ({
                            ...current,
                            pricesByGite: {
                              ...current.pricesByGite,
                              [gite.id]: {
                                ...(current.pricesByGite[gite.id] ?? { low: "", high: "" }),
                                low: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="field field--small">
                      Tarif haut
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={prefillState.pricesByGite[gite.id]?.high ?? ""}
                        onChange={(event) =>
                          setPrefillState((current) => ({
                            ...current,
                            pricesByGite: {
                              ...current.pricesByGite,
                              [gite.id]: {
                                ...(current.pricesByGite[gite.id] ?? { low: "", high: "" }),
                                high: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="season-rates-editor__modal-actions">
              <button type="button" className="button-secondary" onClick={() => setPrefillOpen(false)}>
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    applyPrefill();
                  } catch (prefillError) {
                    setError(prefillError instanceof Error ? prefillError.message : "Préremplissage impossible.");
                  }
                }}
              >
                Générer les segments
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};

export default SeasonRatesPage;
