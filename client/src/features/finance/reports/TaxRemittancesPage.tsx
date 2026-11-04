import { useState } from "react";
import { Link } from "react-router-dom";
import {
  taxRemittanceAccounts,
  taxRemittanceTotals,
  taxRemittanceSourcesChanged,
  type TaxRemittance,
} from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import ReportPageHeader from "./ReportPageHeader";
import { ReportDialog } from "./ReportUi";
import TaxRemittanceForm, { remittanceMoney } from "./TaxRemittanceForm";
import TaxRemittancePayments from "./TaxRemittancePayments";

export default function TaxRemittancesPage({
  workspace,
}: {
  workspace: ReportWorkspace;
}) {
  const { state, canEdit, saving, loading, href } = workspace;
  const accounts = taxRemittanceAccounts(state);
  const [selected, setSelected] = useState("");
  const account = accounts.find((a) => a.id === selected) ?? accounts[0];
  const [form, setForm] = useState<TaxRemittance | "new" | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const rows = (state.taxRemittances ?? [])
    .filter((r) => r.accountId === account?.id)
    .slice()
    .reverse();
  return (
    <>
      <ReportPageHeader
        title="Reversements de taxe de séjour"
        back={{ to: href(), label: "Revenir aux rapports" }}
      />
      <p className="rp-muted">
        Suivez les sommes déclarées et les paiements effectués à la
        collectivité. Les déclarations et les règlements se font sur votre
        portail habituel.
      </p>
      {!accounts.length && (
        <section className="rp-panel">
          <h2>Suivi par propriétaire</h2>
          <p>
            Renseignez le propriétaire dans la fiche de chaque gîte pour
            organiser les reversements.
          </p>
        </section>
      )}
      {state.properties.some((p) => !p.managerId) && (
        <p className="rp-notice">
          Des gîtes n’ont pas de propriétaire renseigné. Complétez leur fiche
          pour les retrouver dans ce suivi.
        </p>
      )}
      {account && (
        <>
          <section className="rp-panel rp-remittance-owner">
            <label className="rp-field">
              Propriétaire
              <select
                aria-label="Propriétaire"
                value={account.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <p>{account.propertyIds.map(workspace.propertyName).join(" · ")}</p>
            {canEdit && (
              <div className="rp-dialog__actions">
                <button
                  type="button"
                  className="rp-button"
                  disabled={saving || loading || !account.propertyIds.length}
                  onClick={() => setForm("new")}
                >
                  Préparer un reversement
                </button>
              </div>
            )}
          </section>
          {!rows.length && <p>Aucun reversement suivi pour ce propriétaire.</p>}
          {rows.map((remittance) => {
            const totals = taxRemittanceTotals(remittance);
            return (
              <section
                className="rp-panel rp-remittance"
                key={remittance.id}
                aria-label={`Reversement · ${remittance.label}`}
              >
                <div className="rp-panel-heading">
                  <h2>{remittance.label}</h2>
                  <span className="rp-status">{totals.status}</span>
                </div>
                <dl className="rp-remittance-totals">
                  <div>
                    <dt>Collecté par vous</dt>
                    <dd>{remittanceMoney(totals.collectedCents)}</dd>
                  </div>
                  <div>
                    <dt>Collecté par les plateformes</dt>
                    <dd>{remittanceMoney(totals.platformCents)}</dd>
                  </div>
                  <div>
                    <dt>Montant déclaré à reverser</dt>
                    <dd>{remittanceMoney(remittance.declaredAmountCents)}</dd>
                  </div>
                  <div>
                    <dt>Déjà versé</dt>
                    <dd>{remittanceMoney(totals.paidCents)}</dd>
                  </div>
                  <div>
                    <dt>
                      {totals.balanceCents < 0
                        ? "Trop versé"
                        : "Reste à régler"}
                    </dt>
                    <dd>{remittanceMoney(Math.abs(totals.balanceCents))}</dd>
                  </div>
                </dl>
                {totals.differenceCents !== 0 && (
                  <p className="rp-notice">
                    Écart entre le montant déclaré et votre collecte :{" "}
                    {remittanceMoney(totals.differenceCents)}.
                  </p>
                )}
                {remittance.declarationReference && (
                  <p>
                    Référence de déclaration : {remittance.declarationReference}
                  </p>
                )}
                {remittance.note && <p>{remittance.note}</p>}
                {taxRemittanceSourcesChanged(state, remittance) && (
                  <p className="rp-notice">
                    Une déclaration de référence a été corrigée depuis la
                    création de ce reversement. Vérifiez le montant sur le
                    portail ; les montants conservés ici restent ceux du dossier
                    initial.
                  </p>
                )}
                <details>
                  <summary>
                    Déclarations regroupées ({remittance.sources.length})
                  </summary>
                  <ul>
                    {remittance.sources.map((source) => (
                      <li key={source.key}>
                        <Link
                          to={href(
                            `/${source.reportId}`,
                            source.start.slice(0, 7),
                          )}
                        >
                          {source.reportName} · {source.label}
                        </Link>
                        <p>
                          {source.properties
                            .map(
                              (p) =>
                                `${p.name} : ${remittanceMoney(p.hostCents)}`,
                            )
                            .join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
                {remittance.cancelledAt ? (
                  <p>Annulé : {remittance.cancelReason}</p>
                ) : (
                  canEdit && (
                    <div className="rp-dialog__actions">
                      <button
                        type="button"
                        className="rp-text-button"
                        disabled={saving || loading}
                        onClick={() => setForm(remittance)}
                      >
                        Modifier le montant déclaré
                      </button>
                      {!totals.paidCents && (
                        <button
                          type="button"
                          className="rp-text-button"
                          disabled={saving || loading}
                          onClick={() => {
                            setCancelId(remittance.id);
                            setReason("");
                          }}
                        >
                          Annuler ce reversement saisi par erreur
                        </button>
                      )}
                    </div>
                  )
                )}
                <TaxRemittancePayments
                  remittance={remittance}
                  workspace={workspace}
                />
              </section>
            );
          })}
        </>
      )}
      {form && account && (
        <TaxRemittanceForm
          workspace={workspace}
          account={account}
          remittance={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
        />
      )}
      {cancelId && (
        <ReportDialog
          title="Annuler un reversement saisi par erreur"
          onClose={() => setCancelId(null)}
        >
          <p>
            La trace du dossier est conservée. Ses périodes pourront être
            rattachées à un nouveau reversement. Cette action ne modifie aucune
            déclaration sur le portail.
          </p>
          {workspace.error && (
            <p role="alert" className="rp-notice">
              {workspace.error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await workspace.mutate({
                  type: "remittance-cancel",
                  remittanceId: cancelId,
                  reason,
                })
              )
                setCancelId(null);
            }}
          >
            <label className="rp-field">
              Motif de l’annulation
              <textarea
                autoFocus
                required
                minLength={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="rp-dialog__actions">
              <button
                className="rp-button"
                disabled={saving || loading || reason.trim().length < 3}
              >
                Confirmer l’annulation du reversement
              </button>
            </div>
          </form>
        </ReportDialog>
      )}
    </>
  );
}
