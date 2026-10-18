import { useState } from "react";
import type { WorkshopRun } from "./sandboxWorkshopState";

const proofLabels = {
  pending: "En attente de traitement",
  verified: "Vérifié",
  mismatch: "Écart ou doublon à examiner — ne pas renvoyer",
};
const paymentLabels: Record<string, string> = {
  recorded: "Enregistré localement — aucun envoi",
  sending: "Envoi commencé — ne pas renvoyer",
  submitted: "Message 212 confirmé — extraction à vérifier",
  send_unknown: "Résultat inconnu — renvoi et suite bloqués",
};
const reportingLabels: Record<string, string> = {
  "ppf:ereporting": "Déclaration transmise",
  "ppf:ereporting-ack": "Accusé de réception technique",
  "ppf:ereporting-ack-error": "Erreur technique — à examiner",
  "ppf:ereporting-rejected": "Déclaration rejetée — à examiner",
  "ppf:ereporting-response-ok": "Réponse favorable du simulateur",
};
export function WorkshopB2c({
  run,
  active,
  busy,
  action,
}: {
  run: WorkshopRun;
  active: boolean;
  busy: boolean;
  action: (kind: string, body?: Record<string, unknown>) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [recordConfirmed, setRecordConfirmed] = useState(false);
  const [sendSlot, setSendSlot] = useState<number | null>(null);
  const payments = run.payments ?? [];
  const writable = active && run.writable && !busy;
  const uncertain = payments.some((p) =>
    ["send_unknown", "sending"].includes(p.status),
  );
  const nextSlot =
    payments.length === 0
      ? 1
      : payments.length === 1 && payments[0].status === "submitted"
        ? 2
        : null;
  const proof = run.reporting;
  return (
    <section aria-label="Recette B2C et encaissements">
      <h3>Transaction et encaissements fictifs</h3>
      <p>
        La facture n’est pas acheminée au particulier. SuperPDP extrait la
        transaction ; les deux messages d’encaissement alimentent séparément le
        e-reporting. Ne déclarez pas ces données par une autre voie.
      </p>
      <div className="sandbox-workshop__notice" role="status">
        <strong>
          Transaction :{" "}
          {proof
            ? proofLabels[proof.transaction]
            : "Non vérifiée — actualisez les statuts"}
          .
        </strong>
        {proof && (
          <p>
            Dernier contrôle :{" "}
            {new Date(proof.checkedAt).toLocaleString("fr-FR")} ·{" "}
            {proof.transactionIds.length} transaction(s) trouvée(s) pour cette
            facture.
          </p>
        )}
      </div>
      <p>
        Scénario limité à 120 € TTC, TVA de test à 20 %, services sans option
        débits. Acomptes déduits, taxe de séjour, exonérations, avoirs et
        remboursements sont exclus.
      </p>
      {payments.map((p) => (
        <div key={p.slot} className="sandbox-workshop__payment">
          <h4>Encaissement fictif {p.slot} / 2 — 60 € TTC</h4>
          <p>
            Date : {p.date} · {paymentLabels[p.status] ?? p.status}
          </p>
          <p className="field-hint">
            Référence unique : {p.reference}
            {p.remoteEventId && <> · Message SuperPDP : {p.remoteEventId}</>}
          </p>
          <p>
            Extraction du paiement :{" "}
            {
              proofLabels[
                proof?.payments.find((x) => x.slot === p.slot)?.result ??
                  "pending"
              ]
            }
            .
          </p>
          {p.status === "recorded" && (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={sendSlot === p.slot}
                  disabled={!writable || uncertain}
                  onChange={(e) =>
                    setSendSlot(e.target.checked ? p.slot : null)
                  }
                />
                Je confirme l’envoi unique du message de test pour ces 60 €
                fictifs. Aucun transfert d’argent.
              </label>
              <button
                disabled={
                  !writable ||
                  uncertain ||
                  sendSlot !== p.slot ||
                  proof?.transaction !== "verified"
                }
                onClick={() =>
                  void action("sendPayment", {
                    slot: p.slot,
                    confirm_test_send: true,
                  })
                }
              >
                Envoyer l’encaissement fictif {p.slot} à SuperPDP
              </button>
            </>
          )}
        </div>
      ))}
      {nextSlot && !uncertain && run.status === "submitted" && (
        <fieldset disabled={!writable || proof?.transaction !== "verified"}>
          <legend>
            Préparer l’encaissement fictif {nextSlot} / 2 — 60 € TTC
          </legend>
          <label className="field">
            Date du mouvement fictif
            <input
              type="date"
              value={date}
              min={run.date}
              onChange={(e) => {
                setDate(e.target.value);
                setRecordConfirmed(false);
              }}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={recordConfirmed}
              onChange={(e) => setRecordConfirmed(e.target.checked)}
            />
            Je confirme ce mouvement de recette de 60 €, à la date choisie, sans
            paiement réel.
          </label>
          <button
            className="secondary"
            disabled={
              !writable ||
              !date ||
              !recordConfirmed ||
              proof?.transaction !== "verified"
            }
            onClick={() =>
              void action("recordPayment", {
                slot: nextSlot,
                date,
                confirm_fictional_receipt: true,
              })
            }
          >
            Enregistrer le mouvement fictif {nextSlot}, sans l’envoyer
          </button>
        </fieldset>
      )}
      {uncertain && (
        <p className="note" role="alert">
          Un résultat d’encaissement est incertain. Aucun renvoi ni nouveau
          mouvement : conservez les références et faites vérifier le résultat
          dans SuperPDP.
        </p>
      )}
      <h4>Déclarations et retours administratifs</h4>
      {proof?.declarations.length ? (
        proof.declarations.map((d) => (
          <div key={d.id}>
            <p>
              Déclaration{" "}
              {d.kind === "transaction" ? "de transaction" : "d’encaissement"} #
              {d.id} · période du {d.start} au {d.end}
            </p>
            {d.events.length ? (
              <ul>
                {d.events.map((e, i) => (
                  <li key={`${e.code}:${i}`}>
                    {reportingLabels[e.code] ?? "Événement fournisseur"} (
                    {e.code}) · {e.at}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Aucun retour disponible.</p>
            )}
          </div>
        ))
      ) : (
        <p>
          Aucune déclaration rattachée disponible pour l’instant. Le traitement
          est différé ; cette absence n’est pas un échec ni une raison de
          renvoyer.
        </p>
      )}
      <p className="field-hint">
        Un dépôt, un message 212 ou un accusé technique ne vaut pas acceptation
        administrative. Les retours affichés sont ceux du bac à sable, pas une
        déclaration fiscale réelle.
      </p>
    </section>
  );
}
