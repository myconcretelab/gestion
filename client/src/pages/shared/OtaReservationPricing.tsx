import { useEffect, useState, type FormEvent } from "react";
import {
  calculateOtaPrice,
  otaGrossInputBasis,
  otaIncludedTotal,
  otaOptionAmount,
  OTA_QUANTITY_KEYS,
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
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const populate = (data: OtaPricingContext) => {
    const grossBasis = otaGrossInputBasis(data.source, data.grossInputBasis);
    const saved = data.saved;
    setContext(data);
    const preferNet =
      data.preferredInputBasis === "net" ||
      (!data.preferredInputBasis && data.source === "Airbnb");
    const initialBasis =
      preferNet || saved?.basis === "net" ? "net" : grossBasis;
    setBasis(initialBasis);
    let value: number | undefined = data.amountCents;
    if (saved)
      value =
        initialBasis === "net"
          ? saved.netCents
          : saved.grossCents -
            (grossBasis === "rental" ? otaIncludedTotal(saved.included) : 0);
    else if (initialBasis === "net" && data.storedPriceBasis !== "net") {
      value = undefined;
      if (data.storedPriceBasis === "gross") {
        try {
          value = calculateOtaPrice(
            {
              basis: "gross",
              amountCents: data.amountCents,
              included: Object.fromEntries(
                data.options.map((option) => [
                  option.key,
                  option.included ? option.amountCents : 0,
                ]),
              ) as OtaPriceInput["included"],
            },
            data.rule,
          ).netCents;
        } catch {
          /* Ask for the actual net instead of guessing. */
        }
      }
    }
    setAmount(value === undefined ? "" : String(value / 100));
    setFee(saved?.feeSource === "manual" ? String(saved.feeCents / 100) : "");
    setSelected(
      Object.fromEntries(
        data.options.map((option) => [option.key, option.included]),
      ),
    );
    setQuantities(
      Object.fromEntries(
        data.options.map((option) => [
          option.key,
          String(option.quantity ?? 1),
        ]),
      ),
    );
  };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    setContext(null);
    apiFetch<OtaPricingContext>(
      "/reservations/" + reservationId + "/payments/pricing",
      { signal: controller.signal },
    )
      .then(populate)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason.message ?? "Chargement impossible.");
      });
    return () => controller.abort();
  }, [open, reservationId]);

  const quantityFor = (key: string) => {
    const value = Number(quantities[key] ?? 1);
    if (!Number.isInteger(value) || value < 1 || value > 1000)
      throw new Error(
        "Renseignez une quantité entière comprise entre 1 et 1 000.",
      );
    return value;
  };
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
          throw new Error("Renseignez un montant avec au plus deux décimales.");
        return Math.round(numeric * 100);
      };
      input = {
        basis,
        amountCents: toCents(amount),
        ...(fee.trim() ? { feeCents: toCents(fee) } : {}),
        included: Object.fromEntries(
          context.options.map((option) => [
            option.key,
            selected[option.key]
              ? otaOptionAmount(option, quantityFor(option.key))
              : 0,
          ]),
        ) as OtaPriceInput["included"],
      };
      result = calculateOtaPrice(input, context.rule);
    } catch (reason) {
      calculationError =
        reason instanceof Error ? reason.message : "Calcul impossible.";
    }
  }
  const needsPrecision = /commission|Plusieurs prix bruts/.test(
    calculationError,
  );
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
      }>("/reservations/" + reservationId + "/payments/pricing", {
        method: "PUT",
        json: {
          ...input,
          revision: context.revision,
          useOptionPrices: true,
          includedKeys: context.options
            .filter((option) => selected[option.key])
            .map((option) => option.key),
          quantities: Object.fromEntries(
            OTA_QUANTITY_KEYS.filter((key) => selected[key]).map((key) => [
              key,
              quantityFor(key),
            ]),
          ),
        },
      });
      populate(response.pricing);
      onSaved(response.tracking);
      window.dispatchEvent(
        new CustomEvent("reservation:pricing-changed", {
          detail: { reservationId },
        }),
      );
      setNotice(
        "Montants enregistrés. La date du versement reste estimée jusqu’à la saisie du règlement réel.",
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
                  ? "Taux à renseigner dans les paramètres"
                  : String(context.rule.percent) + " %"}{" "}
                ·{" "}
                {context.rule.rounding === "euro"
                  ? "Arrondi à l’euro"
                  : "Arrondi au centime"}
                .
              </p>
              {context.blockedReason && (
                <p role="alert">{context.blockedReason}</p>
              )}
              <fieldset
                disabled={busy || disabled || Boolean(context.blockedReason)}
              >
                <label>
                  Je saisis
                  <select
                    aria-label="Base du montant plateforme"
                    value={basis === "net" ? "net" : "gross"}
                    onChange={(event) => {
                      const next =
                        event.target.value === "net"
                          ? "net"
                          : otaGrossInputBasis(
                              context.source,
                              context.grossInputBasis,
                            );
                      if (result)
                        setAmount(
                          String(
                            (next === "net"
                              ? result.netCents
                              : result.grossCents -
                                (next === "rental"
                                  ? otaIncludedTotal(result.included)
                                  : 0)) / 100,
                          ),
                        );
                      setBasis(next);
                      setFee("");
                      setNotice("");
                    }}
                  >
                    <option value="gross">Brut</option>
                    <option value="net">Net propriétaire</option>
                  </select>
                </label>
                <label>
                  {basis === "net"
                    ? "Net propriétaire (€)"
                    : basis === "rental"
                      ? "Prix de location brut (€)"
                      : "Brut hors taxes (€)"}
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
                {context.importedNet && !context.saved && (
                  <small>
                    Net propriétaire repris automatiquement de Pump.
                  </small>
                )}
                <p className="field-hint">
                  {basis === "rental"
                    ? "Reprenez le « Prix location » du relevé. Les options cochées s’ajoutent à ce brut."
                    : "Reprenez le montant hors taxe de séjour et caution. Les options cochées sont déjà comprises dans ce montant."}
                </p>
                <div className="ota-reservation-pricing__options">
                  <p>Options comprises dans le versement</p>
                  <small>
                    Tarifs repris dans l’application. Ajustez seulement les
                    quantités si nécessaire.
                  </small>
                  {context.options.map((option) => {
                    const quantity = Number(quantities[option.key] ?? 1);
                    const value =
                      Number.isInteger(quantity) && quantity > 0
                        ? otaOptionAmount(option, quantity)
                        : 0;
                    return (
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
                        <span className="ota-reservation-pricing__option-price">
                          {formatEuro(value / 100)}
                        </span>
                        {selected[option.key] && option.quantityLabel && (
                          <label className="ota-reservation-pricing__quantity">
                            {option.quantityLabel}
                            <input
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              aria-label={option.quantityLabel}
                              value={quantities[option.key] ?? "1"}
                              onChange={(event) => {
                                setQuantities({
                                  ...quantities,
                                  [option.key]: event.target.value,
                                });
                                setNotice("");
                              }}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
                <details
                  className="ota-reservation-pricing__precision"
                  open={advanced || needsPrecision}
                  onToggle={(event) => setAdvanced(event.currentTarget.open)}
                >
                  <summary>Précision sur la commission (facultatif)</summary>
                  <label>
                    Commission réelle (€), si connue
                    <input
                      aria-label="Commission réelle plateforme"
                      type="number"
                      min="0"
                      step="0.01"
                      value={fee}
                      placeholder="Calcul automatique"
                      onChange={(event) => {
                        setFee(event.target.value);
                        setNotice("");
                      }}
                    />
                  </label>
                  <small>
                    À utiliser seulement si le relevé diffère du calcul, si
                    aucun taux n’est configuré ou si plusieurs bruts donnent le
                    même net.
                  </small>
                </details>
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
