import { useEffect, useState, type FormEvent } from "react";
import {
  calculateOtaPrice,
  otaIncludedTotal,
  type OtaPriceInput,
  type OtaPricingContext,
  type ReservationPaymentTracking,
} from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { formatEuro } from "../../utils/format";

type Props = {
  reservationId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: (tracking: ReservationPaymentTracking) => void;
};
export default function OtaReservationPricing({
  reservationId,
  disabled,
  onBusyChange,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<OtaPricingContext | null>(null);
  const [basis, setBasis] = useState<OtaPriceInput["basis"]>("gross");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [included, setIncluded] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const populate = (data: OtaPricingContext) => {
    setContext(data);
    setBasis(data.saved?.basis ?? "gross");
    setAmount(String((data.saved?.amountCents ?? data.amountCents) / 100));
    setFee(data.saved ? String(data.saved.feeCents / 100) : "");
    setIncluded(
      Object.fromEntries(
        data.options.map((option) => [
          option.key,
          String(option.amountCents / 100),
        ]),
      ),
    );
    setSelected(
      Object.fromEntries(
        data.options.map((option) => [option.key, option.included]),
      ),
    );
  };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    setContext(null);
    apiFetch<OtaPricingContext>(
      `/reservations/${reservationId}/payments/pricing`,
      { signal: controller.signal },
    )
      .then(populate)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason.message ?? "Chargement impossible.");
      });
    return () => controller.abort();
  }, [open, reservationId]);
  let input: OtaPriceInput | null = null;
  let result: ReturnType<typeof calculateOtaPrice> | null = null;
  let calculationError = "";
  if (context) {
    try {
      const toCents = (text: string) => {
        const numeric = Number(text.replace(",", "."));
        if (
          !text.trim() ||
          !Number.isFinite(numeric) ||
          numeric < 0 ||
          Math.abs(numeric * 100 - Math.round(numeric * 100)) > 0.00001
        )
          throw new Error(
            "Renseignez des montants positifs avec au plus deux décimales.",
          );
        return Math.round(numeric * 100);
      };
      input = {
        basis,
        amountCents: toCents(amount),
        ...(fee.trim() ? { feeCents: toCents(fee) } : {}),
        included: Object.fromEntries(
          context.options.map((option) => [
            option.key,
            selected[option.key] ? toCents(included[option.key] ?? "") : 0,
          ]),
        ) as OtaPriceInput["included"],
      };
      result = calculateOtaPrice(input, context.rule);
    } catch (reason) {
      calculationError =
        reason instanceof Error ? reason.message : "Calcul impossible.";
    }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !input ||
      !result ||
      !context ||
      busy ||
      disabled ||
      context.blockedReason
    )
      return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch<{
        pricing: OtaPricingContext;
        tracking: ReservationPaymentTracking;
      }>(`/reservations/${reservationId}/payments/pricing`, {
        method: "PUT",
        json: { ...input, revision: context.revision },
      });
      populate(response.pricing);
      onSaved(response.tracking);
      window.dispatchEvent(
        new CustomEvent("reservation:pricing-changed", {
          detail: { reservationId },
        }),
      );
      setNotice(
        "Montants enregistrés. La date de versement reste estimée jusqu’à la saisie du règlement réel.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Enregistrement impossible.",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <div className="ota-reservation-pricing">
      <button
        className="secondary"
        type="button"
        aria-expanded={open}
        disabled={busy || disabled}
        onClick={() => setOpen(!open)}
      >
        {open
          ? "Fermer les montants plateforme"
          : "Saisir un prix brut ou un net propriétaire"}
      </button>
      {open && (
        <form
          onSubmit={save}
          className="reservation-ledger__form"
          aria-label="Montants de la plateforme"
        >
          {error && <p role="alert">{error}</p>}
          {!context && !error && <p>Chargement…</p>}
          {context && (
            <>
              <p>
                {context.source} ·{" "}
                {context.rule.percent === undefined
                  ? "Taux non renseigné"
                  : `${context.rule.percent} %`}{" "}
                ·{" "}
                {context.rule.rounding === "euro"
                  ? "Arrondi à l’euro"
                  : "Arrondi au centime"}{" "}
                ·{" "}
                {context.rule.scope === "accommodation"
                  ? "Commission sur l’hébergement"
                  : "Commission sur l’hébergement et les options"}
                .
              </p>
              <p className="field-hint">
                Montants hors taxe de séjour et caution. Les options cochées
                sont comprises dans le versement plateforme ; elles ne seront
                pas ajoutées une seconde fois.
              </p>
              {context.blockedReason && (
                <p role="alert">{context.blockedReason}</p>
              )}
              <fieldset
                disabled={busy || disabled || Boolean(context.blockedReason)}
              >
                <label>
                  Montant dont je dispose
                  <select
                    aria-label="Base du montant plateforme"
                    value={basis}
                    onChange={(event) => {
                      setBasis(event.target.value as typeof basis);
                      setFee("");
                      setNotice("");
                    }}
                  >
                    <option value="rental">
                      Prix de location, hors options
                    </option>
                    <option value="gross">Total brut, options incluses</option>
                    <option value="net">
                      Net propriétaire, options incluses
                    </option>
                  </select>
                </label>
                <label>
                  Montant (€)
                  <input
                    aria-label="Montant plateforme"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setNotice("");
                    }}
                  />
                </label>
                <p>Options incluses dans le versement</p>
                {context.options
                  .filter((option) => option.enabled)
                  .map((option) => (
                    <div
                      className="ota-reservation-pricing__option"
                      key={option.key}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={selected[option.key] ?? false}
                          onChange={(event) => {
                            setSelected({
                              ...selected,
                              [option.key]: event.target.checked,
                            });
                            setNotice("");
                          }}
                        />
                        {option.label} inclus
                      </label>
                      {selected[option.key] && (
                        <label>
                          Valeur incluse (€)
                          <input
                            aria-label={`Montant inclus ${option.label}`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            value={included[option.key] ?? ""}
                            onChange={(event) => {
                              setIncluded({
                                ...included,
                                [option.key]: event.target.value,
                              });
                              setNotice("");
                            }}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                {!context.options.some((option) => option.enabled) && (
                  <p className="field-hint">
                    Activez les prestations dans les options du séjour pour
                    pouvoir les inclure.
                  </p>
                )}
                <label>
                  Commission réelle (€), si connue
                  <input
                    aria-label="Commission réelle plateforme"
                    type="number"
                    min="0"
                    step="0.01"
                    value={fee}
                    placeholder="Calculée avec les règles si vide"
                    onChange={(event) => {
                      setFee(event.target.value);
                      setNotice("");
                    }}
                  />
                </label>
                <small>
                  La commission réelle du relevé est prioritaire. Avec un net et
                  un arrondi à l’euro, elle peut être nécessaire pour retrouver
                  le prix exact.
                </small>
              </fieldset>
              {calculationError && <p role="status">{calculationError}</p>}
              {result && (
                <dl
                  className="ota-reservation-pricing__totals"
                  aria-label="Calcul de la plateforme"
                >
                  <div>
                    <dt>Prix de location</dt>
                    <dd>
                      {formatEuro(
                        (result.grossCents -
                          otaIncludedTotal(result.included)) /
                          100,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Options incluses</dt>
                    <dd>
                      {formatEuro(otaIncludedTotal(result.included) / 100)}
                    </dd>
                  </div>
                  <div>
                    <dt>Total brut plateforme</dt>
                    <dd>{formatEuro(result.grossCents / 100)}</dd>
                  </div>
                  <div>
                    <dt>Commission</dt>
                    <dd>{formatEuro(result.feeCents / 100)}</dd>
                  </div>
                  <div>
                    <dt>Net propriétaire</dt>
                    <dd>{formatEuro(result.netCents / 100)}</dd>
                  </div>
                </dl>
              )}
              {notice && <p role="status">{notice}</p>}
              <div className="reservation-ledger__form-actions">
                <button
                  type="submit"
                  disabled={
                    !result ||
                    busy ||
                    disabled ||
                    Boolean(context.blockedReason)
                  }
                >
                  {busy ? "Enregistrement…" : "Enregistrer les montants"}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
