import { useCallback, useEffect, useState } from "react";
import {
  planningOrganizationSchema,
  type PlanningMission,
  type PlanningOrganization,
  type PlanningIntervention,
} from "@contrats/shared";
import { apiFetch, buildApiUrl } from "../../utils/api";
import type {
  PlanningRelayPeriod,
  PlanningRelayWorker,
  PlanningRelaySmsConfig,
  PlanningRelayMessageChannelStatus,
  PlanningRelaySmsProgrammeTemplate,
} from "../../utils/types";
import type { ActionResponse } from "./types";
import ReservationDetailsDrawer from "../shared/ReservationDetailsDrawer";
import PlanningDocument from "./PlanningDocument";
import "./planning.css";

type Draft = Pick<
  PlanningRelayPeriod,
  | "label"
  | "from"
  | "to"
  | "gite_ids"
  | "show_timeline"
  | "show_comments"
  | "show_phones"
  | "show_options"
  | "show_intervention_prices"
  | "arrivals_only"
  | "stay_nights"
  | "expires_at"
  | "is_active"
  | "sms_configs"
> & { organization_config: PlanningOrganization };
const id = () => crypto.randomUUID();
const day = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );
const addDays = (value: string, count: number) =>
  new Date(Date.parse(value + "T12:00:00Z") + count * 86400000)
    .toISOString()
    .slice(0, 10);
const date = (value: string) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const newMission = (
  kind: "cleaning" | "task",
  basket = false,
): PlanningMission => ({
  id: id(),
  kind,
  title:
    kind === "cleaning"
      ? "Ménage"
      : basket
        ? "Livraison de paniers"
        : "Nouvelle prestation",
  trigger: kind === "cleaning" ? "departure" : "arrival",
  minimum_nights: basket ? 5 : null,
  starts_offset_days: 0,
  due_offset_days: 0,
  start_time: "09:00",
  due_time: "17:00",
  assignment_mode: "fixed",
  assignees: {},
  rotation_user_ids: [],
  compensation_mode: "flat_rate",
  rates: {},
  default_minutes: null,
  note: "",
});
const newDraft = (
  kind: "cleaning" | "task" | "share",
  blocks: PlanningRelaySmsProgrammeTemplate[],
): Draft => ({
  label:
    kind === "cleaning"
      ? "Relais pendant mon absence"
      : kind === "task"
        ? "Livraison de paniers"
        : "Planning de l’équipe",
  from: day(),
  to: addDays(day(), 13),
  gite_ids: [],
  show_timeline: false,
  show_comments: false,
  show_phones: false,
  show_options: true,
  show_intervention_prices: true,
  arrivals_only: false,
  stay_nights: null,
  expires_at: null,
  is_active: true,
  organization_config: {
    version: 1,
    enabled: true,
    audience: "individual",
    missions: kind === "share" ? [] : [newMission(kind, kind === "task")],
  },
  sms_configs: [
    {
      id: id(),
      worker_id: "",
      worker_ids: [],
      channel: "sms",
      recipient_channels: {},
      enabled: false,
      send_time: "18:00",
      send_day: "previous_day",
      template:
        "Bonjour {{intervenant}},\n{{programme}}\nVotre planning : {{lien}}",
      programme_template: "{{gite}} : {{horaire}} - {{in-out}}",
      programme_templates: blocks,
      last_sent_for_date: null,
      last_attempt_for_date: null,
    },
  ],
});

export default function PlanningOrganizationsPanel({
  mode,
  onChanged,
}: {
  mode: "automations" | "documents";
  onChanged?: () => void;
}) {
  const [periods, setPeriods] = useState<PlanningRelayPeriod[]>([]);
  const [workers, setWorkers] = useState<PlanningRelayWorker[]>([]);
  const [gites, setGites] = useState<ActionResponse["gites"]>([]);
  const [channels, setChannels] = useState<PlanningRelayMessageChannelStatus[]>(
    [],
  );
  const [blocks, setBlocks] = useState<PlanningRelaySmsProgrammeTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<PlanningRelayPeriod | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<{
    count: number;
    assignments: number;
    conflicts: number;
    examples: string[];
  } | null>(null);
  const [document, setDocument] = useState<{
    period: PlanningRelayPeriod;
    interventions: PlanningIntervention[];
  } | null>(null);
  const [documentWorker, setDocumentWorker] = useState("");
  const [canManage, setCanManage] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ActionResponse>(
        `/action-tasks?from=${day()}&to=${addDays(day(), 45)}`,
      );
      setGites(data.gites);
      setCanManage(data.can_manage);
      if (!data.can_manage) return;
      const [saved, people, status, templates] = await Promise.all([
        apiFetch<PlanningRelayPeriod[]>("/planning-relay-periods"),
        apiFetch<PlanningRelayWorker[]>("/planning-relay-periods/workers"),
        apiFetch<{ channels: PlanningRelayMessageChannelStatus[] }>(
          "/planning-relay-periods/message-channels/status",
        ),
        apiFetch<{ programme_templates: PlanningRelaySmsProgrammeTemplate[] }>(
          "/planning-relay-periods/programme-templates",
        ),
      ]);
      setPeriods(saved);
      setWorkers(people);
      setChannels(status.channels);
      setBlocks(templates.programme_templates);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Impossible de charger les plannings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const update = (value: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...value } : current));
    setReview(null);
  };
  const missionUpdate = (
    missionId: string,
    value: Partial<PlanningMission>,
  ) => {
    if (draft)
      update({
        organization_config: {
          ...draft.organization_config,
          missions: draft.organization_config.missions.map((mission) =>
            mission.id === missionId ? { ...mission, ...value } : mission,
          ),
        },
      });
  };
  const sms = draft?.sms_configs[0];
  const smsUpdate = (value: Partial<PlanningRelaySmsConfig>) => {
    if (draft && sms) update({ sms_configs: [{ ...sms, ...value }] });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "L’opération a échoué.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openDocument = (period: PlanningRelayPeriod, worker = "") =>
    run(async () => {
      const result = await apiFetch<{
        period: PlanningRelayPeriod;
        interventions: PlanningIntervention[];
      }>(
        `/planning-relay-periods/${period.id}/interventions${worker ? `?worker=${encodeURIComponent(worker)}` : ""}`,
      );
      setDocument(result);
      setDocumentWorker(worker);
    });
  const save = async () => {
    if (!draft) return;
    await run(async () => {
      planningOrganizationSchema.parse(draft.organization_config);
      if (
        draft.sms_configs.some(
          (config) => config.enabled && !config.worker_ids.length,
        )
      )
        throw new Error(
          "Choisissez au moins un destinataire pour les rappels.",
        );
      const payload = {
        ...draft,
        expected_updated_at: editing?.updated_at,
        sms_configs: draft.sms_configs.filter(
          (config) => config.worker_ids.length,
        ),
      };
      if (!review) {
        const result = await apiFetch<NonNullable<typeof review>>(
          "/planning-relay-periods/organization-preview",
          { method: "POST", json: { ...draft, id: editing?.id } },
        );
        setReview(result);
        return;
      }
      let period = await apiFetch<PlanningRelayPeriod>(
        editing
          ? `/planning-relay-periods/${editing.id}`
          : "/planning-relay-periods",
        { method: editing ? "PATCH" : "POST", json: payload },
      );
      if (!editing && draft.sms_configs[0]?.worker_ids.length)
        period = await apiFetch<PlanningRelayPeriod>(
          `/planning-relay-periods/${period.id}`,
          { method: "PATCH", json: { sms_configs: draft.sms_configs } },
        );
      await apiFetch(`/planning-relay-periods/${period.id}/interventions`);
      setDraft(null);
      setEditing(null);
      setReview(null);
      await load();
      onChanged?.();
      setNotice(
        "Organisation enregistrée. Les interventions et les plannings sont à jour.",
      );
    });
  };
  const edit = (period: PlanningRelayPeriod) => {
    if (!period.organization_config) return;
    setEditing(period);
    setReview(null);
    setError(null);
    const fallback = newDraft("share", blocks);
    setDraft({
      ...fallback,
      ...period,
      organization_config: structuredClone(period.organization_config),
      sms_configs: period.sms_configs.length
        ? structuredClone(period.sms_configs)
        : fallback.sms_configs,
    });
  };
  const toggleGite = (giteId: string) => {
    if (!draft) return;
    const ids = draft.gite_ids.includes(giteId)
      ? draft.gite_ids.filter((value) => value !== giteId)
      : [...draft.gite_ids, giteId];
    update({
      gite_ids: ids,
      organization_config: {
        ...draft.organization_config,
        missions: draft.organization_config.missions.map((mission) => ({
          ...mission,
          assignees: Object.fromEntries(
            Object.entries(mission.assignees).filter(([key]) =>
              ids.includes(key),
            ),
          ),
          rates: Object.fromEntries(
            Object.entries(mission.rates).filter(([key]) => ids.includes(key)),
          ),
        })),
      },
    });
  };
  const organizations = periods.filter((period) => period.organization_config);
  return (
    <section className="planning-organizations" aria-busy={busy || loading}>
      <div className="po-heading">
        <div>
          <span className="po-eyebrow">
            {mode === "automations"
              ? "Organisation de l’équipe"
              : "Un même programme, tous les supports"}
          </span>
          <h2>
            {mode === "automations"
              ? "Organiser une période"
              : "Plannings & PDF"}
          </h2>
          <p>
            {mode === "automations"
              ? "Un remplacement, une livraison ou une prestation liée aux séjours."
              : "Retrouvez les interventions à jour, partagez un lien ou préparez une feuille A4."}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="tw-primary"
            onClick={() => {
              setChoosing(true);
              setError(null);
            }}
          >
            +{" "}
            {mode === "documents"
              ? "Préparer un planning"
              : "Organiser une période"}
          </button>
        )}
      </div>
      {!draft && error && (
        <p className="tw-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="po-notice" role="status">
          {notice}
        </p>
      )}
      {loading && <p className="po-empty">Chargement des plannings…</p>}
      {!loading && !canManage && (
        <p className="po-empty">
          Votre planning individuel reste accessible depuis le lien reçu.
          Retrouvez vos interventions dans l’onglet Interventions.
        </p>
      )}
      {!loading && canManage && !organizations.length && (
        <div className="po-empty">
          <h3>Préparez votre première période</h3>
          <p>
            Les personnes, les tarifs et les rappels sont définis une fois. Le
            planning suit ensuite les séjours.
          </p>
        </div>
      )}
      <div className="po-cards">
        {organizations.map((period) => (
          <article className="po-card" key={period.id}>
            <div className="po-card-top">
              <span className="po-chip">
                {period.organization_config?.enabled
                  ? period.to < day()
                    ? "Période terminée"
                    : "Active"
                  : "En pause"}
              </span>
              <span>
                {period.gite_ids.length} gîte
                {period.gite_ids.length > 1 ? "s" : ""}
              </span>
            </div>
            <h3>{period.label}</h3>
            <p>
              {date(period.from)} — {date(period.to)}
            </p>
            <p className="po-card-missions">
              {period.organization_config?.missions
                .map((mission) => mission.title)
                .join(" · ") || "Planning des interventions existantes"}
            </p>
            <div className="po-card-meta">
              <span>
                {period.organization_config?.audience === "individual"
                  ? "Planning par intervenant"
                  : "Programme commun"}
              </span>
              <span>
                {period.sms_configs.some((config) => config.enabled)
                  ? "Rappels activés"
                  : "Sans rappel"}
              </span>
            </div>
            {period.sms_configs.flatMap((config) =>
              Object.entries(config.delivery_state ?? {})
                .filter(
                  ([, state]) =>
                    state.status === "failed" || state.status === "uncertain",
                )
                .map(([workerId, state]) => (
                  <small className="tw-error" key={workerId}>
                    {workers.find((worker) => worker.id === workerId)?.nom} :{" "}
                    {state.error} ({state.attempts}/3 tentatives)
                  </small>
                )),
            )}
            <div className="po-card-actions">
              <button
                type="button"
                className="tw-primary"
                onClick={() => void openDocument(period)}
              >
                Voir / PDF
              </button>
              <button
                type="button"
                className="tw-secondary"
                onClick={() => edit(period)}
              >
                Modifier
              </button>
              <button
                type="button"
                className="tw-text-button"
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(
                      new URL(
                        period.public_path,
                        window.location.origin,
                      ).toString(),
                    );
                    setNotice("Lien du planning commun copié.");
                  })
                }
              >
                Copier le lien
              </button>
            </div>
          </article>
        ))}
      </div>
      {canManage && (
        <details className="po-legacy">
          <summary>
            Plannings relais existants et outils détaillés ·{" "}
            {periods.filter((period) => !period.organization_config).length}{" "}
            planning(s)
          </summary>
          <p>
            Vos liens, périodes et modèles de messages existants sont conservés.
          </p>
          <a className="tw-secondary" href="/menages/partages">
            Ouvrir les plannings relais existants
          </a>
        </details>
      )}
      {choosing && (
        <ReservationDetailsDrawer
          open
          title="Que souhaitez-vous organiser ?"
          eyebrow="Tâches & plannings"
          onClose={() => setChoosing(false)}
        >
          <div className="po-choices">
            {(
              [
                [
                  "cleaning",
                  "Confier les ménages pendant mon absence",
                  "Reprendre les ménages prévus, choisir la personne et ses forfaits.",
                ],
                [
                  "task",
                  "Prévoir une prestation à chaque séjour",
                  "Paniers à l’arrivée, préparation du linge ou autre intervention.",
                ],
                [
                  "share",
                  "Partager un planning existant",
                  "Sélectionner une période et les gîtes, sans changer les attributions.",
                ],
              ] as const
            ).map(([kind, title, detail]) => (
              <button
                type="button"
                key={kind}
                onClick={() => {
                  setDraft(newDraft(kind, blocks));
                  setEditing(null);
                  setReview(null);
                  setChoosing(false);
                }}
              >
                <strong>{title}</strong>
                <span>{detail}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </ReservationDetailsDrawer>
      )}
      {draft && (
        <ReservationDetailsDrawer
          open
          className="po-drawer"
          title={editing ? "Modifier l’organisation" : "Organiser une période"}
          eyebrow="Tâches & plannings"
          busy={busy}
          onClose={() => {
            if (!busy) {
              setDraft(null);
              setError(null);
            }
          }}
          footer={
            <>
              <button
                type="button"
                className="tw-secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Annuler
              </button>
              <button
                type="submit"
                form="planning-organization-form"
                className="tw-primary"
                disabled={busy}
              >
                {busy
                  ? "Vérification…"
                  : review
                    ? "Appliquer l’organisation"
                    : "Vérifier les interventions"}
              </button>
            </>
          }
        >
          <form
            id="planning-organization-form"
            className="po-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              {error && (
                <p className="tw-error" role="alert">
                  {error}
                </p>
              )}
              <section className="po-form-section">
                <span className="po-step">1</span>
                <h3>Période et gîtes</h3>
                <label>
                  Nom de l’organisation
                  <input
                    required
                    value={draft.label}
                    maxLength={120}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                </label>
                <div className="po-form-grid">
                  <label>
                    Du
                    <input
                      required
                      type="date"
                      value={draft.from}
                      max={draft.to}
                      onChange={(event) => update({ from: event.target.value })}
                    />
                  </label>
                  <label>
                    Au
                    <input
                      required
                      type="date"
                      value={draft.to}
                      min={draft.from}
                      max={addDays(draft.from, 365)}
                      onChange={(event) => update({ to: event.target.value })}
                    />
                  </label>
                </div>
                <div className="po-gites">
                  {gites.map((gite) => (
                    <label
                      key={gite.id}
                      className={
                        draft.gite_ids.includes(gite.id) ? "is-selected" : ""
                      }
                    >
                      <input
                        type="checkbox"
                        checked={draft.gite_ids.includes(gite.id)}
                        onChange={() => toggleGite(gite.id)}
                      />
                      {gite.nom}
                    </label>
                  ))}
                </div>
              </section>
              <section className="po-form-section">
                <span className="po-step">2</span>
                <h3>Interventions, personnes et tarifs</h3>
                {!draft.organization_config.missions.length && (
                  <p>
                    Ce planning reprend les interventions existantes sans
                    modifier leur attribution.
                  </p>
                )}
                {draft.organization_config.missions.map((mission) => (
                  <article className="po-mission" key={mission.id}>
                    <div className="po-heading">
                      <span className="po-chip">
                        {mission.kind === "cleaning"
                          ? "Ménages existants"
                          : "Prestation liée au séjour"}
                      </span>
                      <button
                        type="button"
                        className="tw-text-button"
                        onClick={() =>
                          update({
                            organization_config: {
                              ...draft.organization_config,
                              missions:
                                draft.organization_config.missions.filter(
                                  (item) => item.id !== mission.id,
                                ),
                            },
                          })
                        }
                      >
                        Retirer
                      </button>
                    </div>
                    <label>
                      Nom de la prestation
                      <input
                        required
                        value={mission.title}
                        maxLength={120}
                        onChange={(event) =>
                          missionUpdate(mission.id, {
                            title: event.target.value,
                          })
                        }
                      />
                    </label>
                    {mission.kind === "cleaning" ? (
                      <p className="po-help">
                        Les règles de ménage, les horaires et le contrôle final
                        sont conservés. Seules les interventions prévues pendant
                        la période sont réattribuées ; les corrections manuelles
                        sont prioritaires.
                      </p>
                    ) : (
                      <>
                        <div className="po-form-grid">
                          <label>
                            Une fois par séjour, à chaque
                            <select
                              value={mission.trigger}
                              onChange={(event) =>
                                missionUpdate(mission.id, {
                                  trigger: event.target.value as
                                    "arrival" | "departure",
                                })
                              }
                            >
                              <option value="arrival">Arrivée</option>
                              <option value="departure">Départ</option>
                            </select>
                          </label>
                          <label>
                            Durée minimale du séjour (nuits)
                            <input
                              type="number"
                              min={1}
                              max={365}
                              placeholder="Toutes les durées"
                              value={mission.minimum_nights ?? ""}
                              onChange={(event) =>
                                missionUpdate(mission.id, {
                                  minimum_nights: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="po-form-grid">
                          <label>
                            Début
                            <input
                              type="time"
                              required
                              value={mission.start_time}
                              onChange={(event) =>
                                missionUpdate(mission.id, {
                                  start_time: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            À terminer avant
                            <input
                              type="time"
                              required
                              value={mission.due_time}
                              onChange={(event) =>
                                missionUpdate(mission.id, {
                                  due_time: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        <details>
                          <summary>
                            Décaler par rapport à l’arrivée ou au départ
                          </summary>
                          <div className="po-form-grid">
                            <label>
                              Début · jours de décalage
                              <input
                                type="number"
                                min={-30}
                                max={30}
                                value={mission.starts_offset_days}
                                onChange={(event) =>
                                  missionUpdate(mission.id, {
                                    starts_offset_days: Number(
                                      event.target.value,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Fin · jours de décalage
                              <input
                                type="number"
                                min={-30}
                                max={30}
                                value={mission.due_offset_days}
                                onChange={(event) =>
                                  missionUpdate(mission.id, {
                                    due_offset_days: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <p className="po-help">
                            0 = le jour même, −1 = la veille, +1 = le lendemain.
                          </p>
                        </details>
                      </>
                    )}
                    <div className="po-form-grid">
                      <label>
                        Attribution
                        <select
                          value={mission.assignment_mode}
                          onChange={(event) =>
                            missionUpdate(mission.id, {
                              assignment_mode: event.target
                                .value as PlanningMission["assignment_mode"],
                            })
                          }
                        >
                          <option value="fixed">Une personne par gîte</option>
                          <option value="rotation">À tour de rôle</option>
                          <option value="unassigned">
                            À attribuer manuellement
                          </option>
                        </select>
                      </label>
                      <label>
                        Rémunération
                        <select
                          value={mission.compensation_mode}
                          onChange={(event) =>
                            missionUpdate(mission.id, {
                              compensation_mode: event.target
                                .value as PlanningMission["compensation_mode"],
                            })
                          }
                        >
                          <option value="flat_rate">
                            Forfait par intervention
                          </option>
                          <option value="none">Sans rémunération</option>
                          {mission.kind === "task" && (
                            <option value="time">Temps passé</option>
                          )}
                        </select>
                      </label>
                    </div>
                    {mission.compensation_mode === "time" && (
                      <label>
                        Durée prévue (minutes)
                        <input
                          required
                          type="number"
                          min={1}
                          max={1440}
                          value={mission.default_minutes ?? ""}
                          onChange={(event) =>
                            missionUpdate(mission.id, {
                              default_minutes: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                    {mission.assignment_mode === "rotation" && (
                      <div className="po-gites">
                        {workers
                          .filter(
                            (worker) => worker.user_id && worker.is_active,
                          )
                          .map((worker) => (
                            <label key={worker.id}>
                              <input
                                type="checkbox"
                                checked={mission.rotation_user_ids.includes(
                                  worker.user_id!,
                                )}
                                onChange={(event) =>
                                  missionUpdate(mission.id, {
                                    rotation_user_ids: event.target.checked
                                      ? [
                                          ...mission.rotation_user_ids,
                                          worker.user_id!,
                                        ]
                                      : mission.rotation_user_ids.filter(
                                          (value) => value !== worker.user_id,
                                        ),
                                  })
                                }
                              />
                              {worker.nom}
                              {mission.rotation_user_ids.includes(
                                worker.user_id!,
                              )
                                ? ` · ${mission.rotation_user_ids.indexOf(worker.user_id!) + 1}`
                                : ""}
                            </label>
                          ))}
                      </div>
                    )}
                    <div className="po-rates">
                      {draft.gite_ids.map((giteId, index) => (
                        <div className="po-rate" key={giteId}>
                          <strong>
                            {gites.find((gite) => gite.id === giteId)?.nom}
                          </strong>
                          {mission.assignment_mode === "fixed" && (
                            <label>
                              <span className="sr-only">
                                Intervenant pour{" "}
                                {gites.find((gite) => gite.id === giteId)?.nom}
                              </span>
                              <select
                                aria-label={`Intervenant pour ${gites.find((gite) => gite.id === giteId)?.nom}`}
                                required
                                value={mission.assignees[giteId] ?? ""}
                                onChange={(event) =>
                                  missionUpdate(mission.id, {
                                    assignees: {
                                      ...mission.assignees,
                                      [giteId]: event.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="">Choisir une personne…</option>
                                {workers
                                  .filter(
                                    (worker) =>
                                      worker.user_id && worker.is_active,
                                  )
                                  .map((worker) => (
                                    <option
                                      key={worker.id}
                                      value={worker.user_id!}
                                    >
                                      {worker.nom}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          )}
                          {mission.compensation_mode === "flat_rate" && (
                            <label className="po-euro">
                              <span className="sr-only">
                                Forfait pour{" "}
                                {gites.find((gite) => gite.id === giteId)?.nom}
                              </span>
                              <input
                                type="number"
                                aria-label={`Forfait pour ${gites.find((gite) => gite.id === giteId)?.nom}`}
                                required
                                min={0.01}
                                max={100000}
                                step="0.01"
                                value={mission.rates[giteId] ?? ""}
                                onChange={(event) =>
                                  missionUpdate(mission.id, {
                                    rates: {
                                      ...mission.rates,
                                      [giteId]: Number(event.target.value),
                                    },
                                  })
                                }
                              />
                              <span>€ / intervention</span>
                            </label>
                          )}
                          {index === 0 && draft.gite_ids.length > 1 && (
                            <button
                              type="button"
                              className="tw-text-button"
                              onClick={() =>
                                missionUpdate(mission.id, {
                                  assignees: Object.fromEntries(
                                    draft.gite_ids
                                      .map((value) => [
                                        value,
                                        mission.assignees[giteId],
                                      ])
                                      .filter(([, value]) => value),
                                  ),
                                  rates: Object.fromEntries(
                                    draft.gite_ids.map((value) => [
                                      value,
                                      mission.rates[giteId] ?? 0,
                                    ]),
                                  ),
                                })
                              }
                            >
                              Appliquer aux autres gîtes
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <label>
                      Consignes
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={mission.note}
                        onChange={(event) =>
                          missionUpdate(mission.id, {
                            note: event.target.value,
                          })
                        }
                      />
                    </label>
                  </article>
                ))}
                <div className="po-card-actions">
                  <button
                    type="button"
                    className="tw-secondary"
                    onClick={() =>
                      update({
                        organization_config: {
                          ...draft.organization_config,
                          missions: [
                            ...draft.organization_config.missions,
                            newMission("task"),
                          ],
                        },
                      })
                    }
                  >
                    + Ajouter une prestation
                  </button>
                  {!draft.organization_config.missions.some(
                    (mission) => mission.kind === "cleaning",
                  ) && (
                    <button
                      type="button"
                      className="tw-secondary"
                      onClick={() =>
                        update({
                          organization_config: {
                            ...draft.organization_config,
                            missions: [
                              ...draft.organization_config.missions,
                              newMission("cleaning"),
                            ],
                          },
                        })
                      }
                    >
                      + Confier les ménages
                    </button>
                  )}
                </div>
                <label className="po-check">
                  <input
                    type="checkbox"
                    checked={draft.organization_config.enabled}
                    onChange={(event) =>
                      update({
                        organization_config: {
                          ...draft.organization_config,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  Organisation active
                </label>
                <p className="po-help">
                  La mise en pause arrête les nouvelles prestations et rend les
                  attributions habituelles aux ménages encore à faire. Le
                  planning reste consultable.
                </p>
              </section>
              <section className="po-form-section">
                <span className="po-step">3</span>
                <h3>Destinataires et rappels</h3>
                <label>
                  Programme communiqué
                  <select
                    value={draft.organization_config.audience}
                    onChange={(event) =>
                      update({
                        organization_config: {
                          ...draft.organization_config,
                          audience: event.target.value as
                            "individual" | "shared",
                        },
                      })
                    }
                  >
                    <option value="individual">
                      Chaque personne voit ses interventions
                    </option>
                    <option value="shared">
                      Tous reçoivent le programme commun
                    </option>
                  </select>
                </label>
                {sms && (
                  <>
                    <label className="po-check">
                      <input
                        type="checkbox"
                        checked={sms.enabled}
                        onChange={(event) =>
                          smsUpdate({ enabled: event.target.checked })
                        }
                      />
                      Envoyer des rappels automatiques
                    </label>
                    <p className="po-help">
                      Choisissez les destinataires. Recevoir un rappel
                      n’attribue aucune tâche. En mode individuel, seules les
                      interventions de la personne sont envoyées.
                    </p>
                    <button
                      type="button"
                      className="tw-text-button"
                      onClick={() => {
                        const users = new Set(
                          draft.organization_config.missions.flatMap(
                            (mission) => [
                              ...Object.values(mission.assignees),
                              ...mission.rotation_user_ids,
                            ],
                          ),
                        );
                        const people = workers.filter(
                          (worker) =>
                            worker.user_id && users.has(worker.user_id),
                        );
                        smsUpdate({
                          worker_ids: people.map((worker) => worker.id),
                          worker_id: people[0]?.id ?? "",
                          recipient_channels: Object.fromEntries(
                            people.map((worker) => [
                              worker.id,
                              worker.message_channel_addresses?.telegram
                                ? "telegram"
                                : "sms",
                            ]),
                          ),
                        });
                      }}
                    >
                      Utiliser les intervenants des prestations
                    </button>
                    <div className="po-recipients">
                      {workers
                        .filter(
                          (worker) =>
                            worker.is_active ||
                            sms.worker_ids.includes(worker.id),
                        )
                        .map((worker) => {
                          const selected = sms.worker_ids.includes(worker.id);
                          const channel =
                            sms.recipient_channels[worker.id] ??
                            (worker.message_channel_addresses?.telegram
                              ? "telegram"
                              : "sms");
                          return (
                            <div key={worker.id}>
                              <label className="po-check">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(event) => {
                                    const ids = event.target.checked
                                      ? [...sms.worker_ids, worker.id]
                                      : sms.worker_ids.filter(
                                          (value) => value !== worker.id,
                                        );
                                    smsUpdate({
                                      worker_ids: ids,
                                      worker_id: ids[0] ?? "",
                                      recipient_channels: {
                                        ...sms.recipient_channels,
                                        [worker.id]: channel,
                                      },
                                    });
                                  }}
                                />
                                {worker.nom}
                              </label>
                              <select
                                aria-label={`Canal de ${worker.nom}`}
                                value={channel}
                                disabled={!selected}
                                onChange={(event) =>
                                  smsUpdate({
                                    recipient_channels: {
                                      ...sms.recipient_channels,
                                      [worker.id]: event.target.value as
                                        "sms" | "telegram",
                                    },
                                  })
                                }
                              >
                                {channels.map((item) => (
                                  <option
                                    value={item.id}
                                    key={item.id}
                                    disabled={!item.available}
                                  >
                                    {item.label}
                                    {item.available ? "" : " · non configuré"}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                    </div>
                    <div className="po-form-grid">
                      <label>
                        Rappel
                        <select
                          value={sms.send_day}
                          onChange={(event) =>
                            smsUpdate({
                              send_day: event.target.value as
                                "previous_day" | "same_day",
                            })
                          }
                        >
                          <option value="previous_day">
                            La veille pour le lendemain
                          </option>
                          <option value="same_day">Le jour même</option>
                        </select>
                      </label>
                      <label>
                        Heure d’envoi
                        <input
                          type="time"
                          required
                          value={sms.send_time}
                          onChange={(event) =>
                            smsUpdate({ send_time: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <details>
                      <summary>
                        Personnaliser le message et les blocs répétés
                      </summary>
                      <label>
                        Message
                        <textarea
                          rows={5}
                          required
                          maxLength={1000}
                          value={sms.template}
                          onChange={(event) =>
                            smsUpdate({ template: event.target.value })
                          }
                        />
                      </label>
                      <p className="po-help">
                        Variables :{" "}
                        {
                          "{{intervenant}}, {{date}}, {{date_texte}}, {{programme}}, {{periode}}, {{lien}}"
                        }
                        . Le programme contient uniquement les interventions du
                        jour visé.
                      </p>
                      {sms.programme_templates.map((block) => (
                        <div className="po-block" key={block.id}>
                          <label>
                            Variable
                            <input
                              value={block.key}
                              onChange={(event) =>
                                smsUpdate({
                                  programme_templates:
                                    sms.programme_templates.map((item) =>
                                      item.id === block.id
                                        ? { ...item, key: event.target.value }
                                        : item,
                                    ),
                                })
                              }
                            />
                          </label>
                          <label>
                            Phrase répétée
                            <textarea
                              rows={2}
                              value={block.template}
                              onChange={(event) =>
                                smsUpdate({
                                  programme_templates:
                                    sms.programme_templates.map((item) =>
                                      item.id === block.id
                                        ? {
                                            ...item,
                                            template: event.target.value,
                                          }
                                        : item,
                                    ),
                                })
                              }
                            />
                          </label>
                          <p className="po-help">
                            {
                              "{{gite}}, {{horaire}}, {{in-out}}, {{prestation}}, {{options}}, {{consignes}}"
                            }
                          </p>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="tw-text-button"
                        disabled={sms.programme_templates.length >= 10}
                        onClick={() =>
                          smsUpdate({
                            programme_templates: [
                              ...sms.programme_templates,
                              {
                                id: id(),
                                key: `programme_${sms.programme_templates.length + 1}`,
                                template:
                                  "{{gite}} · {{prestation}} : {{horaire}}",
                              },
                            ],
                          })
                        }
                      >
                        + Ajouter un bloc
                      </button>
                    </details>
                  </>
                )}
              </section>
              <section className="po-form-section">
                <span className="po-step">4</span>
                <h3>Planning partagé et PDF</h3>
                <p className="po-help">
                  Les mêmes informations sont utilisées pour le lien et le
                  document.
                </p>
                <div className="po-option-grid">
                  {(
                    [
                      ["show_timeline", "Tableau graphique"],
                      ["show_options", "Options du séjour"],
                      [
                        "show_intervention_prices",
                        "Tarifs et total prévisionnel",
                      ],
                      ["show_comments", "Commentaires"],
                      ["show_phones", "Téléphones"],
                      ["arrivals_only", "Entrées uniquement"],
                      ["is_active", "Lien consultable"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="po-check" key={key}>
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        onChange={(event) =>
                          update({ [key]: event.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label>
                  Durée minimale des séjours affichés (nuits)
                  <input
                    type="number"
                    min={1}
                    max={365}
                    placeholder="Toutes les durées"
                    value={draft.stay_nights ?? ""}
                    onChange={(event) =>
                      update({
                        stay_nights: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  Expiration du lien (facultative)
                  <input
                    type="date"
                    value={draft.expires_at?.slice(0, 10) ?? ""}
                    onChange={(event) =>
                      update({ expires_at: event.target.value || null })
                    }
                  />
                </label>
                <p className="po-help">
                  La fin de la période n’expire pas le lien. Les interventions
                  passées restent consultables.
                </p>
              </section>
              {review && (
                <section className="po-review" role="status">
                  <h3>Prêt à appliquer</h3>
                  <p>
                    <strong>{review.count} intervention(s)</strong> concernée(s)
                    · {review.assignments} attribution(s) à reprendre.
                  </p>
                  {review.conflicts > 0 && (
                    <p>
                      {review.conflicts} correction(s) manuelle(s) seront
                      conservées.
                    </p>
                  )}
                  <ul>
                    {review.examples.map((example, index) => (
                      <li key={index}>{example}</li>
                    ))}
                  </ul>
                  <p>
                    Aucun message n’est envoyé à l’enregistrement. Les rappels
                    partiront à l’heure choisie.
                  </p>
                </section>
              )}
            </fieldset>
          </form>
        </ReservationDetailsDrawer>
      )}
      {document && (
        <ReservationDetailsDrawer
          open
          className="po-document-drawer"
          title="Planning et PDF"
          eyebrow={document.period.label}
          busy={busy}
          onClose={() => setDocument(null)}
          footer={
            <>
              <button
                type="button"
                className="tw-secondary"
                onClick={() => setDocument(null)}
              >
                Fermer
              </button>
              <a
                className="tw-primary"
                href={buildApiUrl(
                  `/planning-relay-periods/${document.period.id}/pdf${documentWorker ? `?worker=${encodeURIComponent(documentWorker)}` : ""}`,
                )}
              >
                Télécharger le PDF A4
              </a>
            </>
          }
        >
          <div className="po-document-controls no-print">
            <label>
              Document pour
              <select
                value={documentWorker}
                onChange={(event) =>
                  void openDocument(document.period, event.target.value)
                }
              >
                <option value="">Toute l’équipe</option>
                {workers.map((worker) => (
                  <option value={worker.id} key={worker.id}>
                    {worker.nom}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="tw-secondary"
              onClick={() =>
                void run(async () => {
                  const query = documentWorker
                    ? `?worker=${encodeURIComponent(documentWorker)}`
                    : "";
                  const result = await apiFetch<{ public_path: string }>(
                    `/planning-relay-periods/${document.period.id}/audience-link${query}`,
                  );
                  await navigator.clipboard.writeText(
                    new URL(
                      result.public_path,
                      window.location.origin,
                    ).toString(),
                  );
                  setNotice("Lien du planning copié.");
                })
              }
            >
              Copier ce lien
            </button>
          </div>
          {error && (
            <p className="tw-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p
              className="po-notice"
              role="status"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {notice}
            </p>
          )}
          <PlanningDocument
            label={document.period.label}
            from={document.period.from}
            to={document.period.to}
            rows={document.interventions}
            prices={document.period.show_intervention_prices}
            timeline={document.period.show_timeline}
          />
          <details className="po-legacy">
            <summary>Messages et gestion du partage</summary>
            <p>
              Vérifiez l’aperçu avant d’envoyer un test aux destinataires
              enregistrés.
            </p>
            <div className="po-card-actions">
              <button
                className="tw-secondary"
                type="button"
                onClick={() =>
                  void run(async () => {
                    const config = document.period.sms_configs[0];
                    if (!config)
                      throw new Error(
                        "Configurez les destinataires dans l’organisation.",
                      );
                    const result = await apiFetch<{ message: string | null }>(
                      `/planning-relay-periods/${document.period.id}/preview-sms`,
                      {
                        method: "POST",
                        json: {
                          config: {
                            ...config,
                            worker_ids: documentWorker
                              ? [documentWorker]
                              : config.worker_ids,
                            worker_id: documentWorker || config.worker_ids[0],
                          },
                        },
                      },
                    );
                    setNotice(
                      result.message ?? "Aucune intervention à envoyer.",
                    );
                  })
                }
              >
                Aperçu du message
              </button>
              <button
                className="tw-secondary"
                type="button"
                onClick={() =>
                  void run(async () => {
                    const config = document.period.sms_configs[0];
                    if (!config?.worker_ids.length)
                      throw new Error(
                        "Choisissez des destinataires dans l’organisation.",
                      );
                    await apiFetch(
                      `/planning-relay-periods/${document.period.id}/send-test-sms`,
                      { method: "POST", json: { config } },
                    );
                    setNotice(
                      "Messages de test envoyés aux destinataires sélectionnés.",
                    );
                  })
                }
              >
                Envoyer un test aux destinataires
              </button>
              <button
                type="button"
                className="tw-text-button"
                onClick={() =>
                  void run(async () => {
                    await apiFetch(
                      `/planning-relay-periods/${document.period.id}/rotate-link`,
                      { method: "POST" },
                    );
                    await load();
                    setDocument(null);
                    setNotice(
                      "Liens renouvelés. Les anciens liens ne fonctionnent plus.",
                    );
                  })
                }
              >
                Renouveler les liens
              </button>
              <button
                type="button"
                className="tw-text-button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Supprimer cette organisation et ses prestations automatiques non commencées ? Les interventions corrigées ou terminées restent conservées.",
                    )
                  )
                    return;
                  void run(async () => {
                    await apiFetch(
                      `/planning-relay-periods/${document.period.id}`,
                      { method: "DELETE" },
                    );
                    setDocument(null);
                    await load();
                    onChanged?.();
                    setNotice(
                      "Organisation supprimée. Les interventions terminées restent conservées.",
                    );
                  });
                }}
              >
                Supprimer l’organisation
              </button>
            </div>
            {notice && (
              <p
                className="po-notice"
                style={{ whiteSpace: "pre-wrap" }}
                role="status"
              >
                {notice}
              </p>
            )}
          </details>
        </ReservationDetailsDrawer>
      )}
    </section>
  );
}
