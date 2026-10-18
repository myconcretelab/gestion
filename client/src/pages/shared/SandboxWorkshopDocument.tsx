import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { computeInvoiceFiscal } from "@contrats/shared";
import { buildApiUrl } from "../../utils/api";
import { formatEuro } from "../../utils/format";
import {
  canSendWorkshop,
  workshopStatus,
  type WorkshopRun,
} from "./sandboxWorkshopState";
const endpoint = "/superpdp-workshop";
export function WorkshopDocument({
  run,
  active,
  busy,
  action,
  onDirty,
}: {
  run: WorkshopRun;
  active: boolean;
  busy: boolean;
  action: (kind: string, body?: Record<string, unknown>) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [rates, setRates] = useState(
    run.input.lines.map((line) => line.vat_rate || 0),
  );
  const [reviewed, setReviewed] = useState(run.input.reviewed);
  const [opened, setOpened] = useState(false);
  const [sendConfirmed, setSendConfirmed] = useState(false);
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const draft = run.status === "draft";
  const writable = active && run.writable && !busy;
  const dirty =
    rates.some((rate, i) => rate !== run.input.lines[i].vat_rate) ||
    reviewed !== run.input.reviewed;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const totals = computeInvoiceFiscal(run.input);
  const pdf = (kind: string) =>
    typeof window === "undefined"
      ? `/api${endpoint}/${run.id}/pdf/${kind}`
      : buildApiUrl(`${endpoint}/${run.id}/pdf/${kind}`);
  return (
    <article
      className="card sandbox-workshop__document"
      aria-label="Document de test sélectionné"
    >
      <div className="sandbox-workshop__toolbar">
        <h2>
          {run.kind === "credit_note"
            ? "Avoir intégral de test"
            : "Facture de test"}
        </h2>
        <span className="sandbox-workshop__badge">
          {workshopStatus[run.status] ?? run.status}
        </span>
      </div>
      <p className="sandbox-workshop__reference">{run.number}</p>
      <p>
        Base locale : {run.source.label} ·{" "}
        <strong>{formatEuro(run.source.total)} TTC</strong>. Identités de
        recette figées : Burger Queen et Tricatel.
      </p>
      {run.original && (
        <p>
          Annulation intégrale de{" "}
          <Link to={`?document=${run.original.id}`}>{run.original.number}</Link>
          . Les montants et taux sont repris de l’original ; celui-ci reste
          inchangé.
        </p>
      )}
      {!run.writable && (
        <p className="note" role="status">
          Lecture seule après redémarrage, copie ou restauration. Aucun renvoi
          possible. Le suivi d’un dépôt déjà commencé reste disponible après
          activation de l’atelier.
        </p>
      )}
      {run.error && (
        <p className="note" role="alert">
          {run.error}
        </p>
      )}
      {draft ? (
        <section>
          <h3>2. Vérifier les données de test</h3>
          <p>
            {run.kind === "credit_note"
              ? "L’avoir reprend exactement les montants et taux de la facture source. Relisez ces données avant de confirmer ; elles ne peuvent pas être modifiées."
              : "Le montant est regroupé en une prestation fictive. Choisissez un taux de recette explicitement ; aucune donnée fiscale de vos fiches n’est modifiée."}
          </p>
          {run.input.lines.map((line, i) => (
            <div key={line.id} className="sandbox-workshop__line">
              <div>
                <strong>{line.label}</strong>
                <p>
                  {formatEuro(line.unit_price_ttc)} TTC · quantité{" "}
                  {line.quantity}
                </p>
              </div>
              <label className="field">
                Taux de TVA de test
                <select
                  value={rates[i]}
                  disabled={!writable || run.kind === "credit_note"}
                  onChange={(e) => {
                    setRates(
                      rates.map((rate, index) =>
                        i === index ? Number(e.target.value) : rate,
                      ),
                    );
                    setReviewed(false);
                  }}
                >
                  <option value="0">À choisir</option>
                  <option value="10">10 % (recette)</option>
                  <option value="20">20 % (recette)</option>
                </select>
              </label>
            </div>
          ))}
          <p>
            Cadre de test : prestations de services, sans encaissement.
            Conditions de paiement fictives et adresses synthétiques incluses ;
            aucun SIRET inventé.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={!writable}
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            J’ai vérifié le montant, les identités fictives et le taux de ce
            scénario de test.
          </label>
          <div className="sandbox-workshop__actions">
            <button
              className="secondary"
              disabled={!writable || rates.some((rate) => !rate)}
              onClick={() => void action("save", { rates, reviewed })}
            >
              Enregistrer la vérification
            </button>
            <button
              disabled={!writable || dirty || run.issues.length > 0}
              onClick={() => void action("issue")}
            >
              Émettre le document test et figer son PDF
            </button>
          </div>
          {dirty && (
            <p className="field-hint">
              Enregistrez vos choix avant l’émission ou de changer de document.
            </p>
          )}
          {!dirty && run.issues.length > 0 && (
            <ul className="field-hint">
              {run.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p>
          Total HT : {formatEuro(totals.net_cents / 100)} · TVA :{" "}
          {formatEuro(totals.vat_cents / 100)} · TTC :{" "}
          {formatEuro(totals.total_with_vat_cents / 100)}
          {run.kind === "credit_note" ? " (montants annulés)" : ""}
        </p>
      )}
      {run.nativeSha && (
        <p>
          <a
            className="secondary"
            href={pdf("native")}
            download="test-superpdp-natif.pdf"
          >
            Télécharger le PDF natif de test
          </a>
        </p>
      )}
      {run.status === "issued" && (
        <section>
          <h3>3. Préparer le fichier électronique</h3>
          <p>
            Cette étape vérifie les connexions et les annuaires, puis convertit
            et valide le PDF. Elle ne dépose aucune facture.
          </p>
          <button disabled={!writable} onClick={() => void action("prepare")}>
            Convertir et valider avec SuperPDP
          </button>
        </section>
      )}
      {run.validation && (
        <section aria-label="Résultat de validation">
          <h3>Validation fournisseur</h3>
          <p>
            {run.validation.valid && run.status !== "prepare_failed"
              ? "Validation positive"
              : "Validation non confirmée"}{" "}
            · {run.validation.checks} contrôles.
          </p>
          {run.validation.failures.map((failure, i) => (
            <p key={i} role="alert">
              {failure}
            </p>
          ))}
        </section>
      )}
      {run.artifactSha && (
        <p>
          <a
            className="secondary"
            href={pdf("factur-x")}
            download="test-superpdp-factur-x.pdf"
            onClick={() => setOpened(true)}
          >
            Télécharger et relire le Factur-X final
          </a>
        </p>
      )}
      {canSendWorkshop(run) && (
        <section className="sandbox-workshop__send">
          <h3>Confirmer un envoi unique</h3>
          <p>
            Destination : Tricatel, bac à sable. Relisez d’abord le Factur-X
            final. Un résultat inconnu bloque définitivement le renvoi de ce
            document.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={!writable || !opened}
              checked={sendConfirmed}
              onChange={(e) => setSendConfirmed(e.target.checked)}
            />
            J’ai relu le Factur-X final et je confirme son envoi de test unique,
            sans valeur comptable.
          </label>
          <button
            disabled={!writable || !opened || !sendConfirmed}
            onClick={() =>
              void action("send", {
                reviewed_sha256: run.artifactSha,
                confirm_test_send: true,
              })
            }
          >
            Envoyer ce test à Tricatel
          </button>
        </section>
      )}
      {["submitted", "send_unknown", "sending"].includes(run.status) && (
        <section>
          <h3>4. Suivre le dépôt</h3>
          <p>
            Référence externe : <code>{run.id}</code>
            {run.remoteId && <> · SuperPDP : {run.remoteId}</>}
          </p>
          <button
            className="secondary"
            disabled={!active || busy}
            onClick={() => void action("sync")}
          >
            Vérifier les statuts, sans renvoyer
          </button>
          {run.events.length ? (
            <ul>
              {run.events.map((event) => (
                <li key={event.id}>
                  <strong>{event.code}</strong> · {event.text}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Actualisez les statuts après le dépôt. Une confirmation technique
              ne prouve ni paiement ni acceptation par l’administration.
            </p>
          )}
          <p>
            <Link to="/factures-achat">
              Consulter les achats reçus dans l’application
            </Link>{" "}
            · La récupération des achats reste une opération séparée.
          </p>
          {run.kind === "invoice" &&
            run.status === "submitted" &&
            !run.hasCredit && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={creditConfirmed}
                    disabled={!writable}
                    onChange={(e) => setCreditConfirmed(e.target.checked)}
                  />
                  Je souhaite tester l’annulation intégrale de cette facture,
                  par un avoir distinct.
                </label>
                <button
                  disabled={!writable || !creditConfirmed}
                  onClick={() => void action("credit")}
                >
                  Créer l’avoir intégral de test
                </button>
              </>
            )}
          {run.hasCredit && (
            <p>
              Un avoir intégral est déjà réservé pour cette facture. Aucun
              second avoir ne sera créé.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
