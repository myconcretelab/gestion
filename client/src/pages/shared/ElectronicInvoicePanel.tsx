import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, isAbortError } from "../../utils/api";
import "./electronicInvoice.css";

type Validation = {
  data: Array<{
    is_valid: boolean;
    error?: string;
    subreports: Array<{
      validator: string;
      failures: Array<{ message: string; location?: string }>;
    }>;
  }>;
};
type ElectronicView = {
  available: boolean;
  reason: string | null;
  environment: "sandbox";
  revision: number;
  transmission: null | {
    id: string;
    status: string;
    remote_invoice_id: string | null;
    external_id: string;
    artifact_sha256: string | null;
    validation: Validation | null;
    last_error_code: string | null;
    last_synced_at: string | null;
    post_started_at: string | null;
    seller_address: string;
    buyer_address: string;
    can_prepare: boolean;
    can_send: boolean;
  };
  events: Array<{
    id: string;
    status_code: string;
    occurred_at: string;
    details: {
      status_text?: string;
      data?: { reason?: string };
      error_code?: string;
      details?: Array<{
        reason?: string;
        notes?: Array<{
          subject?: string;
          contents?: Array<{ content: string }>;
        }>;
      }>;
    };
  }>;
  history_truncated: boolean;
};
const labels: Record<string, string> = {
  queued_prepare: "Préparation en attente",
  preparing: "Conversion et validation en cours",
  ready: "Factur-X validé — non déposé",
  validation_failed: "Validation refusée — aucun dépôt",
  prepare_failed: "Préparation non confirmée — aucun dépôt",
  queued_send: "Dépôt demandé — en attente",
  sending: "Dépôt en cours — ne pas renvoyer",
  submitted: "Dépôt confirmé — suivre les événements ci-dessous",
  send_unknown: "Résultat du dépôt inconnu — renvoi bloqué",
  paused_after_restore: "Transmission suspendue après restauration de la base",
};

export default function ElectronicInvoicePanel({
  invoiceId,
}: {
  invoiceId: string;
}) {
  const endpoint = `/invoices/${encodeURIComponent(invoiceId)}/electronic`;
  const [data, setData] = useState<ElectronicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seller, setSeller] = useState("");
  const [buyer, setBuyer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const apply = (value: ElectronicView) => {
    setData(value);
    if (value.transmission) {
      setSeller(value.transmission.seller_address);
      setBuyer(value.transmission.buyer_address);
    }
  };
  const reload = async () => apply(await apiFetch<ElectronicView>(endpoint));
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ElectronicView>(endpoint, { signal: controller.signal })
      .then(apply)
      .catch((err) => {
        if (!isAbortError(err)) setError(err.message);
      });
    return () => controller.abort();
  }, [endpoint]);
  const status = data?.transmission?.status;
  useEffect(() => {
    if (
      !status ||
      !["queued_prepare", "preparing", "queued_send", "sending"].includes(
        status,
      )
    )
      return;
    const controller = new AbortController();
    let count = 0;
    const timer = window.setInterval(() => {
      if (++count > 20) {
        window.clearInterval(timer);
        return;
      }
      apiFetch<ElectronicView>(endpoint, { signal: controller.signal })
        .then(apply)
        .catch((err) => {
          if (!isAbortError(err)) setError(err.message);
        });
    }, 3000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [endpoint, status]);
  const action = async (kind: "prepare" | "send" | "sync") => {
    if (!data) return;
    if (
      kind === "send" &&
      !window.confirm(
        "Déposer ce Factur-X B2B dans SuperPDP de TEST ? Le dépôt est distinct de l’envoi par email. En cas de résultat inconnu, tout renvoi sera bloqué.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      apply(
        await apiFetch<ElectronicView>(`${endpoint}/${kind}`, {
          method: "POST",
          json:
            kind === "sync"
              ? {}
              : {
                  revision: data.revision,
                  confirm_test_data: confirmed,
                  ...(kind === "prepare"
                    ? { seller_address: seller, buyer_address: buyer }
                    : {}),
                },
        }),
      );
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opération non confirmée.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const prepare = (event: FormEvent) => {
    event.preventDefault();
    void action("prepare");
  };
  const row = data?.transmission;
  return (
    <section
      aria-label="Émission électronique de test"
      className="form-section electronic-invoice-panel"
      style={{ marginTop: 24 }}
    >
      <h3>SuperPDP — émission B2B de test</h3>
      <p>
        Le PDF original et la facture émise sont conservés. La préparation
        produit une archive Factur-X distincte et un rapport de validation ;
        elle ne dépose rien.
      </p>
      <p className="note">
        Utiliser uniquement une installation de test et des données fictives
        cohérentes avec les entreprises SuperPDP. Aucun SIREN, nom ou montant
        n’est remplacé automatiquement. Le B2C, le B2B international et les
        déclarations d’encaissement ne sont pas activés dans ce lot.
      </p>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>Chargement…</p>}
      {data && (
        <>
          {!data.available && <p className="note">{data.reason}</p>}
          <p role="status">
            {row
              ? (labels[row.status] ?? "État à vérifier")
              : "Aucune préparation électronique"}
          </p>
          <form onSubmit={prepare}>
            <fieldset
              disabled={busy || !data.available || (!!row && !row.can_prepare)}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend>Adresses électroniques de test</legend>
              <div className="grid-2">
                <label className="field">
                  Adresse de réponse du vendeur
                  <input
                    required
                    value={seller}
                    maxLength={185}
                    placeholder="schéma:identifiant"
                    onChange={(e) => setSeller(e.target.value)}
                  />
                </label>
                <label className="field">
                  Adresse de destination de l’acheteur
                  <input
                    required
                    value={buyer}
                    maxLength={185}
                    placeholder="schéma:identifiant"
                    onChange={(e) => setBuyer(e.target.value)}
                  />
                </label>
              </div>
              <p className="field-hint">
                Copier les adresses complètes depuis les annuaires SuperPDP de
                test (schéma numérique sur quatre chiffres, puis deux-points et
                identifiant). L’adresse du vendeur est contrôlée dans son
                annuaire ; le destinataire est contrôlé lors du dépôt. Aucun
                annuaire ni mandat n’est créé.
              </p>
              <button type="submit" disabled={!confirmed}>
                {row
                  ? "Repréparer et valider"
                  : "Préparer et valider le Factur-X"}
              </button>
            </fieldset>
          </form>
          <label className="field" style={{ marginTop: 12 }}>
            <span>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !data.available}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              Je confirme que ce document et ses destinataires utilisent
              uniquement des données fictives de test.
            </span>
          </label>
          {row?.artifact_sha256 && (
            <p>
              <a
                href={`/api/invoices/${encodeURIComponent(invoiceId)}/electronic/factur-x`}
                target="_blank"
                rel="noreferrer"
              >
                Télécharger l’archive Factur-X préparée
              </a>{" "}
              — vérifier son rapport avant dépôt.
            </p>
          )}
          {row?.validation?.data.map((report, index) => (
            <div key={index}>
              <p>
                Validation : {report.is_valid ? "rapport positif" : "refusée"}.
                Un rapport positif ne garantit pas l’acheminement final.
              </p>
              {report.error && <p className="note">{report.error}</p>}
              {report.subreports.map((part, partIndex) =>
                part.failures.length ? (
                  <div key={partIndex}>
                    <p>{part.validator}</p>
                    <ul>
                      {part.failures.map((issue, issueIndex) => (
                        <li key={issueIndex}>
                          {issue.message}
                          {issue.location ? ` — ${issue.location}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          ))}
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              disabled={busy || !data.available || !row?.can_send || !confirmed}
              onClick={() => void action("send")}
            >
              Déposer dans SuperPDP de test
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                void reload().catch((err) => setError(err.message));
              }}
            >
              Actualiser l’état local
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !data.available || !row?.post_started_at}
              onClick={() => void action("sync")}
            >
              Synchroniser les événements SuperPDP
            </button>
          </div>
          {row?.status === "send_unknown" && (
            <p className="note">
              Le dépôt a peut-être été accepté. Le système recherche sa
              référence distante sans renvoyer le fichier. Même si la recherche
              ne trouve rien, un nouveau dépôt n’est pas autorisé : une
              vérification dans SuperPDP est nécessaire.
            </p>
          )}
          {row?.remote_invoice_id && (
            <p>
              Identifiant SuperPDP : {row.remote_invoice_id}. Référence locale
              de dépôt : {row.external_id}.
            </p>
          )}
          {row?.last_error_code && (
            <p className="note">
              Dernière opération non confirmée : {row.last_error_code}
            </p>
          )}
          {row?.last_synced_at && (
            <p>
              Dernière synchronisation :{" "}
              {new Date(row.last_synced_at).toLocaleString("fr-FR")}
            </p>
          )}
          {data.events.length > 0 && (
            <>
              <h4>Historique des événements</h4>
              <p>
                Ces événements peuvent coexister ; ils ne remplacent ni le
                statut de paiement local ni le suivi par email.
              </p>
              <ul>
                {data.events.map((event) => (
                  <li key={event.id}>
                    {new Date(event.occurred_at).toLocaleString("fr-FR")} ·{" "}
                    {event.status_code}
                    {event.details.status_text
                      ? ` — ${event.details.status_text}`
                      : ""}
                    {event.details.error_code
                      ? ` — ${event.details.error_code}`
                      : ""}
                    {event.details.data?.reason
                      ? ` — ${event.details.data.reason}`
                      : ""}
                    {event.details.details?.map((detail, index) =>
                      detail.reason ? (
                        <span key={index}> · Motif : {detail.reason}</span>
                      ) : null,
                    )}
                    {event.details.details
                      ?.flatMap((detail) => detail.notes ?? [])
                      .map((note, index) => (
                        <span key={`note-${index}`}>
                          {" "}
                          · {note.subject ? `${note.subject} : ` : ""}
                          {note.contents
                            ?.map((entry) => entry.content)
                            .join(" · ")}
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
              {data.history_truncated && (
                <p>
                  Les 200 derniers événements sont affichés ; l’historique
                  complet est conservé sur le serveur.
                </p>
              )}
            </>
          )}
        </>
      )}
      {row?.status === "paused_after_restore" && (
        <p className="note">
          Cette préparation provient d’une base copiée ou restaurée. Un dépôt a
          pu avoir lieu après la sauvegarde : la repréparation et le dépôt
          restent bloqués. Vérifier la situation dans SuperPDP avant toute
          intervention d’administration.
        </p>
      )}
    </section>
  );
}
