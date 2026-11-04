import { useState } from "react";
import {
  taxRemittanceSources,
  taxRemittanceSourcesOverlap,
  taxRemittanceTotals,
  type TaxRemittance,
  type TaxRemittanceAccount,
} from "@contrats/shared";
import type { ReportWorkspace } from "./ReportsPage";
import { ReportDialog } from "./ReportUi";

export const remittanceMoney = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
export const parseRemittanceMoney = (value: string) =>
  /^\d+(?:[.,]\d{1,2})?$/.test(value.trim())
    ? Math.round(Number(value.replace(",", ".")) * 100)
    : NaN;

export default function TaxRemittanceForm({
  workspace,
  account,
  remittance,
  onClose,
}: {
  workspace: ReportWorkspace;
  account: TaxRemittanceAccount;
  remittance?: TaxRemittance;
  onClose: () => void;
}) {
  const [id] = useState(() => remittance?.id ?? crypto.randomUUID());
  const [label, setLabel] = useState(remittance?.label ?? "");
  const [keys, setKeys] = useState(remittance?.sources.map((s) => s.key) ?? []);
  const [amount, setAmount] = useState(
    remittance ? (remittance.declaredAmountCents / 100).toFixed(2) : "",
  );
  const [reference, setReference] = useState(
    remittance?.declarationReference ?? "",
  );
  const [note, setNote] = useState(remittance?.note ?? "");
  const sources =
    remittance?.sources ?? taxRemittanceSources(workspace.state, account);
  const selected = sources.filter((s) => keys.includes(s.key));
  const total = taxRemittanceTotals({
    sources: selected,
    payments: [],
    declaredAmountCents: 0,
  });
  const declared = parseRemittanceMoney(amount);
  const requiresNote =
    declared !== total.collectedCents ||
    (remittance && declared !== remittance.declaredAmountCents);
  const invalid =
    !label.trim() ||
    !selected.length ||
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    declared > 1_000_000_000 ||
    (requiresNote && note.trim().length < 3);
  return (
    <ReportDialog
      title={
        remittance ? "Modifier le montant déclaré" : "Préparer un reversement"
      }
      wide
      onClose={onClose}
    >
      {workspace.error && (
        <p role="alert" className="rp-notice">
          {workspace.error}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (invalid) return;
          if (
            await workspace.mutate({
              type: "remittance-save",
              remittance: {
                id,
                accountId: account.id,
                label,
                sourceKeys: keys,
                declaredAmountCents: declared,
                declarationReference: reference,
                note,
              },
            })
          )
            onClose();
        }}
      >
        <p>
          <strong>{account.name}</strong>
        </p>
        <label className="rp-field">
          Libellé du reversement
          <input
            autoFocus
            required
            value={label}
            maxLength={160}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex. : 4e trimestre 2026"
          />
        </label>
        <fieldset
          className="rp-remittance-choices"
          disabled={Boolean(remittance) || workspace.saving}
        >
          <legend>Déclarations confirmées à regrouper</legend>
          {sources.map((source) => {
            const alreadyUsed =
              !remittance &&
              workspace.state.taxRemittances
                ?.filter((r) => !r.cancelledAt)
                .some((r) =>
                  r.sources.some((s) => taxRemittanceSourcesOverlap(source, s)),
                );
            return (
              <label className="rp-reference-choice" key={source.key}>
                <input
                  type="checkbox"
                  checked={keys.includes(source.key)}
                  disabled={Boolean(alreadyUsed)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...keys, source.key]
                      : keys.filter((key) => key !== source.key);
                    setKeys(next);
                    const cents = sources
                      .filter((s) => next.includes(s.key))
                      .reduce(
                        (sum, s) =>
                          sum +
                          s.properties.reduce((v, p) => v + p.hostCents, 0),
                        0,
                      );
                    setAmount((cents / 100).toFixed(2));
                  }}
                />
                <span>
                  {source.reportName} · {source.label}
                  <small>
                    {source.properties.map((p) => p.name).join(", ")} ·{" "}
                    {remittanceMoney(
                      source.properties.reduce((v, p) => v + p.hostCents, 0),
                    )}
                    {alreadyUsed && " · Déjà rattaché à un reversement"}
                  </small>
                </span>
              </label>
            );
          })}
          {!sources.length && (
            <p>
              Confirmez d’abord une déclaration de taxe de séjour avec un
              registre complet pour ces gîtes.
            </p>
          )}
        </fieldset>
        <p className="rp-field-help">
          Les copies confirmées servent de référence. Un même gîte sur une même
          période ne peut être rattaché qu’une fois, même si plusieurs rapports
          existent.
        </p>
        <p>
          Collecté par vous :{" "}
          <strong>{remittanceMoney(total.collectedCents)}</strong> · Collecté
          par les plateformes : {remittanceMoney(total.platformCents)}
        </p>
        <label className="rp-field">
          Montant à reverser déclaré sur le portail (€)
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <p className="rp-field-help">
          Le montant proposé reprend uniquement votre collecte. Vérifiez le
          montant demandé sur le portail avant d’enregistrer.
        </p>
        <label className="rp-field">
          Référence de la déclaration ou de l’avis de paiement
          <input
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="rp-field">
          Note
          {requiresNote
            ? " · justification de l’écart ou de la correction obligatoire"
            : " (facultative)"}
          <textarea
            value={note}
            maxLength={1000}
            required={Boolean(requiresNote)}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="rp-dialog__actions">
          <button
            className="rp-button"
            disabled={invalid || workspace.saving || workspace.loading}
          >
            Enregistrer le reversement
          </button>
        </div>
      </form>
    </ReportDialog>
  );
}
