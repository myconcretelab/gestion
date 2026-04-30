import { formatEuro } from "../../utils/format";
import {
  mergeReservationOptions,
  toNonNegativeInt,
  type ReservationServiceOptionKey,
} from "../../utils/reservationOptions";
import type { ContratOptions, Gite } from "../../utils/types";

type ReservationOptionsEditorPreview = {
  total: number;
  label: string;
  byKey: Record<ReservationServiceOptionKey, number>;
};

type ReservationOptionsEditorProps = {
  options: ContratOptions | null | undefined;
  preview: ReservationOptionsEditorPreview;
  gite: Gite | null;
  guestCount: number;
  onChange: (next: ContratOptions) => void;
  layout?: "full" | "compact" | "drawer";
  showDeclaredToggle?: boolean;
};

const roundMoneyInput = (value: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 100) / 100);
};

const ReservationOptionsEditor = ({
  options,
  preview,
  gite,
  guestCount,
  onChange,
  layout = "full",
  showDeclaredToggle = true,
}: ReservationOptionsEditorProps) => {
  const normalizedOptions = mergeReservationOptions(options);
  const defaultGuestCount = Math.max(1, toNonNegativeInt(guestCount, 1));
  const isDrawerLayout = layout === "drawer";

  const commit = (updater: (previous: ContratOptions) => ContratOptions) => {
    onChange(mergeReservationOptions(updater(normalizedOptions)));
  };

  const toggleServiceOption = (key: ReservationServiceOptionKey, enabled: boolean) => {
    commit((previous) => {
      if (key === "draps") {
        return {
          ...previous,
          draps: {
            ...previous.draps,
            enabled,
            offert: enabled ? previous.draps?.offert ?? false : false,
            declared: enabled ? previous.draps?.declared ?? false : false,
            nb_lits: enabled ? Math.max(1, toNonNegativeInt(previous.draps?.nb_lits, defaultGuestCount)) : previous.draps?.nb_lits,
          },
        };
      }

      if (key === "linge_toilette") {
        return {
          ...previous,
          linge_toilette: {
            ...previous.linge_toilette,
            enabled,
            offert: enabled ? previous.linge_toilette?.offert ?? false : false,
            declared: enabled ? previous.linge_toilette?.declared ?? false : false,
            nb_personnes: enabled
              ? Math.max(1, toNonNegativeInt(previous.linge_toilette?.nb_personnes, defaultGuestCount))
              : previous.linge_toilette?.nb_personnes,
          },
        };
      }

      if (key === "chiens") {
        return {
          ...previous,
          chiens: {
            ...previous.chiens,
            enabled,
            offert: enabled ? previous.chiens?.offert ?? false : false,
            declared: enabled ? previous.chiens?.declared ?? false : false,
            nb: enabled ? Math.max(1, toNonNegativeInt(previous.chiens?.nb, 1)) : previous.chiens?.nb,
          },
        };
      }

      if (key === "menage") {
        return {
          ...previous,
          menage: {
            ...previous.menage,
            enabled,
            offert: enabled ? previous.menage?.offert ?? false : false,
            declared: enabled ? previous.menage?.declared ?? false : false,
          },
        };
      }

      return {
        ...previous,
        depart_tardif: {
          ...previous.depart_tardif,
          enabled,
          offert: enabled ? previous.depart_tardif?.offert ?? false : false,
          declared: enabled ? previous.depart_tardif?.declared ?? false : false,
        },
      };
    });
  };

  const setDeclared = (key: ReservationServiceOptionKey, declared: boolean) => {
    commit((previous) => {
      if (key === "draps") return { ...previous, draps: { ...previous.draps, declared } };
      if (key === "linge_toilette") return { ...previous, linge_toilette: { ...previous.linge_toilette, declared } };
      if (key === "chiens") return { ...previous, chiens: { ...previous.chiens, declared } };
      if (key === "menage") return { ...previous, menage: { ...previous.menage, declared } };
      return { ...previous, depart_tardif: { ...previous.depart_tardif, declared } };
    });
  };

  const setOffert = (key: ReservationServiceOptionKey, offert: boolean) => {
    commit((previous) => {
      if (key === "draps") return { ...previous, draps: { ...previous.draps, offert } };
      if (key === "linge_toilette") return { ...previous, linge_toilette: { ...previous.linge_toilette, offert } };
      if (key === "chiens") return { ...previous, chiens: { ...previous.chiens, offert } };
      if (key === "menage") return { ...previous, menage: { ...previous.menage, offert } };
      return { ...previous, depart_tardif: { ...previous.depart_tardif, offert } };
    });
  };

  const setCount = (key: "draps" | "linge_toilette" | "chiens", value: number) => {
    const count = toNonNegativeInt(value, 0);
    commit((previous) => {
      if (key === "draps") return { ...previous, draps: { ...previous.draps, nb_lits: count } };
      if (key === "linge_toilette") {
        return {
          ...previous,
          linge_toilette: { ...previous.linge_toilette, nb_personnes: count },
        };
      }
      return { ...previous, chiens: { ...previous.chiens, nb: count } };
    });
  };

  const setPrice = (key: "draps" | "depart_tardif", value: number) => {
    const amount = roundMoneyInput(value);
    commit((previous) => {
      if (key === "draps") return { ...previous, draps: { ...previous.draps, prix_unitaire: amount } };
      return {
        ...previous,
        depart_tardif: { ...previous.depart_tardif, prix_forfait: amount },
      };
    });
  };

  const chiensTarif = normalizedOptions.chiens?.prix_unitaire ?? gite?.options_chiens_forfait ?? 0;

  return (
    <div className={`reservation-options-editor reservation-options-editor--${layout}`}>
      <div className="reservations-options-list">
        <div className="reservations-option-line">
          <div className="reservations-option-main">
            <span className="reservations-option-title">Draps</span>
            <span className="field-hint">
              {formatEuro(normalizedOptions.draps?.prix_unitaire ?? gite?.options_draps_par_lit ?? 0)} / lit / séjour
            </span>
            <div className="reservations-option-switches">
              <div className="switch-group switch-group--table">
                <span>Activer</span>
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.draps?.enabled ?? false}
                    onChange={(event) => toggleServiceOption("draps", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group switch-group--table">
                <span>Offert</span>
                <label className="switch switch--compact switch--pink">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.draps?.offert ?? false}
                    disabled={!normalizedOptions.draps?.enabled}
                    onChange={(event) => setOffert("draps", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              {showDeclaredToggle ? (
                <div className="switch-group switch-group--table">
                  <span>Déclaré</span>
                  <label className="switch switch--compact">
                    <input
                      type="checkbox"
                      checked={normalizedOptions.draps?.declared ?? false}
                      disabled={!normalizedOptions.draps?.enabled}
                      onChange={(event) => setDeclared("draps", event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <div className="reservations-option-controls">
            <div className="reservations-option-fields">
              <label className="reservations-option-count">
                Lits
                <input
                  type="number"
                  min={0}
                  value={normalizedOptions.draps?.nb_lits ?? 0}
                  disabled={!normalizedOptions.draps?.enabled}
                  onChange={(event) => setCount("draps", Number(event.target.value))}
                />
              </label>
              <label className="reservations-option-count">
                Prix / lit
                <span className="reservations-option-input reservations-option-input--currency">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={normalizedOptions.draps?.prix_unitaire ?? gite?.options_draps_par_lit ?? 0}
                    disabled={!normalizedOptions.draps?.enabled}
                    onChange={(event) => setPrice("draps", Number(event.target.value))}
                  />
                  <span className="reservations-option-unit">€</span>
                </span>
              </label>
            </div>
            <div className="reservations-option-footer">
              <span className="reservations-option-amount">{formatEuro(preview.byKey.draps)}</span>
            </div>
          </div>
        </div>

        <div className="reservations-option-line">
          <div className="reservations-option-main">
            <span className="reservations-option-title">Linge de toilette</span>
            <span className="field-hint">{formatEuro(gite?.options_linge_toilette_par_personne ?? 0)} / personne / séjour</span>
            <div className="reservations-option-switches">
              <div className="switch-group switch-group--table">
                <span>Activer</span>
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.linge_toilette?.enabled ?? false}
                    onChange={(event) => toggleServiceOption("linge_toilette", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group switch-group--table">
                <span>Offert</span>
                <label className="switch switch--compact switch--pink">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.linge_toilette?.offert ?? false}
                    disabled={!normalizedOptions.linge_toilette?.enabled}
                    onChange={(event) => setOffert("linge_toilette", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              {showDeclaredToggle ? (
                <div className="switch-group switch-group--table">
                  <span>Déclaré</span>
                  <label className="switch switch--compact">
                    <input
                      type="checkbox"
                      checked={normalizedOptions.linge_toilette?.declared ?? false}
                      disabled={!normalizedOptions.linge_toilette?.enabled}
                      onChange={(event) => setDeclared("linge_toilette", event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <div className="reservations-option-controls">
            <div className="reservations-option-fields">
              <label className="reservations-option-count">
                Personnes
                <input
                  type="number"
                  min={0}
                  value={normalizedOptions.linge_toilette?.nb_personnes ?? 0}
                  disabled={!normalizedOptions.linge_toilette?.enabled}
                  onChange={(event) => setCount("linge_toilette", Number(event.target.value))}
                />
              </label>
              {isDrawerLayout ? <div className="reservations-option-field-spacer" aria-hidden="true" /> : null}
            </div>
            <div className="reservations-option-footer">
              <span className="reservations-option-amount">{formatEuro(preview.byKey.linge_toilette)}</span>
            </div>
          </div>
        </div>

        <div className="reservations-option-line">
          <div className="reservations-option-main">
            <span className="reservations-option-title">Ménage fin de séjour</span>
            <span className="field-hint">Forfait {formatEuro(gite?.options_menage_forfait ?? 0)}</span>
            <div className="reservations-option-switches">
              <div className="switch-group switch-group--table">
                <span>Activer</span>
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.menage?.enabled ?? false}
                    onChange={(event) => toggleServiceOption("menage", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group switch-group--table">
                <span>Offert</span>
                <label className="switch switch--compact switch--pink">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.menage?.offert ?? false}
                    disabled={!normalizedOptions.menage?.enabled}
                    onChange={(event) => setOffert("menage", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              {showDeclaredToggle ? (
                <div className="switch-group switch-group--table">
                  <span>Déclaré</span>
                  <label className="switch switch--compact">
                    <input
                      type="checkbox"
                      checked={normalizedOptions.menage?.declared ?? false}
                      disabled={!normalizedOptions.menage?.enabled}
                      onChange={(event) => setDeclared("menage", event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <div className="reservations-option-controls">
            <div className="reservations-option-fields">
              {isDrawerLayout ? (
                <>
                  <div className="reservations-option-field-spacer" aria-hidden="true" />
                  <div className="reservations-option-field-spacer" aria-hidden="true" />
                </>
              ) : null}
            </div>
            <div className="reservations-option-footer">
              <span className="reservations-option-amount">{formatEuro(preview.byKey.menage)}</span>
            </div>
          </div>
        </div>

        <div className="reservations-option-line">
          <div className="reservations-option-main">
            <span className="reservations-option-title">Départ tardif</span>
            <span className="field-hint">
              Forfait {formatEuro(normalizedOptions.depart_tardif?.prix_forfait ?? gite?.options_depart_tardif_forfait ?? 0)}
            </span>
            <div className="reservations-option-switches">
              <div className="switch-group switch-group--table">
                <span>Activer</span>
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.depart_tardif?.enabled ?? false}
                    onChange={(event) => toggleServiceOption("depart_tardif", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group switch-group--table">
                <span>Offert</span>
                <label className="switch switch--compact switch--pink">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.depart_tardif?.offert ?? false}
                    disabled={!normalizedOptions.depart_tardif?.enabled}
                    onChange={(event) => setOffert("depart_tardif", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              {showDeclaredToggle ? (
                <div className="switch-group switch-group--table">
                  <span>Déclaré</span>
                  <label className="switch switch--compact">
                    <input
                      type="checkbox"
                      checked={normalizedOptions.depart_tardif?.declared ?? false}
                      disabled={!normalizedOptions.depart_tardif?.enabled}
                      onChange={(event) => setDeclared("depart_tardif", event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <div className="reservations-option-controls">
            <div className="reservations-option-fields">
              <label className="reservations-option-count">
                Forfait
                <span className="reservations-option-input reservations-option-input--currency">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={normalizedOptions.depart_tardif?.prix_forfait ?? gite?.options_depart_tardif_forfait ?? 0}
                    disabled={!normalizedOptions.depart_tardif?.enabled}
                    onChange={(event) => setPrice("depart_tardif", Number(event.target.value))}
                  />
                  <span className="reservations-option-unit">€</span>
                </span>
              </label>
              {isDrawerLayout ? <div className="reservations-option-field-spacer" aria-hidden="true" /> : null}
            </div>
            <div className="reservations-option-footer">
              <span className="reservations-option-amount">{formatEuro(preview.byKey.depart_tardif)}</span>
            </div>
          </div>
        </div>

        <div className="reservations-option-line">
          <div className="reservations-option-main">
            <span className="reservations-option-title">Chiens</span>
            <span className="field-hint">{formatEuro(chiensTarif)} / nuit / chien</span>
            <div className="reservations-option-switches">
              <div className="switch-group switch-group--table">
                <span>Activer</span>
                <label className="switch switch--compact">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.chiens?.enabled ?? false}
                    onChange={(event) => toggleServiceOption("chiens", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="switch-group switch-group--table">
                <span>Offert</span>
                <label className="switch switch--compact switch--pink">
                  <input
                    type="checkbox"
                    checked={normalizedOptions.chiens?.offert ?? false}
                    disabled={!normalizedOptions.chiens?.enabled}
                    onChange={(event) => setOffert("chiens", event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
              {showDeclaredToggle ? (
                <div className="switch-group switch-group--table">
                  <span>Déclaré</span>
                  <label className="switch switch--compact">
                    <input
                      type="checkbox"
                      checked={normalizedOptions.chiens?.declared ?? false}
                      disabled={!normalizedOptions.chiens?.enabled}
                      onChange={(event) => setDeclared("chiens", event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <div className="reservations-option-controls">
            <div className="reservations-option-fields">
              <label className="reservations-option-count">
                Nb chiens
                <input
                  type="number"
                  min={0}
                  value={normalizedOptions.chiens?.nb ?? 0}
                  disabled={!normalizedOptions.chiens?.enabled}
                  onChange={(event) => setCount("chiens", Number(event.target.value))}
                />
              </label>
              <label className="reservations-option-count">
                Prix / nuit
                <span className="reservations-option-input reservations-option-input--currency">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={chiensTarif}
                    disabled={!normalizedOptions.chiens?.enabled}
                    onChange={(event) =>
                      commit((previous) => ({
                        ...previous,
                        chiens: { ...previous.chiens, prix_unitaire: roundMoneyInput(Number(event.target.value)) },
                      }))
                    }
                  />
                  <span className="reservations-option-unit">€</span>
                </span>
              </label>
            </div>
            <div className="reservations-option-footer">
              <span className="reservations-option-amount">{formatEuro(preview.byKey.chiens)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReservationOptionsEditor;
