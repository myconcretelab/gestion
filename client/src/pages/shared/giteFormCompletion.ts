import {
  touristTaxSettingsSchema,
  type TouristTaxSettings,
} from "@contrats/shared";
import {
  formCompletionProgress,
  type FormCompletionItem,
} from "./formCompletion";

type NumberValue = number | "";
export type GiteCompletionSection =
  | "base-fiche"
  | "gestion-contact"
  | "gestion-finance"
  | "sejour-services"
  | "sejour-tarifs"
  | "sejour-regles"
  | "web-presentation"
  | "web-photos";
export type GiteCompletionItem = FormCompletionItem & {
  group: GiteCompletionSection;
};

// Optional integrations, address complements and zero-price services are valid.
// This guide does not prevent saving a partly configured property.
export type GiteCompletionForm = {
  nom: string;
  prefixe_contrat: string;
  adresse_ligne1: string;
  proprietaires_noms: string;
  proprietaires_adresse: string;
  fiscal_establishment_id: string;
  email: string;
  telephones: string;
  iban: string;
  titulaire: string;
  caracteristiques: string;
  date_debut_activite: string;
  capacite_max: NumberValue;
  nb_adultes_max: NumberValue;
  nb_adultes_habituel: NumberValue;
  nb_enfants_max: NumberValue;
  heure_arrivee_defaut: string;
  heure_depart_defaut: string;
  options_draps_par_lit: NumberValue;
  options_linge_toilette_par_personne: NumberValue;
  options_menage_forfait: NumberValue;
  options_depart_tardif_forfait: NumberValue;
  options_chiens_forfait: NumberValue;
  caution_montant_defaut: NumberValue;
  cheque_menage_montant_defaut: NumberValue;
  arrhes_taux_defaut: NumberValue;
  electricity_price_per_kwh: NumberValue;
  prix_nuit_basse_saison: NumberValue;
  prix_nuit_haute_saison: NumberValue;
  min_nuits_toute_annee: NumberValue;
  min_nuits_vacances_scolaires: NumberValue;
  min_nuits_juillet_aout: NumberValue;
  taxe_sejour_config?: TouristTaxSettings | null;
  public_is_published: boolean;
  public_slug: string;
  public_title: string;
  public_summary: string;
  public_description: string;
  public_web_info: {
    surface_m2: NumberValue;
    max_people: NumberValue;
    sleeping_capacity: NumberValue;
  };
};

export function giteFormCompletion(
  form: GiteCompletionForm,
  context: { photoCount: number; billingSiret?: string | null },
): GiteCompletionItem[] {
  const items: GiteCompletionItem[] = [];
  const add = (label: string, key: string, group: GiteCompletionSection) =>
    items.push({ label, target: `gite-${key}`, group });
  const required = (
    key: keyof GiteCompletionForm,
    label: string,
    group: GiteCompletionSection,
  ) => {
    if (!String(form[key] ?? "").trim()) add(label, key, group);
  };
  required("nom", "Renseigner le nom du gîte", "base-fiche");
  if (form.prefixe_contrat.trim().length < 2)
    add(
      "Renseigner un préfixe de contrat d’au moins 2 caractères",
      "prefixe_contrat",
      "base-fiche",
    );
  required("adresse_ligne1", "Renseigner l’adresse du gîte", "base-fiche");
  required(
    "date_debut_activite",
    "Renseigner la date de début d’activité",
    "base-fiche",
  );
  if (
    form.date_debut_activite &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(form.date_debut_activite) ||
      !Number.isFinite(new Date(form.date_debut_activite).getTime()) ||
      new Date(form.date_debut_activite).toISOString().slice(0, 10) !==
        form.date_debut_activite)
  )
    add(
      "Corriger la date de début d’activité",
      "date_debut_activite",
      "base-fiche",
    );
  if (!form.fiscal_establishment_id)
    add(
      "Choisir l’établissement facturant",
      "fiscal_establishment_id",
      "base-fiche",
    );
  else if (!context.billingSiret?.trim())
    add(
      "Renseigner le SIRET dans l’établissement facturant",
      "billing-siret",
      "base-fiche",
    );
  for (const [key, label] of [
    ["proprietaires_noms", "Renseigner les noms des propriétaires"],
    ["proprietaires_adresse", "Renseigner l’adresse des propriétaires"],
    ["telephones", "Renseigner un téléphone de contact"],
  ] as const)
    required(key, label, "gestion-contact");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    add(
      "Renseigner une adresse e-mail de contact valide",
      "email",
      "gestion-contact",
    );
  required("iban", "Renseigner l’IBAN", "gestion-finance");
  required(
    "titulaire",
    "Renseigner le titulaire du compte bancaire",
    "gestion-finance",
  );
  required(
    "caracteristiques",
    "Décrire les caractéristiques du gîte pour les documents",
    "sejour-regles",
  );

  const numericFields = [
    ["capacite_max", "la capacité maximale", 1, "base-fiche", true],
    ["nb_adultes_max", "le nombre maximal d’adultes", 1, "base-fiche", true],
    [
      "nb_adultes_habituel",
      "le nombre habituel d’adultes",
      1,
      "base-fiche",
      true,
    ],
    ["nb_enfants_max", "le nombre maximal d’enfants", 0, "base-fiche", true],
    [
      "electricity_price_per_kwh",
      "le prix de l’électricité",
      0,
      "gestion-finance",
    ],
    ["options_draps_par_lit", "le tarif des draps", 0, "sejour-services"],
    [
      "options_linge_toilette_par_personne",
      "le tarif du linge de toilette",
      0,
      "sejour-services",
    ],
    ["options_menage_forfait", "le forfait ménage", 0, "sejour-services"],
    [
      "options_depart_tardif_forfait",
      "le forfait de départ tardif",
      0,
      "sejour-services",
    ],
    [
      "options_chiens_forfait",
      "le tarif pour les chiens",
      0,
      "sejour-services",
    ],
    ["caution_montant_defaut", "la caution", 0, "sejour-tarifs"],
    ["cheque_menage_montant_defaut", "le chèque ménage", 0, "sejour-tarifs"],
    [
      "arrhes_taux_defaut",
      "le taux d’arrhes (de 0 à 100 %)",
      0,
      "sejour-tarifs",
    ],
    [
      "prix_nuit_basse_saison",
      "le prix par nuit en basse saison",
      0,
      "sejour-tarifs",
    ],
    [
      "prix_nuit_haute_saison",
      "le prix par nuit en haute saison",
      0,
      "sejour-tarifs",
    ],
    [
      "min_nuits_toute_annee",
      "le minimum de nuits toute l’année",
      1,
      "sejour-tarifs",
      true,
    ],
    [
      "min_nuits_vacances_scolaires",
      "le minimum de nuits pendant les vacances",
      1,
      "sejour-tarifs",
      true,
    ],
    [
      "min_nuits_juillet_aout",
      "le minimum de nuits en juillet et août",
      1,
      "sejour-tarifs",
      true,
    ],
  ] as const;
  for (const [key, label, min, group, integer] of numericFields) {
    const value = form[key];
    if (
      value === "" ||
      !Number.isFinite(value) ||
      value < min ||
      (integer && !Number.isInteger(value)) ||
      (key === "arrhes_taux_defaut" && value > 1)
    )
      add(`Vérifier ${label}`, key, group);
  }
  if (Number(form.nb_adultes_max) > Number(form.capacite_max))
    add(
      "Le nombre maximal d’adultes dépasse la capacité du gîte",
      "nb_adultes_max",
      "base-fiche",
    );
  if (Number(form.nb_adultes_habituel) > Number(form.nb_adultes_max))
    add(
      "Le nombre habituel d’adultes dépasse le maximum",
      "nb_adultes_habituel",
      "base-fiche",
    );
  for (const [key, label] of [
    ["heure_arrivee_defaut", "d’arrivée"],
    ["heure_depart_defaut", "de départ"],
  ] as const)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form[key]))
      add(`Renseigner l’heure ${label}`, key, "sejour-services");

  if (!form.taxe_sejour_config) {
    add("Configurer la taxe de séjour", "tax-configure", "gestion-finance");
  } else {
    const result = touristTaxSettingsSchema.safeParse(form.taxe_sejour_config);
    if (!result.success) {
      const labels: Record<string, string> = {
        stars: "Choisir le classement officiel du gîte",
        fixed_rate: "Vérifier le tarif fixe de taxe de séjour",
        percentage: "Vérifier le taux de taxe de séjour (1 à 5 %)",
        cap: "Renseigner un plafond de taxe de séjour positif",
        additional_percentage: "Vérifier les taxes additionnelles",
        accommodation_vat_rate: "Vérifier la TVA de l’hébergement",
        effective_from: "Renseigner la date d’application du barème",
        authority: "Vérifier le nom de la collectivité bénéficiaire",
      };
      for (const issue of result.error.issues) {
        const key = String(issue.path[0]);
        // The shared rule reports rate + cap on the rate path. If only the cap
        // is missing, guide directly to the cap instead of a valid rate.
        if (
          issue.code === "custom" &&
          key === "percentage" &&
          form.taxe_sejour_config.percentage >= 1 &&
          form.taxe_sejour_config.percentage <= 5 &&
          form.taxe_sejour_config.cap <= 0
        )
          continue;
        add(
          labels[key] ?? "Vérifier les réglages de taxe de séjour",
          `tax-${key}`,
          "gestion-finance",
        );
      }
      if (
        !form.taxe_sejour_config.classified &&
        form.taxe_sejour_config.cap <= 0
      )
        add(
          "Renseigner un plafond de taxe de séjour positif",
          "tax-cap",
          "gestion-finance",
        );
    }
    if (!form.taxe_sejour_config.authority.trim())
      add(
        "Renseigner la collectivité bénéficiaire de la taxe",
        "tax-authority",
        "gestion-finance",
      );
  }
  if (form.public_is_published) {
    for (const [key, label] of [
      ["public_slug", "Renseigner l’adresse publique du gîte (slug)"],
      ["public_title", "Renseigner le titre public"],
      ["public_summary", "Renseigner l’accroche courte"],
      ["public_description", "Renseigner la description publique"],
    ] as const)
      required(key, label, "web-presentation");
    if (
      form.public_slug &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.public_slug)
    )
      add(
        "Corriger le slug public (lettres minuscules, chiffres et tirets)",
        "public_slug",
        "web-presentation",
      );
    for (const [key, label] of [
      ["surface_m2", "la surface du gîte"],
      ["max_people", "le nombre de personnes maximum sur le site"],
      ["sleeping_capacity", "le nombre de couchages"],
    ] as const) {
      const value = form.public_web_info[key];
      if (value === "" || !Number.isInteger(value) || value < 1)
        add(
          `Renseigner ${label}`,
          `public_web_info-${key}`,
          "web-presentation",
        );
    }
    if (!context.photoCount)
      add(
        "Ajouter au moins une photo (après enregistrement du gîte)",
        "editor-photos",
        "web-photos",
      );
  }
  return items.filter(
    (item, index) =>
      items.findIndex((other) => other.target === item.target) === index,
  );
}

export function giteCompletionProgress(
  items: GiteCompletionItem[],
  published: boolean,
): number {
  return formCompletionProgress(items, [
    "base-fiche",
    "gestion-contact",
    "gestion-finance",
    "sejour-services",
    "sejour-tarifs",
    "sejour-regles",
    ...(published ? ["web-presentation", "web-photos"] : []),
  ]);
}
