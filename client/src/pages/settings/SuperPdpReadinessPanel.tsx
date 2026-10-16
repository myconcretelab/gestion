import { useEffect, useRef, useState } from "react";
import { apiFetch, isAbortError } from "../../utils/api";
import "./superPdpReadiness.css";

type Check = {
  id: string;
  title: string;
  state: "observed" | "action_required" | "not_verified";
  detail: string;
};
type Readiness = {
  version: number;
  fiscal_entity_id: string;
  environment: "sandbox";
  read_only: true;
  observed_at: string;
  production: { enabled: false; status: "blocked"; reason: string };
  summary: { state: string; local_actions: number; manual_checks: number };
  capabilities: {
    sandbox_enabled: boolean;
    emission_enabled: boolean;
    reception_enabled: boolean;
    b2c_enabled: boolean;
  };
  counts: {
    transmissions: {
      total: number;
      submitted: number;
      ready: number;
      uncertain: number;
      failed: number;
      paused: number;
      in_progress: number;
      unknown_state: number;
      binding_to_review: number;
      historical_remote_errors: number;
    };
    payments: {
      total: number;
      recorded: number;
      submitted: number;
      uncertain: number;
      paused: number;
      in_progress: number;
      blocked_before_send: number;
      unknown_state: number;
    };
    incoming: {
      total: number;
      incomplete: number;
      unmatched: number;
      configurations_to_review: number;
      synchronizations_to_review: number;
    };
  };
  checks: Check[];
  manual_checks: Check[];
};
const labels: Record<Check["state"], string> = {
  observed: "Observation locale",
  action_required: "À examiner",
  not_verified: "À vérifier séparément",
};
const CheckList = ({ checks }: { checks: Check[] }) => (
  <ul className="superpdp-readiness-checks">
    {checks.map((check) => (
      <li key={check.id} data-state={check.state}>
        <p>
          <span className="superpdp-readiness-state">
            {labels[check.state]}
          </span>{" "}
          <strong>{check.title}</strong>
        </p>
        <p>{check.detail}</p>
      </li>
    ))}
  </ul>
);

export default function SuperPdpReadinessPanel({
  entityId,
}: {
  entityId: string;
}) {
  const [report, setReport] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await apiFetch<Readiness>(
        `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp/readiness`,
        { signal: controller.signal },
      );
      if (
        result.fiscal_entity_id !== entityId ||
        result.environment !== "sandbox" ||
        result.read_only !== true ||
        result.production.enabled !== false ||
        result.production.status !== "blocked"
      )
        throw new Error(
          "Bilan local incohérent : actualisez la fiche entreprise.",
        );
      if (!controller.signal.aborted) setReport(result);
    } catch (err) {
      if (!isAbortError(err) && !controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Bilan indisponible.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      aria-label="Préparation de la recette SuperPDP"
      className="superpdp-readiness"
    >
      <h3 className="section-subtitle">
        Dernière étape — préparation de la recette
      </h3>
      <p>
        Ce bilan examine uniquement les données locales de cette entreprise. Il
        ne contacte pas SuperPDP, ne renouvelle pas les accès et n’envoie rien.
        La production reste non activable dans cette version.
      </p>
      <button
        className="secondary"
        type="button"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy
          ? "Lecture du bilan…"
          : report
            ? "Actualiser le bilan local"
            : "Établir le bilan local de préparation"}
      </button>
      {error && (
        <p role="alert" className="note">
          {error}
        </p>
      )}
      {report && (
        <>
          <p role="status" className="note">
            <strong>
              Production bloquée — aucune activation ni déploiement.
            </strong>{" "}
            {report.production.reason}
          </p>
          <p>
            Bilan du {new Date(report.observed_at).toLocaleString("fr-FR")} :{" "}
            {report.summary.local_actions} point(s) local(aux) à examiner et{" "}
            {report.summary.manual_checks} validations séparées à réaliser. Même
            sans anomalie locale, la recette réelle reste nécessaire.
          </p>
          <p className="field-hint">
            Interrupteurs de test : connexion{" "}
            {report.capabilities.sandbox_enabled ? "activée" : "désactivée"} ·
            émission{" "}
            {report.capabilities.emission_enabled ? "activée" : "désactivée"} ·
            réception{" "}
            {report.capabilities.reception_enabled ? "activée" : "désactivée"} ·
            B2C {report.capabilities.b2c_enabled ? "activé" : "désactivé"}. Leur
            présence ne prouve pas que les traitements fonctionnent.
          </p>
          <div className="superpdp-readiness-counters">
            <div>
              <h4>Émissions de test</h4>
              <p>
                {report.counts.transmissions.total} transmission(s),{" "}
                {report.counts.transmissions.submitted} dépôt(s) confirmé(s).
              </p>
              <p>
                {report.counts.transmissions.uncertain} résultat(s) inconnu(s) ·{" "}
                {report.counts.transmissions.failed} préparation(s) en échec ·{" "}
                {report.counts.transmissions.paused} suspension(s).
              </p>
              <p>
                {report.counts.transmissions.historical_remote_errors}{" "}
                rejet(s)/erreur(s) historiques à examiner.
              </p>
            </div>
            <div>
              <h4>Encaissements de test</h4>
              <p>
                {report.counts.payments.total} mouvement(s),{" "}
                {report.counts.payments.submitted} création(s) de message 212
                confirmée(s).
              </p>
              <p>
                {report.counts.payments.uncertain} résultat(s) inconnu(s) ·{" "}
                {report.counts.payments.paused} suspension(s) ·{" "}
                {report.counts.payments.blocked_before_send} blocage(s) avant
                envoi.
              </p>
              <p>Aucun reçu ne vaut validation par l’administration.</p>
            </div>
            <div>
              <h4>Achats de test</h4>
              <p>
                {report.counts.incoming.total} document(s) archivé(s),{" "}
                {report.counts.incoming.incomplete} extraction(s) en attente.
              </p>
              <p>
                {report.counts.incoming.unmatched} document(s) sans
                rapprochement local.
              </p>
              <p>
                {report.counts.incoming.configurations_to_review +
                  report.counts.incoming.synchronizations_to_review}{" "}
                observation(s) de configuration/synchronisation à examiner.
              </p>
            </div>
          </div>
          <h4>Contrôles locaux</h4>
          <CheckList checks={report.checks} />
          <h4>Validations humaines — non attestées par le bilan</h4>
          <CheckList checks={report.manual_checks} />
          <p className="field-hint">
            Il n’existe pas de bouton d’autorisation de production ici. Un
            consentement sandbox ou une case cochée ne peut pas activer les flux
            réels. Actualisez le bilan après une intervention ; il n’est pas
            surveillé automatiquement.
          </p>
        </>
      )}
    </section>
  );
}
