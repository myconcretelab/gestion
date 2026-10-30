import type { OtaChannel } from "@contrats/shared";
import "../../features/finance/reports/ota.css";

export default function OtaChannelSettings({
  value,
  automatic,
  disabled,
  onChange,
}: {
  value: OtaChannel[] | undefined;
  automatic: boolean;
  disabled: boolean;
  onChange: (value: OtaChannel[]) => void;
}) {
  const channels =
    value ??
    ["Airbnb", "Abritel", "Gites de France", "Booking.com"].map((name) => ({
      name,
      automatic: name === "Booking.com" ? false : automatic,
      storedPriceBasis: "unknown" as const,
      rateDateBasis: "payment" as const,
      rates: [],
    }));
  const update = (index: number, patch: Partial<OtaChannel>) =>
    onChange(
      channels.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <fieldset className="ota-settings" disabled={disabled}>
      <legend>Canaux et commissions</legend>
      <p className="field-hint">
        Les montants exacts d’un relevé priment sur ces taux. Chaque taux
        s’applique à partir de sa date d’effet, jusqu’au taux suivant. Les
        anciens règlements conservent leur commission.
      </p>
      {channels.map((channel, index) => (
        <section className="ota-channel" key={index}>
          <div className="ota-channel__heading">
            <label className="field">
              Canal
              <input
                aria-label={`Canal ${index + 1}`}
                required
                maxLength={60}
                value={channel.name}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
              />
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={channel.automatic}
                onChange={(event) =>
                  update(index, { automatic: event.target.checked })
                }
              />
              Hébergement considéré réglé par ce canal
            </label>
          </div>
          <label className="field">
            Prix d’hébergement enregistrés dans l’application
            <select
              value={channel.storedPriceBasis ?? "unknown"}
              onChange={(event) =>
                update(index, {
                  storedPriceBasis: event.target
                    .value as OtaChannel["storedPriceBasis"],
                })
              }
            >
              <option value="unknown">Base non précisée</option>
              <option value="gross">Brut, avant commission</option>
              <option value="net">Net, après commission</option>
            </select>
            <small>
              Utilisé uniquement pour les estimations sans relevé. Les montants
              importés restent exacts et prioritaires.
            </small>
          </label>
          <label className="field">
            Date utilisée pour choisir la commission
            <select
              value={channel.rateDateBasis}
              onChange={(event) =>
                update(index, {
                  rateDateBasis: event.target
                    .value as OtaChannel["rateDateBasis"],
                })
              }
            >
              <option value="payment">Date du versement</option>
              <option value="arrival">Date d’arrivée du séjour</option>
              <option value="booking">
                Date de réservation OTA, si connue
              </option>
            </select>
          </label>
          {channel.rates.map((rate, rateIndex) => (
            <div className="ota-rate" key={rateIndex}>
              <label className="field">
                À partir du
                <input
                  aria-label={`Date d’effet ${channel.name} ${rateIndex + 1}`}
                  type="date"
                  required
                  value={rate.effectiveFrom}
                  onChange={(event) =>
                    update(index, {
                      rates: channel.rates.map((item, i) =>
                        i === rateIndex
                          ? { ...item, effectiveFrom: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                Commission (%)
                <input
                  aria-label={`Commission ${channel.name} ${rateIndex + 1}`}
                  type="number"
                  required
                  min="0"
                  max="99.99"
                  step="0.01"
                  value={rate.percent}
                  onChange={(event) =>
                    update(index, {
                      rates: channel.rates.map((item, i) =>
                        i === rateIndex
                          ? { ...item, percent: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  update(index, {
                    rates: channel.rates.filter((_, i) => i !== rateIndex),
                  })
                }
              >
                Retirer ce taux
              </button>
            </div>
          ))}
          <div className="actions">
            <button
              className="secondary"
              type="button"
              disabled={channel.rates.length >= 100}
              onClick={() =>
                update(index, {
                  rates: [
                    ...channel.rates,
                    {
                      effectiveFrom: new Date().toISOString().slice(0, 10),
                      percent: 0,
                    },
                  ],
                })
              }
            >
              Ajouter une commission datée
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => onChange(channels.filter((_, i) => i !== index))}
            >
              Retirer le canal
            </button>
          </div>
        </section>
      ))}
      <button
        className="secondary"
        type="button"
        disabled={channels.length >= 30}
        onClick={() =>
          onChange([
            ...channels,
            {
              name: "Nouveau canal",
              automatic: false,
              storedPriceBasis: "unknown",
              rateDateBasis: "payment",
              rates: [],
            },
          ])
        }
      >
        Ajouter un canal
      </button>
    </fieldset>
  );
}
