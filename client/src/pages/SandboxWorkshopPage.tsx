import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch, isAbortError } from "../utils/api";
import { formatEuro } from "../utils/format";
import { canCurrentUserManageIntegrations } from "../utils/auth";
import {
  workshopStatus,
  workshopStep,
  type WorkshopOverview,
  type WorkshopRun,
} from "./shared/sandboxWorkshopState";
import { WorkshopDocument } from "./shared/SandboxWorkshopDocument";
import "./shared/sandboxWorkshop.css";

const endpoint = "/superpdp-workshop";
export default function SandboxWorkshopPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("document");
  const [overview, setOverview] = useState<WorkshopOverview | null>(null);
  const [run, setRun] = useState<WorkshopRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activation, setActivation] = useState(false);
  const [reservation, setReservation] = useState("");
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [scenario, setScenario] = useState("b2b");
  const [b2cConfirmed, setB2cConfirmed] = useState(false);
  const owner = canCurrentUserManageIntegrations();
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    apiFetch<WorkshopOverview>(endpoint, { signal: controller.signal })
      .then(setOverview)
      .catch((err) => {
        if (!isAbortError(err)) setError(err.message);
      });
    return () => controller.abort();
  }, [owner]);
  useEffect(() => {
    setRun(null);
    setError(null);
    if (!selected || !owner) return;
    const controller = new AbortController();
    apiFetch<WorkshopRun>(`${endpoint}/${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then(setRun)
      .catch((err) => {
        if (!isAbortError(err)) setError(err.message);
      });
    return () => controller.abort();
  }, [selected, owner]);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Opération non confirmée. Actualisez avant de recommencer.",
      );
    } finally {
      setBusy(false);
    }
  };
  const action = (kind: string, body: Record<string, unknown> = {}) =>
    perform(async () => {
      if (!run) return;
      const updated = await apiFetch<WorkshopRun>(
        `${endpoint}/${run.id}/${kind}`,
        {
          method: "POST",
          json: kind === "sync" ? {} : { revision: run.revision, ...body },
        },
      );
      setRun(updated);
      if (updated.id !== run.id) setParams({ document: updated.id });
      setOverview(await apiFetch<WorkshopOverview>(endpoint));
    });
  const refresh = () =>
    perform(async () => {
      setOverview(await apiFetch<WorkshopOverview>(endpoint));
      if (selected)
        setRun(
          await apiFetch<WorkshopRun>(
            `${endpoint}/${encodeURIComponent(selected)}`,
          ),
        );
    });
  const active = !!overview?.active;
  return (
    <main className="sandbox-workshop">
      <Link to="/factures">← Revenir aux factures habituelles</Link>
      <header>
        <span className="sandbox-workshop__badge">Bac à sable uniquement</span>
        <h1>Atelier de facturation test</h1>
        <p>
          Deux scénarios guidés : entre entreprises, ou vente à un particulier
          fictif. Aucun effet sur vos factures habituelles, leur numérotation ou
          vos paiements.
        </p>
      </header>
      <aside className="sandbox-workshop__notice">
        <strong>Identités fictives, aucun paiement réel.</strong> Pour le test
        entre entreprises, seul le montant d’une réservation est repris. Le
        client, ses coordonnées, les adresses et les coordonnées bancaires du
        gîte ne sont pas transmis. Les taux sont des choix de recette, pas une
        qualification fiscale de votre activité.
      </aside>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {!owner ? (
        <p>Atelier réservé aux administrateurs.</p>
      ) : !overview ? (
        <p>Chargement de l’atelier…</p>
      ) : !overview.available ? (
        <p className="note">{overview.reason}</p>
      ) : (
        <>
          {!active && (
            <section className="card">
              <h2>Avant de commencer</h2>
              <p>
                L’atelier s’arrête au redémarrage du serveur. Les anciens
                documents restent consultables, mais ne peuvent pas être
                renvoyés.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={activation}
                  onChange={(e) => setActivation(e.target.checked)}
                />
                Je confirme utiliser les données locales de test, distinctes de
                la production.
              </label>
              <button
                disabled={!activation || busy}
                onClick={() =>
                  void perform(async () =>
                    setOverview(
                      await apiFetch<WorkshopOverview>(`${endpoint}/activate`, {
                        method: "POST",
                        json: { confirm_local_test_data: true },
                      }),
                    ),
                  )
                }
              >
                Ouvrir l’atelier pour cette session
              </button>
            </section>
          )}
          <ol className="sandbox-workshop__steps" aria-label="Étapes du test">
            {[
              "Choisir le scénario",
              "Vérification et émission",
              "Factur-X et envoi",
              run?.scenario === "b2c"
                ? "Suivi et encaissements"
                : "Suivi et avoir",
            ].map((label, i) => (
              <li
                key={label}
                aria-current={workshopStep(run) === i ? "step" : undefined}
              >
                <span>{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <section className="card">
            <div className="sandbox-workshop__toolbar">
              <h2>Vos documents de test</h2>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Actualiser l’atelier
              </button>
            </div>
            <label className="field">
              Document à consulter
              <select
                value={selected ?? ""}
                disabled={busy || dirty}
                onChange={(e) =>
                  setParams(e.target.value ? { document: e.target.value } : {})
                }
              >
                <option value="">Créer un nouveau test</option>
                {overview.runs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.scenario === "b2c"
                      ? "B2C"
                      : item.kind === "credit_note"
                        ? "Avoir"
                        : "Facture B2B"}{" "}
                    · {item.number} ·{" "}
                    {workshopStatus[item.status] ?? item.status}
                  </option>
                ))}
              </select>
            </label>
          </section>
          {!selected && active && (
            <section className="card">
              <h2>1. Choisir un scénario fictif</h2>
              <label className="field">
                Type de test
                <select
                  value={scenario}
                  disabled={busy}
                  onChange={(e) => {
                    setScenario(e.target.value);
                    setB2cConfirmed(false);
                    setCopyConfirmed(false);
                  }}
                >
                  <option value="b2b">
                    Entre entreprises — Burger Queen → Tricatel
                  </option>
                  <option value="b2c">
                    Particulier fictif — transaction et encaissements
                  </option>
                </select>
              </label>
              {scenario === "b2c" ? (
                <>
                  <p className="note">
                    Recette B2C encore en qualification : le convertisseur
                    fournisseur a refusé notre dernier essai malgré le marquage
                    B2C documenté. Le dépôt et les encaissements restent bloqués
                    tant que la conversion et la validation ne sont pas
                    positives.
                  </p>
                  <p>
                    Prestation fictive de 120 € TTC : 100 € HT et 20 € de TVA.
                    Deux encaissements fictifs de 60 € seront saisis après le
                    dépôt. Aucune réservation n’est utilisée et aucun règlement
                    n’est attendu.
                  </p>
                  <p className="note">
                    Profil technique fixe : services, TVA mensuelle sur
                    encaissements, sans option débits. Le serveur vérifiera ce
                    profil dans Burger Queen sans le modifier. La facture n’est
                    pas envoyée au particulier.
                  </p>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={b2cConfirmed}
                      onChange={(e) => setB2cConfirmed(e.target.checked)}
                    />
                    Je confirme ce scénario entièrement fictif et l’absence de
                    déclaration parallèle de ces mêmes données.
                  </label>
                  <button
                    disabled={!b2cConfirmed || busy}
                    onClick={() =>
                      void perform(async () => {
                        const created = await apiFetch<WorkshopRun>(endpoint, {
                          method: "POST",
                          json: {
                            scenario: "b2c",
                            confirm_fictional_b2c: true,
                            confirm_no_other_reporting: true,
                          },
                        });
                        setRun(created);
                        setB2cConfirmed(false);
                        setParams({ document: created.id });
                        setOverview(await apiFetch<WorkshopOverview>(endpoint));
                      })
                    }
                  >
                    Créer le test B2C fictif de 120 €
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Réservations des gîtes rattachés à Burger Queen (100
                    dernières). La copie conserve le montant TTC affiché, pas
                    les informations personnelles ni la ventilation du séjour.
                  </p>
                  <label className="field">
                    Réservation de départ
                    <select
                      value={reservation}
                      disabled={busy}
                      onChange={(e) => setReservation(e.target.value)}
                    >
                      <option value="">Choisir une réservation</option>
                      {overview.sources.map((source) => (
                        <option
                          key={source.reservationId}
                          value={source.reservationId}
                        >
                          {source.label} · {formatEuro(source.total)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!overview.sources.length && (
                    <p className="note">
                      Vérifiez les deux connexions fictives et le rattachement
                      d’un gîte à Burger Queen dans{" "}
                      <Link to="/parametres/entreprises">Entreprises</Link>. Une
                      réservation de ce gîte sera nécessaire.
                    </p>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={copyConfirmed}
                      onChange={(e) => setCopyConfirmed(e.target.checked)}
                    />
                    Je souhaite créer une copie de test anonymisée de ce
                    montant, sans modifier la réservation.
                  </label>
                  <button
                    disabled={!reservation || !copyConfirmed || busy}
                    onClick={() =>
                      void perform(async () => {
                        const created = await apiFetch<WorkshopRun>(endpoint, {
                          method: "POST",
                          json: {
                            reservation_id: reservation,
                            confirm_anonymized_copy: true,
                          },
                        });
                        setRun(created);
                        setCopyConfirmed(false);
                        setParams({ document: created.id });
                        setOverview(await apiFetch<WorkshopOverview>(endpoint));
                      })
                    }
                  >
                    Créer le brouillon de test
                  </button>
                </>
              )}
            </section>
          )}
          {selected && !run && !error && <p>Chargement du document…</p>}
          {run && (
            <WorkshopDocument
              key={`${run.id}:${run.revision}`}
              run={run}
              active={active}
              busy={busy}
              action={action}
              onDirty={setDirty}
            />
          )}
        </>
      )}
    </main>
  );
}
