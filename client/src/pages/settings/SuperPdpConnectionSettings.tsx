import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, isAbortError } from "../../utils/api";

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
}: {
  entityId: string;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [sandboxNumber, setSandboxNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endpoint = `/fiscal-entities/${encodeURIComponent(entityId)}/superpdp`;
  const apply = (value: Connection) => {
    setConnection(value);
    setClientId(value.client_id ?? "");
    setSandboxNumber(value.sandbox_number ?? "");
  };
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Connection>(endpoint, { signal: controller.signal })
      .then(apply)
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
      style={{ margin: "24px 0" }}
    >
      <h3 className="section-subtitle">
        SuperPDP — environnement de test uniquement
      </h3>
      <p>
        La production est désactivée. Cette étape connecte l’entreprise et
        vérifie son identité. Elle ne transmet aucune facture automatiquement ;
        les dépôts de test se préparent séparément depuis la fiche facture.
      </p>
      {error && (
        <p role="alert" className="note">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="note">
          {notice}
        </p>
      )}
      {!connection && !error && <p>Chargement de la connexion…</p>}
      {connection && (
        <>
          <p>
            <strong>
              {statusLabels[connection.status] ?? "État à vérifier"}
            </strong>
            {connection.busy ? " — opération en cours" : ""}
          </p>
          {!connection.available && (
            <p className="note">
              {connection.reason} Aucun identifiant ne peut être enregistré tant
              que le serveur n’est pas configuré.
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
              Corrigez la situation dans votre compte SuperPDP avant de vérifier
              de nouveau.
            </p>
          )}
          {connection.status === "operation_interrupted" && (
            <p className="note">
              Le résultat précédent est incertain. Lancez une déconnexion ; une
              première tentative peut sécuriser le verrou avant de permettre la
              révocation.
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
          <form onSubmit={(event) => void save(event)} autoComplete="off">
            <fieldset
              disabled={busy || connection.busy || !connection.available}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <legend>Application OAuth SuperPDP</legend>
              <p>
                Récupérez les identifiants depuis une application SuperPDP et
                enregistrez l’URL de retour indiquée dans la documentation
                d’installation. Le consentement sera demandé à l’administrateur
                de l’entreprise.
              </p>
              <div className="grid-2">
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
                  Identifiant de l’entreprise fictive SuperPDP
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
              <p className="field-hint">
                Cet identifiant est le champ « number » de l’entreprise fictive
                dans SuperPDP (Burger Queen, Tricatel…). Ce n’est pas le SIREN
                de votre entreprise réelle. Le serveur vérifiera cette
                correspondance après le consentement.
              </p>
              <div className="actions">
                <button type="submit">
                  {busy ? "Opération…" : "Enregistrer la configuration de test"}
                </button>
              </div>
            </fieldset>
          </form>
          <div className="actions" style={{ marginTop: 12 }}>
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
          </div>
          <p className="field-hint">
            Les secrets et jetons restent chiffrés sur le serveur Node.js. Aucun
            secret n’est placé dans le stockage du navigateur. Aucune
            inscription à un annuaire de réception n’est demandée
            automatiquement.
          </p>
        </>
      )}
    </section>
  );
}
