import type { SchoolHoliday } from "./schoolHolidays";

export type Gestionnaire = {
  id: string;
  prenom: string;
  nom: string;
  gites_count?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type Gite = {
  id: string;
  ordre?: number;
  nom: string;
  prefixe_contrat: string;
  adresse_ligne1: string;
  adresse_ligne2?: string | null;
  public_slug?: string | null;
  public_title?: string | null;
  public_summary?: string | null;
  public_description?: string | null;
  public_technical_description?: string | null;
  public_seo_title?: string | null;
  public_seo_description?: string | null;
  public_is_published?: boolean;
  public_structured_content?: unknown;
  public_equipment?: unknown;
  public_rooms?: unknown;
  public_practical_info?: unknown;
  public_location_info?: unknown;
  public_web_info?: {
    surface_m2?: number | null;
    max_people?: number | null;
    sleeping_capacity?: number | null;
    fireplace?: boolean;
    private_garden?: boolean;
    private_courtyard?: boolean;
  } | null;
  public_latitude?: number | null;
  public_longitude?: number | null;
  capacite_max: number;
  nb_adultes_max: number;
  nb_adultes_habituel: number;
  nb_enfants_max: number;
  proprietaires_noms: string;
  proprietaires_adresse: string;
  site_web?: string | null;
  email?: string | null;
  airbnb_listing_id?: string | null;
  telephones: string[];
  taxe_sejour_par_personne_par_nuit: number;
  iban: string;
  bic?: string | null;
  titulaire: string;
  regle_animaux_acceptes: boolean;
  regle_bois_premiere_flambee: boolean;
  regle_tiers_personnes_info: boolean;
  options_draps_par_lit: number;
  options_linge_toilette_par_personne: number;
  options_menage_forfait: number;
  options_depart_tardif_forfait: number;
  options_chiens_forfait: number;
  heure_arrivee_defaut: string;
  heure_depart_defaut: string;
  caution_montant_defaut: number;
  cheque_menage_montant_defaut: number;
  arrhes_taux_defaut: number;
  electricity_price_per_kwh: number;
  frais_gestion?: {
    version?: number;
    categories?: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    expenses?: Array<{
      id: string;
      label: string;
      category_id: string;
      monthly_amount: number;
      annual_amount: number;
      notes?: string;
    }>;
  } | null;
  prix_nuit_basse_saison?: number;
  prix_nuit_haute_saison?: number;
  min_nuits_toute_annee?: number;
  min_nuits_vacances_scolaires?: number;
  min_nuits_juillet_aout?: number;
  prix_nuit_liste?: number[];
  caracteristiques?: string | null;
  gestionnaire_id?: string | null;
  date_debut_activite?: string | null;
  gestionnaire?: Pick<Gestionnaire, "id" | "prenom" | "nom"> | null;
  photos?: GitePhoto[];
  contrats_count?: number;
  factures_count?: number;
  reservations_count?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type GitePhoto = {
  id: string;
  gite_id: string;
  url: string;
  title?: string | null;
  alt?: string | null;
  credit?: string | null;
  is_primary: boolean;
  is_public: boolean;
  ordre: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PlanningRelayPeriod = {
  id: string;
  label: string;
  from: string;
  to: string;
  gite_ids: string[];
  show_timeline: boolean;
  show_comments: boolean;
  show_phones: boolean;
  is_active: boolean;
  expires_at: string | null;
  last_accessed_at: string | null;
  sms_enabled: boolean;
  sms_recipient: string | null;
  sms_worker_id: string | null;
  sms_worker: PlanningRelayWorker | null;
  sms_send_time: string;
  sms_send_day: "previous_day" | "same_day";
  sms_last_sent_for_date: string | null;
  sms_last_attempt_for_date: string | null;
  assignments: PlanningRelayAssignment[];
  created_at: string;
  updated_at: string;
  public_path: string;
};

export type PlanningRelayWorker = {
  id: string;
  nom: string;
  telephone: string;
  email: string | null;
  adresse: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PlanningRelayAssignment = {
  id: string;
  period_id: string;
  date: string;
  gite_id: string;
  worker_id: string;
  worker: PlanningRelayWorker | null;
  created_at: string;
  updated_at: string;
};

export type PlanningRelaySmsStatus = {
  configured: boolean;
  missing: string[];
};

export type PlanningRelaySmsSendResult = {
  ok: boolean;
  provider: "ovh";
  recipient: string;
  credits: number | null;
  ids: number[];
  invalid_receivers: string[];
  valid_receivers: string[];
};

export type PlanningRelaySmsTestResult = PlanningRelaySmsSendResult & {
  target_date: string;
  message: string;
};

export type PublicPlanningRelayResponse = {
  period: Pick<
    PlanningRelayPeriod,
    "label" | "from" | "to" | "show_timeline" | "show_comments" | "show_phones" | "expires_at"
  >;
  assignments: PlanningRelayAssignment[];
  gites: Gite[];
  reservations: Reservation[];
  generated_at: string;
};

export type IcalSource = {
  id: string;
  gite_id: string;
  type: string;
  url: string;
  include_summary?: string | null;
  exclude_summary?: string | null;
  is_active: boolean;
  ordre: number;
  createdAt?: string;
  updatedAt?: string;
  gite?: Pick<Gite, "id" | "nom" | "prefixe_contrat" | "ordre">;
};

export type ReservationPlaceholder = {
  id: string;
  abbreviation: string;
  label?: string | null;
  reservations_count: number;
};

export type ReservationMonthlyEnergySummary = {
  gite_id: string;
  year: number;
  month: number;
  status: "complete" | "incomplete";
  total_kwh: number | null;
  total_cost_eur: number | null;
  live_total_kwh: number | null;
  live_total_cost_eur: number | null;
  live_recorded_at: string | null;
  live_device_count: number;
  device_count: number;
  complete_device_count: number;
  missing_opening_count: number;
  missing_closing_count: number;
  invalid_device_count: number;
  is_partial_month: boolean;
};

export type ReservationLinkedContract = {
  id: string;
  numero_contrat: string;
  heure_arrivee?: string | null;
  heure_depart?: string | null;
  statut_paiement_arrhes: "non_recu" | "recu";
  statut_paiement_solde: "non_regle" | "regle";
  solde_montant: number;
};

export type Reservation = {
  id: string;
  gite_id?: string | null;
  stay_group_id?: string | null;
  placeholder_id?: string | null;
  origin_system?: "app" | "what-today" | "ical" | "pump" | "har" | "csv" | "legacy" | "booked" | null;
  origin_reference?: string | null;
  export_to_ical?: boolean;
  airbnb_url?: string | null;
  hote_nom: string;
  telephone?: string | null;
  email?: string | null;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  nb_adultes: number;
  nb_enfants_2_17: number;
  prix_par_nuit: number;
  prix_total: number;
  source_paiement?: string | null;
  commentaire?: string | null;
  remise_montant: number;
  commission_channel_mode?: "euro" | "percent" | null;
  commission_channel_value: number;
  frais_optionnels_montant: number;
  frais_optionnels_libelle?: string | null;
  frais_optionnels_declares: boolean;
  energy_consumption_kwh: number;
  energy_cost_eur: number;
  energy_price_per_kwh?: number | null;
  energy_live_consumption_kwh?: number;
  energy_live_cost_eur?: number;
  energy_live_price_per_kwh?: number | null;
  energy_live_recorded_at?: string | null;
  energy_tracking?: Array<{
    session_id: string;
    device_id: string;
    device_name: string;
    status: "open" | "closed";
    started_at: string;
    ended_at?: string | null;
    started_total_kwh: number;
    ended_total_kwh?: number | null;
    total_kwh?: number | null;
    total_cost_eur?: number | null;
    stay_total_kwh?: number | null;
    stay_total_cost_eur?: number | null;
    allocation_ratio: number;
    started_by_rule_id?: string | null;
    ended_by_rule_id?: string | null;
  }>;
  options?: ContratOptions;
  createdAt?: string;
  updatedAt?: string;
  gite?: Pick<Gite, "id" | "nom" | "prefixe_contrat" | "ordre"> &
    Partial<Pick<Gite, "heure_arrivee_defaut" | "heure_depart_defaut">>;
  placeholder?: Pick<ReservationPlaceholder, "id" | "abbreviation" | "label">;
  linked_contract?: ReservationLinkedContract | null;
};

export type SeasonRate = {
  id: string;
  gite_id: string;
  date_debut: string;
  date_fin: string;
  prix_par_nuit: number;
  min_nuits: number;
  ordre: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SeasonRateEditorPayloadSegment = {
  date_debut: string;
  date_fin: string;
  min_nuits: number;
  min_nuits_by_gite?: Record<string, number>;
  prices_by_gite: Record<string, number>;
};

export type SeasonRateEditorPayload = {
  from: string;
  to: string;
  zone?: string;
  segments: SeasonRateEditorPayloadSegment[];
};

export type SeasonRateEditorResponse = {
  from: string;
  to: string;
  zone: string;
  holidays: SchoolHoliday[];
  gites: Array<
    Pick<
      Gite,
      | "id"
      | "nom"
      | "ordre"
      | "prefixe_contrat"
      | "prix_nuit_liste"
      | "prix_nuit_basse_saison"
      | "prix_nuit_haute_saison"
      | "min_nuits_toute_annee"
      | "min_nuits_vacances_scolaires"
      | "min_nuits_juillet_aout"
    >
  >;
  rates_by_gite: Record<string, SeasonRate[]>;
};

export type BookingQuote = {
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  required_min_nights: number;
  nightly_breakdown: Array<{
    date: string;
    prix_par_nuit: number;
    min_nuits: number;
    season_rate_id: string;
  }>;
  montant_hebergement: number;
  total_options: number;
  taxe_sejour: number;
  total_global: number;
  arrhes_theoriques: number;
  options_detail: {
    draps: number;
    linge: number;
    menage: number;
    depart_tardif: number;
    chiens: number;
  };
};

export type BookingRequestStatus = "pending" | "approved" | "rejected" | "expired";

export type BookingRequest = {
  id: string;
  gite_id: string;
  approved_reservation_id?: string | null;
  hote_nom: string;
  telephone?: string | null;
  email?: string | null;
  date_entree: string;
  date_sortie: string;
  nb_nuits: number;
  nb_adultes: number;
  nb_enfants_2_17: number;
  options: ContratOptions;
  message_client?: string | null;
  pricing_snapshot: BookingQuote;
  status: BookingRequestStatus;
  hold_expires_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
  createdAt?: string;
  updatedAt?: string;
  gite?: Pick<Gite, "id" | "nom" | "email">;
  approved_reservation?: Pick<Reservation, "id" | "hote_nom" | "date_entree" | "date_sortie"> | null;
};

export type ContratOptions = {
  draps?: { enabled: boolean; nb_lits?: number; prix_unitaire?: number; offert?: boolean; declared?: boolean };
  linge_toilette?: { enabled: boolean; nb_personnes?: number; offert?: boolean; declared?: boolean };
  menage?: { enabled: boolean; offert?: boolean; declared?: boolean };
  depart_tardif?: { enabled: boolean; prix_forfait?: number; offert?: boolean; declared?: boolean };
  chiens?: { enabled: boolean; nb?: number; prix_unitaire?: number; offert?: boolean; declared?: boolean };
  regle_animaux_acceptes?: boolean;
  regle_bois_premiere_flambee?: boolean;
  regle_tiers_personnes_info?: boolean;
};

export type InvoiceExtraFee = {
  libelle: string;
  montant: number;
};

export type Contrat = {
  id: string;
  numero_contrat: string;
  gite_id: string;
  date_creation: string;
  date_derniere_modif: string;
  locataire_nom: string;
  locataire_adresse: string;
  locataire_tel: string;
  locataire_email?: string | null;
  nb_adultes: number;
  nb_enfants_2_17: number;
  date_debut: string;
  heure_arrivee: string;
  date_fin: string;
  heure_depart: string;
  nb_nuits: number;
  prix_par_nuit: number;
  remise_montant: number;
  taxe_sejour_calculee?: number;
  options: ContratOptions;
  arrhes_montant: number;
  arrhes_date_limite: string;
  solde_montant: number;
  caution_montant: number;
  cheque_menage_montant: number;
  afficher_caution_phrase: boolean;
  afficher_cheque_menage_phrase: boolean;
  clauses: Record<string, unknown>;
  pdf_path: string;
  pdf_sent_path?: string | null;
  signed_document_path?: string | null;
  signed_document_filename?: string | null;
  signed_document_mime_type?: string | null;
  signed_document_size?: number | null;
  signed_document_uploaded_at?: string | null;
  date_envoi_email?: string | null;
  statut_reception_contrat: "non_recu" | "recu";
  date_reception_contrat?: string | null;
  statut_paiement_arrhes: "non_recu" | "recu";
  date_paiement_arrhes?: string | null;
  statut_paiement_solde: "non_regle" | "regle";
  mode_paiement_arrhes?: "Chèque" | "Virement" | "Espèces" | "A définir" | null;
  notes?: string | null;
  commentaire_interne?: string | null;
  reservation_id?: string | null;
  gite?: Gite;
};

export type Facture = {
  id: string;
  numero_facture: string;
  gite_id: string;
  date_creation: string;
  date_derniere_modif: string;
  locataire_nom: string;
  locataire_adresse: string;
  locataire_tel: string;
  locataire_email?: string | null;
  nb_adultes: number;
  nb_enfants_2_17: number;
  date_debut: string;
  heure_arrivee: string;
  date_fin: string;
  heure_depart: string;
  nb_nuits: number;
  prix_par_nuit: number;
  remise_montant: number;
  frais_supplementaires: InvoiceExtraFee[];
  taxe_sejour_calculee?: number;
  options: ContratOptions;
  arrhes_montant: number;
  arrhes_date_limite: string;
  solde_montant: number;
  caution_montant: number;
  cheque_menage_montant: number;
  afficher_caution_phrase: boolean;
  afficher_cheque_menage_phrase: boolean;
  clauses: Record<string, unknown>;
  pdf_path: string;
  date_envoi_email?: string | null;
  statut_paiement: "non_reglee" | "reglee";
  notes?: string | null;
  reservation_id?: string | null;
  gite?: Gite;
};
