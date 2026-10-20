import type { TouristTaxResult } from "./touristTax.js";
type Option = {
  enabled?: boolean;
  offert?: boolean;
  nb_lits?: number;
  nb_personnes?: number;
  nb?: number;
  prix_unitaire?: number;
  prix_forfait?: number;
};
type Options = {
  draps?: Option;
  linge_toilette?: Option;
  menage?: Option;
  depart_tardif?: Option;
  chiens?: Option;
};
export type InvoiceReservationService = {
  key: string;
  label: string;
  quantity: number;
  unit_price_ttc: number;
};
export type InvoiceReservationDetail = {
  prix_par_nuit?: number;
  montant_location?: number;
  remise_montant?: number;
  tourist_tax?: TouristTaxResult;
  services?: InvoiceReservationService[];
};

/** Reconstruct a booking's services only when their prices agree with its recorded total.
 * A difference with today's rates stays explicit; never invent an allocation or change the booking price.
 */
export function invoiceReservationServices(
  reservation: {
    nb_nuits: number;
    frais_optionnels_montant: unknown;
    frais_optionnels_libelle?: string | null;
    options?: Options | null;
  },
  gite: {
    options_draps_par_lit?: unknown;
    options_linge_toilette_par_personne?: unknown;
    options_menage_forfait?: unknown;
    options_depart_tardif_forfait?: unknown;
    options_chiens_forfait?: unknown;
  } = {},
) {
  const options = reservation.options ?? {};
  const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
  const services: InvoiceReservationService[] = [];
  const add = (
    key: keyof Options,
    label: string,
    quantity: number,
    price: unknown,
  ) => {
    const option = options[key];
    if (!option?.enabled || quantity <= 0) return;
    services.push({
      key,
      label: `${label}${option.offert ? " · offert" : ""}`,
      quantity,
      unit_price_ttc: option.offert ? 0 : money(price),
    });
  };
  add(
    "draps",
    "Draps",
    options.draps?.nb_lits ?? 0,
    options.draps?.prix_unitaire ?? gite.options_draps_par_lit,
  );
  add(
    "linge_toilette",
    "Linge de toilette",
    options.linge_toilette?.nb_personnes ?? 0,
    gite.options_linge_toilette_par_personne,
  );
  add("menage", "Ménage", 1, gite.options_menage_forfait);
  add(
    "depart_tardif",
    "Départ tardif",
    1,
    options.depart_tardif?.prix_forfait ?? gite.options_depart_tardif_forfait,
  );
  add(
    "chiens",
    `Animaux · ${options.chiens?.nb ?? 1} × ${reservation.nb_nuits} nuits`,
    (options.chiens?.nb ?? 1) * reservation.nb_nuits,
    options.chiens?.prix_unitaire ?? gite.options_chiens_forfait,
  );
  const recorded = money(reservation.frais_optionnels_montant);
  const reconstructed = money(
    services.reduce((sum, row) => sum + row.quantity * row.unit_price_ttc, 0),
  );
  const mismatch =
    reconstructed !== recorded &&
    services.some((row) => !options[row.key as keyof Options]?.offert);
  const serviceLabels = services
    .filter((row) => !options[row.key as keyof Options]?.offert)
    .map((row) => `${row.label} × ${row.quantity}`)
    .join(", ");
  const aggregateLabel = mismatch
    ? `Options du séjour · ${serviceLabels} · montant enregistré${reservation.frais_optionnels_libelle?.trim() ? ` · ${reservation.frais_optionnels_libelle.trim()}` : ""}`
    : reservation.frais_optionnels_libelle?.trim() || "Frais du séjour";
  const extraFee = {
    libelle: aggregateLabel.slice(0, 500),
    montant: money(mismatch ? recorded : recorded - reconstructed),
  };
  return {
    useStructuredOptions: !mismatch,
    extraFee,
    services: [
      ...services.filter(
        (row) => !mismatch || options[row.key as keyof Options]?.offert,
      ),
      ...(extraFee.montant > 0
        ? [
            {
              key: "fees",
              label: extraFee.libelle,
              quantity: 1,
              unit_price_ttc: extraFee.montant,
            },
          ]
        : []),
    ],
  };
}
