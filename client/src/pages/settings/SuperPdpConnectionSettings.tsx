import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isAbortError } from "../../utils/api";
import SuperPdpReadinessPanel from "./SuperPdpReadinessPanel";

type Connection = {
  fiscal_entity_id: string | null;
  environment: "sandbox";
  available: boolean;
  reason: string | null;
  configured: boolean;
  status: string;
  revision: number;
  client_id: string | null;
  sandbox_number: string | null;
  remote_company: { id: string; number: string; name: string } | null;
  verification_status: string | null;
  access_expires_at: string | null;
  last_checked_at: string | null;
  last_error_code: string | null;
  busy: boolean;
};
const statusLabels: Record<string, string> = {
  not_configured: "Non configuré",
  configured: "Application de test configurée",
  authorizing: "Consentement à terminer",
  connected: "Entreprise de test vérifiée",
  verification_pending: "Vérification SuperPDP en attente",
  reauthorization_required: "Nouvelle autorisation nécessaire",
  revocation_pending: "Révocation à confirmer — connexion bloquée",
  identity_rejected: "Identité ou environnement refusé",
  disconnected: "Déconnecté",
  operation_interrupted: "Opération interrompue — connexion bloquée",
};

export default function SuperPdpConnectionSettings({
  entityId,
  hasLocalSiren,
  onDirtyChange,
  onBusyChange,
}: {
  entityId: string;
  hasLocalSiren: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [sandboxNumber, setSandboxNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const endpoint = `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp`;
  const apply = (value: Connection) => {
    setConnection(value);
    setClientId(value.client_id ?? "");
    setSandboxNumber(value.sandbox_number ?? "");
  };
  useEffect(() => {
    onDirtyChange?.(
      !!clientSecret ||
        (!!connection &&
          (clientId !== (connection.client_id ?? "") ||
            sandboxNumber !== (connection.sandbox_number ?? ""))),
    );
  }, [clientSecret, clientId, sandboxNumber, connection, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy || !!connection?.busy);
  }, [busy, connection?.busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Connection>(endpoint, { signal: controller.signal })
      .then((value) => {
        apply(value);
        setConfigurationOpen(!value.configured);
      })
      .catch((err) => {
        if (!isAbortError(err))
          setError(
            err instanceof Error ? err.message : "État SuperPDP indisponible.",
          );
      });
    return () => controller.abort();
  }, [endpoint]);
  const reload = async () => apply(await apiFetch<Connection>(endpoint));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      apply(
        await apiFetch<Connection>(`${endpoint}/config`, {
          method: "PUT",
          json: {
            revision: connection.revision,
            client_id: clientId,
            sandbox_number: sandboxNumber,
            ...(clientSecret ? { client_secret: clientSecret } : {}),
          },
        }),
      );
      setNotice(
        "Configuration de test enregistrée. Le secret n’est jamais renvoyé par le serveur.",
      );
      setConfigurationOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Enregistrement impossible.",
      );
    } finally {
      setClientSecret("");
      setBusy(false);
    }
  };
  const action = async (kind: "connect" | "check" | "disconnect") => {
    if (
      kind === "disconnect" &&
      !window.confirm(
        "Révoquer le consentement SuperPDP de test et retirer les secrets enregistrés pour cette entreprise ? Aucune facture ne sera modifiée.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === "connect") {
        const result = await apiFetch<{ authorization_url: string }>(
          `${endpoint}/connect`,
          { method: "POST", json: {} },
        );
        const url = new URL(result.authorization_url);
        if (
          url.origin !== "https://api.superpdp.tech" ||
          url.pathname !== "/oauth2/authorize"
        )
          throw new Error("Adresse de connexion refusée.");
        setClientSecret("");
        window.location.assign(url.href);
        return;
      }
      const result = await apiFetch<Connection>(
        kind === "check" ? `${endpoint}/check` : endpoint,
        {
          method: kind === "check" ? "POST" : "DELETE",
          ...(kind === "check" ? { json: {} } : {}),
        },
      );
      apply(result);
      setNotice(
        kind === "disconnect" && result.status === "disconnected"
          ? "Consentement révoqué et secrets retirés."
          : (statusLabels[result.status] ?? "État actualisé."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opération impossible.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Connexion SuperPDP de test"
      className="fiscal-superpdp"
    >
      {!hasLocalSiren && (
        <p className="fiscal-callout">
          <strong>Connexion de test possible, émission encore bloquée.</strong>{" "}
          L’identité fiscale est à compléter. Pour ajouter un SIREN à une
          entreprise déjà configurée, déconnectez-la puis reconfigurez sa
          connexion.
        </p>
      )}
      {error && (
        <p role="alert" className="note">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="fiscal-feedback">
          {notice}
        </p>
      )}
      {!connection && !error && <p>Chargement de la connexion…</p>}
      {connection && (
        <>
          <div
            className="fiscal-connection-status"
            data-connected={connection.status === "connected"}
          >
            <p>
              <strong>
                {statusLabels[connection.status] ?? "État à vérifier"}
              </strong>
              {connection.busy ? " — opération en cours" : ""}
            </p>
            {!connection.available && (
              <p className="note">
                {connection.reason} Aucun identifiant ne peut être enregistré
                tant que le serveur n’est pas configuré.
              </p>
            )}
            {connection.remote_company && (
              <p>
                Entreprise SuperPDP de test : {connection.remote_company.name} ·
                Identifiant {connection.remote_company.number}
              </p>
            )}
            {connection.verification_status === "failed" && (
              <p className="note">
                La vérification de l’entreprise a été refusée par SuperPDP.
                Corrigez la situation dans votre compte SuperPDP avant de
                vérifier de nouveau.
              </p>
            )}
            {connection.status === "operation_interrupted" && (
              <p className="note">
                Le résultat précédent est incertain. Lancez une déconnexion ;
                une première tentative peut sécuriser le verrou avant de
                permettre la révocation.
              </p>
            )}
            {connection.last_error_code && (
              <p className="field-hint">
                Dernière opération non confirmée : {connection.last_error_code}
              </p>
            )}
            {connection.last_checked_at && (
              <p className="field-hint">
                Dernière vérification :{" "}
                {new Date(connection.last_checked_at).toLocaleString("fr-FR")}
              </p>
            )}
          </div>
          <details
            className="fiscal-connection-step"
            open={configurationOpen}
            onToggle={(event) => setConfigurationOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="fiscal-step-label">
                A · Accès de l’application
              </span>
              <span className="fiscal-step-description">
                {connection.configured
                  ? "Enregistrés — cliquer pour les modifier"
                  : "À renseigner avant l’autorisation"}
              </span>
            </summary>
            <form onSubmit={(event) => void save(event)} autoComplete="off">
              <fieldset
                disabled={busy || connection.busy || !connection.available}
                className="fiscal-form-fieldset"
              >
                <legend className="sr-only">Application OAuth SuperPDP</legend>
                <p className="fiscal-hint">
                  Copiez les accès de l’application depuis votre compte
                  SuperPDP. Le secret reste chiffré sur le serveur, jamais dans
                  le stockage du navigateur.
                </p>
                <div className="fiscal-form-grid">
                  <label className="field">
                    Identifiant d’application (client_id)
                    <input
                      required
                      value={clientId}
                      maxLength={250}
                      onChange={(e) => setClientId(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    Secret d’application
                    {connection.configured
                      ? " (laisser vide pour le conserver)"
                      : ""}
                    <input
                      type="password"
                      required={!connection.configured}
                      value={clientSecret}
                      maxLength={4096}
                      onChange={(e) => setClientSecret(e.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                  </label>
                  <label className="field">
                    Numéro sandbox de l’entreprise fictive SuperPDP
                    <input
                      required
                      value={sandboxNumber}
                      maxLength={100}
                      onChange={(e) => setSandboxNumber(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <p className="fiscal-hint">
                  Le numéro sandbox correspond au champ « number » de
                  l’entreprise fictive SuperPDP. Conservez les zéros initiaux.
                  Ce n’est ni un SIREN, ni un SIRET, ni une adresse Peppol.
                </p>
                <details className="fiscal-help">
                  <summary>Aide pour l’URL de retour et l’autorisation</summary>
                  <p>
                    Enregistrez dans l’application OAuth SuperPDP l’URL de
                    retour exacte indiquée dans la documentation d’installation.
                    L’autorisation sera donnée séparément par l’administrateur
                    de l’entreprise.
                  </p>
                </details>
                <div className="actions">
                  <button type="submit">
                    {busy
                      ? "Opération…"
                      : "Enregistrer la configuration de test"}
                  </button>
                </div>
              </fieldset>
            </form>
          </details>
          <section
            className="fiscal-connection-step"
            aria-labelledby="fiscal-authorization-title"
          >
            <h4 id="fiscal-authorization-title">
              B · Autorisation et vérification
            </h4>
            <p className="fiscal-hint">
              {connection.status === "connected"
                ? "Cette entreprise a été vérifiée. Vous pouvez contrôler à nouveau sa connexion."
                : "Après avoir enregistré les accès, autorisez cette entreprise dans SuperPDP, puis vérifiez sa connexion."}
            </p>
            <div className="actions fiscal-connection-actions">
              <button
                type="button"
                disabled={
                  busy ||
                  connection.busy ||
                  !connection.available ||
                  !connection.configured ||
                  [
                    "connected",
                    "verification_pending",
                    "revocation_pending",
                  ].includes(connection.status)
                }
                onClick={() => void action("connect")}
              >
                Autoriser l’entreprise dans SuperPDP
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  busy ||
                  connection.busy ||
                  !connection.available ||
                  !connection.configured
                }
                onClick={() => void action("check")}
              >
                Vérifier la connexion
              </button>
            </div>
          </section>
          <details className="fiscal-help fiscal-disconnect">
            <summary>Déconnexion et retrait des accès</summary>
            <p>
              Révoque le consentement et retire les secrets enregistrés. Les
              factures existantes ne sont pas modifiées.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={
                busy ||
                connection.busy ||
                !connection.available ||
                !connection.configured
              }
              onClick={() => void action("disconnect")}
            >
              Déconnecter et retirer les secrets
            </button>
          </details>
          <p className="fiscal-hint">
            Aucune inscription d’annuaire ni aucun mandat n’est créé
            automatiquement. Les dépôts se préparent séparément depuis la fiche
            facture.
          </p>
          <p>
            <Link
              to={`/factures-achat?entreprise=${encodeURIComponent(entityId)}`}
            >
              Consulter les factures d’achat de test de cette entreprise →
            </Link>
          </p>
        </>
      )}
      <details className="fiscal-connection-step fiscal-readiness-details">
        <summary>
          <span className="fiscal-step-label">
            C · Bilan de préparation des tests
          </span>
          <span className="fiscal-step-description">
            Contrôles locaux, sans contact avec SuperPDP ni envoi
          </span>
        </summary>
        <SuperPdpReadinessPanel key={entityId} entityId={entityId} />
      </details>
    </section>
  );
}
