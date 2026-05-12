import { useEffect, useMemo, useState } from "react";
import { apiFetch, isAbortError } from "../utils/api";
import { formatEuro } from "../utils/format";
import type { Gite, SeasonRateEditorPayload, SeasonRateEditorResponse } from "../utils/types";
import {
  addDaysToIso,
  buildAutomaticSeasonRateSegments,
  buildDefaultSeasonRateEditorRange,
  buildSeasonRateEditorPayload,
  buildSeasonRateEditorSegments,
  getExclusiveEndDisplayLabel,
  type SeasonRateEditorRule,
  type SeasonRateEditorSegment,
} from "../utils/seasonRateEditor";
import { formatUtcDateKey, parseIsoDateUtc } from "../utils/schoolHolidays";

const DATE_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

type EditorGite = SeasonRateEditorResponse["gites"][number];

const cloneSegments = (segments: SeasonRateEditorSegment[]) =>
  segments.map((segment) => ({
    ...segment,
    min_nuits_by_gite: { ...segment.min_nuits_by_gite },
    prices_by_gite: { ...segment.prices_by_gite },
    holiday_names: [...segment.holiday_names],
    rule_names: [...segment.rule_names],
  }));

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

const getGiteShortLabel = (gite: Pick<Gite, "prefixe_contrat" | "nom">) =>
  String(gite.prefixe_contrat || gite.nom)
    .trim()
    .toUpperCase();

const getRuleLabel = (segment: Pick<SeasonRateEditorSegment, "rule" | "rule_names" | "holiday_names">) => {
  if (segment.rule === "july_august") return "Juillet / août";
  if (segment.rule === "bridge") return segment.rule_names[0] ?? "Pont";
  if (segment.rule === "school_holiday") return segment.holiday_names.join(" · ") || "Vacances zone B";
  if (segment.rule === "manual") return "Tarif enregistré";
  return "Normal";
};

const getRuleClass = (rule: SeasonRateEditorRule) => {
  if (rule === "school_holiday") return "holiday";
  if (rule === "bridge") return "bridge";
  if (rule === "july_august") return "summer";
  if (rule === "manual") return "manual";
  return "normal";
};

const summarizeMinNights = (segment: SeasonRateEditorSegment, gites: EditorGite[]) => {
  const values = gites.map((gite) => segment.min_nuits_by_gite[gite.id] ?? segment.min_nuits).filter((value): value is number => value != null);
  const uniqueValues = [...new Set(values)].sort((left, right) => left - right);
  if (uniqueValues.length === 0) return "à saisir";
  if (uniqueValues.length === 1) return `${uniqueValues[0]} nuit${uniqueValues[0] > 1 ? "s" : ""}`;
  return `${uniqueValues[0]} à ${uniqueValues[uniqueValues.length - 1]} nuits`;
};

const getDefaultPrice = (gite: EditorGite, mode: "normal" | "high") => {
  const low = Number(gite.prix_nuit_basse_saison ?? 0);
  const high = Number(gite.prix_nuit_haute_saison ?? 0);
  if (mode === "high") return high > 0 ? high : low;
  return low > 0 ? low : high;
};

const getDefaultMinNights = (gite: EditorGite, rule: SeasonRateEditorRule) => {
  if (rule === "july_august") return Math.max(1, Number(gite.min_nuits_juillet_aout ?? 1) || 1);
  if (rule === "school_holiday") return Math.max(1, Number(gite.min_nuits_vacances_scolaires ?? 1) || 1);
  if (rule === "bridge") return 3;
  return Math.max(1, Number(gite.min_nuits_toute_annee ?? 1) || 1);
};

const applyRuleMetadata = (segments: SeasonRateEditorSegment[], automaticSegments: SeasonRateEditorSegment[]) =>
  segments.map((segment) => {
    const matchingRule = automaticSegments.find(
      (candidate) => candidate.date_debut <= segment.date_debut && candidate.date_fin >= segment.date_fin
    );
    if (!matchingRule) return segment;
    return {
      ...segment,
      rule: matchingRule.rule,
      rule_names: [...matchingRule.rule_names],
      holiday_status: matchingRule.holiday_status,
      holiday_names: [...matchingRule.holiday_names],
    };
  });

const recomputeMinSummary = (minNightsByGite: Record<string, number | null>) => {
  const values = Object.values(minNightsByGite).filter((value): value is number => value != null);
  const uniqueValues = [...new Set(values)];
  return {
    min_nuits: uniqueValues.length === 0 ? null : uniqueValues.length === 1 ? uniqueValues[0] : null,
    has_mixed_min_nights: uniqueValues.length > 1,
  };
};

const SeasonRatesPage = () => {
  const [range, setRange] = useState(() => buildDefaultSeasonRateEditorRange());
  const [response, setResponse] = useState<SeasonRateEditorResponse | null>(null);
  const [segments, setSegments] = useState<SeasonRateEditorSegment[]>([]);
  const [initialSegments, setInitialSegments] = useState<SeasonRateEditorSegment[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotice(null);
    setSelectedIndex(null);

    apiFetch<SeasonRateEditorResponse>(
      `/gites/season-rates/editor?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&zone=B`,
      { signal: controller.signal }
    )
      .then((data) => {
        const automaticSegments = buildAutomaticSeasonRateSegments({
          from: data.from,
          to: data.to,
          holidays: data.holidays,
          gites: data.gites,
        });
        setResponse(data);
        setSegments(automaticSegments);
        setInitialSegments(cloneSegments(automaticSegments));
      })
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setError(fetchError instanceof Error ? fetchError.message : "Impossible de charger les tarifs.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [range.from, range.to]);

  const gites = response?.gites ?? [];
  const selectedSegment = selectedIndex == null ? null : segments[selectedIndex] ?? null;
  const automaticSegments = useMemo(
    () =>
      response
        ? buildAutomaticSeasonRateSegments({
            from: response.from,
            to: response.to,
            holidays: response.holidays,
            gites,
          })
        : [],
    [gites, response]
  );
  const isDirty = useMemo(() => JSON.stringify(segments) !== JSON.stringify(initialSegments), [initialSegments, segments]);
  const importantSegments = useMemo(() => segments.filter((segment) => segment.rule !== "normal"), [segments]);
  const summary = useMemo(
    () => ({
      normal: segments.filter((segment) => segment.rule === "normal").length,
      schoolHoliday: segments.filter((segment) => segment.rule === "school_holiday").length,
      bridge: segments.filter((segment) => segment.rule === "bridge").length,
      julyAugust: segments.filter((segment) => segment.rule === "july_august").length,
      incomplete: segments.filter((segment) =>
        gites.some((gite) => segment.prices_by_gite[gite.id] == null || segment.min_nuits_by_gite[gite.id] == null)
      ).length,
    }),
    [gites, segments]
  );

  const setNextSegments = (updater: (current: SeasonRateEditorSegment[]) => SeasonRateEditorSegment[]) => {
    setSegments((current) => updater(cloneSegments(current)));
  };

  const regenerateAutomatic = () => {
    if (!response) return;
    const nextSegments = cloneSegments(automaticSegments);
    setSegments(nextSegments);
    setSelectedIndex(null);
    setError(null);
    setNotice("Préremplissage automatique appliqué: zone B, ponts et juillet/août.");
  };

  const updateSelectedSegment = (updater: (segment: SeasonRateEditorSegment) => SeasonRateEditorSegment) => {
    if (selectedIndex == null) return;
    setNextSegments((current) => {
      const target = current[selectedIndex];
      if (!target) return current;
      current[selectedIndex] = updater(target);
      return current;
    });
  };

  const setCommonMinNights = (value: number) => {
    updateSelectedSegment((segment) => {
      const minNightsByGite = Object.fromEntries(gites.map((gite) => [gite.id, value]));
      return {
        ...segment,
        min_nuits: value,
        min_nuits_by_gite: minNightsByGite,
        has_mixed_min_nights: false,
      };
    });
  };

  const applyDefaultModeToSelected = (mode: "normal" | "high") => {
    updateSelectedSegment((segment) => ({
      ...segment,
      prices_by_gite: Object.fromEntries(gites.map((gite) => [gite.id, getDefaultPrice(gite, mode)])),
    }));
  };

  const resetSelectedToRule = () => {
    if (!selectedSegment) return;
    updateSelectedSegment((segment) => {
      const automaticMatch = automaticSegments.find(
        (candidate) => candidate.date_debut === segment.date_debut && candidate.date_fin === segment.date_fin
      );
      if (automaticMatch) return cloneSegments([automaticMatch])[0];

      const minNightsByGite = Object.fromEntries(gites.map((gite) => [gite.id, getDefaultMinNights(gite, segment.rule)]));
      const minSummary = recomputeMinSummary(minNightsByGite);
      return {
        ...segment,
        min_nuits: minSummary.min_nuits,
        min_nuits_by_gite: minNightsByGite,
        has_mixed_min_nights: minSummary.has_mixed_min_nights,
        prices_by_gite: Object.fromEntries(
          gites.map((gite) => [gite.id, getDefaultPrice(gite, segment.rule === "school_holiday" || segment.rule === "july_august" ? "high" : "normal")])
        ),
      };
    });
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
      const savedAutomaticSegments = buildAutomaticSeasonRateSegments({
        from: saved.from,
        to: saved.to,
        holidays: saved.holidays,
        gites: saved.gites,
      });
      const savedSegments = applyRuleMetadata(buildSeasonRateEditorSegments(saved), savedAutomaticSegments);
      setResponse(saved);
      setSegments(savedSegments);
      setInitialSegments(cloneSegments(savedSegments));
      setSelectedIndex(null);
      setNotice("Tarifs enregistrés pour les 4 gîtes.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page-shell season-rates-page">
      <section className="card season-rates-simple">
        <div className="section-title-row">
          <div>
            <h1>Tarifs automatiques</h1>
            <p className="section-subtitle">Zone B, ponts français et juillet/août pour les 4 gîtes.</p>
          </div>
        </div>

        <div className="season-rates-simple__toolbar">
          <button type="button" className="button-secondary" onClick={() => setRange((current) => shiftIsoRangeByMonths(current, -12))}>
            -12 mois
          </button>
          <strong>
            {formatDateLabel(range.from)} au {formatDateLabel(addDaysToIso(range.to, -1))}
          </strong>
          <button type="button" className="button-secondary" onClick={() => setRange((current) => shiftIsoRangeByMonths(current, 12))}>
            +12 mois
          </button>
          <span className="season-rates-simple__toolbar-spacer" />
          <button type="button" className="button-secondary" onClick={regenerateAutomatic} disabled={loading || !response}>
            Régénérer automatiquement
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setSegments(cloneSegments(initialSegments));
              setSelectedIndex(null);
              setError(null);
              setNotice("Brouillon réinitialisé.");
            }}
            disabled={loading || saving || !isDirty}
          >
            Réinitialiser
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={loading || saving || !response}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>

        <div className="season-rates-simple__summary">
          <span>Normal · {summary.normal}</span>
          <span>Vacances zone B · {summary.schoolHoliday}</span>
          <span>Ponts · {summary.bridge}</span>
          <span>Juillet/août · {summary.julyAugust}</span>
          <span className={summary.incomplete > 0 ? "season-rates-simple__warning" : ""}>
            {summary.incomplete > 0 ? `${summary.incomplete} période(s) incomplète(s)` : "Tout est complet"}
          </span>
        </div>

        {notice ? <div className="note">{notice}</div> : null}
        {error ? <div className="note note--danger">{error}</div> : null}
        {loading ? <div className="note">Chargement des règles...</div> : null}

        {!loading && response ? (
          <div className="season-rates-simple__layout">
            <div className="season-rates-simple__list">
              <div className="season-rates-simple__list-head">
                <h2>Périodes détectées</h2>
                <p>{importantSegments.length} période(s) à vérifier rapidement. Les périodes normales restent enregistrées aussi.</p>
              </div>

              {importantSegments.length === 0 ? <div className="note">Aucune vacances, pont ou période juillet/août sur cette plage.</div> : null}

              <div className="season-rates-simple__rows">
                {segments.map((segment, index) => {
                  if (segment.rule === "normal") return null;
                  const isSelected = selectedIndex === index;
                  return (
                    <button
                      key={`${segment.date_debut}:${segment.date_fin}:${index}`}
                      type="button"
                      className={`season-rates-simple__row season-rates-simple__row--${getRuleClass(segment.rule)} ${
                        isSelected ? "season-rates-simple__row--selected" : ""
                      }`}
                      onClick={() => setSelectedIndex(index)}
                    >
                      <span>
                        <strong>{getRuleLabel(segment)}</strong>
                        <em>{formatRangeLabel(segment.date_debut, segment.date_fin)}</em>
                      </span>
                      <span>{summarizeMinNights(segment, gites)}</span>
                      <span>
                        {gites
                          .map((gite) => {
                            const price = segment.prices_by_gite[gite.id];
                            return `${getGiteShortLabel(gite)} ${price == null ? "?" : formatEuro(price, { maximumFractionDigits: 0 })}`;
                          })
                          .join(" · ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="season-rates-simple__editor">
              {selectedSegment ? (
                <>
                  <div className="season-rates-simple__editor-head">
                    <span className={`badge season-rates-simple__badge--${getRuleClass(selectedSegment.rule)}`}>
                      {getRuleLabel(selectedSegment)}
                    </span>
                    <h2>{formatRangeLabel(selectedSegment.date_debut, selectedSegment.date_fin)}</h2>
                  </div>

                  <div className="season-rates-simple__quick-actions">
                    <label className="field field--small">
                      Min nuits 4 gîtes
                      <input
                        type="number"
                        min={1}
                        value={selectedSegment.has_mixed_min_nights ? "" : selectedSegment.min_nuits ?? ""}
                        placeholder={selectedSegment.has_mixed_min_nights ? "Mixte" : "2"}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isInteger(value) && value >= 1) setCommonMinNights(value);
                        }}
                      />
                    </label>
                    <button type="button" className="button-secondary" onClick={() => applyDefaultModeToSelected("normal")}>
                      Tarif normal
                    </button>
                    <button type="button" className="button-secondary" onClick={() => applyDefaultModeToSelected("high")}>
                      Tarif vacances
                    </button>
                    <button type="button" className="button-secondary" onClick={resetSelectedToRule}>
                      Valeurs auto
                    </button>
                  </div>

                  <div className="season-rates-simple__gite-grid">
                    {gites.map((gite) => (
                      <div key={gite.id} className="season-rates-simple__gite-row">
                        <strong>{gite.nom}</strong>
                        <label className="field field--small">
                          Nuits
                          <input
                            type="number"
                            min={1}
                            value={selectedSegment.min_nuits_by_gite[gite.id] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value === "" ? null : Math.max(1, Math.trunc(Number(event.target.value) || 1));
                              updateSelectedSegment((segment) => {
                                const minNightsByGite = { ...segment.min_nuits_by_gite, [gite.id]: value };
                                const minSummary = recomputeMinSummary(minNightsByGite);
                                return {
                                  ...segment,
                                  min_nuits: minSummary.min_nuits,
                                  min_nuits_by_gite: minNightsByGite,
                                  has_mixed_min_nights: minSummary.has_mixed_min_nights,
                                };
                              });
                            }}
                          />
                        </label>
                        <label className="field field--small">
                          Prix/nuit
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={selectedSegment.prices_by_gite[gite.id] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0);
                              updateSelectedSegment((segment) => ({
                                ...segment,
                                prices_by_gite: { ...segment.prices_by_gite, [gite.id]: value },
                              }));
                            }}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="season-rates-simple__empty-editor">
                  <h2>Exception</h2>
                  <p>Sélectionne une période détectée pour ajuster les 4 gîtes ou un seul gîte.</p>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
};

export default SeasonRatesPage;
