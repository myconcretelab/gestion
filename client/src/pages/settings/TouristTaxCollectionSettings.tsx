import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  touristTaxCollectionRule,
  type TouristTaxCollectionResponse,
  type TouristTaxCollectionRule,
  type TouristTaxReapplyPreview,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { canCurrentUserWritePage } from "../../utils/auth";
import { formatEuro } from "../../utils/format";
import "./touristTaxCollection.css";

const collectorLabel = (collector: string, platform: string) =>
  collector === "host"
    ? "Gestionnaire"
    : collector === "platform"
      ? platform || "Plateforme"
      : collector === "not_applicable"
        ? "Non applicable"
        : "À préciser";
export default function TouristTaxCollectionSettings() {
  const [settings, setSettings] = useState<TouristTaxCollectionResponse | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => `${new Date().getFullYear()}-12-31`);
  const [giteId, setGiteId] = useState("");
  const [gites, setGites] = useState<Array<{ id: string; nom: string }>>([]);
  const [overrideManual, setOverrideManual] = useState(false);
  const [preview, setPreview] = useState<TouristTaxReapplyPreview | null>(null);
  const writable = canCurrentUserWritePage("settings");
  const canReapply = writable && canCurrentUserWritePage("reservations");
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TouristTaxCollectionResponse>("/settings/tourist-tax-collection", {
      signal: controller.signal,
    })
      .then(setSettings)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    apiFetch<Array<{ id: string; nom: string }>>("/gites", {
      signal: controller.signal,
    })
      .then(setGites)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const updateRule = (
    source: string,
    change: Partial<TouristTaxCollectionRule>,
  ) => {
    if (!settings) return;
    const rule = { ...touristTaxCollectionRule(source, settings), ...change };
    setSettings({
      ...settings,
      rules: [
        ...settings.rules.filter(
          (item) =>
            item.source.toLocaleLowerCase() !== source.toLocaleLowerCase(),
        ),
        rule,
      ],
    });
    setDirty(true);
    setPreview(null);
    setNotice("");
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Opération impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const scope = {
    from,
    to,
    ...(giteId ? { gite_id: giteId } : {}),
    override_manual: overrideManual,
  };
  return (
    <section
      className="settings-cluster tourist-tax-collection"
      aria-labelledby="nav-settings-tourist-tax"
    >
      <div className="settings-cluster__header">
        <div>
          <div className="settings-cluster__eyebrow">Hébergements</div>
          <h2 className="settings-cluster__title">Taxe de séjour</h2>
        </div>
        <p className="settings-cluster__text">
          Préremplissez la collecte selon l’origine de chaque réservation.
        </p>
      </div>
      <div className="card settings-card">
        <h3>Les barèmes restent propres à chaque gîte</h3>
        <p>
          Classement, tarif, pourcentage, taxes additionnelles, collectivité
          bénéficiaire et date d’application se règlent dans la fiche du gîte,
          rubrique « Fiscalité & banque ».
        </p>
        <Link to="/gites">Ouvrir les gîtes →</Link>
      </div>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="note" role="status">
          {notice}
        </p>
      )}
      <form
        className="card settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!settings) return;
          void run(async () => {
            const saved = await apiFetch<{ rules: TouristTaxCollectionRule[] }>(
              "/settings/tourist-tax-collection",
              { method: "PUT", json: { rules: settings.rules } },
            );
            setSettings({ ...settings, ...saved });
            setDirty(false);
            setPreview(null);
            setNotice(
              "Règles enregistrées. Elles préremplissent les nouvelles réservations et les imports. Les séjours existants conservent leurs choix.",
            );
          });
        }}
      >
        <h3>Collecte selon l’origine</h3>
        <p>
          Le collecteur encaisse la taxe auprès du voyageur. La collectivité
          bénéficiaire est définie dans le gîte.
        </p>
        {!settings ? (
          <p>Chargement…</p>
        ) : (
          <>
            <div className="tax-collection-table-wrap">
              <table className="tax-collection-table tax-collection-rules">
                <thead>
                  <tr>
                    <th>Origine</th>
                    <th>Qui collecte ?</th>
                    <th>Taxe dans le prix saisi ou importé</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.sources.map((source) => {
                    const rule = touristTaxCollectionRule(source, settings);
                    return (
                      <tr key={source}>
                        <th scope="row">{source}</th>
                        <td>
                          <select
                            aria-label={`Collecteur pour ${source}`}
                            disabled={busy || !writable}
                            value={rule.collector}
                            onChange={(event) =>
                              updateRule(source, {
                                collector: event.target
                                  .value as TouristTaxCollectionRule["collector"],
                              })
                            }
                          >
                            <option value="host">Gestionnaire</option>
                            <option value="platform">Plateforme</option>
                            <option value="unknown">
                              À préciser sur le séjour
                            </option>
                          </select>
                        </td>
                        <td>
                          <select
                            aria-label={`Prix pour ${source}`}
                            disabled={busy || !writable}
                            value={rule.price}
                            onChange={(event) =>
                              updateRule(source, {
                                price: event.target
                                  .value as TouristTaxCollectionRule["price"],
                              })
                            }
                          >
                            <option value="gite">
                              Selon le réglage du gîte
                            </option>
                            <option value="included">Taxe comprise</option>
                            <option value="excluded">Taxe non comprise</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="field-hint">
              « Taxe comprise » isole la taxe du prix enregistré. « Taxe non
              comprise » l’ajoute uniquement si le gestionnaire la collecte.
              Chaque séjour reste modifiable.
            </p>
            <p className="field-hint">
              Les nouvelles plateformes configurées dans{" "}
              <Link to="/parametres/reglements">Règlements</Link> apparaissent
              ici avec un collecteur « À préciser ».
            </p>
            <button
              className="primary"
              disabled={busy || !writable || !dirty}
              type="submit"
            >
              {busy ? "Enregistrement…" : "Enregistrer les règles"}
            </button>
          </>
        )}
      </form>
      <section className="card settings-card">
        <h3>Appliquer aux réservations existantes</h3>
        <p>
          Choisissez les dates d’arrivée. L’aperçu reprend le barème actuel de
          chaque gîte et les règles enregistrées ci-dessus. Les réservations
          liées à un contrat, une facture ou un paiement en cours sont exclues.
        </p>
        <div className="tax-collection-scope">
          <label className="field">
            Arrivée à partir du
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label className="field">
            Jusqu’au
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label className="field">
            Gîte
            <select
              value={giteId}
              onChange={(event) => {
                setGiteId(event.target.value);
                setPreview(null);
              }}
            >
              <option value="">Tous les gîtes</option>
              {gites.map((gite) => (
                <option key={gite.id} value={gite.id}>
                  {gite.nom}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={overrideManual}
            disabled={busy || !canReapply}
            onChange={(event) => {
              setOverrideManual(event.target.checked);
              setPreview(null);
            }}
          />
          Remplacer aussi les choix de collecte et de prix personnalisés sur les
          séjours
        </label>
        {dirty && (
          <p className="field-hint">
            Enregistrez les règles avant de préparer l’aperçu.
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy || !canReapply || dirty || !from || !to}
            onClick={() =>
              void run(async () =>
                setPreview(
                  await apiFetch<TouristTaxReapplyPreview>(
                    "/settings/tourist-tax-collection/preview",
                    { method: "POST", json: scope },
                  ),
                ),
              )
            }
          >
            Prévisualiser les changements
          </button>
        </div>
        {preview && (
          <>
            <p role="status">
              <strong>{preview.eligible} séjour(s) à mettre à jour</strong> ·{" "}
              {preview.excluded} sans modification
            </p>
            <div className="tax-collection-table-wrap">
              <table className="tax-collection-table">
                <thead>
                  <tr>
                    <th>Séjour</th>
                    <th>Collecteur avant → après</th>
                    <th>Taxe avant → après</th>
                    <th>Hébergement hors taxe avant → après</th>
                    <th>Total du séjour avant → après</th>
                    <th>Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.guest}</strong>
                        <br />
                        {row.gite} · {row.start.split("-").reverse().join("/")}
                        <br />
                        {row.source}
                      </td>
                      <td>
                        {collectorLabel(
                          row.before.collector,
                          row.before.platform,
                        )}{" "}
                        →{" "}
                        {collectorLabel(
                          row.after.collector,
                          row.after.platform,
                        )}
                      </td>
                      <td>
                        {row.before.tax === null
                          ? "—"
                          : formatEuro(row.before.tax)}{" "}
                        →{" "}
                        {row.after.tax === null
                          ? "—"
                          : formatEuro(row.after.tax)}
                      </td>
                      <td>
                        {formatEuro(row.before.accommodation)} →{" "}
                        {formatEuro(row.after.accommodation)}
                      </td>
                      <td>
                        {formatEuro(row.before.total)} →{" "}
                        {formatEuro(row.after.total)}
                      </td>
                      <td>{row.reason ?? "À mettre à jour"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || !canReapply || !preview.eligible || dirty}
              onClick={() =>
                void run(async () => {
                  const result = await apiFetch<{ updated: number }>(
                    "/settings/tourist-tax-collection/apply",
                    {
                      method: "POST",
                      json: { ...scope, fingerprint: preview.fingerprint },
                    },
                  );
                  setPreview(null);
                  setNotice(
                    `${result.updated} séjour(s) mis à jour. Les rapports refléteront ces changements au prochain calcul.`,
                  );
                })
              }
            >
              Appliquer aux {preview.eligible} séjour(s)
            </button>
          </>
        )}
      </section>
    </section>
  );
}
