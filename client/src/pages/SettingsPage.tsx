import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { apiFetch, buildApiUrl } from "../utils/api";
import { getGiteColor } from "../utils/giteColors";
import {
  type ServerAuthSession,
  type ServerSecuritySaveResult,
  type ServerSecuritySettings,
} from "../utils/auth";
import { formatEuro } from "../utils/format";
import { dispatchRecentImportedReservationsCreated } from "../utils/recentImportsBadge";
import {
  DEFAULT_PAYMENT_SOURCE_COLORS,
  buildPaymentColorMap,
  getPaymentColor,
  normalizePaymentHexColor,
  normalizePaymentLabel,
} from "../utils/paymentColors";
import type { Gestionnaire, Gite, IcalSource } from "../utils/types";

type IcalPreviewItem = {
  id: string;
  gite_nom: string;
  source_type: string;
  final_source: string;
  summary: string;
  date_entree: string;
  date_sortie: string;
  status: "new" | "existing" | "existing_updatable" | "conflict";
  update_fields: string[];
};

type IcalPreviewResult = {
  fetched_sources: number;
  parsed_events: number;
  errors: Array<{
    source_id: string;
    gite_nom: string;
    url: string;
    message: string;
  }>;
  reservations: IcalPreviewItem[];
  counts: {
    new: number;
    existing: number;
    existing_updatable: number;
    conflict: number;
  };
};

type IcalSyncResult = IcalPreviewResult & {
  created_count: number;
  updated_count: number;
  deleted_count?: number;
  skipped_count: number;
  to_verify_marked_count?: number;
  to_verify_cleared_count?: number;
  pump_follow_up?: {
    source: "pump-ical-follow-up";
    status: "success" | "error";
    message: string;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    reservation_count: number;
    updated_at: string | null;
    session_id: string | null;
  };
  per_gite?: Record<
    string,
    { inserted: number; updated: number; skipped: number }
  >;
  inserted_items?: Array<{
    giteName: string;
    giteId: string;
    checkIn: string;
    checkOut: string;
    source: string;
  }>;
};

type IcalCronState = {
  config: {
    enabled: boolean;
    auto_sync_on_app_load: boolean;
    auto_run_pump_for_new_airbnb_ical: boolean;
  };
  scheduler: "external";
  running: boolean;
  last_run_at: string | null;
  last_success_at?: string | null;
  last_status?: "idle" | "running" | "success" | "error";
  last_error?: string | null;
  last_result: IcalSyncResult | null;
};

type IcalCronConfig = IcalCronState["config"];

type ImportLogEntry = {
  id: string;
  at: string;
  source: string;
  status?: "success" | "error";
  errorMessage?: string | null;
  selectionCount: number;
  inserted: number;
  updated: number;
  skipped?: {
    duplicate?: number;
    invalid?: number;
    outsideYear?: number;
    unknown?: number;
  };
  perGite?: Record<
    string,
    { inserted?: number; updated?: number; skipped?: number }
  >;
  insertedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
  }>;
  updatedItems?: Array<{
    giteName?: string;
    giteId?: string;
    checkIn?: string;
    checkOut?: string;
    source?: string;
    updatedFields?: string[];
  }>;
};

type ImportPreviewItem = {
  id: string;
  listing_id: string;
  gite_id: string | null;
  gite_nom: string | null;
  source_type: string;
  status:
    | "new"
    | "existing"
    | "existing_updatable"
    | "conflict"
    | "unmapped_listing";
  check_in: string;
  check_out: string;
  nights: number;
  hote_nom: string | null;
  prix_total: number | null;
  commentaire: string | null;
  update_fields: string[];
};

type ImportPreviewResult = {
  reservations: ImportPreviewItem[];
  counts: {
    new: number;
    existing: number;
    existing_updatable: number;
    conflict: number;
    unmapped_listing: number;
  };
};

type PumpStatusResult = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount?: number;
  errors?: Array<{ message?: string | null }>;
  results?: Record<string, unknown> | null;
};

type PumpPreviewResult = ImportPreviewResult & {
  pump?: {
    session_id: string | null;
    status: string;
    updated_at: string | null;
    reservation_count: number;
  };
};

type PumpImportResult = PumpPreviewResult & {
  selected_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
};

type PumpCronConfig = {
  enabled: boolean;
  interval_days: number;
  hour: number;
  minute: number;
  run_on_start: boolean;
};

type PumpCronState = {
  config: PumpCronConfig;
  scheduler: "internal" | "external";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: PumpImportResult | null;
  last_error: string | null;
};

type PumpAutomationFilterRule = {
  type: string;
  pattern?: string;
  negate?: boolean;
};

type PumpAutomationConfig = {
  baseUrl: string;
  username: string;
  authMode: "persisted-only" | "legacy-auto-login";
  hasOTP: boolean;
  persistSession: boolean;
  manualScrollMode: boolean;
  manualScrollDuration: number;
  scrollSelector: string;
  scrollCount: number;
  scrollDistance: number;
  scrollDelay: number;
  waitBeforeScroll: number;
  outputFolder: string;
  filterRules: {
    inclusive: PumpAutomationFilterRule[];
    exclusive: PumpAutomationFilterRule[];
  };
  loginStrategy: "simple" | "multi-step";
  advancedSelectors: {
    usernameInput: string;
    passwordInput: string;
    submitButton: string;
    emailFirstButton: string;
    continueAfterUsernameButton: string;
    finalSubmitButton: string;
    accountChooserContinueButton: string;
    calendarSourceCard: string;
    calendarSourceEditButton: string;
    calendarSourceRefreshButton: string;
    calendarSourceUrlField: string;
    calendarSourceCloseButton: string;
  };
};

type PumpConfigSaveResult = {
  config: PumpAutomationConfig;
};

type PumpSessionImportResult = {
  success: boolean;
  storageStateId: string;
  filename: string;
  relativePath: string;
};

type PumpSessionExportResult = PumpSessionImportResult & {
  storageState: unknown;
};

type PumpHealthResult = {
  status:
    | "connected"
    | "stale"
    | "auth_required"
    | "refresh_failed"
    | "disabled";
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  summary: string;
  recommendedAction: string | null;
  sessionFileExists: boolean;
  sessionFileUpdatedAt: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  latestSessionStatus: string | null;
  lastSuccessfulRefreshAt: string | null;
  latestError: string | null;
  cronEnabled: boolean;
  cronScheduler: "internal" | "external";
  staleAfterHours: number;
};

type PumpSessionCaptureResult = {
  captureId: string;
  status:
    | "idle"
    | "starting"
    | "waiting_for_login"
    | "saving"
    | "saved"
    | "failed"
    | "cancelled"
    | "timed_out";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message: string;
  error: string | null;
  currentUrl: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  active: boolean;
  available: boolean;
};

type PumpSessionRenewalResult = {
  renewalId: string;
  status:
    | "idle"
    | "starting"
    | "awaiting_sms_code"
    | "submitting_sms_code"
    | "saving"
    | "saved"
    | "failed"
    | "cancelled"
    | "timed_out";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message: string;
  error: string | null;
  currentUrl: string | null;
  storageStateId: string | null;
  storageStateRelativePath: string | null;
  maskedDestination: string | null;
  diagnosticsRelativePath: string | null;
  active: boolean;
  available: boolean;
};

const SETTINGS_SECTIONS = [
  { id: "settings-import-log", label: "Journal des imports" },
  { id: "settings-sms", label: "SMS" },
  { id: "settings-email-texts", label: "Emails" },
  { id: "settings-daily-reservation-email", label: "Email quotidien" },
  { id: "settings-smartlife", label: "Smart Life" },
  { id: "settings-declaration-nights", label: "Nuitées à déclarer" },
  { id: "settings-source-colors", label: "Couleurs des sources" },
  { id: "settings-team", label: "Équipe" },
  { id: "settings-ical-sources", label: "Sources iCal" },
  { id: "settings-ical-exports", label: "Exports iCal OTA" },
  { id: "settings-ical-sync", label: "Synchronisation iCal" },
  { id: "settings-imports", label: "Pump" },
  { id: "settings-security", label: "Sécurité" },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

type PumpConnectionTestResult = {
  success: boolean;
  result?: {
    success?: boolean;
    method?: string;
  };
};

type PumpScrollTargetTestResult = {
  success: boolean;
  result?: {
    selector?: string | null;
    relation?: string;
    isHorizontallyScrollable?: boolean;
  };
};

type IcalSourceDraft = {
  gite_id: string;
  type: string;
  url: string;
  include_summary: string;
  exclude_summary: string;
  is_active: boolean;
};

type IcalSourcesExportPayload = {
  version?: number;
  exported_at?: string;
  sources: unknown[];
};

type IcalSourcesImportResult = {
  created_count: number;
  updated_count: number;
};

type IcalSourcesImportPreviewUnknownExample = {
  source_id: string | null;
  type: string | null;
  url: string | null;
};

type IcalSourcesImportPreviewUnknown = {
  source_gite_id: string;
  count: number;
  sample_type: string | null;
  sample_url: string | null;
  sample_source_id?: string | null;
  sample_gite_nom?: string | null;
  sample_gite_prefixe?: string | null;
  sample_types?: string[];
  sample_hosts?: string[];
  examples?: IcalSourcesImportPreviewUnknownExample[];
  mapped_to: string | null;
};

type IcalSourcesImportPreviewResult = {
  total_count: number;
  ready_count: number;
  unresolved_count: number;
  unknown_gites: IcalSourcesImportPreviewUnknown[];
  mapping_errors: Array<{
    source_gite_id: string;
    mapped_to: string;
    message: string;
  }>;
  can_import: boolean;
};

type IcalCronExportPayload = {
  version?: number;
  exported_at?: string;
  config: IcalCronConfig;
};

type PumpConfigExportPayload = {
  version?: number;
  exported_at?: string;
  config: PumpAutomationConfig;
};

type DeclarationNightsSettings = {
  excluded_sources: string[];
  available_sources: string[];
};

type SourceColorSettings = {
  colors: Record<string, string>;
  available_sources: string[];
};

type SmsTextItem = {
  id: string;
  title: string;
  text: string;
};

type SmsTextSettings = {
  texts: SmsTextItem[];
};

type DocumentEmailTextTemplate = {
  subject: string;
  body: string;
};

type DocumentEmailTextSettings = {
  contrat: DocumentEmailTextTemplate & {
    activitiesList: string;
    guideUrl: string;
    destinationUrl: string;
  };
  facture: DocumentEmailTextTemplate;
};

type DailyReservationEmailConfig = {
  enabled: boolean;
  recipients: DailyReservationEmailRecipientConfig[];
  hour: number;
  minute: number;
};

type DailyReservationEmailRecipientConfig = {
  email: string;
  enabled: boolean;
  send_if_empty: boolean;
};

type DailyReservationEmailGiteTotal = {
  gite_id: string | null;
  gite_nom: string;
  total_amount: number;
  reservations_count: number;
};

type DailyReservationEmailRunSummary = {
  slot_at: string;
  window_start_at: string;
  window_end_at: string;
  new_reservations_count: number;
  email_sent: boolean;
  skipped_reason:
    | "disabled"
    | "already-ran-for-slot"
    | "no-new-reservations"
    | null;
  recipients_count: number;
  total_amount: number;
  total_reservations_count: number;
  totals_by_gite: DailyReservationEmailGiteTotal[];
};

type DailyReservationEmailState = {
  config: DailyReservationEmailConfig;
  scheduler: "internal";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_email_sent_at: string | null;
  last_status: "idle" | "running" | "success" | "skipped" | "error";
  last_error: string | null;
  last_result: DailyReservationEmailRunSummary | null;
  smtp_configured: boolean;
  smtp_issues: string[];
};

type DailyReservationEmailRunResponse = {
  ok: boolean;
  state: DailyReservationEmailState;
  summary: DailyReservationEmailRunSummary;
};

type SmartlifeRegion = "eu" | "eu-west" | "us" | "us-e" | "in" | "cn";

type SmartlifeDeviceFunction = {
  code: string;
  name: string;
  desc: string;
  type: string;
  values: string;
  is_primary_switch: boolean;
  unit: string | null;
  scale: number | null;
};

type SmartlifeDeviceStatusEntry = {
  code: string;
  value: string | boolean | number | null;
};

type SmartlifeDevice = {
  id: string;
  name: string;
  product_name: string | null;
  category: string;
  online: boolean;
  functions: SmartlifeDeviceFunction[];
  status: SmartlifeDeviceStatusEntry[];
  supports_energy_total?: boolean;
  energy_total_source_code?: string | null;
  energy_total_scale?: number | null;
  energy_total_kwh?: number | null;
  supports_total_ele: boolean;
  total_ele_scale: number | null;
  total_ele_kwh: number | null;
};

type SmartlifeEnergyDeviceRole = "primary" | "informational";

type SmartlifeEnergyDeviceAssignment = {
  id: string;
  enabled: boolean;
  gite_id: string;
  device_id: string;
  device_name: string;
  role: SmartlifeEnergyDeviceRole;
};

type SmartlifeAutomationRuleAction = "device-on" | "device-off";

type SmartlifeAutomationRule = {
  id: string;
  enabled: boolean;
  label: string;
  gite_ids: string[];
  trigger:
    | "before-arrival"
    | "after-arrival"
    | "before-departure"
    | "after-departure";
  offset_minutes: number;
  action: SmartlifeAutomationRuleAction;
  device_id: string;
  device_name: string;
  command_code: string;
  command_label: string | null;
  command_value: boolean;
};

type SmartlifeAutomationConfig = {
  enabled: boolean;
  region: SmartlifeRegion;
  access_id: string;
  access_secret: string;
  rules: SmartlifeAutomationRule[];
  energy_devices: SmartlifeEnergyDeviceAssignment[];
};

type SmartlifeAutomationRunItem = {
  key: string;
  reservation_id: string;
  gite_id: string | null;
  gite_nom: string;
  reservation_label: string;
  rule_id: string;
  rule_label: string;
  device_id: string;
  device_name: string;
  action: SmartlifeAutomationRuleAction;
  command_code: string;
  command_value: boolean;
  trigger:
    | "before-arrival"
    | "after-arrival"
    | "before-departure"
    | "after-departure";
  scheduled_at: string;
  executed_at: string | null;
  previous_executed_at: string | null;
  status: "executed" | "skipped" | "error";
  message: string | null;
};

type SmartlifeAutomationRunSummary = {
  checked_at: string;
  scanned_rules_count: number;
  scanned_reservations_count: number;
  due_events_count: number;
  executed_count: number;
  skipped_count: number;
  error_count: number;
  note: string | null;
  items: SmartlifeAutomationRunItem[];
};

type SmartlifeAutomationState = {
  config: SmartlifeAutomationConfig;
  scheduler: "internal" | "external";
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: "idle" | "running" | "success" | "partial" | "skipped" | "error";
  last_error: string | null;
  last_result: SmartlifeAutomationRunSummary | null;
  credentials_configured: boolean;
};

type SmartlifeDevicesResponse = {
  devices: SmartlifeDevice[];
};

type SmartlifeAutomationRunResponse = {
  ok: boolean;
  state: SmartlifeAutomationState;
  summary: SmartlifeAutomationRunSummary;
};

type SmartlifeRuleSaveState = "idle" | "saving" | "saved" | "error";

type SmartlifeRuleExportGiteRef = {
  id: string;
  nom: string;
  prefixe_contrat: string;
};

type SmartlifeRulesImportExportRule = SmartlifeAutomationRule & {
  gites?: SmartlifeRuleExportGiteRef[];
};

type SmartlifeRulesImportExportPayload = {
  version: 1 | 2;
  exported_at: string;
  rules: SmartlifeRulesImportExportRule[];
};

type SettingsPageProps = {
  onAuthSessionUpdated?: (session: ServerAuthSession) => void;
};

const SaveSpinnerIcon = () => (
  <svg
    className="calendar-quick-create-sheet__submit-icon calendar-quick-create-sheet__submit-icon--spinner"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx="12"
      cy="12"
      r="8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      opacity="0.28"
    />
    <path
      d="M12 4a8 8 0 0 1 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

const SaveCheckIcon = () => (
  <svg
    className="calendar-quick-create-sheet__submit-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="m7.5 12.5 3 3 6-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type IcalExportFeed = {
  id: string;
  nom: string;
  prefixe_contrat: string;
  ordre: number;
  ical_export_token: string | null;
  reservations_count: number;
  exported_reservations_count: number;
};

const DEFAULT_SOURCE_DRAFT: IcalSourceDraft = {
  gite_id: "",
  type: "Airbnb",
  url: "",
  include_summary: "",
  exclude_summary: "",
  is_active: true,
};

const DEFAULT_DECLARATION_NIGHTS_SETTINGS: DeclarationNightsSettings = {
  excluded_sources: ["Airbnb"],
  available_sources: ["Airbnb"],
};

const DEFAULT_SOURCE_COLOR_SETTINGS: SourceColorSettings = {
  colors: { ...DEFAULT_PAYMENT_SOURCE_COLORS },
  available_sources: Object.keys(DEFAULT_PAYMENT_SOURCE_COLORS),
};

const DEFAULT_SMS_TEXT_SETTINGS: SmsTextSettings = {
  texts: [
    {
      id: "bedding-cleaning",
      title: "Draps/ménage",
      text: "Comme indiqué, je vous laisse prendre vos draps, serviettes et faire le ménage avant de partir.",
    },
    {
      id: "bedding-option",
      title: "Option Draps/Serviettes",
      text: "Vous pourrez prendre l'option draps à 15€ par lit si vous ne souhaitez pas emporter votre linge.",
    },
  ],
};

const DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS: DocumentEmailTextSettings = {
  contrat: {
    subject: "Contrat {{giteName}} {{documentNumber}}",
    body: [
      "{{greeting}}",
      "",
      "Suite à votre appel, veuillez trouver {{documentDeliveryIntroContract}} le contrat de location pour votre séjour de {{stayDuration}} {{giteReference}}, du {{dateDebutLong}}, à partir de {{heureArrivee}} au {{dateFinLong}}, {{heureDepart}}.",
      "",
      "{{documentDeliveryLabel}}",
      "{{documentDeliveryValue}}",
      "",
      "{{arrhesInstruction}}",
      "",
      "Si vous voulez des idées d'activités pour votre escapade mauronnaise, voici ce que je peux vous conseiller :",
      "",
      "{{activitiesList}}",
      "",
      "Vous trouverez de bonnes indications sur ces sites :",
      "{{guideUrl}}",
      "{{destinationUrl}}",
      "",
      "N'hésitez pas à revenir vers nous si vous avez des questions pour l'organisation de votre rencontre.",
      "",
      "Si toutefois vous ne voulez pas donner suite à cette location, merci de nous en informer rapidement pour que nous puissions débloquer les dates sur le calendrier et les proposer à d'autres locataires.",
      "",
      "Je vous souhaite une bonne journée.",
      "",
      "Bien à vous,",
      "Soazig",
      "",
      "www.gites-broceliande.com",
      "Soazig et Sébastien Jacqmin",
      "T : (0033) 6 98 99 37 35",
    ].join("\n"),
    activitiesList: [
      "Les calèches de Brocéliande. Ils proposent des balades en forêt.\nhttps://broceliande.guide/Les-Caleches-de-Barenton",
      "Les balades contées avec les guides conteurs de Brocéliande.\nhttps://guidesdebroceliande.com/",
      "Le Château de Comper, avec le Centre de l'Imaginaire Arthurien.",
      "La Porte des Secrets à Paimpont.",
      "En balades : la fontaine de Barenton, le Val sans Retour, le lac au Duc et l'étang de Trémelin.",
    ].join("\n\n"),
    guideUrl: "https://broceliande.guide/Secrets-de-Broceliande",
    destinationUrl: "https://destination-broceliande.com/",
  },
  facture: {
    subject: "Facture {{giteName}} {{documentNumber}}",
    body: [
      "{{greeting}}",
      "",
      "{{documentDeliveryIntroSentence}}",
      "En espérant que vous avez passé un agréable séjour{{giteSentence}}",
      "",
      "{{documentDeliveryLabel}}",
      "{{documentDeliveryValue}}",
      "",
      "A bientôt,",
      "",
      "Sébastien et Soazig",
      "Les Gites de Brocéliande",
    ].join("\n"),
  },
};

const DEFAULT_DAILY_RESERVATION_EMAIL_CONFIG: DailyReservationEmailConfig = {
  enabled: false,
  recipients: [],
  hour: 7,
  minute: 0,
};

const DEFAULT_DAILY_RESERVATION_EMAIL_STATE: DailyReservationEmailState = {
  config: DEFAULT_DAILY_RESERVATION_EMAIL_CONFIG,
  scheduler: "internal",
  running: false,
  next_run_at: null,
  last_run_at: null,
  last_success_at: null,
  last_email_sent_at: null,
  last_status: "idle",
  last_error: null,
  last_result: null,
  smtp_configured: false,
  smtp_issues: [],
};

const DEFAULT_SMARTLIFE_RULE = (giteId = ""): SmartlifeAutomationRule => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `smartlife-rule-${Math.random().toString(36).slice(2, 10)}`,
  enabled: true,
  label: "",
  gite_ids: giteId ? [giteId] : [],
  trigger: "before-arrival",
  offset_minutes: 60,
  action: "device-on",
  device_id: "",
  device_name: "",
  command_code: "",
  command_label: null,
  command_value: true,
});

const DEFAULT_SMARTLIFE_CONFIG: SmartlifeAutomationConfig = {
  enabled: false,
  region: "eu",
  access_id: "",
  access_secret: "",
  rules: [],
  energy_devices: [],
};

const DEFAULT_SMARTLIFE_STATE: SmartlifeAutomationState = {
  config: DEFAULT_SMARTLIFE_CONFIG,
  scheduler: "internal",
  running: false,
  next_run_at: null,
  last_run_at: null,
  last_success_at: null,
  last_status: "idle",
  last_error: null,
  last_result: null,
  credentials_configured: false,
};

const DEFAULT_SERVER_SECURITY_SETTINGS: ServerSecuritySettings = {
  enabled: false,
  passwordConfigured: false,
  sessionDurationHours: 24 * 7,
  sessionExpiresAt: null,
};

const IMPORT_LOG_FETCH_COUNT = 20;
const IMPORT_LOG_VISIBLE_COUNT = 5;
const IMPORT_LOG_VISIBLE_STEP = 5;
const IMPORT_LOG_EVENT_VISIBLE_COUNT = 2;
const SMARTLIFE_LOG_VISIBLE_COUNT = 5;
const SMARTLIFE_LOG_VISIBLE_STEP = 5;

const formatIsoDateFr = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR");
};

const formatDateFr = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR");
};

const formatTimeFr = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatIsoDateTimeFr = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("fr-FR");
};

const formatImportSource = (source: string | null | undefined) => {
  const normalized = String(source ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "ical-manual") return "ICAL manuel";
  if (normalized === "ical-cron") return "ICAL cron";
  if (normalized === "ical-startup") return "ICAL démarrage";
  if (normalized === "pump") return "Pump";
  if (normalized === "pump-cron") return "Pump cron";
  if (normalized === "pump-ical-follow-up") return "Pump après iCal";
  if (normalized === "pump-refresh") return "Pump refresh";
  return source || "Import";
};

const createDailyReservationRecipientDraft =
  (): DailyReservationEmailRecipientConfig => ({
    email: "",
    enabled: true,
    send_if_empty: false,
  });

const isSmartlifeDeviceCommandAction = (
  action: SmartlifeAutomationRuleAction,
) => action === "device-on" || action === "device-off";

const getSmartlifeActionCommandValue = (
  action: SmartlifeAutomationRuleAction,
) => action === "device-on";

const createSmartlifeRuleDraft = (giteId = "") => DEFAULT_SMARTLIFE_RULE(giteId);

const createSmartlifeRuleFromDevice = (
  device: SmartlifeDevice,
  giteId = "",
): SmartlifeAutomationRule => {
  const preferredCommand = getPreferredSmartlifeCommand(device);
  return {
    ...createSmartlifeRuleDraft(giteId),
    label: device.name,
    action: "device-on",
    device_id: device.id,
    device_name: device.name,
    command_code: preferredCommand?.code ?? "",
    command_label: preferredCommand
      ? formatSmartlifeFunctionLabel(
          preferredCommand.code,
          preferredCommand.name,
        )
      : null,
  };
};

const duplicateSmartlifeRule = (
  rule: SmartlifeAutomationRule,
): SmartlifeAutomationRule => ({
  ...rule,
  id: createSmartlifeRuleDraft().id,
});

const normalizeSmartlifeRule = (
  rule: Partial<SmartlifeAutomationRule> | null | undefined,
): SmartlifeAutomationRule => {
  const action =
    rule?.action === "device-off"
      ? "device-off"
      : rule?.command_value === false
        ? "device-off"
        : "device-on";
  const commandCode = String(rule?.command_code ?? "").trim();
  const commandLabel =
    typeof rule?.command_label === "string" && rule.command_label.trim()
      ? rule.command_label.trim()
      : null;

  return {
    id: String(rule?.id ?? "").trim() || createSmartlifeRuleDraft().id,
    enabled: rule?.enabled == null ? true : Boolean(rule.enabled),
    label: String(rule?.label ?? "").trim(),
    gite_ids: Array.isArray(rule?.gite_ids)
      ? [
          ...new Set(
            rule.gite_ids
              .map((item) => String(item ?? "").trim())
              .filter(Boolean),
          ),
        ]
      : [],
    trigger:
      rule?.trigger === "after-arrival"
        ? "after-arrival"
        : rule?.trigger === "before-departure"
          ? "before-departure"
          : rule?.trigger === "after-departure"
            ? "after-departure"
            : "before-arrival",
    offset_minutes: Math.max(
      0,
      Math.min(
        14 * 24 * 60,
        Math.round(Number(rule?.offset_minutes ?? 0) || 0),
      ),
    ),
    action,
    device_id: String(rule?.device_id ?? "").trim(),
    device_name: String(rule?.device_name ?? "").trim(),
    command_code: isSmartlifeDeviceCommandAction(action) ? commandCode : "",
    command_label: isSmartlifeDeviceCommandAction(action) ? commandLabel : null,
    command_value: getSmartlifeActionCommandValue(action),
  };
};

const normalizeSmartlifeRules = (
  rules: Array<Partial<SmartlifeAutomationRule> | null | undefined>,
) => {
  const seenIds = new Set<string>();

  return rules.map((rule) => {
    const normalized = normalizeSmartlifeRule(rule);
    const uniqueId = seenIds.has(normalized.id)
      ? createSmartlifeRuleDraft().id
      : normalized.id;
    seenIds.add(uniqueId);

    return {
      ...normalized,
      id: uniqueId,
    };
  });
};

const normalizeSmartlifeGiteMatchKey = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const sanitizeSmartlifeRuleGiteIds = (
  giteIds: string[],
  validGiteIds?: ReadonlySet<string>,
) => {
  const normalized = [...new Set(giteIds.map((item) => item.trim()).filter(Boolean))];
  return validGiteIds
    ? normalized.filter((giteId) => validGiteIds.has(giteId))
    : normalized;
};

const resolveImportedSmartlifeRuleGiteIds = (
  rule:
    | (Partial<SmartlifeAutomationRule> & {
        gites?: Array<Partial<SmartlifeRuleExportGiteRef> | null | undefined>;
      })
    | null
    | undefined,
  gites: Gite[],
) => {
  const exportedGites = Array.isArray(rule?.gites) ? rule.gites : [];
  if (exportedGites.length === 0) {
    return Array.isArray(rule?.gite_ids)
      ? sanitizeSmartlifeRuleGiteIds(
          rule.gite_ids.map((item) => String(item ?? "").trim()),
        )
      : [];
  }

  const gitesByPrefix = new Map(
    gites.map((gite) => [
      normalizeSmartlifeGiteMatchKey(gite.prefixe_contrat),
      gite.id,
    ]),
  );
  const gitesByName = new Map(
    gites.map((gite) => [normalizeSmartlifeGiteMatchKey(gite.nom), gite.id]),
  );

  return sanitizeSmartlifeRuleGiteIds(
    exportedGites.flatMap((gite) => {
      const prefix = normalizeSmartlifeGiteMatchKey(gite?.prefixe_contrat);
      const name = normalizeSmartlifeGiteMatchKey(gite?.nom);
      const matchedId =
        (prefix ? gitesByPrefix.get(prefix) : null) ??
        (name ? gitesByName.get(name) : null) ??
        null;
      return matchedId ? [matchedId] : [];
    }),
  );
};

const createSmartlifeEnergyDeviceDraft = (
  deviceId: string,
  deviceName: string,
  giteId = "",
  role: SmartlifeEnergyDeviceRole = "informational",
): SmartlifeEnergyDeviceAssignment => ({
  id:
    globalThis.crypto?.randomUUID?.() ??
    `smartlife-energy-${Math.random().toString(36).slice(2, 10)}`,
  enabled: Boolean(giteId),
  gite_id: giteId,
  device_id: deviceId,
  device_name: deviceName,
  role,
});

const normalizeSmartlifeEnergyDevice = (
  assignment: Partial<SmartlifeEnergyDeviceAssignment> | null | undefined,
): SmartlifeEnergyDeviceAssignment | null => {
  const giteId = String(assignment?.gite_id ?? "").trim();
  const deviceId = String(assignment?.device_id ?? "").trim();
  if (!giteId || !deviceId) return null;

  return {
    id:
      String(assignment?.id ?? "").trim() ||
      createSmartlifeEnergyDeviceDraft(deviceId, "").id,
    enabled: assignment?.enabled == null ? true : Boolean(assignment.enabled),
    gite_id: giteId,
    device_id: deviceId,
    device_name: String(assignment?.device_name ?? "").trim() || deviceId,
    role: assignment?.role === "primary" ? "primary" : "informational",
  };
};

const normalizeSmartlifeEnergyDevices = (
  assignments: Array<Partial<SmartlifeEnergyDeviceAssignment> | null | undefined>,
) => {
  const seenAssignmentKeys = new Set<string>();
  const primaryByGite = new Set<string>();
  return assignments
    .map((assignment) => normalizeSmartlifeEnergyDevice(assignment))
    .filter((assignment): assignment is SmartlifeEnergyDeviceAssignment => {
      if (!assignment) return false;
      const key = `${assignment.gite_id}:${assignment.device_id}`;
      if (seenAssignmentKeys.has(key)) return false;
      seenAssignmentKeys.add(key);
      if (assignment.role === "primary") {
        if (primaryByGite.has(assignment.gite_id)) {
          assignment.role = "informational";
        } else {
          primaryByGite.add(assignment.gite_id);
        }
      }
      return true;
    });
};

const sanitizeSmartlifeRulesForSave = (
  rules: Array<Partial<SmartlifeAutomationRule> | null | undefined>,
  validGiteIds?: ReadonlySet<string>,
) =>
  normalizeSmartlifeRules(rules)
    .map((rule, index) => {
      return {
        ...rule,
        label: rule.label || `Automatisation ${index + 1}`,
        gite_ids: sanitizeSmartlifeRuleGiteIds(rule.gite_ids, validGiteIds),
      };
    })
    .filter(
      (rule) =>
        rule.gite_ids.length > 0 ||
        rule.device_id ||
        rule.command_code ||
        rule.label,
    );

const sanitizeSmartlifeEnergyDevicesForSave = (
  assignments: Array<Partial<SmartlifeEnergyDeviceAssignment> | null | undefined>,
) =>
  normalizeSmartlifeEnergyDevices(assignments).filter(
    (assignment) =>
      assignment.enabled &&
      assignment.gite_id.trim() &&
      assignment.device_id.trim(),
  );

const formatDailyReservationEmailSkippedReason = (
  reason: DailyReservationEmailRunSummary["skipped_reason"],
) => {
  if (reason === "disabled") return "Envoi automatique désactivé.";
  if (reason === "already-ran-for-slot")
    return "Le créneau courant a déjà été traité.";
  if (reason === "no-new-reservations")
    return "Aucune nouvelle réservation sur les dernières 24h.";
  return null;
};

const isHtmlApiResponseError = (error: unknown) =>
  error instanceof Error &&
  /html au lieu du json attendu|unexpected token '<'|doctype/i.test(
    error.message,
  );

const buildDailyReservationEmailUnavailableMessage = () =>
  "Cette section n'est pas disponible sur ce serveur: le frontend reçoit du HTML au lieu du JSON API. Le backend en production n'est probablement pas à jour, ou la route /api/settings/daily-reservation-email est redirigée vers le frontend.";

const formatSmartlifeRegionLabel = (region: SmartlifeRegion) => {
  if (region === "eu") return "Europe centrale";
  if (region === "eu-west") return "Europe de l'Ouest";
  if (region === "us") return "États-Unis Ouest";
  if (region === "us-e") return "États-Unis Est";
  if (region === "in") return "Inde";
  return "Chine";
};

const SMARTLIFE_CODE_LABELS: Record<string, string> = {
  switch: "Interrupteur principal",
  switch_1: "Interrupteur 1",
  switch_2: "Interrupteur 2",
  switch_3: "Interrupteur 3",
  switch_4: "Interrupteur 4",
  switch_5: "Interrupteur 5",
  switch_6: "Interrupteur 6",
  switch_usb1: "Port USB 1",
  switch_usb2: "Port USB 2",
  child_lock: "Verrou enfant",
  countdown_1: "Compte à rebours 1",
  countdown_2: "Compte à rebours 2",
  countdown_3: "Compte à rebours 3",
  countdown_4: "Compte à rebours 4",
  cycle_time: "Programmation cyclique",
  relay_status: "État après remise sous tension",
  light_mode: "Mode du voyant",
  indicator_mode: "Mode du voyant",
  power_memory: "Mémoire de l'état",
  temp_set: "Température de consigne",
  temp_current: "Température actuelle",
  cur_current: "Intensité actuelle",
  cur_power: "Puissance actuelle",
  cur_voltage: "Tension actuelle",
  add_ele: "Énergie cumulée",
};

const formatSmartlifeCodeLabel = (code: string | null | undefined) => {
  const normalized = String(code ?? "").trim();
  if (!normalized) return "Commande";
  return SMARTLIFE_CODE_LABELS[normalized] ?? normalized;
};

const looksMostlyChinese = (value: string | null | undefined) => {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const chineseChars = text.match(/[\u3400-\u9fff]/g) ?? [];
  return chineseChars.length >= Math.max(1, Math.floor(text.length / 3));
};

const formatSmartlifeFunctionLabel = (
  code: string | null | undefined,
  rawLabel?: string | null,
) => {
  const normalizedCode = String(code ?? "").trim();
  const translated = formatSmartlifeCodeLabel(normalizedCode);
  const label = String(rawLabel ?? "").trim();

  if (!label) return translated;
  if (looksMostlyChinese(label)) {
    return normalizedCode ? `${translated} (${normalizedCode})` : translated;
  }
  if (label.toLowerCase() === translated.toLowerCase()) return translated;
  if (normalizedCode && label.toLowerCase() === normalizedCode.toLowerCase()) {
    return translated;
  }

  return normalizedCode
    ? `${label} · ${translated} (${normalizedCode})`
    : `${label} · ${translated}`;
};

const formatSmartlifeStatusLabel = (
  code: string | null | undefined,
  value: string | boolean | number | null,
) => `${formatSmartlifeCodeLabel(code)}: ${String(value)}`;

const formatSmartlifeRuleTrigger = (
  trigger: SmartlifeAutomationRule["trigger"],
) => {
  if (trigger === "after-arrival") return "Après arrivée";
  if (trigger === "before-departure") return "Avant départ";
  if (trigger === "after-departure") return "Après départ";
  return "Avant arrivée";
};

const formatSmartlifeOffsetHours = (offsetMinutes: number) => {
  const hours = Math.max(0, Math.round(Number(offsetMinutes) / 60 || 0));
  return `${hours} h`;
};

const formatSmartlifeRuleAction = (action: SmartlifeAutomationRuleAction) => {
  if (action === "device-off") return "Désactiver";
  return "Activer";
};

const formatSmartlifeRunStatus = (
  status: SmartlifeAutomationState["last_status"],
) => {
  if (status === "running") return "En cours";
  if (status === "success") return "Succès";
  if (status === "partial") return "Partiel";
  if (status === "skipped") return "Sans action";
  if (status === "error") return "Erreur";
  return "Repos";
};

const formatSmartlifeItemStatus = (
  status: SmartlifeAutomationRunItem["status"],
) => {
  if (status === "executed") return "Exécutée";
  if (status === "error") return "Erreur";
  return "Ignorée";
};

const getPreferredSmartlifeCommand = (
  device: SmartlifeDevice | null | undefined,
) => {
  if (!device) return null;
  return (
    device.functions.find((item) => item.is_primary_switch) ??
    device.functions.find((item) => item.type.toLowerCase().includes("bool")) ??
    null
  );
};

const getAvailableSmartlifeRuleActions = (
  _device: SmartlifeDevice | null | undefined,
): Array<{
  value: SmartlifeAutomationRuleAction;
  label: string;
}> => {
  return [
    {
      value: "device-on",
      label: "Activer",
    },
    {
      value: "device-off",
      label: "Désactiver",
    },
  ];
};

const getCompatibleSmartlifeRuleAction = (
  action: SmartlifeAutomationRuleAction,
  _device: SmartlifeDevice | null | undefined,
): SmartlifeAutomationRuleAction => action;

const formatSmartlifeEnergyRole = (
  role: SmartlifeEnergyDeviceRole,
) =>
  role === "primary"
    ? "Compteur de référence"
    : "Sous-compteur informatif";

const getSmartlifeEnergyRoleOptionLabel = (value: string) => {
  if (value === "primary") return "Compteur de référence";
  if (value === "informational") return "Sous-compteur informatif";
  return "Désactivé";
};

const formatImportLogTitle = (
  entry: Pick<ImportLogEntry, "source" | "status">,
) =>
  entry.status === "error"
    ? `${formatImportSource(entry.source)} · échec`
    : formatImportSource(entry.source);

const isPumpRefreshImportSource = (source: string | null | undefined) =>
  String(source ?? "")
    .trim()
    .toLowerCase() === "pump-refresh";

const formatImportLogSummary = (entry: ImportLogEntry) => {
  if (entry.status === "error") {
    return `Erreur: ${entry.errorMessage || "Erreur inconnue lors de l'import."}`;
  }

  if (isPumpRefreshImportSource(entry.source)) {
    return `Réservations extraites: ${entry.selectionCount ?? 0}`;
  }

  return `Sélectionnées: ${entry.selectionCount ?? 0} | Ajoutées: ${entry.inserted ?? 0} | Mises à jour: ${entry.updated ?? 0} | Ignorées: ${entry.skipped?.unknown ?? 0}`;
};

const getIcalExportUrl = (
  feed: Pick<IcalExportFeed, "id" | "ical_export_token">,
) =>
  buildApiUrl(
    `/gites/${feed.id}/calendar.ics?token=${encodeURIComponent(feed.ical_export_token ?? "")}`,
  );

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const uniqueNonEmpty = (values: Array<string | null | undefined>) => [
  ...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
];

const normalizeSourceList = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const label = String(value ?? "").trim();
    if (!label) return;
    const key = normalizeTextKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(label);
  });

  return normalized;
};

const parseDeclarationSourcesInput = (value: string) =>
  normalizeSourceList(value.split(/[\n,;]+/g));

const createSmsTextDraftId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `sms-text-${Math.random().toString(36).slice(2, 10)}`;

const truncateMiddle = (value: string, maxLength = 92) => {
  if (value.length <= maxLength) return value;
  const keep = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const extractUrlHost = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const extractIcalUrlIdentifiers = (url: string | null | undefined) => {
  if (!url) return [];
  const labels: string[] = [];
  const airbnb =
    url.match(/calendar\/ical\/(\d+)\.ics/i)?.[1] ??
    url.match(/multicalendar\/(\d+)/i)?.[1] ??
    null;
  if (airbnb) labels.push(`Airbnb #${airbnb}`);

  const abritel = url.match(/\/icalendar\/([a-z0-9]+)\.ics/i)?.[1] ?? null;
  if (abritel) labels.push(`Abritel #${abritel}`);

  const gdfCode = url.match(/\/(\d{2}G\d{3,})\//i)?.[1] ?? null;
  if (gdfCode) labels.push(`GDF ${gdfCode.toUpperCase()}`);

  const gdfCalendar = url.match(/ical_([a-z0-9]{8,})\.ics/i)?.[1] ?? null;
  if (gdfCalendar) labels.push(`Cal #${gdfCalendar.slice(0, 10)}...`);

  return uniqueNonEmpty(labels);
};

const getUnknownImportExamples = (
  item: IcalSourcesImportPreviewUnknown,
): IcalSourcesImportPreviewUnknownExample[] => {
  if (Array.isArray(item.examples) && item.examples.length > 0)
    return item.examples.slice(0, 4);
  if (item.sample_url) {
    return [
      {
        source_id: item.sample_source_id ?? null,
        type: item.sample_type ?? null,
        url: item.sample_url,
      },
    ];
  }
  return [];
};

const IMPORT_LOG_UPDATE_FIELD_LABELS: Record<string, string> = {
  hote_nom: "hôte",
  source_paiement: "source",
  commentaire: "commentaire",
  prix_total: "prix",
};

const formatImportLogUpdatedFields = (
  fields: Array<string | null | undefined> | undefined,
) => {
  const labels = uniqueNonEmpty(
    (fields ?? []).map(
      (field) =>
        IMPORT_LOG_UPDATE_FIELD_LABELS[String(field ?? "").trim()] ?? null,
    ),
  );
  return labels.length > 0 ? labels.join(", ") : null;
};

const isImportablePreviewStatus = (status: ImportPreviewItem["status"]) =>
  status === "new" || status === "existing_updatable";

const statusLabelMap: Record<IcalPreviewItem["status"], string> = {
  new: "Nouveau",
  existing: "Déjà présent",
  existing_updatable: "Complétable",
  conflict: "Conflit",
};

const importPreviewStatusLabelMap: Record<ImportPreviewItem["status"], string> =
  {
    new: "Nouveau",
    existing: "Déjà présent",
    existing_updatable: "Complétable",
    conflict: "Conflit",
    unmapped_listing: "Listing non mappé",
  };

const SettingsPage = ({ onAuthSessionUpdated }: SettingsPageProps) => {
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [gites, setGites] = useState<Gite[]>([]);
  const [sources, setSources] = useState<IcalSource[]>([]);

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [loadingManagers, setLoadingManagers] = useState(true);
  const [savingManager, setSavingManager] = useState(false);
  const [deletingManagerId, setDeletingManagerId] = useState<string | null>(
    null,
  );
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerNotice, setManagerNotice] = useState<string | null>(null);

  const [loadingSources, setLoadingSources] = useState(true);
  const [icalExports, setIcalExports] = useState<IcalExportFeed[]>([]);
  const [loadingIcalExports, setLoadingIcalExports] = useState(true);
  const [resettingIcalExportId, setResettingIcalExportId] = useState<
    string | null
  >(null);
  const [
    resettingIcalExportReservationsId,
    setResettingIcalExportReservationsId,
  ] = useState<string | null>(null);
  const [icalExportsError, setIcalExportsError] = useState<string | null>(null);
  const [icalExportsNotice, setIcalExportsNotice] = useState<string | null>(
    null,
  );
  const [sourceDraft, setSourceDraft] =
    useState<IcalSourceDraft>(DEFAULT_SOURCE_DRAFT);
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [creatingSource, setCreatingSource] = useState(false);
  const [exportingSources, setExportingSources] = useState(false);
  const [importingSources, setImportingSources] = useState(false);
  const [analyzingSourcesImport, setAnalyzingSourcesImport] = useState(false);
  const [sourceImportFileName, setSourceImportFileName] = useState("");
  const [sourceImportRows, setSourceImportRows] = useState<unknown[] | null>(
    null,
  );
  const [sourceImportMapping, setSourceImportMapping] = useState<
    Record<string, string>
  >({});
  const [sourceImportPreview, setSourceImportPreview] =
    useState<IcalSourcesImportPreviewResult | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const importSourcesInputRef = useRef<HTMLInputElement | null>(null);
  const [declarationNightsSettings, setDeclarationNightsSettings] =
    useState<DeclarationNightsSettings>(DEFAULT_DECLARATION_NIGHTS_SETTINGS);
  const [declarationExcludedSourcesDraft, setDeclarationExcludedSourcesDraft] =
    useState<string[]>(DEFAULT_DECLARATION_NIGHTS_SETTINGS.excluded_sources);
  const [loadingDeclarationNights, setLoadingDeclarationNights] =
    useState(true);
  const [savingDeclarationNights, setSavingDeclarationNights] = useState(false);
  const [declarationNightsError, setDeclarationNightsError] = useState<
    string | null
  >(null);
  const [declarationNightsNotice, setDeclarationNightsNotice] = useState<
    string | null
  >(null);
  const [sourceColorSettings, setSourceColorSettings] =
    useState<SourceColorSettings>(DEFAULT_SOURCE_COLOR_SETTINGS);
  const [sourceColorDraft, setSourceColorDraft] = useState<
    Record<string, string>
  >(DEFAULT_SOURCE_COLOR_SETTINGS.colors);
  const [loadingSourceColors, setLoadingSourceColors] = useState(true);
  const [savingSourceColors, setSavingSourceColors] = useState(false);
  const [sourceColorError, setSourceColorError] = useState<string | null>(null);
  const [sourceColorNotice, setSourceColorNotice] = useState<string | null>(
    null,
  );
  const [newSourceColorLabel, setNewSourceColorLabel] = useState("");
  const [newSourceColorValue, setNewSourceColorValue] = useState("#D3D3D3");
  const [smsTextSettings, setSmsTextSettings] = useState<SmsTextSettings>(
    DEFAULT_SMS_TEXT_SETTINGS,
  );
  const [smsTextDraft, setSmsTextDraft] = useState<SmsTextItem[]>(
    DEFAULT_SMS_TEXT_SETTINGS.texts,
  );
  const [loadingSmsTexts, setLoadingSmsTexts] = useState(true);
  const [savingSmsTexts, setSavingSmsTexts] = useState(false);
  const [smsTextError, setSmsTextError] = useState<string | null>(null);
  const [smsTextNotice, setSmsTextNotice] = useState<string | null>(null);
  const [documentEmailTextDraft, setDocumentEmailTextDraft] =
    useState<DocumentEmailTextSettings>(DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS);
  const [loadingDocumentEmailTexts, setLoadingDocumentEmailTexts] =
    useState(true);
  const [savingDocumentEmailTexts, setSavingDocumentEmailTexts] =
    useState(false);
  const [documentEmailTextError, setDocumentEmailTextError] = useState<
    string | null
  >(null);
  const [documentEmailTextNotice, setDocumentEmailTextNotice] = useState<
    string | null
  >(null);
  const [dailyReservationEmailState, setDailyReservationEmailState] =
    useState<DailyReservationEmailState>(
      DEFAULT_DAILY_RESERVATION_EMAIL_STATE,
    );
  const [dailyReservationEmailDraft, setDailyReservationEmailDraft] =
    useState<DailyReservationEmailConfig>(
      DEFAULT_DAILY_RESERVATION_EMAIL_CONFIG,
    );
  const [loadingDailyReservationEmail, setLoadingDailyReservationEmail] =
    useState(true);
  const [dailyReservationEmailStateLoaded, setDailyReservationEmailStateLoaded] =
    useState(false);
  const [savingDailyReservationEmail, setSavingDailyReservationEmail] =
    useState(false);
  const [runningDailyReservationEmail, setRunningDailyReservationEmail] =
    useState(false);
  const [dailyReservationEmailError, setDailyReservationEmailError] = useState<
    string | null
  >(null);
  const [dailyReservationEmailNotice, setDailyReservationEmailNotice] =
    useState<string | null>(null);
  const [smartlifeState, setSmartlifeState] =
    useState<SmartlifeAutomationState>(DEFAULT_SMARTLIFE_STATE);
  const [smartlifeDraft, setSmartlifeDraft] =
    useState<SmartlifeAutomationConfig>(DEFAULT_SMARTLIFE_CONFIG);
  const [smartlifeDevices, setSmartlifeDevices] = useState<SmartlifeDevice[]>(
    [],
  );
  const [loadingSmartlife, setLoadingSmartlife] = useState(true);
  const [smartlifeLoaded, setSmartlifeLoaded] = useState(false);
  const [loadingSmartlifeDevices, setLoadingSmartlifeDevices] = useState(false);
  const [exportingSmartlifeRules, setExportingSmartlifeRules] = useState(false);
  const [importingSmartlifeRules, setImportingSmartlifeRules] = useState(false);
  const [savingSmartlifeConnection, setSavingSmartlifeConnection] =
    useState(false);
  const [savingSmartlifeRules, setSavingSmartlifeRules] = useState(false);
  const [savingSmartlifeMeters, setSavingSmartlifeMeters] = useState(false);
  const [runningSmartlife, setRunningSmartlife] = useState(false);
  const [testingSmartlifeRuleId, setTestingSmartlifeRuleId] = useState<
    string | null
  >(null);
  const [smartlifeDeviceFilter, setSmartlifeDeviceFilter] = useState("");
  const [smartlifeOpenRuleIds, setSmartlifeOpenRuleIds] = useState<string[]>(
    [],
  );
  const [pendingSmartlifeScrollRuleId, setPendingSmartlifeScrollRuleId] =
    useState<string | null>(null);
  const [smartlifeError, setSmartlifeError] = useState<string | null>(null);
  const [smartlifeNotice, setSmartlifeNotice] = useState<string | null>(null);
  const [smartlifeConnectionError, setSmartlifeConnectionError] = useState<
    string | null
  >(null);
  const [smartlifeConnectionNotice, setSmartlifeConnectionNotice] = useState<
    string | null
  >(null);
  const [smartlifeMetersError, setSmartlifeMetersError] = useState<
    string | null
  >(null);
  const [smartlifeMetersNotice, setSmartlifeMetersNotice] = useState<
    string | null
  >(null);
  const [smartlifeSecretDirty, setSmartlifeSecretDirty] = useState(false);
  const [smartlifeLogVisibleCount, setSmartlifeLogVisibleCount] = useState(
    SMARTLIFE_LOG_VISIBLE_COUNT,
  );
  const [smartlifeRuleSaveStates, setSmartlifeRuleSaveStates] = useState<
    Record<string, SmartlifeRuleSaveState>
  >({});
  const smartlifeRuleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const smartlifeRuleSaveTimers = useRef<Record<string, number>>({});
  const importSmartlifeRulesInputRef = useRef<HTMLInputElement | null>(null);
  const smartlifeValidGiteIds = useMemo(
    () => new Set(gites.map((gite) => gite.id)),
    [gites],
  );
  const [serverSecuritySettings, setServerSecuritySettings] =
    useState<ServerSecuritySettings>(DEFAULT_SERVER_SECURITY_SETTINGS);
  const [serverSecurityDurationDraft, setServerSecurityDurationDraft] =
    useState(DEFAULT_SERVER_SECURITY_SETTINGS.sessionDurationHours);
  const [serverSecurityCurrentPassword, setServerSecurityCurrentPassword] =
    useState("");
  const [serverSecurityNewPassword, setServerSecurityNewPassword] =
    useState("");
  const [serverSecurityConfirmPassword, setServerSecurityConfirmPassword] =
    useState("");
  const [loadingServerSecurity, setLoadingServerSecurity] = useState(true);
  const [savingServerSecurity, setSavingServerSecurity] = useState(false);
  const [serverSecurityError, setServerSecurityError] = useState<string | null>(
    null,
  );
  const [serverSecurityNotice, setServerSecurityNotice] = useState<
    string | null
  >(null);

  const [icalPreview, setIcalPreview] = useState<IcalPreviewResult | null>(
    null,
  );
  const [icalCronState, setIcalCronState] = useState<IcalCronState | null>(
    null,
  );
  const [cronDraft, setCronDraft] = useState<IcalCronConfig>({
    enabled: true,
    auto_sync_on_app_load: false,
    auto_run_pump_for_new_airbnb_ical: false,
  });
  const [savingCron, setSavingCron] = useState(false);
  const [loadingIcalPreview, setLoadingIcalPreview] = useState(false);
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [exportingCron, setExportingCron] = useState(false);
  const [importingCron, setImportingCron] = useState(false);
  const [icalError, setIcalError] = useState<string | null>(null);
  const [icalNotice, setIcalNotice] = useState<string | null>(null);
  const importCronInputRef = useRef<HTMLInputElement | null>(null);
  const importPumpConfigInputRef = useRef<HTMLInputElement | null>(null);
  const importPumpSessionInputRef = useRef<HTMLInputElement | null>(null);

  const [pumpStatus, setPumpStatus] = useState<PumpStatusResult | null>(null);
  const [pumpConfig, setPumpConfig] = useState<PumpAutomationConfig | null>(
    null,
  );
  const [pumpConfigDraft, setPumpConfigDraft] = useState<PumpAutomationConfig>({
    baseUrl: "https://www.airbnb.fr/hosting/multicalendar",
    username: "",
    authMode: "persisted-only",
    hasOTP: false,
    persistSession: true,
    manualScrollMode: false,
    manualScrollDuration: 20000,
    scrollSelector: "",
    scrollCount: 5,
    scrollDistance: 500,
    scrollDelay: 1000,
    waitBeforeScroll: 2000,
    outputFolder: "",
    filterRules: {
      inclusive: [],
      exclusive: [],
    },
    loginStrategy: "simple",
    advancedSelectors: {
      usernameInput:
        'input[type="email"], input[type="text"][placeholder*="email"], input[name*="email"]',
      passwordInput: 'input[type="password"]',
      submitButton:
        'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
      emailFirstButton:
        'button:has-text("Continuer avec un email"), button:has-text("Continuer avec un e-mail"), button:has-text("Continue with email")',
      continueAfterUsernameButton:
        'button:has-text("Continuer"), button:has-text("Continue"), button:has-text("Suivant"), button:has-text("Next"), button[type="submit"]',
      finalSubmitButton:
        'button:has-text("Connexion"), button:has-text("Se connecter"), button:has-text("Continuer"), button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"]',
      accountChooserContinueButton:
        'button:has-text("Continuer"), [role="button"]:has-text("Continuer"), button:has-text("Continue"), [role="button"]:has-text("Continue")',
      calendarSourceCard:
        'div:has(button:has-text("Actualiser")), div:has(button:has-text("Refresh")), article:has(button:has-text("Actualiser")), article:has(button:has-text("Refresh"))',
      calendarSourceEditButton:
        'button:has-text("Modifier"), [role="button"]:has-text("Modifier"), button:has-text("Edit"), [role="button"]:has-text("Edit")',
      calendarSourceRefreshButton:
        'button:has-text("Actualiser"), [role="button"]:has-text("Actualiser"), button:has-text("Refresh"), [role="button"]:has-text("Refresh")',
      calendarSourceUrlField:
        'input[type="url"], input[readonly], input[value*="ical"], input[value*="/calendar/"], textarea',
      calendarSourceCloseButton:
        'button:has-text("Fermer"), [role="button"]:has-text("Fermer"), button:has-text("Close"), [role="button"]:has-text("Close"), [aria-label*="Fermer"], [aria-label*="Close"]',
    },
  });
  const [pumpCronState, setPumpCronState] = useState<PumpCronState | null>(
    null,
  );
  const [pumpCronDraft, setPumpCronDraft] = useState<PumpCronConfig>({
    enabled: true,
    interval_days: 3,
    hour: 10,
    minute: 0,
    run_on_start: false,
  });
  const [pumpPreview, setPumpPreview] = useState<PumpPreviewResult | null>(
    null,
  );
  const [pumpHealth, setPumpHealth] = useState<PumpHealthResult | null>(null);
  const [pumpSessionCapture, setPumpSessionCapture] =
    useState<PumpSessionCaptureResult | null>(null);
  const [pumpSessionRenewal, setPumpSessionRenewal] =
    useState<PumpSessionRenewalResult | null>(null);
  const [pumpRenewalSmsCode, setPumpRenewalSmsCode] = useState("");
  const [pumpSelections, setPumpSelections] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingPumpConfig, setLoadingPumpConfig] = useState(false);
  const [importingPumpConfig, setImportingPumpConfig] = useState(false);
  const [exportingPumpConfig, setExportingPumpConfig] = useState(false);
  const [importingPumpSession, setImportingPumpSession] = useState(false);
  const [exportingPumpSession, setExportingPumpSession] = useState(false);
  const [startingPumpSessionCapture, setStartingPumpSessionCapture] =
    useState(false);
  const [cancellingPumpSessionCapture, setCancellingPumpSessionCapture] =
    useState(false);
  const [startingPumpSessionRenewal, setStartingPumpSessionRenewal] =
    useState(false);
  const [cancellingPumpSessionRenewal, setCancellingPumpSessionRenewal] =
    useState(false);
  const [submittingPumpSessionRenewalCode, setSubmittingPumpSessionRenewalCode] =
    useState(false);
  const [savingPumpConfig, setSavingPumpConfig] = useState(false);
  const [loadingPumpStatus, setLoadingPumpStatus] = useState(false);
  const [savingPumpCron, setSavingPumpCron] = useState(false);
  const [testingPumpConnection, setTestingPumpConnection] = useState(false);
  const [testingPumpScrollTarget, setTestingPumpScrollTarget] = useState(false);
  const [refreshingPump, setRefreshingPump] = useState(false);
  const [analyzingPump, setAnalyzingPump] = useState(false);
  const [importingPump, setImportingPump] = useState(false);
  const [pumpError, setPumpError] = useState<string | null>(null);
  const [pumpNotice, setPumpNotice] = useState<string | null>(null);
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>("settings-security");

  const [importLog, setImportLog] = useState<ImportLogEntry[]>([]);
  const [importLogTotal, setImportLogTotal] = useState(0);
  const [importLogVisibleCount, setImportLogVisibleCount] = useState(
    IMPORT_LOG_VISIBLE_COUNT,
  );
  const [loadingImportLog, setLoadingImportLog] = useState(false);
  const [importLogError, setImportLogError] = useState<string | null>(null);

  const linkedGitesCount = useMemo(
    () =>
      gestionnaires.reduce(
        (sum, item) => sum + Number(item.gites_count ?? 0),
        0,
      ),
    [gestionnaires],
  );
  const selectedPumpCount = useMemo(
    () => Object.values(pumpSelections).filter(Boolean).length,
    [pumpSelections],
  );
  const pumpConfigReady = useMemo(
    () =>
      Boolean(
        pumpConfigDraft.baseUrl.trim() && pumpConfigDraft.scrollSelector.trim(),
      ),
    [pumpConfigDraft.baseUrl, pumpConfigDraft.scrollSelector],
  );
  const smartlifeAnySaving =
    savingSmartlifeConnection || savingSmartlifeRules || savingSmartlifeMeters;
  const smartlifeBusy = smartlifeAnySaving || runningSmartlife;
  const smartlifeDeviceMap = useMemo(
    () => new Map(smartlifeDevices.map((device) => [device.id, device])),
    [smartlifeDevices],
  );
  useEffect(() => {
    setSmartlifeDraft((previous) => {
      let hasChanges = false;
      const nextRules = previous.rules.map((rule) => {
        const device = smartlifeDeviceMap.get(rule.device_id) ?? null;
        const nextAction = getCompatibleSmartlifeRuleAction(rule.action, device);
        if (nextAction === rule.action) return rule;

        hasChanges = true;
        const preferredCommand = getPreferredSmartlifeCommand(device);

        return {
          ...rule,
          action: nextAction,
          command_code: isSmartlifeDeviceCommandAction(nextAction)
            ? preferredCommand?.code ?? rule.command_code
            : "",
          command_label: isSmartlifeDeviceCommandAction(nextAction)
            ? preferredCommand
              ? formatSmartlifeFunctionLabel(
                  preferredCommand.code,
                  preferredCommand.name,
                )
              : rule.command_label
            : null,
          command_value: getSmartlifeActionCommandValue(nextAction),
        };
      });

      return hasChanges ? { ...previous, rules: nextRules } : previous;
    });
  }, [smartlifeDeviceMap]);
  const smartlifeEnergyDeviceByDeviceId = useMemo(
    () =>
      new Map(
        smartlifeDraft.energy_devices.map((assignment) => [
          assignment.device_id,
          assignment,
        ]),
      ),
    [smartlifeDraft.energy_devices],
  );
  const smartlifeEnergyDevices = useMemo(
    () =>
      smartlifeDevices.filter(
        (device) => device.supports_energy_total || device.supports_total_ele,
      ),
    [smartlifeDevices],
  );
  const filteredSmartlifeDevices = useMemo(() => {
    const query = smartlifeDeviceFilter.trim().toLowerCase();
    if (!query) return smartlifeDevices;

    return smartlifeDevices.filter((device) => {
      const searchable = [
        device.name,
        device.id,
        device.product_name ?? "",
        device.category,
        ...device.functions.map((item) => `${item.name} ${item.code}`),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [smartlifeDeviceFilter, smartlifeDevices]);
  const filteredSmartlifeEnergyDevices = useMemo(() => {
    const query = smartlifeDeviceFilter.trim().toLowerCase();
    if (!query) return smartlifeEnergyDevices;

    return smartlifeEnergyDevices.filter((device) => {
      const searchable = [
        device.name,
        device.id,
        device.product_name ?? "",
        device.category,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [smartlifeDeviceFilter, smartlifeEnergyDevices]);
  const groupedSmartlifeRules = useMemo(() => {
    const giteLookup = new Map(
      gites.map((gite, index) => [gite.id, { gite, index }]),
    );
    const groups = new Map<
      string,
      {
        key: string;
        title: string;
        color: string;
        sortIndex: number;
        rules: Array<{ rule: SmartlifeAutomationRule; displayIndex: number }>;
      }
    >();

    const ensureGroup = (
      key: string,
      title: string,
      color: string,
      sortIndex: number,
    ) => {
      const existing = groups.get(key);
      if (existing) return existing;

      const created = {
        key,
        title,
        color,
        sortIndex,
        rules: [] as Array<{
          rule: SmartlifeAutomationRule;
          displayIndex: number;
        }>,
      };
      groups.set(key, created);
      return created;
    };

    smartlifeDraft.rules.forEach((rule, index) => {
      const uniqueGiteIds = sanitizeSmartlifeRuleGiteIds(
        rule.gite_ids,
        smartlifeValidGiteIds,
      );
      const singleGite =
        uniqueGiteIds.length === 1
          ? giteLookup.get(uniqueGiteIds[0]) ?? null
          : null;

      const group =
        singleGite
          ? ensureGroup(
              singleGite.gite.id,
              singleGite.gite.nom,
              getGiteColor(singleGite.gite, singleGite.index),
              singleGite.index,
            )
          : uniqueGiteIds.length > 1
            ? ensureGroup(
                "multiple",
                "Plusieurs gîtes",
                "#5f6675",
                gites.length,
              )
            : ensureGroup("none", "Aucun gîte", "#7b8494", gites.length + 1);

      group.rules.push({ rule, displayIndex: index });
    });

    return Array.from(groups.values()).sort(
      (left, right) => left.sortIndex - right.sortIndex,
    );
  }, [gites, smartlifeDraft.rules, smartlifeValidGiteIds]);
  const sourceImportUnknownIds = useMemo(
    () =>
      (sourceImportPreview?.unknown_gites ?? []).map(
        (item) => item.source_gite_id,
      ),
    [sourceImportPreview],
  );
  const sourceImportUnresolvedCount = useMemo(
    () =>
      sourceImportUnknownIds.filter((sourceGiteId) => {
        const target = sourceImportMapping[sourceGiteId];
        return !target;
      }).length,
    [sourceImportMapping, sourceImportUnknownIds],
  );
  const availableDeclarationSources = useMemo(
    () =>
      normalizeSourceList([
        ...declarationNightsSettings.available_sources,
        ...declarationNightsSettings.excluded_sources,
        ...declarationExcludedSourcesDraft,
      ]),
    [declarationExcludedSourcesDraft, declarationNightsSettings],
  );
  const paymentColorMap = useMemo(
    () => buildPaymentColorMap(sourceColorDraft),
    [sourceColorDraft],
  );
  const availableSourceColorLabels = useMemo(
    () =>
      normalizeSourceList([
        ...Object.keys(DEFAULT_PAYMENT_SOURCE_COLORS),
        ...sourceColorSettings.available_sources,
        ...Object.keys(sourceColorSettings.colors ?? {}),
        ...Object.keys(sourceColorDraft),
      ]),
    [sourceColorDraft, sourceColorSettings],
  );
  const customizedSourceColorCount = useMemo(
    () =>
      Object.entries(sourceColorDraft).filter(([label, color]) => {
        const normalizedColor = normalizePaymentHexColor(color);
        const defaultColor = getPaymentColor(
          label,
          DEFAULT_PAYMENT_SOURCE_COLORS,
        );
        return Boolean(normalizedColor) && normalizedColor !== defaultColor;
      }).length,
    [sourceColorDraft],
  );
  const smsTextCount = useMemo(
    () =>
      smsTextDraft.filter((item) => item.title.trim() && item.text.trim())
        .length,
    [smsTextDraft],
  );
  const activeIcalSourcesCount = useMemo(
    () => sources.filter((source) => source.is_active).length,
    [sources],
  );
  const readyIcalExportsCount = useMemo(
    () => icalExports.filter((feed) => Boolean(feed.ical_export_token)).length,
    [icalExports],
  );
  const groupedIcalSources = useMemo(() => {
    const giteLookup = new Map(gites.map((gite) => [gite.id, gite]));
    const groups = new Map<
      string,
      {
        key: string;
        giteId: string;
        giteName: string;
        gitePrefix: string | null;
        giteOrder: number;
        sources: IcalSource[];
      }
    >();

    sources.forEach((source) => {
      const resolvedGite = source.gite_id
        ? giteLookup.get(source.gite_id)
        : null;
      const giteId =
        source.gite?.id ??
        resolvedGite?.id ??
        source.gite_id ??
        `unknown-${source.id}`;
      const existing = groups.get(giteId);

      if (existing) {
        existing.sources.push(source);
        return;
      }

      groups.set(giteId, {
        key: giteId,
        giteId,
        giteName: source.gite?.nom ?? resolvedGite?.nom ?? "Gîte inconnu",
        gitePrefix:
          source.gite?.prefixe_contrat ?? resolvedGite?.prefixe_contrat ?? null,
        giteOrder:
          source.gite?.ordre ?? resolvedGite?.ordre ?? Number.MAX_SAFE_INTEGER,
        sources: [source],
      });
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        activeCount: group.sources.filter((source) => source.is_active).length,
        sources: [...group.sources].sort(
          (left, right) => left.ordre - right.ordre,
        ),
      }))
      .sort((left, right) => {
        if (left.giteOrder !== right.giteOrder)
          return left.giteOrder - right.giteOrder;
        return left.giteName.localeCompare(right.giteName, "fr", {
          sensitivity: "base",
        });
      });
  }, [gites, sources]);

  const loadManagers = async () => {
    const data = await apiFetch<Gestionnaire[]>("/managers");
    setGestionnaires(data);
  };

  const loadSources = async () => {
    const [gitesData, sourcesData, exportsData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<IcalSource[]>("/settings/ical-sources"),
      apiFetch<IcalExportFeed[]>("/settings/ical-exports"),
    ]);
    setGites(gitesData);
    setSources(sourcesData);
    setIcalExports(exportsData);
    setSourceDraft((previous) => ({
      ...previous,
      gite_id: previous.gite_id || gitesData[0]?.id || "",
    }));
  };

  const applyDeclarationNightsSettings = (data: DeclarationNightsSettings) => {
    const excludedSources = Array.isArray(data.excluded_sources)
      ? normalizeSourceList(data.excluded_sources)
      : DEFAULT_DECLARATION_NIGHTS_SETTINGS.excluded_sources;
    const availableSources = normalizeSourceList([
      ...(data.available_sources ?? []),
      ...excludedSources,
    ]);

    setDeclarationNightsSettings({
      excluded_sources: excludedSources,
      available_sources: availableSources,
    });
    setDeclarationExcludedSourcesDraft(excludedSources);
  };

  const loadDeclarationNightsSettings = async () => {
    const data = await apiFetch<DeclarationNightsSettings>(
      "/settings/declaration-nights",
    );
    applyDeclarationNightsSettings(data);
  };

  const applySourceColorSettings = (data: SourceColorSettings) => {
    const colors = Object.fromEntries(
      Object.entries(data.colors ?? {}).flatMap(([label, color]) => {
        const trimmedLabel = String(label ?? "").trim();
        const normalizedColor = normalizePaymentHexColor(color);
        if (!trimmedLabel || !normalizedColor) return [];
        return [[trimmedLabel, normalizedColor]];
      }),
    );

    const availableSources = normalizeSourceList([
      ...Object.keys(DEFAULT_PAYMENT_SOURCE_COLORS),
      ...(data.available_sources ?? []),
      ...Object.keys(colors),
    ]);

    setSourceColorSettings({
      colors: colors,
      available_sources: availableSources,
    });
    setSourceColorDraft(colors);
  };

  const loadSourceColorSettings = async () => {
    const data = await apiFetch<SourceColorSettings>("/settings/source-colors");
    applySourceColorSettings(data);
  };

  const applySmsTextSettings = (data: SmsTextSettings) => {
    const normalizedTexts = Array.isArray(data.texts)
      ? data.texts
          .map((item, index) => ({
            id: String(item?.id ?? "").trim() || `sms-text-${index + 1}`,
            title: String(item?.title ?? "").trim(),
            text: String(item?.text ?? "").trim(),
          }))
          .filter((item) => item.title && item.text)
      : [];

    const nextTexts =
      normalizedTexts.length > 0
        ? normalizedTexts
        : DEFAULT_SMS_TEXT_SETTINGS.texts;
    setSmsTextSettings({ texts: nextTexts });
    setSmsTextDraft(nextTexts);
  };

  const applyDocumentEmailTextSettings = (data: DocumentEmailTextSettings) => {
    const nextSettings: DocumentEmailTextSettings = {
      contrat: {
        subject:
          String(data?.contrat?.subject ?? "").trim() ||
          DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.contrat.subject,
        body:
          String(data?.contrat?.body ?? "")
            .replace(/\r\n/g, "\n")
            .trim() || DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.contrat.body,
        activitiesList:
          String(data?.contrat?.activitiesList ?? "")
            .replace(/\r\n/g, "\n")
            .trim() ||
          DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.contrat.activitiesList,
        guideUrl:
          String(data?.contrat?.guideUrl ?? "").trim() ||
          DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.contrat.guideUrl,
        destinationUrl:
          String(data?.contrat?.destinationUrl ?? "").trim() ||
          DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.contrat.destinationUrl,
      },
      facture: {
        subject:
          String(data?.facture?.subject ?? "").trim() ||
          DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.facture.subject,
        body:
          String(data?.facture?.body ?? "")
            .replace(/\r\n/g, "\n")
            .trim() || DEFAULT_DOCUMENT_EMAIL_TEXT_SETTINGS.facture.body,
      },
    };

    setDocumentEmailTextDraft(nextSettings);
  };

  const applyDailyReservationEmailState = (data: DailyReservationEmailState) => {
    const recipients = Array.isArray(data?.config?.recipients)
      ? data.config.recipients
          .map((item) => ({
            email: String(item?.email ?? "").trim().toLowerCase(),
            enabled: Boolean(item?.enabled),
            send_if_empty: Boolean(item?.send_if_empty),
          }))
          .filter((item) => item.email)
      : DEFAULT_DAILY_RESERVATION_EMAIL_CONFIG.recipients;

    const totalsByGite = Array.isArray(data?.last_result?.totals_by_gite)
      ? data.last_result.totals_by_gite
          .map((item) => ({
            gite_id:
              typeof item?.gite_id === "string" && item.gite_id.trim()
                ? item.gite_id
                : null,
            gite_nom: String(item?.gite_nom ?? "").trim(),
            total_amount: Number(item?.total_amount ?? 0),
            reservations_count: Math.max(
              0,
              Number(item?.reservations_count ?? 0),
            ),
          }))
          .filter((item) => item.gite_nom)
      : [];

    const nextState: DailyReservationEmailState = {
      config: {
        enabled: Boolean(data?.config?.enabled),
        recipients,
        hour: Math.min(
          23,
          Math.max(0, Math.round(Number(data?.config?.hour ?? 7) || 7)),
        ),
        minute: Math.min(
          59,
          Math.max(0, Math.round(Number(data?.config?.minute ?? 0) || 0)),
        ),
      },
      scheduler: "internal",
      running: Boolean(data?.running),
      next_run_at: data?.next_run_at ?? null,
      last_run_at: data?.last_run_at ?? null,
      last_success_at: data?.last_success_at ?? null,
      last_email_sent_at: data?.last_email_sent_at ?? null,
      last_status:
        data?.last_status === "running" ||
        data?.last_status === "success" ||
        data?.last_status === "skipped" ||
        data?.last_status === "error"
          ? data.last_status
          : "idle",
      last_error: data?.last_error ?? null,
      last_result: data?.last_result
        ? {
            slot_at: data.last_result.slot_at,
            window_start_at: data.last_result.window_start_at,
            window_end_at: data.last_result.window_end_at,
            new_reservations_count: Math.max(
              0,
              Number(data.last_result.new_reservations_count ?? 0),
            ),
            email_sent: Boolean(data.last_result.email_sent),
            skipped_reason:
              data.last_result.skipped_reason === "disabled" ||
              data.last_result.skipped_reason === "already-ran-for-slot" ||
              data.last_result.skipped_reason === "no-new-reservations"
                ? data.last_result.skipped_reason
                : null,
            recipients_count: Math.max(
              0,
              Number(data.last_result.recipients_count ?? 0),
            ),
            total_amount: Number(data.last_result.total_amount ?? 0),
            total_reservations_count: Math.max(
              0,
              Number(data.last_result.total_reservations_count ?? 0),
            ),
            totals_by_gite: totalsByGite,
          }
        : null,
      smtp_configured: Boolean(data?.smtp_configured),
      smtp_issues: Array.isArray(data?.smtp_issues)
        ? data.smtp_issues
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
        : [],
    };

    setDailyReservationEmailState(nextState);
    setDailyReservationEmailDraft(nextState.config);
    setDailyReservationEmailStateLoaded(true);
  };

  const applySmartlifeState = (
    data: SmartlifeAutomationState,
    options?: {
      preserveConnection?: boolean;
      preserveRules?: boolean;
      preserveMeters?: boolean;
    },
  ) => {
    const rules = Array.isArray(data?.config?.rules)
      ? normalizeSmartlifeRules(data.config.rules)
      : [];
    const energyDevices = Array.isArray(data?.config?.energy_devices)
      ? normalizeSmartlifeEnergyDevices(data.config.energy_devices)
      : [];

    const nextState: SmartlifeAutomationState = {
      config: {
        enabled: Boolean(data?.config?.enabled),
        region:
          data?.config?.region === "eu-west" ||
          data?.config?.region === "us" ||
          data?.config?.region === "us-e" ||
          data?.config?.region === "in" ||
          data?.config?.region === "cn"
            ? data.config.region
            : "eu",
        access_id: String(data?.config?.access_id ?? ""),
        access_secret: String(data?.config?.access_secret ?? ""),
        rules,
        energy_devices: energyDevices,
      },
      scheduler: data?.scheduler === "external" ? "external" : "internal",
      running: Boolean(data?.running),
      next_run_at: data?.next_run_at ?? null,
      last_run_at: data?.last_run_at ?? null,
      last_success_at: data?.last_success_at ?? null,
      last_status:
        data?.last_status === "running" ||
        data?.last_status === "success" ||
        data?.last_status === "partial" ||
        data?.last_status === "skipped" ||
        data?.last_status === "error"
          ? data.last_status
          : "idle",
      last_error: data?.last_error ?? null,
      last_result: data?.last_result
        ? {
            checked_at: data.last_result.checked_at,
            scanned_rules_count: Number(data.last_result.scanned_rules_count) || 0,
            scanned_reservations_count:
              Number(data.last_result.scanned_reservations_count) || 0,
            due_events_count: Number(data.last_result.due_events_count) || 0,
            executed_count: Number(data.last_result.executed_count) || 0,
            skipped_count: Number(data.last_result.skipped_count) || 0,
            error_count: Number(data.last_result.error_count) || 0,
            note: data.last_result.note ?? null,
            items: Array.isArray(data.last_result.items)
              ? data.last_result.items.map((item) => {
                  const action =
                    item?.action === "device-off" || item?.command_value === false
                      ? "device-off"
                      : "device-on";
                  return {
                    key: String(item?.key ?? ""),
                    reservation_id: String(item?.reservation_id ?? ""),
                    gite_id:
                      typeof item?.gite_id === "string" && item.gite_id.trim()
                        ? item.gite_id
                        : null,
                    gite_nom: String(item?.gite_nom ?? "").trim(),
                    reservation_label: String(item?.reservation_label ?? "").trim(),
                    rule_id: String(item?.rule_id ?? "").trim(),
                    rule_label: String(item?.rule_label ?? "").trim(),
                    device_id: String(item?.device_id ?? "").trim(),
                    device_name: String(item?.device_name ?? "").trim(),
                    action,
                    command_code: String(item?.command_code ?? "").trim(),
                    command_value: getSmartlifeActionCommandValue(action),
                    trigger:
                      item?.trigger === "after-arrival"
                        ? "after-arrival"
                        : item?.trigger === "before-departure"
                          ? "before-departure"
                          : item?.trigger === "after-departure"
                            ? "after-departure"
                            : "before-arrival",
                    scheduled_at: String(item?.scheduled_at ?? ""),
                    executed_at: item?.executed_at ?? null,
                    previous_executed_at: item?.previous_executed_at ?? null,
                    status:
                      item?.status === "executed" || item?.status === "error"
                        ? item.status
                        : "skipped",
                    message:
                      typeof item?.message === "string" && item.message.trim()
                        ? item.message.trim()
                        : null,
                  };
                })
              : [],
          }
        : null,
      credentials_configured: Boolean(data?.credentials_configured),
    };

    setSmartlifeState(nextState);
    setSmartlifeLogVisibleCount(SMARTLIFE_LOG_VISIBLE_COUNT);
    setSmartlifeDraft((previous) => ({
      enabled: options?.preserveConnection
        ? previous.enabled
        : nextState.config.enabled,
      region: options?.preserveConnection
        ? previous.region
        : nextState.config.region,
      access_id: options?.preserveConnection
        ? previous.access_id
        : nextState.config.access_id,
      access_secret: options?.preserveConnection
        ? previous.access_secret
        : nextState.config.access_secret,
      rules: options?.preserveRules ? previous.rules : nextState.config.rules,
      energy_devices: options?.preserveMeters
        ? previous.energy_devices
        : nextState.config.energy_devices,
    }));
    if (!options?.preserveConnection) {
      setSmartlifeSecretDirty(false);
    }
    setSmartlifeLoaded(true);
  };

  const applyServerSecuritySettings = (data: ServerSecuritySettings) => {
    const nextSettings: ServerSecuritySettings = {
      enabled: Boolean(data.enabled || data.passwordConfigured),
      passwordConfigured: Boolean(data.passwordConfigured),
      sessionDurationHours: Math.max(
        1,
        Number(data.sessionDurationHours) ||
          DEFAULT_SERVER_SECURITY_SETTINGS.sessionDurationHours,
      ),
      sessionExpiresAt: data.sessionExpiresAt ?? null,
    };

    setServerSecuritySettings(nextSettings);
    setServerSecurityDurationDraft(nextSettings.sessionDurationHours);
  };

  const resetSmartlifeRuleSaveState = (ruleId: string) => {
    const timerId = smartlifeRuleSaveTimers.current[ruleId];
    if (timerId != null) {
      window.clearTimeout(timerId);
      delete smartlifeRuleSaveTimers.current[ruleId];
    }
    setSmartlifeRuleSaveStates((previous) => {
      if (!previous[ruleId]) return previous;
      const next = { ...previous };
      delete next[ruleId];
      return next;
    });
  };

  const markSmartlifeRuleSaved = (ruleId: string) => {
    resetSmartlifeRuleSaveState(ruleId);
    setSmartlifeRuleSaveStates((previous) => ({
      ...previous,
      [ruleId]: "saved",
    }));
    smartlifeRuleSaveTimers.current[ruleId] = window.setTimeout(() => {
      setSmartlifeRuleSaveStates((previous) =>
        previous[ruleId] === "saved"
          ? Object.fromEntries(
              Object.entries(previous).filter(([key]) => key !== ruleId),
            )
          : previous,
      );
      delete smartlifeRuleSaveTimers.current[ruleId];
    }, 1600);
  };

  const loadSmsTextSettings = async () => {
    const data = await apiFetch<SmsTextSettings>("/settings/sms-texts");
    applySmsTextSettings(data);
  };

  const loadDocumentEmailTextSettings = async () => {
    const data = await apiFetch<DocumentEmailTextSettings>(
      "/settings/document-email-texts",
    );
    applyDocumentEmailTextSettings(data);
  };

  const loadDailyReservationEmailState = async () => {
    try {
      const data = await apiFetch<DailyReservationEmailState>(
        "/settings/daily-reservation-email",
      );
      setDailyReservationEmailError(null);
      applyDailyReservationEmailState(data);
    } catch (error: any) {
      setDailyReservationEmailStateLoaded(false);
      setDailyReservationEmailError(
        isHtmlApiResponseError(error)
          ? buildDailyReservationEmailUnavailableMessage()
          : error.message ??
              "Impossible de charger la configuration de l'email quotidien.",
      );
    }
  };

  const loadSmartlifeState = async () => {
    try {
      const data = await apiFetch<SmartlifeAutomationState>("/settings/smartlife");
      setSmartlifeError(null);
      applySmartlifeState(data);
    } catch (error: any) {
      setSmartlifeLoaded(false);
      setSmartlifeError(
        error.message ??
          "Impossible de charger la configuration Smart Life.",
      );
    }
  };

  const loadSmartlifeDevices = async () => {
    setLoadingSmartlifeDevices(true);
    setSmartlifeError(null);
    try {
      const data = await apiFetch<SmartlifeDevicesResponse>(
        "/settings/smartlife/devices",
      );
      setSmartlifeDevices(Array.isArray(data.devices) ? data.devices : []);
      setSmartlifeNotice(
        `${Array.isArray(data.devices) ? data.devices.length : 0} appareil(s) Smart Life chargé(s).`,
      );
    } catch (error: any) {
      setSmartlifeError(
        error.message ?? "Impossible de charger les appareils Smart Life.",
      );
    } finally {
      setLoadingSmartlifeDevices(false);
    }
  };

  const loadServerSecuritySettings = async () => {
    const data = await apiFetch<ServerSecuritySettings>("/settings/security");
    applyServerSecuritySettings(data);
  };

  const loadCronState = async () => {
    const data = await apiFetch<IcalCronState>("/settings/ical/cron");
    setIcalCronState(data);
    setCronDraft(data.config);
  };

  const loadImportLog = async (limit = IMPORT_LOG_FETCH_COUNT) => {
    setLoadingImportLog(true);
    setImportLogError(null);
    try {
      const data = await apiFetch<{ entries: ImportLogEntry[]; total: number }>(
        `/settings/import-log?limit=${limit}`,
      );
      setImportLog(Array.isArray(data.entries) ? data.entries : []);
      setImportLogTotal(Number.isFinite(data.total) ? data.total : 0);
      setImportLogVisibleCount((previous) =>
        Math.max(IMPORT_LOG_VISIBLE_COUNT, previous),
      );
    } catch (error: any) {
      setImportLogError(
        error.message ?? "Impossible de charger le journal des imports.",
      );
    } finally {
      setLoadingImportLog(false);
    }
  };

  const loadPumpStatus = async () => {
    setLoadingPumpStatus(true);
    setPumpError(null);
    try {
      const data = await apiFetch<PumpStatusResult>("/settings/pump/status");
      setPumpStatus(data);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de charger le statut Pump.");
    } finally {
      setLoadingPumpStatus(false);
    }
  };

  const loadPumpHealth = async () => {
    try {
      const data = await apiFetch<PumpHealthResult>("/settings/pump/health");
      setPumpHealth(data);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible de charger l'état de connexion Pump.",
      );
    }
  };

  const loadPumpSessionCaptureStatus = async () => {
    try {
      const data = await apiFetch<PumpSessionCaptureResult>(
        "/settings/pump/session/capture/status",
      );
      setPumpSessionCapture(data);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible de charger l'état de capture Pump.",
      );
    }
  };

  const loadPumpSessionRenewalStatus = async () => {
    try {
      const data = await apiFetch<PumpSessionRenewalResult>(
        "/settings/pump/session/renewal/status",
      );
      setPumpSessionRenewal(data);
    } catch (error: any) {
      setPumpError(
        error.message ??
          "Impossible de charger l'état du renouvellement assisté Pump.",
      );
    }
  };

  const loadPumpConfig = async () => {
    setLoadingPumpConfig(true);
    setPumpError(null);
    try {
      const data = await apiFetch<PumpAutomationConfig>(
        "/settings/pump/config",
      );
      setPumpConfig(data);
      setPumpConfigDraft(data);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible de charger la configuration Pump.",
      );
    } finally {
      setLoadingPumpConfig(false);
    }
  };

  const loadPumpCronState = async () => {
    const data = await apiFetch<PumpCronState>("/settings/pump/cron");
    setPumpCronState(data);
    setPumpCronDraft(data.config);
  };

  useEffect(() => {
    setLoadingManagers(true);
    setLoadingSources(true);
    setLoadingIcalExports(true);
    setLoadingDeclarationNights(true);
    setLoadingSourceColors(true);
    setLoadingSmsTexts(true);
    setLoadingDocumentEmailTexts(true);
    setLoadingDailyReservationEmail(true);
    setLoadingSmartlife(true);
    setLoadingServerSecurity(true);
    Promise.all([
      loadManagers(),
      loadSources(),
      loadDeclarationNightsSettings(),
      loadSourceColorSettings(),
      loadSmsTextSettings(),
      loadDocumentEmailTextSettings(),
      loadDailyReservationEmailState(),
      loadSmartlifeState(),
      loadServerSecuritySettings(),
      loadCronState(),
      loadImportLog(),
      loadPumpConfig(),
      loadPumpStatus(),
      loadPumpHealth(),
      loadPumpSessionCaptureStatus(),
      loadPumpSessionRenewalStatus(),
      loadPumpCronState(),
    ])
      .catch((error: any) => {
        const message =
          error?.message ?? "Impossible de charger les paramètres.";
        setManagerError(message);
        setSourceError(message);
        setIcalExportsError(message);
        setDeclarationNightsError(message);
        setSourceColorError(message);
        setSmsTextError(message);
        setDocumentEmailTextError(message);
        setDailyReservationEmailError(message);
        setSmartlifeError(message);
        setServerSecurityError(message);
      })
      .finally(() => {
        setLoadingManagers(false);
        setLoadingSources(false);
        setLoadingIcalExports(false);
        setLoadingDeclarationNights(false);
        setLoadingSourceColors(false);
        setLoadingSmsTexts(false);
        setLoadingDocumentEmailTexts(false);
        setLoadingDailyReservationEmail(false);
        setLoadingSmartlife(false);
        setLoadingServerSecurity(false);
      });
  }, []);

  useEffect(() => {
    if (!pumpSessionCapture?.active) return;
    const intervalId = window.setInterval(() => {
      void loadPumpSessionCaptureStatus();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pumpSessionCapture?.active]);

  useEffect(() => {
    if (!pumpSessionRenewal?.active) return;
    const intervalId = window.setInterval(() => {
      void loadPumpSessionRenewalStatus();
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pumpSessionRenewal?.active]);

  useEffect(
    () => () => {
      Object.values(smartlifeRuleSaveTimers.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      smartlifeRuleSaveTimers.current = {};
    },
    [],
  );

  useEffect(() => {
    if (!pumpSessionCapture || pumpSessionCapture.active) return;
    if (pumpSessionCapture.status === "saved") {
      void Promise.all([loadPumpHealth(), loadPumpStatus()]).catch(
        () => undefined,
      );
    }
  }, [pumpSessionCapture]);

  useEffect(() => {
    if (!pumpSessionRenewal || pumpSessionRenewal.active) return;
    if (pumpSessionRenewal.status === "saved") {
      setPumpRenewalSmsCode("");
      void Promise.all([
        loadPumpHealth(),
        loadPumpStatus(),
        loadPumpSessionCaptureStatus(),
      ]).catch(() => undefined);
    }
  }, [pumpSessionRenewal]);

  useEffect(() => {
    if (pumpSessionRenewal?.status === "awaiting_sms_code") return;
    setPumpRenewalSmsCode("");
  }, [pumpSessionRenewal?.status]);

  useEffect(() => {
    if (!pendingSmartlifeScrollRuleId) return;
    const target = smartlifeRuleRefs.current[pendingSmartlifeScrollRuleId];
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingSmartlifeScrollRuleId(null);
  }, [pendingSmartlifeScrollRuleId, smartlifeDraft.rules]);

  useEffect(() => {
    setSmartlifeOpenRuleIds((previous) =>
      previous.filter((ruleId) =>
        smartlifeDraft.rules.some((rule) => rule.id === ruleId),
      ),
    );
  }, [smartlifeDraft.rules]);

  useEffect(() => {
    const activeRuleIds = new Set(smartlifeDraft.rules.map((rule) => rule.id));
    setSmartlifeRuleSaveStates((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([ruleId]) => activeRuleIds.has(ruleId)),
      ),
    );
    Object.entries(smartlifeRuleSaveTimers.current).forEach(([ruleId, timerId]) => {
      if (activeRuleIds.has(ruleId)) return;
      window.clearTimeout(timerId);
      delete smartlifeRuleSaveTimers.current[ruleId];
    });
  }, [smartlifeDraft.rules]);

  const preserveSmartlifeRuleViewportPosition = (ruleId: string) => {
    const initialTop =
      smartlifeRuleRefs.current[ruleId]?.getBoundingClientRect().top ?? null;

    return () => {
      if (initialTop == null) return;

      requestAnimationFrame(() => {
        const nextTop =
          smartlifeRuleRefs.current[ruleId]?.getBoundingClientRect().top ?? null;
        if (nextTop == null) return;

        const delta = nextTop - initialTop;
        if (Math.abs(delta) < 1) return;
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      });
    };
  };

  const saveDeclarationNightsSettings = async () => {
    setSavingDeclarationNights(true);
    setDeclarationNightsError(null);
    setDeclarationNightsNotice(null);
    try {
      const response = await apiFetch<DeclarationNightsSettings>(
        "/settings/declaration-nights",
        {
          method: "PUT",
          json: {
            excluded_sources: declarationExcludedSourcesDraft,
          },
        },
      );
      applyDeclarationNightsSettings(response);
      setDeclarationNightsNotice("Sources d'exclusion enregistrées.");
    } catch (error: any) {
      setDeclarationNightsError(
        error.message ?? "Impossible d'enregistrer les sources exclues.",
      );
    } finally {
      setSavingDeclarationNights(false);
    }
  };

  const saveSourceColorSettings = async () => {
    setSavingSourceColors(true);
    setSourceColorError(null);
    setSourceColorNotice(null);
    try {
      const invalidEntry = Object.entries(sourceColorDraft).find(
        ([label, color]) =>
          String(label ?? "").trim() && !normalizePaymentHexColor(color),
      );
      if (invalidEntry) {
        setSourceColorError(
          `Couleur invalide pour "${invalidEntry[0]}". Utilisez un format #RRGGBB.`,
        );
        return;
      }

      const response = await apiFetch<SourceColorSettings>(
        "/settings/source-colors",
        {
          method: "PUT",
          json: {
            colors: Object.fromEntries(
              Object.entries(sourceColorDraft).flatMap(([label, color]) => {
                const trimmedLabel = String(label ?? "").trim();
                const normalizedColor = normalizePaymentHexColor(color);
                if (!trimmedLabel || !normalizedColor) return [];
                return [[trimmedLabel, normalizedColor]];
              }),
            ),
          },
        },
      );
      applySourceColorSettings(response);
      setSourceColorNotice("Couleurs des sources enregistrées.");
    } catch (error: any) {
      setSourceColorError(
        error.message ?? "Impossible d'enregistrer les couleurs des sources.",
      );
    } finally {
      setSavingSourceColors(false);
    }
  };

  const addSourceColorLabel = () => {
    const label = newSourceColorLabel.trim();
    const normalizedColor = normalizePaymentHexColor(newSourceColorValue);
    if (!label) {
      setSourceColorError("Renseignez un libellé de source.");
      return;
    }
    if (!normalizedColor) {
      setSourceColorError("Choisissez une couleur valide.");
      return;
    }

    setSourceColorError(null);
    setSourceColorNotice(null);
    setSourceColorDraft((previous) => ({
      ...previous,
      [label]: normalizedColor,
    }));
    setSourceColorSettings((previous) => ({
      ...previous,
      available_sources: normalizeSourceList([
        ...previous.available_sources,
        label,
      ]),
    }));
    setNewSourceColorLabel("");
  };

  const saveSmsTextSettings = async () => {
    setSavingSmsTexts(true);
    setSmsTextError(null);
    setSmsTextNotice(null);

    try {
      const sanitizedTexts = smsTextDraft
        .map((item, index) => ({
          id: String(item.id ?? "").trim() || `sms-text-${index + 1}`,
          title: item.title.trim(),
          text: item.text.trim(),
        }))
        .filter((item) => item.title || item.text);

      if (sanitizedTexts.length === 0) {
        setSmsTextError("Ajoutez au moins un texte SMS.");
        return;
      }

      const invalidItem = sanitizedTexts.find(
        (item) => !item.title || !item.text,
      );
      if (invalidItem) {
        setSmsTextError("Chaque texte SMS doit avoir un titre et un contenu.");
        return;
      }

      const response = await apiFetch<SmsTextSettings>("/settings/sms-texts", {
        method: "PUT",
        json: {
          texts: sanitizedTexts,
        },
      });
      applySmsTextSettings(response);
      setSmsTextNotice("Textes SMS enregistrés.");
    } catch (error: any) {
      setSmsTextError(
        error.message ?? "Impossible d'enregistrer les textes SMS.",
      );
    } finally {
      setSavingSmsTexts(false);
    }
  };

  const saveDocumentEmailTextSettings = async () => {
    setSavingDocumentEmailTexts(true);
    setDocumentEmailTextError(null);
    setDocumentEmailTextNotice(null);
    try {
      const response = await apiFetch<DocumentEmailTextSettings>(
        "/settings/document-email-texts",
        {
          method: "PUT",
          json: {
            contrat: {
              subject: documentEmailTextDraft.contrat.subject.trim(),
              body: documentEmailTextDraft.contrat.body.trim(),
              activitiesList: documentEmailTextDraft.contrat.activitiesList,
              guideUrl: documentEmailTextDraft.contrat.guideUrl.trim(),
              destinationUrl:
                documentEmailTextDraft.contrat.destinationUrl.trim(),
            },
            facture: {
              subject: documentEmailTextDraft.facture.subject.trim(),
              body: documentEmailTextDraft.facture.body.trim(),
            },
          },
        },
      );
      applyDocumentEmailTextSettings(response);
      setDocumentEmailTextNotice("Textes d'emails enregistrés.");
    } catch (error: any) {
      setDocumentEmailTextError(
        error.message ?? "Impossible d'enregistrer les textes d'emails.",
      );
    } finally {
      setSavingDocumentEmailTexts(false);
    }
  };

  const saveDailyReservationEmailSettings = async () => {
    setSavingDailyReservationEmail(true);
    setDailyReservationEmailError(null);
    setDailyReservationEmailNotice(null);

    try {
      const sanitizedRecipients = dailyReservationEmailDraft.recipients
        .map((item) => ({
          email: String(item.email ?? "").trim().toLowerCase(),
          enabled: Boolean(item.enabled),
          send_if_empty: Boolean(item.send_if_empty),
        }))
        .filter((item) => item.email);

      const invalidRecipient = sanitizedRecipients.find(
        (item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(item.email),
      );
      if (invalidRecipient) {
        setDailyReservationEmailError(
          `Adresse email invalide: ${invalidRecipient.email}`,
        );
        return;
      }

      const seen = new Set<string>();
      const deduplicatedRecipients = sanitizedRecipients.filter((item) => {
        if (seen.has(item.email)) return false;
        seen.add(item.email);
        return true;
      });

      const response = await apiFetch<DailyReservationEmailState>(
        "/settings/daily-reservation-email",
        {
          method: "PUT",
          json: {
            enabled: dailyReservationEmailDraft.enabled,
            recipients: deduplicatedRecipients,
            hour: dailyReservationEmailDraft.hour,
            minute: dailyReservationEmailDraft.minute,
          },
        },
      );
      applyDailyReservationEmailState(response);
      setDailyReservationEmailNotice(
        "Résumé quotidien des réservations enregistré.",
      );
    } catch (error: any) {
      setDailyReservationEmailError(
        isHtmlApiResponseError(error)
          ? buildDailyReservationEmailUnavailableMessage()
          : error.message ??
              "Impossible d'enregistrer le résumé quotidien des réservations.",
      );
    } finally {
      setSavingDailyReservationEmail(false);
    }
  };

  const runDailyReservationEmailNow = async () => {
    setRunningDailyReservationEmail(true);
    setDailyReservationEmailError(null);
    setDailyReservationEmailNotice(null);

    try {
      const response = await apiFetch<DailyReservationEmailRunResponse>(
        "/settings/daily-reservation-email/send",
        {
          method: "POST",
          json: { force: true },
        },
      );
      applyDailyReservationEmailState(response.state);

      if (response.summary.email_sent) {
        setDailyReservationEmailNotice(
          `Email envoyé à ${response.summary.recipients_count} destinataire${response.summary.recipients_count > 1 ? "s" : ""}.`,
        );
      } else {
        setDailyReservationEmailNotice(
          formatDailyReservationEmailSkippedReason(
            response.summary.skipped_reason,
          ) ?? "Aucun email n'a été envoyé.",
        );
      }
    } catch (error: any) {
      setDailyReservationEmailError(
        isHtmlApiResponseError(error)
          ? buildDailyReservationEmailUnavailableMessage()
          : error.message ?? "Impossible d'envoyer le résumé quotidien.",
      );
    } finally {
      setRunningDailyReservationEmail(false);
    }
  };

  const upsertSmartlifeEnergyDevice = (
    device: SmartlifeDevice,
    patch: Partial<SmartlifeEnergyDeviceAssignment>,
  ) => {
    setSmartlifeMetersError(null);
    setSmartlifeMetersNotice(null);
    setSmartlifeDraft((previous) => {
      const existing = previous.energy_devices.find(
        (assignment) => assignment.device_id === device.id,
      );
      const nextAssignment = normalizeSmartlifeEnergyDevice({
        ...(existing ??
          createSmartlifeEnergyDeviceDraft(
            device.id,
            device.name,
            patch.gite_id ?? "",
            patch.role === "primary" ? "primary" : "informational",
          )),
        device_id: device.id,
        device_name: device.name,
        ...patch,
      });

      const remaining = previous.energy_devices.filter(
        (assignment) => assignment.device_id !== device.id,
      );
      if (!nextAssignment || !nextAssignment.enabled) {
        return {
          ...previous,
          energy_devices: remaining,
        };
      }

      const normalizedRemaining = remaining.map((assignment) =>
        nextAssignment.role === "primary" &&
        assignment.gite_id === nextAssignment.gite_id
          ? { ...assignment, role: "informational" as const }
          : assignment,
      );

      return {
        ...previous,
        energy_devices: normalizeSmartlifeEnergyDevices([
          ...normalizedRemaining,
          nextAssignment,
        ]),
      };
    });
  };

  const saveSmartlifeConnectionSettings = async () => {
    setSavingSmartlifeConnection(true);
    setSmartlifeConnectionError(null);
    setSmartlifeConnectionNotice(null);

    try {
      const accessId = smartlifeDraft.access_id.trim();
      const accessSecret = smartlifeDraft.access_secret.trim();
      const accessIdChanged = accessId !== smartlifeState.config.access_id.trim();
      const hasPersistedSecret = smartlifeState.credentials_configured;
      const willUpdateSecret = smartlifeSecretDirty;
      const willKeepPersistedSecret =
        hasPersistedSecret && !willUpdateSecret && !accessIdChanged;
      const hasUsableSecret = willKeepPersistedSecret || Boolean(accessSecret);

      if (smartlifeDraft.enabled && (!accessId || !hasUsableSecret)) {
        setSmartlifeConnectionError(
          "Renseignez l'Access ID et l'Access Secret avant d'activer Smart Life.",
        );
        return;
      }
      if (accessIdChanged && hasPersistedSecret && !willUpdateSecret) {
        setSmartlifeConnectionError(
          "Si vous changez l'Access ID, ressaisissez aussi l'Access Secret avant d'enregistrer, ou utilisez \"Effacer les identifiants\".",
        );
        return;
      }

      const response = await apiFetch<SmartlifeAutomationState>(
        "/settings/smartlife/connection",
        {
          method: "PUT",
          json: {
            enabled: smartlifeDraft.enabled,
            region: smartlifeDraft.region,
            access_id: accessId,
            access_secret: smartlifeSecretDirty ? accessSecret : undefined,
          },
        },
      );
      applySmartlifeState(response, {
        preserveRules: true,
        preserveMeters: true,
      });
      setSmartlifeConnectionNotice("Connexion Tuya enregistrée.");
    } catch (error: any) {
      setSmartlifeConnectionError(
        error.message ??
          "Impossible d'enregistrer la connexion Smart Life.",
      );
    } finally {
      setSavingSmartlifeConnection(false);
    }
  };

  const saveSmartlifeRules = async (focusedRuleId?: string) => {
    setSavingSmartlifeRules(true);
    setSmartlifeError(null);
    setSmartlifeNotice(null);
    if (focusedRuleId) {
      resetSmartlifeRuleSaveState(focusedRuleId);
      setSmartlifeRuleSaveStates((previous) => ({
        ...previous,
        [focusedRuleId]: "saving",
      }));
    }

    try {
      const sanitizedRules = sanitizeSmartlifeRulesForSave(
        smartlifeDraft.rules,
        smartlifeValidGiteIds,
      );
      const invalidRule = sanitizedRules.find((rule) => {
        if (!rule.enabled || !rule.gite_ids.length || !rule.device_id) {
          return Boolean(rule.enabled);
        }
        if (!rule.command_code) return true;
        const device = smartlifeDeviceMap.get(rule.device_id) ?? null;
        if (!device) return false;
        return !device.functions.some(
          (functionItem) =>
            functionItem.code === rule.command_code &&
            functionItem.type.toLowerCase().includes("bool"),
        );
      });
      if (invalidRule) {
        if (focusedRuleId) {
          setSmartlifeRuleSaveStates((previous) => ({
            ...previous,
            [focusedRuleId]: "error",
          }));
        }
        setSmartlifeError(
          `Complétez la règle "${invalidRule.label}": gîte(s), appareil et commande booléenne sont requis.`,
        );
        return;
      }

      const response = await apiFetch<SmartlifeAutomationState>(
        "/settings/smartlife/rules",
        {
          method: "PUT",
          json: {
            rules: sanitizedRules,
          },
        },
      );
      applySmartlifeState(response, {
        preserveConnection: true,
        preserveMeters: true,
      });
      if (focusedRuleId) {
        markSmartlifeRuleSaved(focusedRuleId);
      }
      setSmartlifeNotice("Règles Smart Life enregistrées.");
    } catch (error: any) {
      if (focusedRuleId) {
        setSmartlifeRuleSaveStates((previous) => ({
          ...previous,
          [focusedRuleId]: "error",
        }));
      }
      setSmartlifeError(
        error.message ?? "Impossible d'enregistrer les règles Smart Life.",
      );
    } finally {
      setSavingSmartlifeRules(false);
    }
  };

  const saveSmartlifeMeters = async () => {
    setSavingSmartlifeMeters(true);
    setSmartlifeMetersError(null);
    setSmartlifeMetersNotice(null);

    try {
      const sanitizedEnergyDevices = sanitizeSmartlifeEnergyDevicesForSave(
        smartlifeDraft.energy_devices,
      );
      const primaryCountByGite = sanitizedEnergyDevices.reduce(
        (counts, assignment) => {
          if (assignment.role === "primary") {
            counts.set(
              assignment.gite_id,
              (counts.get(assignment.gite_id) ?? 0) + 1,
            );
          }
          return counts;
        },
        new Map<string, number>(),
      );
      const giteWithoutPrimary = gites.find(
        (gite) =>
          sanitizedEnergyDevices.some(
            (assignment) => assignment.gite_id === gite.id,
          ) && !primaryCountByGite.has(gite.id),
      );
      if (giteWithoutPrimary) {
        setSmartlifeMetersError(
          `Le gîte "${giteWithoutPrimary.nom}" a des compteurs Smart Life mais aucun compteur de référence.`,
        );
        return;
      }
      const response = await apiFetch<SmartlifeAutomationState>(
        "/settings/smartlife/meters",
        {
          method: "PUT",
          json: {
            energy_devices: sanitizedEnergyDevices,
          },
        },
      );
      applySmartlifeState(response, {
        preserveConnection: true,
        preserveRules: true,
      });
      setSmartlifeMetersNotice("Compteurs Smart Life enregistrés.");
    } catch (error: any) {
      setSmartlifeMetersError(
        error.message ??
          "Impossible d'enregistrer les compteurs Smart Life.",
      );
    } finally {
      setSavingSmartlifeMeters(false);
    }
  };

  const triggerSmartlifeRulesImport = () => {
    importSmartlifeRulesInputRef.current?.click();
  };

  const exportSmartlifeRules = async () => {
    setExportingSmartlifeRules(true);
    setSmartlifeError(null);
    setSmartlifeNotice(null);

    try {
      const giteLookup = new Map(gites.map((gite) => [gite.id, gite]));
      const payload: SmartlifeRulesImportExportPayload = {
        version: 2,
        exported_at: new Date().toISOString(),
        rules: normalizeSmartlifeRules(smartlifeDraft.rules).map((rule) => ({
          ...rule,
          gites: sanitizeSmartlifeRuleGiteIds(
            rule.gite_ids,
            smartlifeValidGiteIds,
          )
            .map((giteId) => giteLookup.get(giteId) ?? null)
            .filter((gite): gite is Gite => Boolean(gite))
            .map((gite) => ({
              id: gite.id,
              nom: gite.nom,
              prefixe_contrat: gite.prefixe_contrat,
            })),
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `smartlife-rules-export-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setSmartlifeNotice(`${payload.rules.length} règle(s) exportée(s).`);
    } catch (error: any) {
      setSmartlifeError(
        error.message ?? "Impossible d'exporter les règles Smart Life.",
      );
    } finally {
      setExportingSmartlifeRules(false);
    }
  };

  const importSmartlifeRulesFromFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingSmartlifeRules(true);
    setSmartlifeError(null);
    setSmartlifeNotice(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const source =
        Array.isArray(parsed)
          ? parsed
          : parsed &&
              typeof parsed === "object" &&
              Array.isArray((parsed as { rules?: unknown[] }).rules)
            ? (parsed as { rules: unknown[] }).rules
            : null;

      if (!source) {
        throw new Error(
          "Format invalide: utilisez un JSON exporté depuis l'application.",
        );
      }

      const importedRules = normalizeSmartlifeRules(
        source.map((rule) => {
          if (!rule || typeof rule !== "object") return null;
          const candidate = rule as Partial<SmartlifeAutomationRule> & {
            gites?: Array<Partial<SmartlifeRuleExportGiteRef> | null | undefined>;
          };

          return {
            ...candidate,
            gite_ids: resolveImportedSmartlifeRuleGiteIds(candidate, gites),
          };
        }),
      );

      setSmartlifeDraft((previous) => ({
        ...previous,
        rules: importedRules,
      }));
      setSmartlifeOpenRuleIds(importedRules.map((rule) => rule.id));
      setPendingSmartlifeScrollRuleId(importedRules[0]?.id ?? null);
      setSmartlifeNotice(
        `${importedRules.length} règle(s) importée(s) depuis ${file.name}. Enregistrez pour appliquer.`,
      );
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setSmartlifeError("Le fichier n'est pas un JSON valide.");
      } else {
        setSmartlifeError(
          error.message ?? "Impossible d'importer les règles Smart Life.",
        );
      }
    } finally {
      input.value = "";
      setImportingSmartlifeRules(false);
    }
  };

  const runSmartlifeNow = async () => {
    setRunningSmartlife(true);
    setSmartlifeError(null);
    setSmartlifeNotice(null);

    try {
      const response = await apiFetch<SmartlifeAutomationRunResponse>(
        "/settings/smartlife/run-now",
        {
          method: "POST",
        },
      );
      applySmartlifeState(response.state, {
        preserveConnection: true,
        preserveRules: true,
        preserveMeters: true,
      });
      setSmartlifeNotice(
        response.summary.executed_count > 0
          ? `${response.summary.executed_count} commande(s) Smart Life exécutée(s).`
          : response.summary.note || "Aucune commande Smart Life à exécuter.",
      );
    } catch (error: any) {
      setSmartlifeError(
        error.message ??
          "Impossible de lancer l'automatisation Smart Life.",
      );
    } finally {
      setRunningSmartlife(false);
    }
  };

  const testSmartlifeRule = async (ruleId: string) => {
    const rule = smartlifeDraft.rules.find((item) => item.id === ruleId);
    if (!rule) return;

    const deviceId = rule.device_id.trim();
    const commandCode = rule.command_code.trim();
    const device = smartlifeDeviceMap.get(deviceId) ?? null;
    if (!deviceId || !commandCode) {
      setSmartlifeError(
        "Sélectionnez un appareil et une commande avant de lancer le test.",
      );
      return;
    }
    if (
      device &&
      !device.functions.some(
        (functionItem) =>
          functionItem.code === commandCode &&
          functionItem.type.toLowerCase().includes("bool"),
      )
    ) {
      setSmartlifeError(
        "La commande choisie n'accepte pas une valeur ON/OFF. Sélectionnez une commande booléenne.",
      );
      return;
    }

    setTestingSmartlifeRuleId(ruleId);
    setSmartlifeError(null);
    setSmartlifeNotice(null);

    try {
      await apiFetch<{ ok: boolean }>("/settings/smartlife/test-command", {
        method: "POST",
        json: {
          device_id: deviceId,
          command_code: commandCode,
          command_value: getSmartlifeActionCommandValue(rule.action),
        },
      });
      setSmartlifeNotice(
        `Commande test envoyée: ${formatSmartlifeRuleAction(rule.action)} ${rule.device_name.trim() || deviceId}.`,
      );
      if (smartlifeDevices.length > 0) {
        void loadSmartlifeDevices();
      }
    } catch (error: any) {
      setSmartlifeError(
        error.message ?? "Impossible d'envoyer la commande de test.",
      );
    } finally {
      setTestingSmartlifeRuleId(null);
    }
  };

  const saveServerSecuritySettings = async () => {
    const nextDuration = Math.max(
      1,
      Math.min(24 * 90, Math.round(Number(serverSecurityDurationDraft) || 1)),
    );
    const trimmedNewPassword = serverSecurityNewPassword.trim();
    const trimmedConfirmPassword = serverSecurityConfirmPassword.trim();

    setSavingServerSecurity(true);
    setServerSecurityError(null);
    setServerSecurityNotice(null);

    try {
      if (trimmedNewPassword || trimmedConfirmPassword) {
        if (trimmedNewPassword.length < 8) {
          setServerSecurityError(
            "Le nouveau mot de passe doit contenir au moins 8 caractères.",
          );
          return;
        }
        if (trimmedNewPassword !== trimmedConfirmPassword) {
          setServerSecurityError(
            "La confirmation du nouveau mot de passe ne correspond pas.",
          );
          return;
        }
      }

      const response = await apiFetch<ServerSecuritySaveResult>(
        "/settings/security",
        {
          method: "PUT",
          json: {
            currentPassword: serverSecurityCurrentPassword,
            newPassword: trimmedNewPassword || undefined,
            sessionDurationHours: nextDuration,
          },
        },
      );
      applyServerSecuritySettings(response.settings);
      onAuthSessionUpdated?.(response.session);
      setServerSecurityCurrentPassword("");
      setServerSecurityNewPassword("");
      setServerSecurityConfirmPassword("");
      setServerSecurityNotice(
        trimmedNewPassword
          ? response.settings.enabled
            ? "Protection serveur enregistrée et session courante renouvelée."
            : "Paramètres de sécurité enregistrés."
          : "Durée d'expiration enregistrée.",
      );
    } catch (error: any) {
      setServerSecurityError(
        error.message ?? "Impossible d'enregistrer la sécurité serveur.",
      );
    } finally {
      setSavingServerSecurity(false);
    }
  };

  const createManager = async () => {
    const trimmedPrenom = prenom.trim();
    const trimmedNom = nom.trim();
    if (!trimmedPrenom || !trimmedNom) {
      setManagerError("Renseignez le prénom et le nom.");
      return;
    }

    setSavingManager(true);
    setManagerError(null);
    setManagerNotice(null);
    try {
      await apiFetch<Gestionnaire>("/managers", {
        method: "POST",
        json: { prenom: trimmedPrenom, nom: trimmedNom },
      });
      setPrenom("");
      setNom("");
      await loadManagers();
      setManagerNotice("Gestionnaire ajouté.");
    } catch (error: any) {
      setManagerError(error.message);
    } finally {
      setSavingManager(false);
    }
  };

  const removeManager = async (manager: Gestionnaire) => {
    const fullName = `${manager.prenom} ${manager.nom}`.trim();
    if (!confirm(`Supprimer le gestionnaire ${fullName} ?`)) return;

    setDeletingManagerId(manager.id);
    setManagerError(null);
    setManagerNotice(null);
    try {
      await apiFetch(`/managers/${manager.id}`, { method: "DELETE" });
      await loadManagers();
      setManagerNotice("Gestionnaire supprimé.");
    } catch (error: any) {
      setManagerError(error.message);
    } finally {
      setDeletingManagerId(null);
    }
  };

  const createSource = async () => {
    if (
      !sourceDraft.gite_id ||
      !sourceDraft.url.trim() ||
      !sourceDraft.type.trim()
    ) {
      setSourceError("Renseignez le gîte, le type et l'URL iCal.");
      return;
    }

    setCreatingSource(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      await apiFetch<IcalSource>("/settings/ical-sources", {
        method: "POST",
        json: {
          ...sourceDraft,
          url: sourceDraft.url.trim(),
          type: sourceDraft.type.trim(),
        },
      });
      await loadSources();
      setSourceDraft((previous) => ({
        ...DEFAULT_SOURCE_DRAFT,
        gite_id: previous.gite_id,
      }));
      setSourceNotice("Source iCal ajoutée.");
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setCreatingSource(false);
    }
  };

  const updateSourceField = (
    sourceId: string,
    field: keyof IcalSource,
    value: string | boolean,
  ) => {
    setSources((previous) =>
      previous.map((item) =>
        item.id === sourceId
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    );
  };

  const saveSource = async (source: IcalSource) => {
    setSavingSourceId(source.id);
    setSourceError(null);
    setSourceNotice(null);
    try {
      await apiFetch<IcalSource>(`/settings/ical-sources/${source.id}`, {
        method: "PUT",
        json: {
          gite_id: source.gite_id,
          type: source.type,
          url: source.url,
          include_summary: source.include_summary ?? "",
          exclude_summary: source.exclude_summary ?? "",
          is_active: Boolean(source.is_active),
        },
      });
      await loadSources();
      setSourceNotice("Source iCal enregistrée.");
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setSavingSourceId(null);
    }
  };

  const removeSource = async (source: IcalSource) => {
    if (
      !confirm(
        `Supprimer la source ${source.type} pour ${source.gite?.nom ?? "ce gîte"} ?`,
      )
    )
      return;

    setDeletingSourceId(source.id);
    setSourceError(null);
    setSourceNotice(null);
    try {
      await apiFetch(`/settings/ical-sources/${source.id}`, {
        method: "DELETE",
      });
      await loadSources();
      setSourceNotice("Source iCal supprimée.");
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setDeletingSourceId(null);
    }
  };

  const copyIcalExportUrl = async (feed: IcalExportFeed) => {
    setIcalExportsError(null);
    setIcalExportsNotice(null);
    if (!feed.ical_export_token) {
      setIcalExportsError("Token iCal manquant pour ce gîte.");
      return;
    }

    try {
      await navigator.clipboard.writeText(getIcalExportUrl(feed));
      setIcalExportsNotice(`URL iCal copiée pour ${feed.nom}.`);
    } catch (error: any) {
      setIcalExportsError(error?.message ?? "Impossible de copier l'URL iCal.");
    }
  };

  const resetIcalExportToken = async (feed: IcalExportFeed) => {
    if (
      !confirm(
        `Régénérer le token iCal de ${feed.nom} ? Les anciennes URL OTA cesseront de fonctionner.`,
      )
    )
      return;

    setResettingIcalExportId(feed.id);
    setIcalExportsError(null);
    setIcalExportsNotice(null);
    try {
      await apiFetch(`/settings/ical-exports/${feed.id}/reset-token`, {
        method: "POST",
      });
      await loadSources();
      setIcalExportsNotice(`Token iCal régénéré pour ${feed.nom}.`);
    } catch (error: any) {
      setIcalExportsError(
        error.message ?? "Impossible de régénérer le token iCal.",
      );
    } finally {
      setResettingIcalExportId(null);
    }
  };

  const resetIcalExportReservations = async (feed: IcalExportFeed) => {
    if (
      !confirm(
        `Reset OTA pour ${feed.nom} ? Toutes les réservations actuellement prévues pour cet iCal passeront à non exportées. Le macaron retombera à 0 jusqu'à la prochaine création de réservation.`,
      )
    ) {
      return;
    }

    setResettingIcalExportReservationsId(feed.id);
    setIcalExportsError(null);
    setIcalExportsNotice(null);
    try {
      const result = await apiFetch<{
        gite_id: string;
        gite_nom: string;
        reset_count: number;
      }>(`/settings/ical-exports/${feed.id}/reset`, { method: "POST" });
      await loadSources();
      setIcalExportsNotice(
        `${result.reset_count} réservation(s) retirée(s) de l'export OTA pour ${result.gite_nom}.`,
      );
    } catch (error: any) {
      setIcalExportsError(error.message ?? "Impossible de reset l'export OTA.");
    } finally {
      setResettingIcalExportReservationsId(null);
    }
  };

  const triggerSourceImport = () => {
    importSourcesInputRef.current?.click();
  };

  const exportIcalSources = async () => {
    setExportingSources(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const payload = await apiFetch<IcalSourcesExportPayload>(
        "/settings/ical-sources/export",
      );
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ical-sources-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSourceNotice(`${payload.sources.length} source(s) exportée(s).`);
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setExportingSources(false);
    }
  };

  const handleIcalSourcesImportFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setAnalyzingSourcesImport(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      let sourcesPayload: unknown[];
      if (Array.isArray(parsed)) {
        sourcesPayload = parsed;
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { sources?: unknown[] }).sources)
      ) {
        sourcesPayload = (parsed as { sources: unknown[] }).sources;
      } else {
        throw new Error(
          "Format invalide: utilisez un JSON exporté depuis l'application.",
        );
      }

      setSourceImportRows(sourcesPayload);
      setSourceImportMapping({});
      setSourceImportPreview(null);
      setSourceImportFileName(file.name);
      setSourceNotice(
        `Fichier chargé (${sourcesPayload.length} ligne(s)). Cliquez sur "Analyser".`,
      );
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setSourceError("Le fichier n'est pas un JSON valide.");
      } else {
        setSourceError(error.message);
      }
    } finally {
      input.value = "";
      setAnalyzingSourcesImport(false);
    }
  };

  const analyzeIcalSourcesImport = async () => {
    if (!sourceImportRows || sourceImportRows.length === 0) {
      setSourceError("Chargez d'abord un fichier d'import.");
      return;
    }

    setAnalyzingSourcesImport(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const preview = await apiFetch<IcalSourcesImportPreviewResult>(
        "/settings/ical-sources/import/preview",
        {
          method: "POST",
          json: {
            sources: sourceImportRows,
            gite_mapping: sourceImportMapping,
          },
        },
      );
      setSourceImportPreview(preview);
      if (preview.unresolved_count > 0) {
        setSourceNotice(
          `${preview.unresolved_count} gîte(s) introuvable(s): attribuez-les puis importez.`,
        );
      } else {
        setSourceNotice("Analyse terminée: prêt à importer.");
      }
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setAnalyzingSourcesImport(false);
    }
  };

  const importIcalSources = async () => {
    if (!sourceImportRows || sourceImportRows.length === 0) {
      setSourceError("Chargez d'abord un fichier d'import.");
      return;
    }

    setImportingSources(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const result = await apiFetch<IcalSourcesImportResult>(
        "/settings/ical-sources/import",
        {
          method: "POST",
          json: {
            sources: sourceImportRows,
            gite_mapping: sourceImportMapping,
          },
        },
      );
      await loadSources();
      setSourceImportRows(null);
      setSourceImportMapping({});
      setSourceImportPreview(null);
      setSourceImportFileName("");
      setSourceNotice(
        `Import terminé: ${result.created_count} créée(s), ${result.updated_count} mise(s) à jour.`,
      );
    } catch (error: any) {
      setSourceError(error.message);
    } finally {
      setImportingSources(false);
    }
  };

  const runIcalPreview = async () => {
    setLoadingIcalPreview(true);
    setIcalError(null);
    setIcalNotice(null);
    try {
      const data = await apiFetch<IcalPreviewResult>("/settings/ical/preview", {
        method: "POST",
        json: {},
      });
      setIcalPreview(data);
    } catch (error: any) {
      setIcalError(error.message);
    } finally {
      setLoadingIcalPreview(false);
    }
  };

  const saveCronConfig = async () => {
    setSavingCron(true);
    setIcalError(null);
    setIcalNotice(null);
    try {
      const response = await apiFetch<{
        config: IcalCronConfig;
        state: IcalCronState;
      }>("/settings/ical/cron", {
        method: "PUT",
        json: cronDraft,
      });
      setIcalCronState(response.state);
      setCronDraft(response.config);
      setIcalNotice("Planification iCal enregistrée.");
    } catch (error: any) {
      setIcalError(error.message);
    } finally {
      setSavingCron(false);
    }
  };

  const triggerCronImport = () => {
    importCronInputRef.current?.click();
  };

  const exportIcalCronConfig = async () => {
    setExportingCron(true);
    setIcalError(null);
    setIcalNotice(null);
    try {
      const payload = await apiFetch<IcalCronExportPayload>(
        "/settings/ical/cron/export",
      );
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ical-cron-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setIcalNotice("Paramètres iCal exportés.");
    } catch (error: any) {
      setIcalError(error.message);
    } finally {
      setExportingCron(false);
    }
  };

  const importIcalCronConfigFromFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingCron(true);
    setIcalError(null);
    setIcalNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      let payload: unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "config" in parsed &&
        typeof (parsed as { config?: unknown }).config === "object"
      ) {
        payload = { config: (parsed as { config: unknown }).config };
      } else if (parsed && typeof parsed === "object") {
        payload = parsed;
      } else {
        throw new Error(
          "Format invalide: utilisez un JSON exporté depuis l'application.",
        );
      }

      const response = await apiFetch<{
        config: IcalCronConfig;
        state: IcalCronState;
      }>("/settings/ical/cron/import", {
        method: "POST",
        json: payload,
      });
      setIcalCronState(response.state);
      setCronDraft(response.config);
      setIcalNotice("Paramètres iCal importés.");
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setIcalError("Le fichier n'est pas un JSON valide.");
      } else {
        setIcalError(error.message);
      }
    } finally {
      input.value = "";
      setImportingCron(false);
    }
  };

  const triggerPumpConfigImport = () => {
    importPumpConfigInputRef.current?.click();
  };

  const triggerPumpSessionImport = () => {
    importPumpSessionInputRef.current?.click();
  };

  const exportPumpConfig = async () => {
    setExportingPumpConfig(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const payload: PumpConfigExportPayload = {
        version: 1,
        exported_at: new Date().toISOString(),
        config: pumpConfigDraft,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `pump-config-export-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setPumpNotice("Configuration Pump exportée.");
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'exporter la configuration Pump.",
      );
    } finally {
      setExportingPumpConfig(false);
    }
  };

  const importPumpConfigFromFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingPumpConfig(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const source =
        parsed &&
        typeof parsed === "object" &&
        "config" in parsed &&
        (parsed as { config?: unknown }).config
          ? (parsed as { config: unknown }).config
          : parsed;

      const response = await apiFetch<PumpConfigSaveResult>(
        "/settings/pump/config/import",
        {
          method: "POST",
          json: {
            config: source,
          },
        },
      );
      setPumpConfig(response.config);
      setPumpConfigDraft(response.config);
      setPumpNotice(`Configuration Pump importée depuis ${file.name}.`);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setPumpError(
          "Le fichier de configuration Pump n'est pas un JSON valide.",
        );
      } else {
        setPumpError(
          error.message ?? "Impossible d'importer la configuration Pump.",
        );
      }
    } finally {
      input.value = "";
      setImportingPumpConfig(false);
    }
  };

  const importPumpSessionFromFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingPumpSession(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const response = await apiFetch<PumpSessionImportResult>(
        "/settings/pump/session/import",
        {
          method: "POST",
          json: {
            storageState: parsed,
            filename: file.name,
          },
        },
      );
      const persistHint = pumpConfigDraft.persistSession
        ? ""
        : ' Activez "Session persistée" pour l’utiliser.';
      setPumpNotice(
        `Session persistée importée vers ${response.relativePath}.${persistHint}`,
      );
      await loadPumpHealth();
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setPumpError(
          "Le fichier de session persistée n'est pas un JSON valide.",
        );
      } else {
        setPumpError(
          error.message ?? "Impossible d'importer la session persistée.",
        );
      }
    } finally {
      input.value = "";
      setImportingPumpSession(false);
    }
  };

  const exportPumpSession = async () => {
    setExportingPumpSession(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionExportResult>(
        "/settings/pump/session/export",
      );
      const blob = new Blob([JSON.stringify(response.storageState, null, 2)], {
        type: "application/json",
      });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download =
        response.filename ||
        `${response.storageStateId || "pump-session"}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setPumpNotice(
        `Session persistée exportée depuis ${response.relativePath}.`,
      );
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'exporter la session persistée.",
      );
    } finally {
      setExportingPumpSession(false);
    }
  };

  const startPumpSessionCapture = async () => {
    setStartingPumpSessionCapture(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionCaptureResult>(
        "/settings/pump/session/capture/start",
        {
          method: "POST",
        },
      );
      setPumpSessionCapture(response);
      setPumpNotice(
        "Navigateur de capture Pump lancé. Connectez-vous dans la fenêtre ouverte.",
      );
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible de lancer la capture interactive Pump.",
      );
    } finally {
      setStartingPumpSessionCapture(false);
    }
  };

  const cancelPumpSessionCapture = async () => {
    setCancellingPumpSessionCapture(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionCaptureResult>(
        "/settings/pump/session/capture/cancel",
        {
          method: "POST",
        },
      );
      setPumpSessionCapture(response);
      setPumpNotice("Demande d'annulation envoyée à la capture Pump.");
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'annuler la capture interactive Pump.",
      );
    } finally {
      setCancellingPumpSessionCapture(false);
    }
  };

  const startPumpSessionRenewal = async () => {
    setStartingPumpSessionRenewal(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionRenewalResult>(
        "/settings/pump/session/renewal/start",
        {
          method: "POST",
        },
      );
      setPumpSessionRenewal(response);
      setPumpNotice(
        "Renouvellement assisté Airbnb lancé. L'app attendra le code SMS si Airbnb le demande.",
      );
    } catch (error: any) {
      setPumpError(
        error.message ??
          "Impossible de lancer le renouvellement assisté Pump.",
      );
    } finally {
      setStartingPumpSessionRenewal(false);
    }
  };

  const submitPumpSessionRenewalCode = async () => {
    const code = pumpRenewalSmsCode.trim();
    if (!code) {
      setPumpError("Saisissez le code SMS Airbnb.");
      return;
    }

    setSubmittingPumpSessionRenewalCode(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionRenewalResult>(
        "/settings/pump/session/renewal/submit-code",
        {
          method: "POST",
          json: {
            code,
          },
        },
      );
      setPumpSessionRenewal(response);
      setPumpNotice("Code SMS envoyé au renouvellement assisté.");
    } catch (error: any) {
      setPumpError(
        error.message ??
          "Impossible d'envoyer le code SMS au renouvellement Pump.",
      );
    } finally {
      setSubmittingPumpSessionRenewalCode(false);
    }
  };

  const cancelPumpSessionRenewal = async () => {
    setCancellingPumpSessionRenewal(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionRenewalResult>(
        "/settings/pump/session/renewal/cancel",
        {
          method: "POST",
        },
      );
      setPumpSessionRenewal(response);
      setPumpNotice("Renouvellement assisté Airbnb annulé.");
    } catch (error: any) {
      setPumpError(
        error.message ??
          "Impossible d'annuler le renouvellement assisté Pump.",
      );
    } finally {
      setCancellingPumpSessionRenewal(false);
    }
  };

  const runIcalSync = async () => {
    setSyncingIcal(true);
    setIcalError(null);
    setIcalNotice(null);
    try {
      const result = await apiFetch<IcalSyncResult>("/settings/ical/sync", {
        method: "POST",
        json: {},
      });
      setIcalPreview(result);
      await Promise.all([loadCronState(), loadImportLog()]);
      const toVerifyLabel =
        typeof result.to_verify_marked_count === "number"
          ? ` ${result.to_verify_marked_count} marquée(s) "A vérifier", ${result.to_verify_cleared_count ?? 0} retirée(s).`
          : "";
      const deletedLabel =
        typeof result.deleted_count === "number"
          ? `, ${result.deleted_count} suppression(s)`
          : "";
      const pumpLabel = result.pump_follow_up
        ? result.pump_follow_up.status === "success"
          ? ` ${result.pump_follow_up.message}`
          : ` Pump auto en échec: ${result.pump_follow_up.message}`
        : "";
      setIcalNotice(
        `Synchronisation terminée: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour${deletedLabel}, ${result.skipped_count} ignorée(s).${toVerifyLabel}${pumpLabel}`,
      );
      dispatchRecentImportedReservationsCreated(result.created_count);
    } catch (error: any) {
      setIcalError(error.message);
    } finally {
      setSyncingIcal(false);
    }
  };

  const refreshPump = async () => {
    setRefreshingPump(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<{
        sessionId: string;
        status: string;
        message?: string;
      }>("/settings/pump/refresh", {
        method: "POST",
      });
      await Promise.all([loadPumpStatus(), loadPumpHealth()]);
      setPumpNotice(
        result.message ?? `Refresh Pump lancé (${result.sessionId}).`,
      );
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de lancer le refresh Pump.");
    } finally {
      setRefreshingPump(false);
    }
  };

  const savePumpConfig = async () => {
    setSavingPumpConfig(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpConfigSaveResult>(
        "/settings/pump/config",
        {
          method: "PUT",
          json: pumpConfigDraft,
        },
      );
      setPumpConfig(response.config);
      setPumpConfigDraft(response.config);
      await loadPumpHealth();
      setPumpNotice("Configuration Pump enregistrée.");
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'enregistrer la configuration Pump.",
      );
    } finally {
      setSavingPumpConfig(false);
    }
  };

  const testPumpConnection = async () => {
    setTestingPumpConnection(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<PumpConnectionTestResult>(
        "/settings/pump/config/test-connection",
        {
          method: "POST",
          json: pumpConfigDraft,
        },
      );
      await Promise.all([loadPumpHealth(), loadPumpStatus()]);
      const method = result.result?.method ? ` (${result.result.method})` : "";
      setPumpNotice(`Test de connexion Pump validé${method}.`);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de tester la connexion Pump.");
    } finally {
      setTestingPumpConnection(false);
    }
  };

  const testPumpScrollTarget = async () => {
    setTestingPumpScrollTarget(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<PumpScrollTargetTestResult>(
        "/settings/pump/config/test-scroll-target",
        {
          method: "POST",
          json: pumpConfigDraft,
        },
      );
      const selector = result.result?.selector
        ? ` ${result.result.selector}`
        : "";
      setPumpNotice(`Zone de scroll Pump validée${selector}.`);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible de tester la zone de scroll Pump.",
      );
    } finally {
      setTestingPumpScrollTarget(false);
    }
  };

  const savePumpCronConfig = async () => {
    setSavingPumpCron(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<{
        config: PumpCronConfig;
        state: PumpCronState;
      }>("/settings/pump/cron", {
        method: "PUT",
        json: pumpCronDraft,
      });
      setPumpCronState(response.state);
      setPumpCronDraft(response.config);
      await loadPumpHealth();
      setPumpNotice("Planification Pump enregistrée.");
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'enregistrer le cron Pump.");
    } finally {
      setSavingPumpCron(false);
    }
  };

  const analyzePump = async () => {
    setAnalyzingPump(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<PumpPreviewResult>(
        "/settings/pump/preview",
        {
          method: "POST",
        },
      );
      setPumpPreview(result);
      const defaults: Record<string, boolean> = {};
      result.reservations.forEach((item) => {
        if (isImportablePreviewStatus(item.status)) {
          defaults[item.id] = true;
        }
      });
      setPumpSelections(defaults);
      await Promise.all([loadPumpStatus(), loadPumpHealth()]);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'analyser la dernière extraction Pump.",
      );
    } finally {
      setAnalyzingPump(false);
    }
  };

  const importPump = async () => {
    if (!pumpPreview) return;

    const selectedIds = Object.entries(pumpSelections)
      .filter(([, checked]) => checked)
      .map(([id]) => id);

    if (selectedIds.length === 0) {
      setPumpError("Aucune réservation Pump sélectionnée.");
      return;
    }

    setImportingPump(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<PumpImportResult>("/settings/pump/import", {
        method: "POST",
        json: {
          selected_ids: selectedIds,
        },
      });
      setPumpPreview(result);
      await loadImportLog();
      await Promise.all([loadPumpStatus(), loadPumpHealth()]);
      setPumpNotice(
        `Import Pump terminé: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour, ${result.skipped_count} ignorée(s).`,
      );
      dispatchRecentImportedReservationsCreated(result.created_count);
    } catch (error: any) {
      setPumpError(
        error.message ?? "Impossible d'importer les réservations Pump.",
      );
    } finally {
      setImportingPump(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__panel">
            <h1 className="settings-sidebar__title">Paramètres</h1>
            <nav
              className="settings-sidebar__nav"
              aria-label="Rubriques des paramètres"
            >
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  id={`nav-${section.id}`}
                  type="button"
                  className={`settings-sidebar__link${
                    activeSettingsSection === section.id
                      ? " settings-sidebar__link--active"
                      : ""
                  }`}
                  onClick={() => setActiveSettingsSection(section.id)}
                  aria-current={
                    activeSettingsSection === section.id ? "page" : undefined
                  }
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <div className="settings-content">
          <section
            id="settings-security"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-security"}
            aria-labelledby="nav-settings-security"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Sécurité</div>
                <h2 className="settings-cluster__title">Accès serveur</h2>
              </div>
              <p className="settings-cluster__text">
                Le mot de passe administrateur est hashé côté serveur et la
                session est portée par un cookie HTTP-only.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--sand settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Session</span>
                  <span className="settings-card__badge">
                    {serverSecuritySettings.enabled
                      ? "Protection active"
                      : "Protection inactive"}
                  </span>
                </div>
                <div className="section-title">Mot de passe et expiration</div>
                <div className="field-hint">
                  {serverSecuritySettings.passwordConfigured
                    ? `Session courante valable jusqu'au ${formatIsoDateTimeFr(serverSecuritySettings.sessionExpiresAt)}.`
                    : "Aucun mot de passe serveur n'est encore enregistré. Définissez-en un pour activer la protection."}
                </div>
                {loadingServerSecurity ? (
                  <div className="field-hint" style={{ marginTop: 12 }}>
                    Chargement...
                  </div>
                ) : (
                  <>
                    <div className="grid-2" style={{ marginTop: 16 }}>
                      <label className="field">
                        Expiration de session (heures)
                        <input
                          type="number"
                          min={1}
                          max={24 * 90}
                          value={serverSecurityDurationDraft}
                          onChange={(event) => {
                            setServerSecurityError(null);
                            setServerSecurityNotice(null);
                            setServerSecurityDurationDraft(
                              Math.max(
                                1,
                                Math.min(
                                  24 * 90,
                                  Number(event.target.value || 1),
                                ),
                              ),
                            );
                          }}
                          disabled={savingServerSecurity}
                        />
                      </label>
                      <div className="field-hint" style={{ alignSelf: "end" }}>
                        La durée s'applique aux nouvelles connexions et
                        renouvelle la session courante après enregistrement.
                      </div>
                      {serverSecuritySettings.passwordConfigured ? (
                        <label className="field">
                          Mot de passe actuel
                          <input
                            type="password"
                            value={serverSecurityCurrentPassword}
                            onChange={(event) => {
                              setServerSecurityError(null);
                              setServerSecurityNotice(null);
                              setServerSecurityCurrentPassword(
                                event.target.value,
                              );
                            }}
                            placeholder="Requis uniquement si vous changez le mot de passe"
                            disabled={savingServerSecurity}
                          />
                        </label>
                      ) : (
                        <div
                          className="field-hint"
                          style={{ alignSelf: "end" }}
                        >
                          Le premier mot de passe active la protection
                          immédiatement pour ce navigateur.
                        </div>
                      )}
                      <label className="field">
                        {serverSecuritySettings.passwordConfigured
                          ? "Nouveau mot de passe"
                          : "Mot de passe initial"}
                        <input
                          type="password"
                          value={serverSecurityNewPassword}
                          onChange={(event) => {
                            setServerSecurityError(null);
                            setServerSecurityNotice(null);
                            setServerSecurityNewPassword(event.target.value);
                          }}
                          placeholder={
                            serverSecuritySettings.passwordConfigured
                              ? "Laisser vide pour conserver l'actuel"
                              : "Minimum 8 caractères"
                          }
                          disabled={savingServerSecurity}
                        />
                      </label>
                      <label className="field">
                        Confirmation du mot de passe
                        <input
                          type="password"
                          value={serverSecurityConfirmPassword}
                          onChange={(event) => {
                            setServerSecurityError(null);
                            setServerSecurityNotice(null);
                            setServerSecurityConfirmPassword(
                              event.target.value,
                            );
                          }}
                          placeholder="Confirmer le nouveau mot de passe"
                          disabled={savingServerSecurity}
                        />
                      </label>
                    </div>
                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        onClick={() => void saveServerSecuritySettings()}
                        disabled={savingServerSecurity}
                      >
                        {savingServerSecurity
                          ? "Enregistrement..."
                          : serverSecuritySettings.passwordConfigured
                            ? "Enregistrer la sécurité"
                            : "Activer la protection"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadServerSecuritySettings()}
                        disabled={loadingServerSecurity || savingServerSecurity}
                      >
                        {loadingServerSecurity ? "Chargement..." : "Recharger"}
                      </button>
                    </div>
                    {serverSecurityNotice ? (
                      <div className="note note--success">
                        {serverSecurityNotice}
                      </div>
                    ) : null}
                    {serverSecurityError ? (
                      <div className="note">{serverSecurityError}</div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-import-log"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-import-log"}
            aria-labelledby="nav-settings-import-log"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Traçabilité</div>
                <h2 className="settings-cluster__title">Journal des imports</h2>
              </div>
              <p className="settings-cluster__text">
                Gardez une trace claire des imports réellement appliqués et de
                leurs effets sur les réservations.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--neutral settings-card--span-12">
                <div className="settings-managers-header">
                  <div>
                    <div className="settings-card__tag">Traçabilité</div>
                    <div className="section-title">Journal des imports</div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadImportLog()}
                    disabled={loadingImportLog}
                  >
                    {loadingImportLog ? "Chargement..." : "Rafraîchir"}
                  </button>
                </div>
                {importLogError && <div className="note">{importLogError}</div>}
                {!importLogError && importLog.length === 0 ? (
                  <div className="field-hint">Aucun import enregistré.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {importLog.slice(0, importLogVisibleCount).map((entry) => (
                      <div key={entry.id} className="field-group">
                        <div className="field-group__header">
                          <div className="field-group__label">
                            {formatImportLogTitle(entry)}
                          </div>
                          <div className="field-hint">
                            {formatIsoDateTimeFr(entry.at)}
                          </div>
                        </div>
                        <div className="field-hint">
                          {formatImportLogSummary(entry)}
                        </div>
                        {Array.isArray(entry.insertedItems) &&
                        entry.insertedItems.length > 0 ? (
                          <div style={{ marginTop: 8 }}>
                            <div
                              className="field-hint"
                              style={{ marginBottom: 4 }}
                            >
                              Nouvelles réservations
                            </div>
                            <div style={{ display: "grid", gap: 4 }}>
                              {entry.insertedItems
                                .slice(0, IMPORT_LOG_EVENT_VISIBLE_COUNT)
                                .map((item, index) => (
                                  <div
                                    key={`${entry.id}-inserted-${index}`}
                                    className="field-hint"
                                    style={{
                                      display: "flex",
                                      flexWrap: "wrap",
                                      gap: 8,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: "#111827",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {item.giteName || item.giteId || "-"}
                                    </span>
                                    <span>
                                      {item.checkIn
                                        ? formatIsoDateFr(item.checkIn)
                                        : "-"}{" "}
                                      -{" "}
                                      {item.checkOut
                                        ? formatIsoDateFr(item.checkOut)
                                        : "-"}
                                    </span>
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}
                                    >
                                      <span
                                        style={{
                                          width: 10,
                                          height: 10,
                                          borderRadius: "999px",
                                          background: getPaymentColor(
                                            item.source,
                                            paymentColorMap,
                                          ),
                                          border:
                                            "1px solid rgba(17, 24, 39, 0.2)",
                                        }}
                                      />
                                      <span>{item.source || "-"}</span>
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ) : null}
                        {Array.isArray(entry.updatedItems) &&
                        entry.updatedItems.length > 0 ? (
                          <div style={{ marginTop: 8 }}>
                            <div
                              className="field-hint"
                              style={{ marginBottom: 4 }}
                            >
                              Mises à jour
                            </div>
                            <div style={{ display: "grid", gap: 4 }}>
                              {entry.updatedItems
                                .slice(0, IMPORT_LOG_EVENT_VISIBLE_COUNT)
                                .map((item, index) => {
                                  const updatedFields =
                                    formatImportLogUpdatedFields(
                                      item.updatedFields,
                                    );
                                  return (
                                    <div
                                      key={`${entry.id}-updated-${index}`}
                                      className="field-hint"
                                      style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: 8,
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: "#111827",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {item.giteName || item.giteId || "-"}
                                      </span>
                                      <span>
                                        {item.checkIn
                                          ? formatIsoDateFr(item.checkIn)
                                          : "-"}{" "}
                                        -{" "}
                                        {item.checkOut
                                          ? formatIsoDateFr(item.checkOut)
                                          : "-"}
                                      </span>
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                      >
                                        <span
                                          style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: "999px",
                                            background: getPaymentColor(
                                              item.source,
                                              paymentColorMap,
                                            ),
                                            border:
                                              "1px solid rgba(17, 24, 39, 0.2)",
                                          }}
                                        />
                                        <span>{item.source || "-"}</span>
                                      </span>
                                      {updatedFields ? (
                                        <span>Modifié: {updatedFields}</span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {importLog.length > importLogVisibleCount ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setImportLogVisibleCount((previous) =>
                            Math.min(
                              importLog.length,
                              previous + IMPORT_LOG_VISIBLE_STEP,
                            ),
                          );
                        }}
                      >
                        Afficher plus (
                        {importLog.length - importLogVisibleCount} restante
                        {importLog.length - importLogVisibleCount > 1
                          ? "s"
                          : ""}
                        )
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-sms"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-sms"}
            aria-labelledby="nav-settings-sms"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Communication</div>
                <h2 className="settings-cluster__title">SMS</h2>
              </div>
              <p className="settings-cluster__text">
                Gérez les textes optionnels utilisés dans la prise de
                réservation mobile.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--blue settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">SMS</span>
                  <span className="settings-card__badge">
                    {smsTextCount} texte(s)
                  </span>
                </div>
                <div className="section-title">Textes optionnels</div>
                <div className="field-hint">
                  Ces textes alimentent les switches du bloc SMS dans la prise
                  de réservation mobile.
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  {smsTextSettings.texts.length} texte(s) actuellement
                  enregistrés.
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Variables disponibles: {"{nom}"}, {"{gite}"}, {"{adresse}"},{" "}
                  {"{dateDebut}"}, {"{dateFin}"}, {"{nbNuits}"},{" "}
                  {"{heureArrivee}"}, {"{heureDepart}"}
                </div>
                {loadingSmsTexts ? (
                  <div className="field-hint" style={{ marginTop: 12 }}>
                    Chargement...
                  </div>
                ) : (
                  <>
                    <div
                      className="settings-sms-texts"
                      style={{ marginTop: 16 }}
                    >
                      {smsTextDraft.map((item, index) => (
                        <div key={item.id} className="settings-sms-text-row">
                          <div className="settings-sms-text-row__header">
                            <strong>Texte {index + 1}</strong>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                setSmsTextError(null);
                                setSmsTextNotice(null);
                                setSmsTextDraft((previous) =>
                                  previous.filter(
                                    (entry) => entry.id !== item.id,
                                  ),
                                );
                              }}
                              disabled={
                                savingSmsTexts || smsTextDraft.length <= 1
                              }
                            >
                              Supprimer
                            </button>
                          </div>
                          <label className="field">
                            Titre
                            <input
                              type="text"
                              value={item.title}
                              onChange={(event) => {
                                setSmsTextError(null);
                                setSmsTextNotice(null);
                                setSmsTextDraft((previous) =>
                                  previous.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, title: event.target.value }
                                      : entry,
                                  ),
                                );
                              }}
                              placeholder="Ex: Adresse du gîte"
                              disabled={savingSmsTexts}
                            />
                          </label>
                          <label className="field">
                            Texte
                            <textarea
                              rows={3}
                              value={item.text}
                              onChange={(event) => {
                                setSmsTextError(null);
                                setSmsTextNotice(null);
                                setSmsTextDraft((previous) =>
                                  previous.map((entry) =>
                                    entry.id === item.id
                                      ? { ...entry, text: event.target.value }
                                      : entry,
                                  ),
                                );
                              }}
                              placeholder="Contenu du SMS"
                              disabled={savingSmsTexts}
                            />
                          </label>
                        </div>
                      ))}
                    </div>

                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setSmsTextError(null);
                          setSmsTextNotice(null);
                          setSmsTextDraft((previous) => [
                            ...previous,
                            { id: createSmsTextDraftId(), title: "", text: "" },
                          ]);
                        }}
                        disabled={savingSmsTexts}
                      >
                        Ajouter un texte
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSmsTextSettings()}
                        disabled={savingSmsTexts}
                      >
                        {savingSmsTexts ? "Enregistrement..." : "Enregistrer"}
                      </button>
                    </div>
                    {smsTextNotice ? (
                      <div className="note note--success">{smsTextNotice}</div>
                    ) : null}
                    {smsTextError ? (
                      <div className="note">{smsTextError}</div>
                    ) : null}
                  </>
                )}
              </div>

            </div>
          </section>

          <section
            id="settings-email-texts"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-email-texts"}
            aria-labelledby="nav-settings-email-texts"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Communication</div>
                <h2 className="settings-cluster__title">Emails</h2>
              </div>
              <p className="settings-cluster__text">
                Définissez les sujets et textes par défaut utilisés pour les
                e-mails de contrat et de facture.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--blue settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Modèles email</span>
                </div>
                <div className="section-title">Textes d'emails</div>
                <div className="field-hint">
                  Variables disponibles selon le type: {"{{greeting}}"},{" "}
                  {"{{documentUrl}}"}, {"{{giteName}}"}, {"{{documentNumber}}"},{" "}
                  {"{{locataireNom}}"}, {"{{giteSentence}}"},{" "}
                  {"{{giteReference}}"}, {"{{stayDuration}}"},{" "}
                  {"{{dateDebutLong}}"}, {"{{heureArrivee}}"},{" "}
                  {"{{dateFinLong}}"}, {"{{heureDepart}}"},{" "}
                  {"{{arrhesMontant}}"}, {"{{arrhesDateLimiteLong}}"},{" "}
                  {"{{arrhesInstruction}}"}, {"{{soldeMontant}}"},{" "}
                  {"{{activitiesList}}"}, {"{{guideUrl}}"}, {"{{destinationUrl}}"}
                </div>
                {loadingDocumentEmailTexts ? (
                  <div className="field-hint" style={{ marginTop: 12 }}>
                    Chargement...
                  </div>
                ) : (
                  <>
                    <div
                      className="settings-sms-texts"
                      style={{ marginTop: 16 }}
                    >
                      <div className="settings-sms-text-row">
                        <div className="settings-sms-text-row__header">
                          <strong>Contrat</strong>
                        </div>
                        <label className="field">
                          Sujet
                          <input
                            type="text"
                            value={documentEmailTextDraft.contrat.subject}
                            onChange={(event) => {
                              setDocumentEmailTextError(null);
                              setDocumentEmailTextNotice(null);
                              setDocumentEmailTextDraft((previous) => ({
                                ...previous,
                                contrat: {
                                  ...previous.contrat,
                                  subject: event.target.value,
                                },
                              }));
                            }}
                            disabled={savingDocumentEmailTexts}
                          />
                        </label>
                        <label className="field">
                          Corps
                          <textarea
                            rows={16}
                            value={documentEmailTextDraft.contrat.body}
                            onChange={(event) => {
                              setDocumentEmailTextError(null);
                              setDocumentEmailTextNotice(null);
                              setDocumentEmailTextDraft((previous) => ({
                                ...previous,
                                contrat: {
                                  ...previous.contrat,
                                  body: event.target.value,
                                },
                              }));
                            }}
                            disabled={savingDocumentEmailTexts}
                          />
                        </label>
                        <label className="field">
                          Activités suggérées
                          <textarea
                            rows={8}
                            value={
                              documentEmailTextDraft.contrat.activitiesList
                            }
                            onChange={(event) => {
                              setDocumentEmailTextError(null);
                              setDocumentEmailTextNotice(null);
                              setDocumentEmailTextDraft((previous) => ({
                                ...previous,
                                contrat: {
                                  ...previous.contrat,
                                  activitiesList: event.target.value,
                                },
                              }));
                            }}
                            disabled={savingDocumentEmailTexts}
                          />
                        </label>
                        <div className="grid-2">
                          <label className="field">
                            URL guide
                            <input
                              type="text"
                              value={documentEmailTextDraft.contrat.guideUrl}
                              onChange={(event) => {
                                setDocumentEmailTextError(null);
                                setDocumentEmailTextNotice(null);
                                setDocumentEmailTextDraft((previous) => ({
                                  ...previous,
                                  contrat: {
                                    ...previous.contrat,
                                    guideUrl: event.target.value,
                                  },
                                }));
                              }}
                              disabled={savingDocumentEmailTexts}
                            />
                          </label>
                          <label className="field">
                            URL destination
                            <input
                              type="text"
                              value={
                                documentEmailTextDraft.contrat.destinationUrl
                              }
                              onChange={(event) => {
                                setDocumentEmailTextError(null);
                                setDocumentEmailTextNotice(null);
                                setDocumentEmailTextDraft((previous) => ({
                                  ...previous,
                                  contrat: {
                                    ...previous.contrat,
                                    destinationUrl: event.target.value,
                                  },
                                }));
                              }}
                              disabled={savingDocumentEmailTexts}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="settings-sms-text-row">
                        <div className="settings-sms-text-row__header">
                          <strong>Facture</strong>
                        </div>
                        <label className="field">
                          Sujet
                          <input
                            type="text"
                            value={documentEmailTextDraft.facture.subject}
                            onChange={(event) => {
                              setDocumentEmailTextError(null);
                              setDocumentEmailTextNotice(null);
                              setDocumentEmailTextDraft((previous) => ({
                                ...previous,
                                facture: {
                                  ...previous.facture,
                                  subject: event.target.value,
                                },
                              }));
                            }}
                            disabled={savingDocumentEmailTexts}
                          />
                        </label>
                        <label className="field">
                          Corps
                          <textarea
                            rows={10}
                            value={documentEmailTextDraft.facture.body}
                            onChange={(event) => {
                              setDocumentEmailTextError(null);
                              setDocumentEmailTextNotice(null);
                              setDocumentEmailTextDraft((previous) => ({
                                ...previous,
                                facture: {
                                  ...previous.facture,
                                  body: event.target.value,
                                },
                              }));
                            }}
                            disabled={savingDocumentEmailTexts}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadDocumentEmailTextSettings()}
                        disabled={
                          loadingDocumentEmailTexts || savingDocumentEmailTexts
                        }
                      >
                        {loadingDocumentEmailTexts
                          ? "Chargement..."
                          : "Recharger"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveDocumentEmailTextSettings()}
                        disabled={savingDocumentEmailTexts}
                      >
                        {savingDocumentEmailTexts
                          ? "Enregistrement..."
                          : "Enregistrer"}
                      </button>
                    </div>
                    {documentEmailTextNotice ? (
                      <div className="note note--success">
                        {documentEmailTextNotice}
                      </div>
                    ) : null}
                    {documentEmailTextError ? (
                      <div className="note">{documentEmailTextError}</div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-daily-reservation-email"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-daily-reservation-email"}
            aria-labelledby="nav-settings-daily-reservation-email"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Communication</div>
                <h2 className="settings-cluster__title">Email quotidien</h2>
              </div>
              <p className="settings-cluster__text">
                Configurez le digest quotidien des nouvelles réservations avec
                des réglages distincts par adresse email.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Digest quotidien</span>
                </div>
                <div className="section-title">
                  Email quotidien des nouvelles réservations
                </div>
                <div className="field-hint">
                  Envoie un email stylé récapitulant les réservations créées
                  sur les dernières 24h, avec les totaux actuels par gîte et
                  le total global.
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Le bouton <strong>Envoyer maintenant</strong> force un envoi
                  immédiat pour vérifier le rendu, même sans nouvelle
                  réservation.
                </div>
                {loadingDailyReservationEmail ? (
                  <div className="field-hint" style={{ marginTop: 12 }}>
                    Chargement...
                  </div>
                ) : !dailyReservationEmailStateLoaded ? (
                  <>
                    {dailyReservationEmailError ? (
                      <div className="note" style={{ marginTop: 16 }}>
                        {dailyReservationEmailError}
                      </div>
                    ) : (
                      <div className="note" style={{ marginTop: 16 }}>
                        La configuration de l'email quotidien n'a pas pu être
                        chargée.
                      </div>
                    )}
                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadDailyReservationEmailState()}
                        disabled={loadingDailyReservationEmail}
                      >
                        {loadingDailyReservationEmail
                          ? "Chargement..."
                          : "Recharger"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid-2" style={{ marginTop: 16 }}>
                      <label className="field">
                        Activation
                        <select
                          value={dailyReservationEmailDraft.enabled ? "1" : "0"}
                          onChange={(event) => {
                            setDailyReservationEmailError(null);
                            setDailyReservationEmailNotice(null);
                            setDailyReservationEmailDraft((previous) => ({
                              ...previous,
                              enabled: event.target.value === "1",
                            }));
                          }}
                          disabled={
                            savingDailyReservationEmail ||
                            runningDailyReservationEmail
                          }
                        >
                          <option value="0">Désactivé</option>
                          <option value="1">Activé</option>
                        </select>
                      </label>
                      <label className="field">
                        Heure d'envoi
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={dailyReservationEmailDraft.hour}
                          onChange={(event) => {
                            setDailyReservationEmailError(null);
                            setDailyReservationEmailNotice(null);
                            setDailyReservationEmailDraft((previous) => ({
                              ...previous,
                              hour: Math.min(
                                23,
                                Math.max(
                                  0,
                                  Math.round(
                                    Number(event.target.value || 0),
                                  ),
                                ),
                              ),
                            }));
                          }}
                          disabled={
                            savingDailyReservationEmail ||
                            runningDailyReservationEmail
                          }
                        />
                      </label>
                      <label className="field">
                        Minute
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={dailyReservationEmailDraft.minute}
                          onChange={(event) => {
                            setDailyReservationEmailError(null);
                            setDailyReservationEmailNotice(null);
                            setDailyReservationEmailDraft((previous) => ({
                              ...previous,
                              minute: Math.min(
                                59,
                                Math.max(
                                  0,
                                  Math.round(
                                    Number(event.target.value || 0),
                                  ),
                                ),
                              ),
                            }));
                          }}
                          disabled={
                            savingDailyReservationEmail ||
                            runningDailyReservationEmail
                          }
                        />
                      </label>
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <div className="field-hint">
                        Chaque adresse peut avoir ses propres réglages.
                      </div>
                      <div
                        className="settings-sms-texts"
                        style={{ marginTop: 8 }}
                      >
                        {dailyReservationEmailDraft.recipients.map(
                          (recipient, index) => (
                            <div
                              key={`daily-recipient-${index}`}
                              className="settings-sms-text-row"
                            >
                              <div className="settings-sms-text-row__header">
                                <strong>
                                  {recipient.email ||
                                    `Destinataire ${index + 1}`}
                                </strong>
                                <button
                                  type="button"
                                  className="danger-link"
                                  onClick={() => {
                                    setDailyReservationEmailError(null);
                                    setDailyReservationEmailNotice(null);
                                    setDailyReservationEmailDraft((previous) => ({
                                      ...previous,
                                      recipients: previous.recipients.filter(
                                        (_item, itemIndex) =>
                                          itemIndex !== index,
                                      ),
                                    }));
                                  }}
                                  disabled={
                                    savingDailyReservationEmail ||
                                    runningDailyReservationEmail
                                  }
                                >
                                  Supprimer
                                </button>
                              </div>
                              <div className="grid-2">
                                <label className="field">
                                  Adresse email
                                  <input
                                    type="email"
                                    value={recipient.email}
                                    onChange={(event) => {
                                      setDailyReservationEmailError(null);
                                      setDailyReservationEmailNotice(null);
                                      setDailyReservationEmailDraft((previous) => ({
                                        ...previous,
                                        recipients: previous.recipients.map(
                                          (item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  email: event.target.value,
                                                }
                                              : item,
                                        ),
                                      }));
                                    }}
                                    disabled={
                                      savingDailyReservationEmail ||
                                      runningDailyReservationEmail
                                    }
                                    placeholder="contact@example.com"
                                  />
                                </label>
                                <label className="field">
                                  Actif
                                  <select
                                    value={recipient.enabled ? "1" : "0"}
                                    onChange={(event) => {
                                      setDailyReservationEmailError(null);
                                      setDailyReservationEmailNotice(null);
                                      setDailyReservationEmailDraft((previous) => ({
                                        ...previous,
                                        recipients: previous.recipients.map(
                                          (item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  enabled:
                                                    event.target.value === "1",
                                                }
                                              : item,
                                        ),
                                      }));
                                    }}
                                    disabled={
                                      savingDailyReservationEmail ||
                                      runningDailyReservationEmail
                                    }
                                  >
                                    <option value="1">Oui</option>
                                    <option value="0">Non</option>
                                  </select>
                                </label>
                                <label className="field">
                                  Envoyer même sans nouvelle résa
                                  <select
                                    value={recipient.send_if_empty ? "1" : "0"}
                                    onChange={(event) => {
                                      setDailyReservationEmailError(null);
                                      setDailyReservationEmailNotice(null);
                                      setDailyReservationEmailDraft((previous) => ({
                                        ...previous,
                                        recipients: previous.recipients.map(
                                          (item, itemIndex) =>
                                            itemIndex === index
                                              ? {
                                                  ...item,
                                                  send_if_empty:
                                                    event.target.value === "1",
                                                }
                                              : item,
                                        ),
                                      }));
                                    }}
                                    disabled={
                                      savingDailyReservationEmail ||
                                      runningDailyReservationEmail
                                    }
                                  >
                                    <option value="0">Non</option>
                                    <option value="1">Oui</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                      <div className="actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setDailyReservationEmailError(null);
                            setDailyReservationEmailNotice(null);
                            setDailyReservationEmailDraft((previous) => ({
                              ...previous,
                              recipients: [
                                ...previous.recipients,
                                createDailyReservationRecipientDraft(),
                              ],
                            }));
                          }}
                          disabled={
                            savingDailyReservationEmail ||
                            runningDailyReservationEmail
                          }
                        >
                          Ajouter un destinataire
                        </button>
                      </div>
                    </div>

                    <div className="field-hint" style={{ marginTop: 8 }}>
                      Prochain passage:{" "}
                      <strong>
                        {formatIsoDateTimeFr(
                          dailyReservationEmailState.next_run_at,
                        )}
                      </strong>
                      {" · "}Dernier run:{" "}
                      <strong>
                        {formatIsoDateTimeFr(
                          dailyReservationEmailState.last_run_at,
                        )}
                      </strong>
                      {" · "}Dernier email envoyé:{" "}
                      <strong>
                        {formatIsoDateTimeFr(
                          dailyReservationEmailState.last_email_sent_at,
                        )}
                      </strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 8 }}>
                      SMTP:{" "}
                      <strong>
                        {dailyReservationEmailState.smtp_configured
                          ? "configuré"
                          : "incomplet"}
                      </strong>
                      {dailyReservationEmailState.smtp_issues.length > 0
                        ? ` (${dailyReservationEmailState.smtp_issues.join(", ")})`
                        : ""}
                      {" · "}Statut:{" "}
                      <strong>{dailyReservationEmailState.last_status}</strong>
                    </div>

                    {dailyReservationEmailState.last_result ? (
                      <div className="field-hint" style={{ marginTop: 12 }}>
                        Dernière fenêtre:{" "}
                        {formatIsoDateTimeFr(
                          dailyReservationEmailState.last_result
                            .window_start_at,
                        )}{" "}
                        →{" "}
                        {formatIsoDateTimeFr(
                          dailyReservationEmailState.last_result.window_end_at,
                        )}
                        {" · "}
                        {dailyReservationEmailState.last_result
                          .new_reservations_count}{" "}
                        nouvelle
                        {dailyReservationEmailState.last_result
                          .new_reservations_count > 1
                          ? "s"
                          : ""}
                        {" · "}Total du mois{" "}
                        {formatEuro(
                          dailyReservationEmailState.last_result.total_amount,
                        )}
                      </div>
                    ) : null}

                    {dailyReservationEmailState.last_result?.totals_by_gite
                      ?.length ? (
                      <div style={{ marginTop: 14 }}>
                        <div className="field-hint">
                          Totaux du mois mémorisés au dernier envoi/run:
                        </div>
                        <div
                          className="settings-sms-texts"
                          style={{ marginTop: 8 }}
                        >
                          {dailyReservationEmailState.last_result.totals_by_gite.map(
                            (item) => (
                              <div
                                key={`${item.gite_id ?? item.gite_nom}-daily-email`}
                                className="settings-sms-text-row"
                              >
                                <div className="settings-sms-text-row__header">
                                  <strong>{item.gite_nom}</strong>
                                  <span>
                                    {item.reservations_count} réservation
                                    {item.reservations_count > 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="field-hint">
                                  {formatEuro(item.total_amount)}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadDailyReservationEmailState()}
                        disabled={
                          loadingDailyReservationEmail ||
                          savingDailyReservationEmail ||
                          runningDailyReservationEmail
                        }
                      >
                        {loadingDailyReservationEmail
                          ? "Chargement..."
                          : "Recharger"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void runDailyReservationEmailNow()}
                        disabled={
                          savingDailyReservationEmail ||
                          runningDailyReservationEmail
                        }
                      >
                        {runningDailyReservationEmail
                          ? "Envoi..."
                          : "Envoyer maintenant"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveDailyReservationEmailSettings()}
                        disabled={
                          savingDailyReservationEmail ||
                          runningDailyReservationEmail
                        }
                      >
                        {savingDailyReservationEmail
                          ? "Enregistrement..."
                          : "Enregistrer"}
                      </button>
                    </div>
                    {dailyReservationEmailNotice ? (
                      <div className="note note--success">
                        {dailyReservationEmailNotice}
                      </div>
                    ) : null}
                    {dailyReservationEmailError ? (
                      <div className="note">{dailyReservationEmailError}</div>
                    ) : null}
                    {!dailyReservationEmailState.smtp_configured ? (
                      <div className="note" style={{ marginTop: 12 }}>
                        Configurez le SMTP dans le fichier d'environnement pour
                        activer l'envoi réel.
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-smartlife"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-smartlife"}
            aria-labelledby="nav-settings-smartlife"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Domotique</div>
                <h2 className="settings-cluster__title">Smart Life</h2>
              </div>
              <p className="settings-cluster__text">
                Activez ou coupez certains interrupteurs avant l'arrivée ou le
                départ, en vous basant sur l'heure par défaut du gîte.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--green settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Automatisation</span>
                  <span className="settings-card__badge">
                    {smartlifeState.credentials_configured
                      ? "Tuya prêt"
                      : "Identifiants requis"}
                  </span>
                </div>
                <div className="section-title">
                  Interrupteurs Smart Life programmés
                </div>
                {loadingSmartlife ? (
                  <div className="field-hint" style={{ marginTop: 12 }}>
                    Chargement...
                  </div>
                ) : !smartlifeLoaded ? (
                  <>
                    <div className="note" style={{ marginTop: 16 }}>
                      {smartlifeError ||
                        "La configuration Smart Life n'a pas pu être chargée."}
                    </div>
                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadSmartlifeState()}
                        disabled={loadingSmartlife}
                      >
                        Recharger
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field-hint" style={{ marginTop: 10 }}>
                      {smartlifeState.scheduler === "external" ? (
                        <>
                          Déclenchement: <strong>cron HTTP externe</strong>
                          {" · "}Dernier run:{" "}
                          <strong>
                            {formatIsoDateTimeFr(smartlifeState.last_run_at)}
                          </strong>
                          {" · "}Statut:{" "}
                          <strong>
                            {formatSmartlifeRunStatus(
                              smartlifeState.last_status,
                            )}
                          </strong>
                        </>
                      ) : (
                        <>
                          Prochain passage:{" "}
                          <strong>
                            {formatIsoDateTimeFr(smartlifeState.next_run_at)}
                          </strong>
                          {" · "}Dernier run:{" "}
                          <strong>
                            {formatIsoDateTimeFr(smartlifeState.last_run_at)}
                          </strong>
                          {" · "}Statut:{" "}
                          <strong>
                            {formatSmartlifeRunStatus(
                              smartlifeState.last_status,
                            )}
                          </strong>
                        </>
                      )}
                    </div>

                    <div className="field-hint" style={{ marginTop: 6 }}>
                      Appareils chargés: <strong>{smartlifeDevices.length}</strong>
                      {" · "}Identifiants:{" "}
                      <strong>
                        {smartlifeState.credentials_configured
                          ? "configurés"
                          : "incomplets"}
                      </strong>
                    </div>

                    {smartlifeState.last_result ? (
                      <div className="field-hint" style={{ marginTop: 8 }}>
                        Dernier passage: {smartlifeState.last_result.executed_count} exécutée(s),
                        {" "}
                        {smartlifeState.last_result.skipped_count} ignorée(s),
                        {" "}
                        {smartlifeState.last_result.error_count} erreur(s)
                        {smartlifeState.last_result.note
                          ? ` · ${smartlifeState.last_result.note}`
                          : ""}
                      </div>
                    ) : null}

                    <div style={{ marginTop: 18 }}>
                      <div className="field-hint">
                        Chaque règle cible un ou plusieurs gîtes, un appareil,
                        une commande booléenne, et un décalage horaire avant ou
                        après l'arrivée ou le départ.
                      </div>
                      <input
                        ref={importSmartlifeRulesInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={(event) => void importSmartlifeRulesFromFile(event)}
                        style={{ display: "none" }}
                      />
                      <div
                        className="settings-sms-texts"
                        style={{ marginTop: 8 }}
                      >
                        {groupedSmartlifeRules.map((group) => (
                          <div
                            key={`smartlife-group-${group.key}`}
                            className="settings-source-group"
                            style={{
                              borderColor: `${group.color}33`,
                              background: `${group.color}08`,
                            }}
                          >
                            <div className="settings-source-group__header">
                              <div>
                                <div
                                  className="settings-source-group__title"
                                  style={{ color: group.color }}
                                >
                                  {group.title}
                                </div>
                                <div className="field-hint">
                                  {group.rules.length} règle(s)
                                </div>
                              </div>
                              <span
                                className="settings-card__badge"
                                style={{
                                  background: `${group.color}1f`,
                                  borderColor: `${group.color}55`,
                                  color: group.color,
                                }}
                              >
                                {group.rules.length} règle(s)
                              </span>
                            </div>

                            <div className="settings-sms-texts">
                              {group.rules.map(({ rule, displayIndex }) => {
                                const device =
                                  smartlifeDeviceMap.get(rule.device_id) ?? null;
                                const availableActionOptions =
                                  getAvailableSmartlifeRuleActions(device);
                                const effectiveAction =
                                  getCompatibleSmartlifeRuleAction(
                                    rule.action,
                                    device,
                                  );
                                const ruleGites = sanitizeSmartlifeRuleGiteIds(
                                  rule.gite_ids,
                                  smartlifeValidGiteIds,
                                )
                                  .map(
                                    (giteId) =>
                                      gites.find((gite) => gite.id === giteId) ??
                                      null,
                                  )
                                  .filter((value): value is Gite => Boolean(value));
                                const availableFunctions =
                                  device?.functions.filter((item) =>
                                    item.type.toLowerCase().includes("bool"),
                                  ) ?? [];
                                const commandOptions = availableFunctions;
                                const currentStatus =
                                  device?.status.find(
                                    (item) => item.code === rule.command_code,
                                  ) ?? null;
                                const ruleSaveState =
                                  smartlifeRuleSaveStates[rule.id] ?? "idle";
                                const ruleSaveLabel =
                                  ruleSaveState === "saving"
                                    ? "Enregistrement..."
                                    : ruleSaveState === "saved"
                                      ? "Règle enregistrée"
                                      : ruleSaveState === "error"
                                        ? "Échec"
                                        : "Sauvegarder";

                                return (
                                  <div
                                    key={rule.id}
                                    className="settings-sms-text-row"
                                    ref={(node) => {
                                      smartlifeRuleRefs.current[rule.id] = node;
                                    }}
                                  >
                              <details
                                className="settings-card-accordion"
                                open={smartlifeOpenRuleIds.includes(rule.id)}
                                onToggle={(event) => {
                                  const isOpen = event.currentTarget.open;
                                  setSmartlifeOpenRuleIds((previous) =>
                                    isOpen
                                      ? previous.includes(rule.id)
                                        ? previous
                                        : [...previous, rule.id]
                                      : previous.filter(
                                          (ruleId) => ruleId !== rule.id,
                                        ),
                                  );
                                }}
                              >
                                <summary className="settings-card-accordion__summary">
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      gap: 16,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <div style={{ minWidth: 0 }}>
                                      <strong>
                                        {rule.label.trim() ||
                                          `Règle ${displayIndex + 1}`}
                                      </strong>
                                      <div
                                        className="field-hint"
                                        style={{ marginTop: 6 }}
                                      >
                                        {formatSmartlifeRuleTrigger(
                                          rule.trigger,
                                        )}{" "}
                                        ·{" "}
                                        {formatSmartlifeOffsetHours(
                                          rule.offset_minutes,
                                        )}{" "}
                                        ·{" "}
                                        {formatSmartlifeRuleAction(
                                          effectiveAction,
                                        )}
                                        {" · "}Appareil:{" "}
                                        <strong>
                                          {rule.device_name ||
                                            rule.device_id ||
                                            "non défini"}
                                        </strong>
                                      </div>
                                    </div>
                                    <div className="settings-card-accordion__meta">
                                      <span className="settings-card__badge">
                                        {rule.enabled ? "Active" : "Inactive"}
                                      </span>
                                      {ruleGites.length > 0 ? (
                                        ruleGites.map((gite, giteIndex) => {
                                          const giteColor = getGiteColor(
                                            gite,
                                            giteIndex,
                                          );

                                          return (
                                            <span
                                              key={`${rule.id}-${gite.id}-badge`}
                                              className="settings-card__badge"
                                              style={{
                                                background: `${giteColor}1f`,
                                                borderColor: `${giteColor}55`,
                                                color: giteColor,
                                              }}
                                            >
                                              {gite.nom}
                                            </span>
                                          );
                                        })
                                      ) : (
                                        <span className="settings-card__badge">
                                          Aucun gîte
                                        </span>
                                      )}
                                      {device ? (
                                        <span
                                          className="settings-card__badge"
                                          style={{
                                            background: device.online
                                              ? "rgba(37, 171, 83, 0.12)"
                                              : "rgba(120, 128, 145, 0.12)",
                                            color: device.online
                                              ? "#1f7a3d"
                                              : "#5f6675",
                                          }}
                                        >
                                          {device.online
                                            ? "En ligne"
                                            : "Hors ligne"}
                                        </span>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="secondary"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          const duplicatedRule =
                                            duplicateSmartlifeRule(rule);
                                          setSmartlifeError(null);
                                          setSmartlifeNotice(null);
                                          setSmartlifeDraft((previous) => {
                                            const ruleIndex =
                                              previous.rules.findIndex(
                                                (item) => item.id === rule.id,
                                              );
                                            if (ruleIndex === -1) {
                                              return {
                                                ...previous,
                                                rules: [
                                                  ...previous.rules,
                                                  duplicatedRule,
                                                ],
                                              };
                                            }

                                            return {
                                              ...previous,
                                              rules: [
                                                ...previous.rules.slice(
                                                  0,
                                                  ruleIndex + 1,
                                                ),
                                                duplicatedRule,
                                                ...previous.rules.slice(
                                                  ruleIndex + 1,
                                                ),
                                              ],
                                            };
                                          });
                                        }}
                                        disabled={
                                          savingSmartlifeRules ||
                                          runningSmartlife ||
                                          testingSmartlifeRuleId === rule.id
                                        }
                                      >
                                        Dupliquer
                                      </button>
                                      <span
                                        className="settings-accordion__icon"
                                        aria-hidden="true"
                                      />
                                    </div>
                                  </div>
                                </summary>

                                <div className="settings-card-accordion__content">
                                  <div className="settings-sms-text-row__header">
                                    <span className="field-hint">
                                      Paramètres de la règle
                                    </span>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className={`secondary smartlife-rule-save-button${
                                          ruleSaveState === "saving"
                                            ? " smartlife-rule-save-button--saving"
                                            : ruleSaveState === "saved"
                                              ? " smartlife-rule-save-button--saved"
                                              : ruleSaveState === "error"
                                                ? " smartlife-rule-save-button--error"
                                                : ""
                                        }`}
                                        onClick={() => void saveSmartlifeRules(rule.id)}
                                        disabled={
                                          savingSmartlifeRules ||
                                          runningSmartlife ||
                                          testingSmartlifeRuleId === rule.id
                                        }
                                        aria-label={ruleSaveLabel}
                                        title={ruleSaveLabel}
                                      >
                                        <span
                                          className={`smartlife-rule-save-button__content${
                                            ruleSaveState === "saving" ||
                                            ruleSaveState === "saved"
                                              ? " smartlife-rule-save-button__content--icon"
                                              : ""
                                          }`}
                                        >
                                          {ruleSaveState === "saving" ? (
                                            <SaveSpinnerIcon />
                                          ) : ruleSaveState === "saved" ? (
                                            <SaveCheckIcon />
                                          ) : (
                                            <span>{ruleSaveLabel}</span>
                                          )}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="secondary"
                                        onClick={() =>
                                          void testSmartlifeRule(rule.id)
                                        }
                                        disabled={
                                          savingSmartlifeRules ||
                                          runningSmartlife ||
                                          testingSmartlifeRuleId === rule.id
                                        }
                                      >
                                        {testingSmartlifeRuleId === rule.id
                                          ? "Test..."
                                          : "Tester"}
                                      </button>
                                      <button
                                        type="button"
                                        className="danger-link"
                                        onClick={() => {
                                          setSmartlifeError(null);
                                          setSmartlifeNotice(null);
                                          setSmartlifeDraft((previous) => ({
                                            ...previous,
                                            rules: previous.rules.filter(
                                              (item) => item.id !== rule.id,
                                            ),
                                          }));
                                        }}
                                        disabled={
                                          savingSmartlifeRules ||
                                          runningSmartlife ||
                                          testingSmartlifeRuleId === rule.id
                                        }
                                      >
                                        Supprimer
                                      </button>
                                    </div>
                                  </div>

                                  <div className="grid-2">
                                <label className="field">
                                  Libellé
                                  <input
                                    type="text"
                                    value={rule.label}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? { ...item, label: value }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                    placeholder="Ex: Chauffage séjour"
                                  />
                                </label>
                                <label className="field">
                                  Active
                                  <select
                                    value={rule.enabled ? "1" : "0"}
                                    onChange={(event) => {
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? {
                                                ...item,
                                                enabled: event.target.value === "1",
                                              }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                  >
                                    <option value="1">Oui</option>
                                    <option value="0">Non</option>
                                  </select>
                                </label>
                                <label className="field">
                                  Déclenchement
                                  <select
                                    value={rule.trigger}
                                    onChange={(event) => {
                                      const nextTrigger =
                                        event.target.value === "after-arrival"
                                          ? "after-arrival"
                                          : event.target.value ===
                                              "before-departure"
                                            ? "before-departure"
                                            : event.target.value ===
                                                "after-departure"
                                              ? "after-departure"
                                              : "before-arrival";
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? { ...item, trigger: nextTrigger }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                  >
                                    <option value="before-arrival">
                                      Avant arrivée
                                    </option>
                                    <option value="after-arrival">
                                      Après arrivée
                                    </option>
                                    <option value="before-departure">
                                      Avant départ
                                    </option>
                                    <option value="after-departure">
                                      Après départ
                                    </option>
                                  </select>
                                </label>
                                <label className="field">
                                  Heures
                                  <input
                                    type="number"
                                    min={0}
                                    max={14 * 24}
                                    value={Math.round(rule.offset_minutes / 60)}
                                    onChange={(event) => {
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      const nextHours = Math.max(
                                        0,
                                        Math.min(
                                          14 * 24,
                                          Math.round(
                                            Number(event.target.value) || 0,
                                          ),
                                        ),
                                      );
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? {
                                                ...item,
                                                offset_minutes: nextHours * 60,
                                              }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                  />
                                </label>
                                <label className="field">
                                  Action
                                  <select
                                    value={effectiveAction}
                                    onChange={(event) => {
                                      const requestedAction =
                                        event.target.value === "device-off"
                                          ? "device-off"
                                          : "device-on";
                                      const nextAction =
                                        getCompatibleSmartlifeRuleAction(
                                          requestedAction,
                                          device,
                                        );
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? {
                                                ...item,
                                                action: nextAction,
                                                command_code: item.command_code,
                                                command_label: item.command_label,
                                                command_value:
                                                  getSmartlifeActionCommandValue(
                                                    nextAction,
                                                  ),
                                              }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                  >
                                    {availableActionOptions.map((actionOption) => (
                                      <option
                                        key={actionOption.value}
                                        value={actionOption.value}
                                      >
                                        {actionOption.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="field">
                                  Appareil
                                  <select
                                    value={rule.device_id}
                                    onChange={(event) => {
                                      const nextDeviceId = event.target.value;
                                      const nextDevice =
                                        smartlifeDeviceMap.get(nextDeviceId) ?? null;
                                      const preferredCommand =
                                        getPreferredSmartlifeCommand(nextDevice);
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id !== rule.id
                                            ? item
                                            : (() => {
                                                const nextAction =
                                                  getCompatibleSmartlifeRuleAction(
                                                    item.action,
                                                    nextDevice,
                                                  );
                                                return {
                                                  ...item,
                                                  action: nextAction,
                                                  device_id: nextDeviceId,
                                                  device_name:
                                                    nextDevice?.name ?? "",
                                                  command_code:
                                                    preferredCommand?.code ??
                                                    item.command_code,
                                                  command_label: preferredCommand
                                                    ? formatSmartlifeFunctionLabel(
                                                        preferredCommand.code,
                                                        preferredCommand.name,
                                                      )
                                                    : item.command_label,
                                                  command_value:
                                                    getSmartlifeActionCommandValue(
                                                      nextAction,
                                                    ),
                                                };
                                              })(),
                                        ),
                                      }));
                                    }}
                                    disabled={savingSmartlifeRules || runningSmartlife}
                                  >
                                    <option value="">Sélectionner</option>
                                    {rule.device_id &&
                                    !smartlifeDeviceMap.has(rule.device_id) ? (
                                      <option value={rule.device_id}>
                                        {rule.device_name || rule.device_id}
                                      </option>
                                    ) : null}
                                    {smartlifeDevices.map((deviceItem) => (
                                      <option key={deviceItem.id} value={deviceItem.id}>
                                        {deviceItem.name}
                                        {deviceItem.product_name
                                          ? ` · ${deviceItem.product_name}`
                                          : ""}
                                        {deviceItem.online
                                          ? " · En ligne"
                                          : " · Hors ligne"}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="field">
                                  Commande
                                  <select
                                    value={rule.command_code}
                                    onChange={(event) => {
                                      const selectedFunction = commandOptions.find(
                                        (item) => item.code === event.target.value,
                                      );
                                      setSmartlifeError(null);
                                      setSmartlifeNotice(null);
                                      setSmartlifeDraft((previous) => ({
                                        ...previous,
                                        rules: previous.rules.map((item) =>
                                          item.id === rule.id
                                            ? {
                                                ...item,
                                                command_code: event.target.value,
                                                command_label: selectedFunction
                                                  ? formatSmartlifeFunctionLabel(
                                                      selectedFunction.code,
                                                      selectedFunction.name,
                                                    )
                                                  : item.command_label,
                                              }
                                            : item,
                                        ),
                                      }));
                                    }}
                                    disabled={
                                      savingSmartlifeRules ||
                                      runningSmartlife ||
                                      !rule.device_id
                                    }
                                  >
                                    <option value="">
                                      {rule.device_id
                                        ? commandOptions.length > 0
                                          ? "Sélectionner"
                                          : "Aucune commande détectée"
                                        : "Choisir d'abord un appareil"}
                                    </option>
                                    {rule.command_code &&
                                    !commandOptions.some(
                                      (functionItem) =>
                                        functionItem.code === rule.command_code,
                                    ) ? (
                                      <option value={rule.command_code}>
                                        {formatSmartlifeFunctionLabel(
                                          rule.command_code,
                                          rule.command_label,
                                        )}
                                      </option>
                                    ) : null}
                                    {commandOptions.map((functionItem) => (
                                      <option
                                        key={`${rule.id}-${functionItem.code}`}
                                        value={functionItem.code}
                                      >
                                        {formatSmartlifeFunctionLabel(
                                          functionItem.code,
                                          functionItem.name,
                                        )}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              {rule.device_id && commandOptions.length === 0 ? (
                                <div className="field-hint" style={{ marginTop: 8 }}>
                                  Aucun DP booléen détecté sur cet appareil. Les
                                  actions ON/OFF nécessitent une commande de type
                                  interrupteur.
                                </div>
                              ) : null}

                              <div style={{ marginTop: 12 }}>
                                <div className="field-hint">
                                  Gîtes concernés
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 10,
                                    marginTop: 8,
                                  }}
                                >
                                  {gites.map((gite) => (
                                    <label
                                      key={`${rule.id}-${gite.id}`}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={sanitizeSmartlifeRuleGiteIds(
                                          rule.gite_ids,
                                          smartlifeValidGiteIds,
                                        ).includes(gite.id)}
                                        onChange={(event) => {
                                          const restoreScroll =
                                            preserveSmartlifeRuleViewportPosition(
                                              rule.id,
                                            );
                                          setSmartlifeError(null);
                                          setSmartlifeNotice(null);
                                          setSmartlifeDraft((previous) => ({
                                            ...previous,
                                            rules: previous.rules.map((item) =>
                                              item.id === rule.id
                                                ? {
                                                    ...item,
                                                    gite_ids: event.target.checked
                                                      ? [
                                                          ...sanitizeSmartlifeRuleGiteIds(
                                                            item.gite_ids,
                                                            smartlifeValidGiteIds,
                                                          ),
                                                          gite.id,
                                                        ]
                                                      : sanitizeSmartlifeRuleGiteIds(
                                                          item.gite_ids,
                                                          smartlifeValidGiteIds,
                                                        ).filter(
                                                          (giteId) =>
                                                            giteId !== gite.id,
                                                        ),
                                                  }
                                                : item,
                                            ),
                                          }));
                                          restoreScroll();
                                        }}
                                        disabled={savingSmartlifeRules || runningSmartlife}
                                      />
                                      <span>{gite.nom}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="field-hint" style={{ marginTop: 10 }}>
                                {formatSmartlifeRuleTrigger(rule.trigger)} ·{" "}
                                {formatSmartlifeOffsetHours(rule.offset_minutes)} ·{" "}
                                {formatSmartlifeRuleAction(rule.action)}
                                {" · "}Appareil:{" "}
                                <strong>{rule.device_name || rule.device_id || "non défini"}</strong>
                                {" · "}Commande:{" "}
                                <strong>
                                  {formatSmartlifeFunctionLabel(
                                    rule.command_code,
                                    rule.command_label,
                                  ) || "non définie"}
                                </strong>
                              </div>
                              {device ? (
                                <div className="field-hint" style={{ marginTop: 6 }}>
                                  {device.online ? "En ligne" : "Hors ligne"}
                                  {currentStatus
                                    ? ` · Statut actuel ${formatSmartlifeStatusLabel(
                                        currentStatus.code,
                                        currentStatus.value,
                                      )}`
                                    : ""}
                                </div>
                              ) : null}
                                </div>
                              </details>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void exportSmartlifeRules()}
                          disabled={
                            savingSmartlifeRules ||
                            runningSmartlife ||
                            exportingSmartlifeRules ||
                            importingSmartlifeRules
                          }
                        >
                          {exportingSmartlifeRules
                            ? "Export..."
                            : "Exporter les règles"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={triggerSmartlifeRulesImport}
                          disabled={
                            savingSmartlifeRules ||
                            runningSmartlife ||
                            importingSmartlifeRules ||
                            exportingSmartlifeRules
                          }
                        >
                          {importingSmartlifeRules
                            ? "Import..."
                            : "Importer des règles"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            const nextRule = createSmartlifeRuleDraft(
                              gites[0]?.id ?? "",
                            );
                            setSmartlifeError(null);
                            setSmartlifeNotice(null);
                            setSmartlifeOpenRuleIds((previous) =>
                              previous.includes(nextRule.id)
                                ? previous
                                : [...previous, nextRule.id],
                            );
                            setPendingSmartlifeScrollRuleId(nextRule.id);
                            setSmartlifeDraft((previous) => ({
                              ...previous,
                              rules: [
                                ...previous.rules,
                                nextRule,
                              ],
                            }));
                          }}
                          disabled={savingSmartlifeRules || runningSmartlife}
                        >
                          Ajouter une règle
                        </button>
                      </div>
                    </div>

                    {smartlifeState.last_result?.items.length ? (
                      <div style={{ marginTop: 18 }}>
                        <div className="field-hint">
                          Derniers événements mémorisés
                        </div>
                        <div
                          className="settings-sms-texts"
                          style={{ marginTop: 8 }}
                        >
                          {smartlifeState.last_result.items
                            .slice(0, smartlifeLogVisibleCount)
                            .map((item) => (
                              <div
                                key={item.key}
                                className="settings-sms-text-row smartlife-log-item"
                              >
                                <div className="settings-sms-text-row__header smartlife-log-item__header">
                                  <div className="smartlife-log-item__title-group">
                                    <span className="smartlife-log-item__eyebrow">
                                      {item.gite_nom || "Smart Life"}
                                    </span>
                                    <strong>{item.rule_label}</strong>
                                  </div>
                                  <span
                                    className={`smartlife-log-item__status smartlife-log-item__status--${item.status}`}
                                  >
                                    {formatSmartlifeItemStatus(item.status)}
                                  </span>
                                </div>
                                <div className="smartlife-log-item__reservation">
                                  {item.reservation_label}
                                </div>
                                <div className="smartlife-log-item__meta">
                                  <span>{item.device_name || "Sans appareil"}</span>
                                  <span>{formatSmartlifeRuleAction(item.action)}</span>
                                  {item.command_code ? (
                                    <span>{formatSmartlifeCodeLabel(item.command_code)}</span>
                                  ) : null}
                                </div>
                                <div className="smartlife-log-item__timeline">
                                  <span className="smartlife-log-item__timeline-item">
                                    <span className="smartlife-log-item__timeline-label">
                                      Prévu
                                    </span>
                                    <strong>{formatIsoDateTimeFr(item.scheduled_at)}</strong>
                                  </span>
                                  {item.executed_at ? (
                                    <span className="smartlife-log-item__timeline-item">
                                      <span className="smartlife-log-item__timeline-label">
                                        Exécuté
                                      </span>
                                      <strong>{formatIsoDateTimeFr(item.executed_at)}</strong>
                                    </span>
                                  ) : null}
                                  {item.previous_executed_at ? (
                                    <span className="smartlife-log-item__timeline-item">
                                      <span className="smartlife-log-item__timeline-label">
                                        Déjà fait
                                      </span>
                                      <strong>
                                        {formatIsoDateTimeFr(item.previous_executed_at)}
                                      </strong>
                                    </span>
                                  ) : null}
                                </div>
                                {item.message ? (
                                  <div className="smartlife-log-item__message">
                                    {item.message}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                        </div>
                        {smartlifeState.last_result.items.length >
                        smartlifeLogVisibleCount ? (
                          <div
                            className="field-hint"
                            style={{ marginTop: 10 }}
                          >
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                setSmartlifeLogVisibleCount((previous) =>
                                  Math.min(
                                    smartlifeState.last_result?.items.length ?? 0,
                                    previous + SMARTLIFE_LOG_VISIBLE_STEP,
                                  ),
                                )
                              }
                            >
                              Charger plus
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadSmartlifeState()}
                        disabled={smartlifeBusy}
                      >
                        Recharger
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void loadSmartlifeDevices()}
                        disabled={
                          smartlifeBusy ||
                          loadingSmartlifeDevices
                        }
                      >
                        {loadingSmartlifeDevices
                          ? "Chargement..."
                          : "Charger les appareils"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void runSmartlifeNow()}
                        disabled={smartlifeBusy}
                      >
                        {runningSmartlife ? "Exécution..." : "Lancer maintenant"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveSmartlifeRules()}
                        disabled={savingSmartlifeRules || runningSmartlife}
                      >
                        {savingSmartlifeRules
                          ? "Enregistrement..."
                          : "Enregistrer les règles"}
                      </button>
                    </div>
                    {smartlifeNotice ? (
                      <div className="note note--success">{smartlifeNotice}</div>
                    ) : null}
                    {smartlifeError ? (
                      <div className="note">{smartlifeError}</div>
                    ) : null}
                  </>
                )}
              </div>
              {smartlifeLoaded ? (
                <div className="card settings-card settings-card--span-12">
                  <div className="settings-card__topline">
                    <span className="settings-card__tag">Énergie</span>
                    <span className="settings-card__badge">
                      {sanitizeSmartlifeEnergyDevicesForSave(
                        smartlifeDraft.energy_devices,
                      ).length} appareil(s)
                    </span>
                  </div>
                  <div className="section-title">Compteurs d&apos;énergie cumulée</div>
                  <div className="field-hint">
                    Chaque gîte doit avoir au plus un <strong>compteur de référence</strong>.
                    C&apos;est ce compteur unique qui sert à la fois au suivi de
                    consommation des réservations et au calcul mensuel. Les
                    <strong> sous-compteurs informatifs</strong> restent visibles
                    mais ne sont pas utilisés pour la facturation. Les appareils
                    compatibles peuvent remonter `total_ele` ou `add_ele`.
                  </div>
                  {loadingSmartlifeDevices ? (
                    <div className="field-hint" style={{ marginTop: 12 }}>
                      Chargement des compteurs...
                    </div>
                  ) : filteredSmartlifeEnergyDevices.length > 0 ? (
                    <div
                      className="settings-sms-texts"
                      style={{ marginTop: 12 }}
                    >
                      {filteredSmartlifeEnergyDevices.map((device) => {
                        const assignment =
                          smartlifeEnergyDeviceByDeviceId.get(device.id) ??
                          null;
                        const selectedGiteId = assignment?.gite_id ?? "";
                        const selectedMode = !assignment?.enabled
                          ? "disabled"
                          : assignment.role;
                        return (
                          <div
                            key={`smartlife-meter-${device.id}`}
                            className="settings-sms-text-row"
                          >
                            <div className="settings-sms-text-row__header">
                              <div>
                                <strong>{device.name}</strong>
                                <div className="field-hint">
                                  {device.product_name || device.category || device.id}
                                  {(device.energy_total_kwh ?? device.total_ele_kwh) != null
                                    ? ` · ${
                                        device.energy_total_source_code ?? "énergie"
                                      } ${(
                                        device.energy_total_kwh ?? device.total_ele_kwh
                                      )?.toFixed(2)} kWh`
                                    : ""}
                                </div>
                              </div>
                              <span
                                className="settings-card__badge"
                                style={{
                                  background: device.online
                                    ? "rgba(37, 171, 83, 0.12)"
                                    : "rgba(120, 128, 145, 0.12)",
                                  color: device.online ? "#1f7a3d" : "#5f6675",
                                }}
                              >
                                {device.online ? "En ligne" : "Hors ligne"}
                              </span>
                            </div>
                            <div className="grid-2" style={{ marginTop: 10 }}>
                              <label className="field">
                                Gîte relié
                                <select
                                  value={selectedGiteId}
                                  onChange={(event) =>
                                    upsertSmartlifeEnergyDevice(device, {
                                      enabled: Boolean(event.target.value),
                                      gite_id: event.target.value,
                                      role:
                                        selectedMode === "primary"
                                          ? "primary"
                                          : "informational",
                                    })
                                  }
                                  disabled={
                                    savingSmartlifeMeters ||
                                    runningSmartlife ||
                                    gites.length === 0
                                  }
                                >
                                  <option value="">Aucun gîte</option>
                                  {gites.map((gite) => (
                                    <option key={gite.id} value={gite.id}>
                                      {gite.nom}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="field">
                                Rôle énergie
                                <select
                                  value={selectedMode}
                                  onChange={(event) =>
                                    upsertSmartlifeEnergyDevice(device, {
                                      enabled:
                                        event.target.value !== "disabled" &&
                                        Boolean(selectedGiteId),
                                      gite_id: selectedGiteId,
                                      role:
                                        event.target.value === "primary"
                                          ? "primary"
                                          : "informational",
                                    })
                                  }
                                  disabled={
                                    savingSmartlifeMeters ||
                                    runningSmartlife ||
                                    !selectedGiteId
                                  }
                                >
                                  <option value="disabled">Désactivé</option>
                                  <option value="primary">
                                    {getSmartlifeEnergyRoleOptionLabel("primary")}
                                  </option>
                                  <option value="informational">
                                    {getSmartlifeEnergyRoleOptionLabel(
                                      "informational",
                                    )}
                                  </option>
                                </select>
                              </label>
                            </div>
                            <div className="field-hint" style={{ marginTop: 8 }}>
                              {selectedMode === "primary"
                                ? `${formatSmartlifeEnergyRole("primary")} · source officielle du gîte pour les réservations et le mensuel.`
                                : selectedMode === "informational"
                                  ? `${formatSmartlifeEnergyRole("informational")} · visible dans l'inventaire, sans impact sur les calculs officiels.`
                                  : "Non utilisé par l'application."}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="field-hint" style={{ marginTop: 12 }}>
                      Aucun appareil avec énergie cumulée détecté. Charge
                      d&apos;abord les appareils Smart Life, puis vérifie que le
                      device remonte bien `total_ele` ou `add_ele`.
                    </div>
                  )}
                  <div className="actions" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => void saveSmartlifeMeters()}
                      disabled={savingSmartlifeMeters || runningSmartlife}
                    >
                      {savingSmartlifeMeters
                        ? "Enregistrement..."
                        : "Enregistrer les compteurs"}
                    </button>
                  </div>
                  {smartlifeMetersNotice ? (
                    <div className="note note--success" style={{ marginTop: 12 }}>
                      {smartlifeMetersNotice}
                    </div>
                  ) : null}
                  {smartlifeMetersError ? (
                    <div className="note" style={{ marginTop: 12 }}>
                      {smartlifeMetersError}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {smartlifeLoaded ? (
                <div className="card settings-card settings-card--span-12">
                  <div className="settings-card__topline">
                    <span className="settings-card__tag">Appareils</span>
                    <span className="settings-card__badge">
                      {smartlifeDevices.length} chargé(s)
                    </span>
                  </div>
                  <div className="section-title">Appareils disponibles</div>
                  <div className="field-hint">
                    Clique sur <strong>Créer une règle</strong> pour
                    préremplir une automatisation à partir d'un appareil.
                  </div>
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <label className="field">
                      Filtrer les appareils
                      <input
                        type="text"
                        value={smartlifeDeviceFilter}
                        onChange={(event) =>
                          setSmartlifeDeviceFilter(event.target.value)
                        }
                        placeholder="Nom ou identifiant..."
                        disabled={
                          smartlifeBusy ||
                          loadingSmartlifeDevices
                        }
                      />
                    </label>
                  </div>
                  {loadingSmartlifeDevices ? (
                    <div className="field-hint" style={{ marginTop: 12 }}>
                      Chargement des appareils...
                    </div>
                  ) : smartlifeDevices.length > 0 ? (
                    <>
                      <div
                        className="settings-sms-texts"
                        style={{ marginTop: 8 }}
                      >
                        {filteredSmartlifeDevices.map((device) => (
                          <div
                            key={`smartlife-device-${device.id}`}
                            className="settings-sms-text-row"
                          >
                            <div className="settings-sms-text-row__header">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  flexWrap: "wrap",
                                }}
                              >
                                <strong>{device.name}</strong>
                                <span
                                  className="settings-card__badge"
                                  style={{
                                    background: device.online
                                      ? "rgba(37, 171, 83, 0.12)"
                                      : "rgba(120, 128, 145, 0.12)",
                                    color: device.online
                                      ? "#1f7a3d"
                                      : "#5f6675",
                                  }}
                                >
                                  {device.online ? "En ligne" : "Hors ligne"}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  const nextRule = createSmartlifeRuleFromDevice(
                                    device,
                                    gites[0]?.id ?? "",
                                  );
                                  setSmartlifeError(null);
                                  setSmartlifeNotice(null);
                                  setSmartlifeOpenRuleIds((previous) =>
                                    previous.includes(nextRule.id)
                                      ? previous
                                      : [...previous, nextRule.id],
                                  );
                                  setPendingSmartlifeScrollRuleId(nextRule.id);
                                  setSmartlifeDraft((previous) => ({
                                    ...previous,
                                    rules: [...previous.rules, nextRule],
                                  }));
                                }}
                                disabled={savingSmartlifeRules || runningSmartlife}
                              >
                                Créer une règle
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {filteredSmartlifeDevices.length === 0 ? (
                        <div className="field-hint" style={{ marginTop: 8 }}>
                          Aucun appareil ne correspond au filtre.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="field-hint" style={{ marginTop: 12 }}>
                      Aucun appareil chargé. Utilise <strong>Charger les appareils</strong>
                      {" "}dans le cadre Automatisation.
                    </div>
                  )}
                </div>
              ) : null}
              {smartlifeLoaded ? (
                <div className="card settings-card settings-card--span-12">
                  <div className="settings-card__topline">
                    <span className="settings-card__tag">Connexion</span>
                    <span className="settings-card__badge">
                      {smartlifeState.credentials_configured
                        ? "Identifiants OK"
                        : "Identifiants requis"}
                    </span>
                  </div>
                  <div className="section-title">Connexion Tuya</div>
                  <div className="field-hint">
                    Région, identifiants et activation de l'automatisation.
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 12,
                    }}
                  >
                    <span className="settings-card__badge">
                      {smartlifeDraft.enabled ? "Activé" : "Désactivé"}
                    </span>
                    <span className="settings-card__badge">
                      {formatSmartlifeRegionLabel(smartlifeDraft.region)}
                    </span>
                    <span className="settings-card__badge">
                      {smartlifeState.credentials_configured
                        ? "Identifiants OK"
                        : "Identifiants requis"}
                    </span>
                  </div>
                  <div className="grid-2" style={{ marginTop: 16 }}>
                    <label className="field">
                      Activation
                      <select
                        value={smartlifeDraft.enabled ? "1" : "0"}
                        onChange={(event) => {
                          setSmartlifeConnectionError(null);
                          setSmartlifeConnectionNotice(null);
                          setSmartlifeDraft((previous) => ({
                            ...previous,
                            enabled: event.target.value === "1",
                          }));
                        }}
                        disabled={savingSmartlifeConnection || runningSmartlife}
                      >
                        <option value="0">Désactivé</option>
                        <option value="1">Activé</option>
                      </select>
                    </label>
                    <label className="field">
                      Région Tuya
                      <select
                        value={smartlifeDraft.region}
                        onChange={(event) => {
                          const nextRegion = event.target.value as SmartlifeRegion;
                          setSmartlifeConnectionError(null);
                          setSmartlifeConnectionNotice(null);
                          setSmartlifeDraft((previous) => ({
                            ...previous,
                            region: nextRegion,
                          }));
                          setSmartlifeDevices([]);
                        }}
                        disabled={savingSmartlifeConnection || runningSmartlife}
                      >
                        {([
                          "eu",
                          "eu-west",
                          "us",
                          "us-e",
                          "in",
                          "cn",
                        ] as SmartlifeRegion[]).map((region) => (
                          <option key={region} value={region}>
                            {formatSmartlifeRegionLabel(region)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Access ID
                      <input
                        type="text"
                        value={smartlifeDraft.access_id}
                        onChange={(event) => {
                          setSmartlifeConnectionError(null);
                          setSmartlifeConnectionNotice(null);
                          setSmartlifeDraft((previous) => ({
                            ...previous,
                            access_id: event.target.value,
                          }));
                        }}
                        disabled={savingSmartlifeConnection || runningSmartlife}
                        placeholder="Tuya Access ID"
                      />
                    </label>
                    <label className="field">
                      Access Secret
                      <input
                        type="password"
                        value={smartlifeDraft.access_secret}
                        onChange={(event) => {
                          setSmartlifeConnectionError(null);
                          setSmartlifeConnectionNotice(null);
                          setSmartlifeSecretDirty(true);
                          setSmartlifeDraft((previous) => ({
                            ...previous,
                            access_secret: event.target.value,
                          }));
                        }}
                        disabled={savingSmartlifeConnection || runningSmartlife}
                        placeholder={
                          smartlifeState.credentials_configured && !smartlifeSecretDirty
                            ? "Secret déjà enregistré"
                            : "Tuya Access Secret"
                        }
                      />
                    </label>
                  </div>
                  <div className="field-hint" style={{ marginTop: 10 }}>
                    Le secret enregistré n'est plus renvoyé au navigateur.
                    Laissez ce champ vide pour conserver le secret actuel, ou
                    ressaisissez-le pour le remplacer. Si vous modifiez l'Access
                    ID, ressaisissez aussi le secret.
                  </div>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setSmartlifeConnectionError(null);
                        setSmartlifeConnectionNotice(null);
                        setSmartlifeSecretDirty(true);
                        setSmartlifeDraft((previous) => ({
                          ...previous,
                          access_id: "",
                          access_secret: "",
                        }));
                      }}
                      disabled={
                        savingSmartlifeConnection ||
                        runningSmartlife ||
                        (!smartlifeState.credentials_configured &&
                          !smartlifeDraft.access_id.trim())
                      }
                    >
                      Effacer les identifiants
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveSmartlifeConnectionSettings()}
                      disabled={savingSmartlifeConnection || runningSmartlife}
                    >
                      {savingSmartlifeConnection
                        ? "Enregistrement..."
                        : "Sauvegarder la connexion"}
                    </button>
                  </div>
                  {smartlifeConnectionNotice ? (
                    <div className="note note--success" style={{ marginTop: 12 }}>
                      {smartlifeConnectionNotice}
                    </div>
                  ) : null}
                  {smartlifeConnectionError ? (
                    <div className="note" style={{ marginTop: 12 }}>
                      {smartlifeConnectionError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section
            id="settings-declaration-nights"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-declaration-nights"}
            aria-labelledby="nav-settings-declaration-nights"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Totaux mensuels</div>
                <h2 className="settings-cluster__title">Nuitées à déclarer</h2>
              </div>
              <p className="settings-cluster__text">
                Choisissez quelles sources doivent être exclues du total de
                nuitées à déclarer.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--rose settings-card--span-12">
                <div className="settings-card-accordion__content">
                  <div className="settings-card__topline">
                    <span className="settings-card__tag">Totaux mensuels</span>
                    <span className="settings-card__badge">
                      {declarationExcludedSourcesDraft.length} exclue(s)
                    </span>
                  </div>
                  <div className="section-title">Nuitées à déclarer</div>
                  <div className="field-hint">
                    Les sources listées ici sont retirées du macaron "Nuitées à
                    déclarer" dans les totaux mensuels.
                  </div>
                  {loadingDeclarationNights ? (
                    <div className="field-hint">Chargement...</div>
                  ) : (
                    <>
                      {availableDeclarationSources.length > 0 ? (
                        <div className="field-group">
                          <div className="field-group__header">
                            <div className="field-group__label">
                              Sources détectées
                            </div>
                            <div className="field-hint">
                              Cochez les sources à exclure du total à déclarer.
                            </div>
                          </div>
                          <div className="checkbox-grid">
                            {availableDeclarationSources.map((source) => {
                              const checked =
                                declarationExcludedSourcesDraft.some(
                                  (item) =>
                                    normalizeTextKey(item) ===
                                    normalizeTextKey(source),
                                );

                              return (
                                <label key={source} className="checkbox-inline">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      setDeclarationNightsNotice(null);
                                      setDeclarationNightsError(null);
                                      setDeclarationExcludedSourcesDraft(
                                        (previous) =>
                                          event.target.checked
                                            ? normalizeSourceList([
                                                ...previous,
                                                source,
                                              ])
                                            : previous.filter(
                                                (item) =>
                                                  normalizeTextKey(item) !==
                                                  normalizeTextKey(source),
                                              ),
                                      );
                                    }}
                                    disabled={savingDeclarationNights}
                                  />
                                  <span>{source}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <label className="field">
                        Sources exclues
                        <textarea
                          rows={4}
                          value={declarationExcludedSourcesDraft.join("\n")}
                          onChange={(event) => {
                            setDeclarationNightsNotice(null);
                            setDeclarationNightsError(null);
                            setDeclarationExcludedSourcesDraft(
                              parseDeclarationSourcesInput(event.target.value),
                            );
                          }}
                          placeholder={"Airbnb\nHomeExchange"}
                          disabled={savingDeclarationNights}
                        />
                      </label>
                      <div className="field-hint">
                        Une source par ligne. Les variantes accent/casse sont
                        reconnues.
                      </div>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => void saveDeclarationNightsSettings()}
                          disabled={savingDeclarationNights}
                        >
                          {savingDeclarationNights
                            ? "Enregistrement..."
                            : "Enregistrer"}
                        </button>
                      </div>
                      {declarationNightsNotice ? (
                        <div className="note note--success">
                          {declarationNightsNotice}
                        </div>
                      ) : null}
                      {declarationNightsError ? (
                        <div className="note">{declarationNightsError}</div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-source-colors"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-source-colors"}
            aria-labelledby="nav-settings-source-colors"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Palette</div>
                <h2 className="settings-cluster__title">
                  Couleurs des sources
                </h2>
              </div>
              <p className="settings-cluster__text">
                Personnalisez les couleurs utilisées dans le calendrier et dans
                la répartition des paiements.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--sand settings-card--span-12">
                <div className="settings-card-accordion__content">
                  <div className="settings-card__topline">
                    <span className="settings-card__tag">Palette</span>
                    <span className="settings-card__badge">
                      {customizedSourceColorCount} personnalisée(s)
                    </span>
                  </div>
                  <div className="section-title">Couleurs des sources</div>
                  <div className="field-hint">
                    Personnalisez les couleurs utilisées dans le calendrier et
                    la répartition des paiements.
                  </div>
                  {loadingSourceColors ? (
                    <div className="field-hint">Chargement...</div>
                  ) : (
                    <>
                      <div className="settings-source-colors">
                        {availableSourceColorLabels.map((source) => {
                          const color =
                            sourceColorDraft[source] ??
                            getPaymentColor(
                              source,
                              DEFAULT_PAYMENT_SOURCE_COLORS,
                            );
                          const hasDefaultColor = Object.keys(
                            DEFAULT_PAYMENT_SOURCE_COLORS,
                          ).some(
                            (label) =>
                              normalizeTextKey(label) ===
                              normalizeTextKey(source),
                          );
                          return (
                            <div
                              key={source}
                              className="settings-source-color-row"
                            >
                              <div className="settings-source-color-row__label">
                                <span
                                  className="settings-source-color-row__swatch"
                                  style={{ backgroundColor: color }}
                                />
                                <span>{source}</span>
                              </div>
                              <input
                                type="color"
                                value={color}
                                onChange={(event) => {
                                  setSourceColorError(null);
                                  setSourceColorNotice(null);
                                  setSourceColorDraft((previous) => ({
                                    ...previous,
                                    [source]: event.target.value.toUpperCase(),
                                  }));
                                }}
                                disabled={savingSourceColors}
                              />
                              <input
                                type="text"
                                value={color}
                                onChange={(event) => {
                                  setSourceColorError(null);
                                  setSourceColorNotice(null);
                                  setSourceColorDraft((previous) => ({
                                    ...previous,
                                    [source]: event.target.value.toUpperCase(),
                                  }));
                                }}
                                placeholder="#FFFFFF"
                                disabled={savingSourceColors}
                              />
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  setSourceColorError(null);
                                  setSourceColorNotice(null);
                                  setSourceColorDraft((previous) => {
                                    if (!hasDefaultColor) {
                                      const next = { ...previous };
                                      delete next[source];
                                      return next;
                                    }
                                    return {
                                      ...previous,
                                      [source]: getPaymentColor(
                                        source,
                                        DEFAULT_PAYMENT_SOURCE_COLORS,
                                      ),
                                    };
                                  });
                                }}
                                disabled={savingSourceColors}
                              >
                                {hasDefaultColor ? "Défaut" : "Retirer"}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="field-group">
                        <div className="field-group__header">
                          <div className="field-group__label">
                            Ajouter une source
                          </div>
                          <div className="field-hint">
                            Ajoutez un libellé si une source n'apparaît pas
                            encore.
                          </div>
                        </div>
                        <div className="settings-source-color-add">
                          <input
                            value={newSourceColorLabel}
                            onChange={(event) => {
                              setSourceColorError(null);
                              setSourceColorNotice(null);
                              setNewSourceColorLabel(event.target.value);
                            }}
                            placeholder="Ex: Booking"
                            disabled={savingSourceColors}
                          />
                          <input
                            type="color"
                            value={newSourceColorValue}
                            onChange={(event) =>
                              setNewSourceColorValue(
                                event.target.value.toUpperCase(),
                              )
                            }
                            disabled={savingSourceColors}
                          />
                          <button
                            type="button"
                            className="secondary"
                            onClick={addSourceColorLabel}
                            disabled={savingSourceColors}
                          >
                            Ajouter
                          </button>
                        </div>
                      </div>

                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => void saveSourceColorSettings()}
                          disabled={savingSourceColors}
                        >
                          {savingSourceColors
                            ? "Enregistrement..."
                            : "Enregistrer"}
                        </button>
                      </div>
                      {sourceColorNotice ? (
                        <div className="note note--success">
                          {sourceColorNotice}
                        </div>
                      ) : null}
                      {sourceColorError ? (
                        <div className="note">{sourceColorError}</div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section
            id="settings-team"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-team"}
            aria-labelledby="nav-settings-team"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Équipe</div>
                <h2 className="settings-cluster__title">
                  Gestionnaires et répartition
                </h2>
              </div>
              <p className="settings-cluster__text">
                Ajoutez rapidement des gestionnaires et gardez une lecture
                claire de leur couverture sur les gîtes.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--sand settings-card--span-4">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Nouveau profil</span>
                </div>
                <div className="section-title">Ajouter un gestionnaire</div>
                <div className="grid-2">
                  <label className="field">
                    Prénom
                    <input
                      value={prenom}
                      onChange={(event) => setPrenom(event.target.value)}
                      placeholder="Ex. Marie"
                      disabled={savingManager}
                    />
                  </label>
                  <label className="field">
                    Nom
                    <input
                      value={nom}
                      onChange={(event) => setNom(event.target.value)}
                      placeholder="Ex. Dupont"
                      disabled={savingManager}
                    />
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => void createManager()}
                    disabled={savingManager}
                  >
                    {savingManager ? "Ajout..." : "Ajouter"}
                  </button>
                </div>
                {managerNotice && (
                  <div className="note note--success">{managerNotice}</div>
                )}
                {managerError && <div className="note">{managerError}</div>}
              </div>

              <div className="card settings-card settings-card--neutral settings-card--span-8">
                <div className="settings-managers-header">
                  <div>
                    <div className="settings-card__tag">Vue d'ensemble</div>
                    <div className="section-title">Gestionnaires</div>
                  </div>
                  <div className="field-hint">
                    {gestionnaires.length} gestionnaire(s), {linkedGitesCount}{" "}
                    gîte(s) associé(s)
                  </div>
                </div>
                {loadingManagers ? (
                  <div className="field-hint">Chargement...</div>
                ) : gestionnaires.length === 0 ? (
                  <div className="field-hint">
                    Aucun gestionnaire enregistré.
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Prénom</th>
                        <th>Nom</th>
                        <th>Gîtes associés</th>
                        <th className="table-actions-cell">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gestionnaires.map((manager) => (
                        <tr key={manager.id}>
                          <td>{manager.prenom}</td>
                          <td>{manager.nom}</td>
                          <td>
                            <span className="badge">
                              {manager.gites_count ?? 0}
                            </span>
                          </td>
                          <td className="table-actions-cell">
                            <button
                              type="button"
                              className="table-action table-action--danger"
                              onClick={() => void removeManager(manager)}
                              disabled={deletingManagerId === manager.id}
                            >
                              {deletingManagerId === manager.id
                                ? "Suppression..."
                                : "Supprimer"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-ical-sources"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-ical-sources"}
            aria-labelledby="nav-settings-ical-sources"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Distribution</div>
                <h2 className="settings-cluster__title">Sources iCal</h2>
              </div>
              <p className="settings-cluster__text">
                Centralisez les sources entrantes et leur configuration.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--blue settings-card--span-4">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Entrée manuelle</span>
                </div>
                <div className="section-title">Ajouter une source iCal</div>
                <div className="grid-2">
                  <label className="field">
                    Gîte
                    <select
                      value={sourceDraft.gite_id}
                      onChange={(event) =>
                        setSourceDraft((previous) => ({
                          ...previous,
                          gite_id: event.target.value,
                        }))
                      }
                      disabled={creatingSource || loadingSources}
                    >
                      <option value="">Choisir</option>
                      {gites.map((gite) => (
                        <option key={gite.id} value={gite.id}>
                          {gite.nom}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Type / Source
                    <input
                      value={sourceDraft.type}
                      onChange={(event) =>
                        setSourceDraft((previous) => ({
                          ...previous,
                          type: event.target.value,
                        }))
                      }
                      placeholder="Airbnb"
                      disabled={creatingSource}
                    />
                  </label>
                  <label className="field">
                    URL iCal
                    <input
                      value={sourceDraft.url}
                      onChange={(event) =>
                        setSourceDraft((previous) => ({
                          ...previous,
                          url: event.target.value,
                        }))
                      }
                      placeholder="https://.../calendar/ical/..."
                      disabled={creatingSource}
                    />
                  </label>
                  <label className="field">
                    Inclure si résumé contient
                    <input
                      value={sourceDraft.include_summary}
                      onChange={(event) =>
                        setSourceDraft((previous) => ({
                          ...previous,
                          include_summary: event.target.value,
                        }))
                      }
                      placeholder="Reserved, BOOKED"
                      disabled={creatingSource}
                    />
                  </label>
                  <label className="field">
                    Exclure si résumé contient
                    <input
                      value={sourceDraft.exclude_summary}
                      onChange={(event) =>
                        setSourceDraft((previous) => ({
                          ...previous,
                          exclude_summary: event.target.value,
                        }))
                      }
                      placeholder="Blocked"
                      disabled={creatingSource}
                    />
                  </label>
                  <label className="field">
                    Active
                    <div className="switch-group settings-switch-row">
                      <span>
                        {sourceDraft.is_active ? "Active" : "Inactive"}
                      </span>
                      <label className="switch switch--pink">
                        <input
                          type="checkbox"
                          checked={sourceDraft.is_active}
                          onChange={(event) =>
                            setSourceDraft((previous) => ({
                              ...previous,
                              is_active: event.target.checked,
                            }))
                          }
                          disabled={creatingSource}
                        />
                        <span className="slider" />
                      </label>
                    </div>
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => void createSource()}
                    disabled={creatingSource || loadingSources}
                  >
                    {creatingSource ? "Ajout..." : "Ajouter la source"}
                  </button>
                </div>
                {sourceNotice && (
                  <div className="note note--success">{sourceNotice}</div>
                )}
                {sourceError && <div className="note">{sourceError}</div>}
              </div>

              <div className="card settings-card settings-card--neutral settings-card--span-8">
                <div className="settings-managers-header">
                  <div>
                    <div className="settings-card__tag">Sources entrantes</div>
                    <div className="section-title">Sources iCal</div>
                  </div>
                  <div className="gites-tools">
                    <button
                      type="button"
                      className="table-action table-action--neutral gites-tool-button"
                      onClick={() => void exportIcalSources()}
                      disabled={
                        exportingSources || importingSources || loadingSources
                      }
                    >
                      {exportingSources ? "Export..." : "Exporter"}
                    </button>
                    <button
                      type="button"
                      className="table-action table-action--neutral gites-tool-button"
                      onClick={triggerSourceImport}
                      disabled={
                        analyzingSourcesImport ||
                        importingSources ||
                        exportingSources ||
                        loadingSources
                      }
                    >
                      {analyzingSourcesImport
                        ? "Lecture..."
                        : "Charger fichier"}
                    </button>
                  </div>
                </div>
                <input
                  ref={importSourcesInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void handleIcalSourcesImportFile(event)}
                  style={{ display: "none" }}
                />
                {sourceImportRows ? (
                  <div className="field-group" style={{ marginBottom: 12 }}>
                    <div className="field-group__header">
                      <div className="field-group__label">Import iCal prêt</div>
                      <div className="field-hint">
                        {sourceImportFileName || "Fichier JSON"}
                      </div>
                    </div>
                    <div className="field-hint">
                      Lignes: {sourceImportRows.length}
                      {sourceImportPreview
                        ? ` | Prêtes: ${sourceImportPreview.ready_count}/${sourceImportPreview.total_count}`
                        : ""}
                    </div>
                    <div className="actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void analyzeIcalSourcesImport()}
                        disabled={analyzingSourcesImport || importingSources}
                      >
                        {analyzingSourcesImport ? "Analyse..." : "Analyser"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void importIcalSources()}
                        disabled={
                          importingSources ||
                          analyzingSourcesImport ||
                          !sourceImportPreview ||
                          sourceImportUnresolvedCount > 0 ||
                          sourceImportPreview.mapping_errors.length > 0
                        }
                      >
                        {importingSources ? "Import..." : "Importer"}
                      </button>
                    </div>
                    {sourceImportPreview?.mapping_errors.length ? (
                      <div className="note" style={{ marginTop: 8 }}>
                        Mapping invalide:{" "}
                        {sourceImportPreview.mapping_errors
                          .map((item) => item.message)
                          .join(" ; ")}
                      </div>
                    ) : null}
                    {sourceImportPreview &&
                    sourceImportPreview.unknown_gites.length > 0 ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        <div className="field-hint">
                          Gîtes introuvables:{" "}
                          {sourceImportPreview.unknown_gites.length}. Attribuez
                          un gîte local.
                        </div>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Gîte import</th>
                              <th>Lignes</th>
                              <th>Indices</th>
                              <th>Attribuer à</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sourceImportPreview.unknown_gites.map((item) => {
                              const examples = getUnknownImportExamples(item);
                              const types = uniqueNonEmpty(
                                (item.sample_types &&
                                item.sample_types.length > 0
                                  ? item.sample_types
                                  : [item.sample_type]) as Array<
                                  string | null | undefined
                                >,
                              );
                              const hosts = uniqueNonEmpty(
                                (item.sample_hosts &&
                                item.sample_hosts.length > 0
                                  ? item.sample_hosts
                                  : examples.map((example) =>
                                      extractUrlHost(example.url),
                                    )) as Array<string | null | undefined>,
                              );
                              const identifiers = uniqueNonEmpty(
                                examples.flatMap((example) =>
                                  extractIcalUrlIdentifiers(example.url),
                                ),
                              );
                              const importLabel = item.sample_gite_nom
                                ? `${item.sample_gite_nom}${item.sample_gite_prefixe ? ` (${item.sample_gite_prefixe})` : ""}`
                                : null;

                              return (
                                <tr key={item.source_gite_id}>
                                  <td>
                                    <div style={{ display: "grid", gap: 2 }}>
                                      <div>
                                        {importLabel || item.source_gite_id}
                                      </div>
                                      {importLabel ? (
                                        <div className="field-hint">
                                          ID: {item.source_gite_id}
                                        </div>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td>{item.count}</td>
                                  <td>
                                    <div style={{ display: "grid", gap: 4 }}>
                                      {types.length > 0 ? (
                                        <div>Type: {types.join(", ")}</div>
                                      ) : null}
                                      {hosts.length > 0 ? (
                                        <div>Domaine: {hosts.join(", ")}</div>
                                      ) : null}
                                      {identifiers.length > 0 ? (
                                        <div>
                                          Identifiant: {identifiers.join(" | ")}
                                        </div>
                                      ) : null}
                                      {item.sample_source_id ? (
                                        <div className="field-hint">
                                          Source: {item.sample_source_id}
                                        </div>
                                      ) : null}
                                      {examples.length > 0 ? (
                                        <div
                                          className="field-hint"
                                          style={{ display: "grid", gap: 2 }}
                                        >
                                          {examples.map((example, index) => (
                                            <div
                                              key={`${item.source_gite_id}-example-${index}`}
                                            >
                                              {(example.type || "-") +
                                                " | " +
                                                truncateMiddle(
                                                  example.url || "-",
                                                )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td>
                                    <select
                                      value={
                                        sourceImportMapping[
                                          item.source_gite_id
                                        ] ??
                                        item.mapped_to ??
                                        ""
                                      }
                                      onChange={(event) =>
                                        setSourceImportMapping((previous) => ({
                                          ...previous,
                                          [item.source_gite_id]:
                                            event.target.value,
                                        }))
                                      }
                                      disabled={
                                        analyzingSourcesImport ||
                                        importingSources
                                      }
                                    >
                                      <option value="">Choisir un gîte</option>
                                      {gites.map((gite) => (
                                        <option key={gite.id} value={gite.id}>
                                          {gite.nom} ({gite.prefixe_contrat})
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {sourceImportUnresolvedCount > 0 ? (
                          <div className="field-hint">
                            {sourceImportUnresolvedCount} attribution(s)
                            manquante(s).
                          </div>
                        ) : (
                          <div className="field-hint">
                            Toutes les attributions sont renseignées.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <details className="settings-sources-accordion">
                  <summary>Sources iCal configurées ({sources.length})</summary>
                  {loadingSources ? (
                    <div className="field-hint">Chargement...</div>
                  ) : sources.length === 0 ? (
                    <div className="field-hint">
                      Aucune source iCal configurée.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {groupedIcalSources.map((group) => (
                        <div key={group.key} className="settings-source-group">
                          <div className="settings-source-group__header">
                            <div>
                              <div className="settings-source-group__eyebrow">
                                {group.gitePrefix || "Gîte"}
                              </div>
                              <div className="settings-source-group__title">
                                {group.giteName}
                              </div>
                              <div className="settings-source-group__meta">
                                {group.sources.length} source(s) |{" "}
                                {group.activeCount} active(s)
                              </div>
                            </div>
                            <span className="settings-card__badge">
                              {group.activeCount}/{group.sources.length} actives
                            </span>
                          </div>
                          <div style={{ display: "grid", gap: 12 }}>
                            {group.sources.map((source) => (
                              <div key={source.id} className="field-group">
                                <div className="field-group__header">
                                  <div className="field-group__label">
                                    {source.type || "Source iCal"}
                                  </div>
                                  <div className="field-hint">
                                    Source #{source.ordre + 1}
                                  </div>
                                </div>
                                <div className="grid-2">
                                  <label className="field">
                                    Gîte
                                    <select
                                      value={source.gite_id}
                                      onChange={(event) =>
                                        updateSourceField(
                                          source.id,
                                          "gite_id",
                                          event.target.value,
                                        )
                                      }
                                      disabled={
                                        savingSourceId === source.id ||
                                        deletingSourceId === source.id
                                      }
                                    >
                                      {gites.map((gite) => (
                                        <option key={gite.id} value={gite.id}>
                                          {gite.nom}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="field">
                                    Type
                                    <input
                                      value={source.type}
                                      onChange={(event) =>
                                        updateSourceField(
                                          source.id,
                                          "type",
                                          event.target.value,
                                        )
                                      }
                                      disabled={
                                        savingSourceId === source.id ||
                                        deletingSourceId === source.id
                                      }
                                    />
                                  </label>
                                  <label className="field">
                                    URL iCal
                                    <input
                                      value={source.url}
                                      onChange={(event) =>
                                        updateSourceField(
                                          source.id,
                                          "url",
                                          event.target.value,
                                        )
                                      }
                                      disabled={
                                        savingSourceId === source.id ||
                                        deletingSourceId === source.id
                                      }
                                    />
                                  </label>
                                  <label className="field">
                                    Inclure résumé
                                    <input
                                      value={source.include_summary ?? ""}
                                      onChange={(event) =>
                                        updateSourceField(
                                          source.id,
                                          "include_summary",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Reserved, BOOKED"
                                      disabled={
                                        savingSourceId === source.id ||
                                        deletingSourceId === source.id
                                      }
                                    />
                                  </label>
                                  <label className="field">
                                    Exclure résumé
                                    <input
                                      value={source.exclude_summary ?? ""}
                                      onChange={(event) =>
                                        updateSourceField(
                                          source.id,
                                          "exclude_summary",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Blocked"
                                      disabled={
                                        savingSourceId === source.id ||
                                        deletingSourceId === source.id
                                      }
                                    />
                                  </label>
                                  <label className="field">
                                    Active
                                    <div className="switch-group settings-switch-row">
                                      <span>
                                        {source.is_active
                                          ? "Active"
                                          : "Inactive"}
                                      </span>
                                      <label className="switch switch--pink">
                                        <input
                                          type="checkbox"
                                          checked={source.is_active}
                                          onChange={(event) =>
                                            updateSourceField(
                                              source.id,
                                              "is_active",
                                              event.target.checked,
                                            )
                                          }
                                          disabled={
                                            savingSourceId === source.id ||
                                            deletingSourceId === source.id
                                          }
                                        />
                                        <span className="slider" />
                                      </label>
                                    </div>
                                  </label>
                                </div>
                                <div className="actions">
                                  <button
                                    type="button"
                                    className="table-action table-action--primary"
                                    onClick={() => void saveSource(source)}
                                    disabled={
                                      savingSourceId === source.id ||
                                      deletingSourceId === source.id
                                    }
                                  >
                                    {savingSourceId === source.id
                                      ? "Enregistrement..."
                                      : "Enregistrer"}
                                  </button>
                                  <button
                                    type="button"
                                    className="table-action table-action--danger"
                                    onClick={() => void removeSource(source)}
                                    disabled={
                                      savingSourceId === source.id ||
                                      deletingSourceId === source.id
                                    }
                                  >
                                    {deletingSourceId === source.id
                                      ? "Suppression..."
                                      : "Supprimer"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              </div>
            </div>
          </section>

          <section
            id="settings-ical-exports"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-ical-exports"}
            aria-labelledby="nav-settings-ical-exports"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Publication OTA</div>
                <h2 className="settings-cluster__title">Exports iCal OTA</h2>
              </div>
              <p className="settings-cluster__text">
                Gérez les flux iCal publics publiés pour les OTA.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--blue settings-card--span-12">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Publication OTA</span>
                  <span className="settings-card__badge">
                    {readyIcalExportsCount} prêt(s)
                  </span>
                </div>
                <div className="section-title">Exports iCal OTA</div>
                <div className="field-hint">
                  Publie les réservations locales et celles insérées par{" "}
                  <code>what-today</code>. Les réservations importées depuis
                  iCal, Pump ou CSV ne sont pas réémises.
                </div>
                {icalExportsNotice && (
                  <div className="note note--success">{icalExportsNotice}</div>
                )}
                {icalExportsError && (
                  <div className="note">{icalExportsError}</div>
                )}
                {loadingIcalExports ? (
                  <div className="field-hint" style={{ marginTop: 10 }}>
                    Chargement...
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {icalExports.map((feed) => (
                      <div key={feed.id} className="field-group">
                        <div className="field-group__header">
                          <div className="field-group__label">
                            {feed.nom} ({feed.prefixe_contrat})
                          </div>
                          <div className="settings-ical-export__meta">
                            <span
                              className={
                                feed.exported_reservations_count > 0
                                  ? "settings-ical-export__badge"
                                  : "settings-ical-export__badge settings-ical-export__badge--empty"
                              }
                            >
                              {feed.exported_reservations_count} résa iCal
                            </span>
                            <div className="field-hint">
                              {feed.reservations_count} réservation(s) |{" "}
                              {feed.exported_reservations_count} exportée(s)
                            </div>
                          </div>
                        </div>
                        <label className="field">
                          URL iCal publique
                          <input
                            value={
                              feed.ical_export_token
                                ? getIcalExportUrl(feed)
                                : ""
                            }
                            readOnly
                          />
                        </label>
                        <div className="actions">
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void copyIcalExportUrl(feed)}
                            disabled={
                              !feed.ical_export_token ||
                              resettingIcalExportId === feed.id ||
                              resettingIcalExportReservationsId === feed.id
                            }
                          >
                            Copier l'URL
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() =>
                              void resetIcalExportReservations(feed)
                            }
                            disabled={
                              feed.exported_reservations_count === 0 ||
                              resettingIcalExportId === feed.id ||
                              resettingIcalExportReservationsId === feed.id
                            }
                          >
                            {resettingIcalExportReservationsId === feed.id
                              ? "Reset..."
                              : "Reset OTA"}
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--danger"
                            onClick={() => void resetIcalExportToken(feed)}
                            disabled={
                              resettingIcalExportId === feed.id ||
                              resettingIcalExportReservationsId === feed.id
                            }
                          >
                            {resettingIcalExportId === feed.id
                              ? "Régénération..."
                              : "Régénérer le token"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-ical-sync"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-ical-sync"}
            aria-labelledby="nav-settings-ical-sync"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">Automatisation</div>
                <h2 className="settings-cluster__title">
                  Synchronisation iCal
                </h2>
              </div>
              <p className="settings-cluster__text">
                Pilotez le cron iCal, les imports automatiques et la
                synchronisation immédiate.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--blue settings-card--span-12">
                <div className="settings-managers-header">
                  <div>
                    <div className="settings-card__tag">Automatisation</div>
                    <div className="section-title">Synchronisation iCal</div>
                  </div>
                  <div className="gites-tools">
                    <button
                      type="button"
                      className="table-action table-action--neutral gites-tool-button"
                      onClick={() => void exportIcalCronConfig()}
                      disabled={
                        exportingCron ||
                        importingCron ||
                        savingCron ||
                        syncingIcal ||
                        loadingIcalPreview
                      }
                    >
                      {exportingCron ? "Export..." : "Exporter paramètres"}
                    </button>
                    <button
                      type="button"
                      className="table-action table-action--neutral gites-tool-button"
                      onClick={triggerCronImport}
                      disabled={
                        importingCron ||
                        exportingCron ||
                        savingCron ||
                        syncingIcal ||
                        loadingIcalPreview
                      }
                    >
                      {importingCron ? "Import..." : "Importer paramètres"}
                    </button>
                  </div>
                </div>
                <input
                  ref={importCronInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importIcalCronConfigFromFile(event)}
                  style={{ display: "none" }}
                />
                <div className="field-hint">
                  Déclenchement iCal par URL externe Alwaysdata. Statut cron:{" "}
                  {icalCronState?.config.enabled ? "activé" : "désactivé"}.{" "}
                  Import auto au chargement:{" "}
                  {icalCronState?.config.auto_sync_on_app_load
                    ? "activé"
                    : "désactivé"}
                  . Relance Pump après nouvelle réservation Airbnb:{" "}
                  {icalCronState?.config.auto_run_pump_for_new_airbnb_ical
                    ? "activée"
                    : "désactivée"}
                  . Dernière tentative:{" "}
                  {formatIsoDateTimeFr(icalCronState?.last_run_at ?? null)}.
                </div>
                {icalCronState?.last_success_at ? (
                  <div className="field-hint" style={{ marginTop: 6 }}>
                    Dernier succès:{" "}
                    {formatIsoDateTimeFr(icalCronState.last_success_at)}
                  </div>
                ) : null}
                {icalCronState?.last_error ? (
                  <div className="note" style={{ marginTop: 8 }}>
                    Dernière erreur cron: {icalCronState.last_error}
                  </div>
                ) : null}
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Déclenchement externe possible via URL HTTP Alwaysdata sur{" "}
                  <code>/api/settings/ical/cron/run?token=...</code>.
                </div>
                <div className="grid-2" style={{ marginTop: 12 }}>
                  <label className="field">
                    Cron externe actif
                    <select
                      value={cronDraft.enabled ? "1" : "0"}
                      onChange={(event) =>
                        setCronDraft((previous) => ({
                          ...previous,
                          enabled: event.target.value === "1",
                        }))
                      }
                      disabled={savingCron}
                    >
                      <option value="1">Oui</option>
                      <option value="0">Non</option>
                    </select>
                  </label>
                  <label className="field">
                    Import auto au chargement
                    <select
                      value={cronDraft.auto_sync_on_app_load ? "1" : "0"}
                      onChange={(event) =>
                        setCronDraft((previous) => ({
                          ...previous,
                          auto_sync_on_app_load: event.target.value === "1",
                        }))
                      }
                      disabled={savingCron}
                    >
                      <option value="1">Oui</option>
                      <option value="0">Non</option>
                    </select>
                  </label>
                  <label className="field">
                    Relancer Pump si iCal crée une réservation Airbnb
                    <select
                      value={cronDraft.auto_run_pump_for_new_airbnb_ical ? "1" : "0"}
                      onChange={(event) =>
                        setCronDraft((previous) => ({
                          ...previous,
                          auto_run_pump_for_new_airbnb_ical:
                            event.target.value === "1",
                        }))
                      }
                      disabled={savingCron}
                    >
                      <option value="1">Oui</option>
                      <option value="0">Non</option>
                    </select>
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void saveCronConfig()}
                    disabled={savingCron || syncingIcal || loadingIcalPreview}
                  >
                    {savingCron ? "Enregistrement..." : "Enregistrer le cron"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void runIcalPreview()}
                    disabled={loadingIcalPreview || syncingIcal}
                  >
                    {loadingIcalPreview
                      ? "Lecture iCal..."
                      : "Prévisualiser iCal"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void runIcalSync()}
                    disabled={syncingIcal || loadingIcalPreview}
                  >
                    {syncingIcal
                      ? "Synchronisation..."
                      : "Synchroniser maintenant"}
                  </button>
                </div>
                {icalNotice && (
                  <div className="note note--success">{icalNotice}</div>
                )}
                {icalError && <div className="note">{icalError}</div>}
                {icalPreview && (
                  <div style={{ marginTop: 14 }}>
                    <div className="field-hint" style={{ marginBottom: 8 }}>
                      Sources lues: {icalPreview.fetched_sources} | Événements:{" "}
                      {icalPreview.parsed_events} | Nouveaux:{" "}
                      {icalPreview.counts.new} | Complétables:{" "}
                      {icalPreview.counts.existing_updatable} | Conflits:{" "}
                      {icalPreview.counts.conflict}
                    </div>
                    {icalPreview.errors.length > 0 ? (
                      <div className="note" style={{ marginBottom: 10 }}>
                        {icalPreview.errors.length} source(s) en erreur:{" "}
                        {icalPreview.errors
                          .map(
                            (error) => `${error.gite_nom} (${error.message})`,
                          )
                          .join(" ; ")}
                      </div>
                    ) : null}
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Gîte</th>
                          <th>Dates</th>
                          <th>Source iCal</th>
                          <th>Source finale</th>
                          <th>Statut</th>
                          <th>Résumé</th>
                        </tr>
                      </thead>
                      <tbody>
                        {icalPreview.reservations.slice(0, 80).map((item) => (
                          <tr key={item.id}>
                            <td>{item.gite_nom}</td>
                            <td>
                              {formatIsoDateFr(item.date_entree)} -{" "}
                              {formatIsoDateFr(item.date_sortie)}
                            </td>
                            <td>{item.source_type}</td>
                            <td>{item.final_source}</td>
                            <td>
                              {statusLabelMap[item.status]}
                              {item.update_fields.length > 0
                                ? ` (${item.update_fields.join(", ")})`
                                : ""}
                            </td>
                            <td>{item.summary || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {icalPreview.reservations.length > 80 ? (
                      <div className="field-hint">
                        Affichage limité aux 80 premières lignes.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section
            id="settings-imports"
            className="settings-cluster"
            hidden={activeSettingsSection !== "settings-imports"}
            aria-labelledby="nav-settings-imports"
          >
            <div className="settings-cluster__header">
              <div>
                <div className="settings-cluster__eyebrow">
                  Imports externes
                </div>
                <h2 className="settings-cluster__title">Pump</h2>
              </div>
              <p className="settings-cluster__text">
                Déclenchement, contrôle de session et import des réservations
                Pump depuis un seul espace.
              </p>
            </div>
            <div className="settings-cluster__grid">
              <div className="card settings-card settings-card--green settings-card--span-8">
                <div className="settings-card__topline">
                  <span className="settings-card__tag">Import automatisé</span>
                  <span className="settings-card__badge">
                    {pumpConfigReady ? "Configuré" : "À configurer"}
                  </span>
                </div>
                <div className="section-title">Import Pump</div>
                <div className="field-hint">
                  Déclenche un refresh dans l'automatisation Pump locale, attend
                  une extraction exploitable, puis crée ou complète les
                  réservations. Le cron utilise le même enchaînement.
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Configuration:{" "}
                  {pumpConfigDraft.baseUrl
                    ? pumpConfigDraft.baseUrl
                    : "URL absente"}
                  {pumpConfigDraft.username
                    ? ` | Compte: ${pumpConfigDraft.username}`
                    : ""}
                  {pumpConfigDraft.scrollSelector
                    ? ` | Scroll: ${pumpConfigDraft.scrollSelector}`
                    : ""}
                </div>
                <input
                  ref={importPumpConfigInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importPumpConfigFromFile(event)}
                  style={{ display: "none" }}
                />
                <input
                  ref={importPumpSessionInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importPumpSessionFromFile(event)}
                  style={{ display: "none" }}
                />
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void exportPumpConfig()}
                    disabled={
                      exportingPumpConfig ||
                      importingPumpConfig ||
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget
                    }
                  >
                    {exportingPumpConfig
                      ? "Export config..."
                      : "Exporter config Pump"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={triggerPumpConfigImport}
                    disabled={
                      importingPumpConfig ||
                      exportingPumpConfig ||
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget
                    }
                  >
                    {importingPumpConfig
                      ? "Import config..."
                      : "Importer config Pump"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={triggerPumpSessionImport}
                    disabled={
                      importingPumpSession ||
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget
                    }
                  >
                    {importingPumpSession
                      ? "Import session..."
                      : "Importer session persistée"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void exportPumpSession()}
                    disabled={
                      exportingPumpSession ||
                      importingPumpSession ||
                      savingPumpConfig
                    }
                  >
                    {exportingPumpSession
                      ? "Export..."
                      : "Exporter session persistée"}
                  </button>
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Import JSON compatible avec l'ancien Pump: configuration{" "}
                  <code>last.json</code> et storage state Playwright.
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => void startPumpSessionRenewal()}
                    disabled={
                      startingPumpSessionRenewal ||
                      cancellingPumpSessionRenewal ||
                      submittingPumpSessionRenewalCode ||
                      Boolean(pumpSessionRenewal?.active) ||
                      savingPumpConfig ||
                      importingPumpSession
                    }
                  >
                    {startingPumpSessionRenewal
                      ? "Démarrage..."
                      : "Renouveler la session Airbnb"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void cancelPumpSessionRenewal()}
                    disabled={
                      !pumpSessionRenewal?.active ||
                      cancellingPumpSessionRenewal
                    }
                  >
                    {cancellingPumpSessionRenewal
                      ? "Annulation..."
                      : "Annuler le renouvellement"}
                  </button>
                </div>
                {pumpSessionRenewal ? (
                  <div
                    className="pump-health-card pump-health-card--neutral"
                    style={{ marginTop: 12 }}
                  >
                    <div className="pump-health-card__headline">
                      <span
                        className="pump-health-dot pump-health-dot--neutral"
                        aria-hidden="true"
                      />
                      <strong>
                        Renouvellement assisté:{" "}
                        {pumpSessionRenewal.active
                          ? "en cours"
                          : pumpSessionRenewal.status}
                      </strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      {pumpSessionRenewal.message}
                    </div>
                    {pumpSessionRenewal.maskedDestination ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Code envoyé vers:{" "}
                        {pumpSessionRenewal.maskedDestination}
                      </div>
                    ) : null}
                    {pumpSessionRenewal.currentUrl ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        URL courante: {pumpSessionRenewal.currentUrl}
                      </div>
                    ) : null}
                    {pumpSessionRenewal.diagnosticsRelativePath ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Diagnostics:{" "}
                        {pumpSessionRenewal.diagnosticsRelativePath}
                      </div>
                    ) : null}
                    {pumpSessionRenewal.status === "awaiting_sms_code" ? (
                      <div className="actions" style={{ marginTop: 12 }}>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={pumpRenewalSmsCode}
                          onChange={(event) =>
                            setPumpRenewalSmsCode(
                              event.target.value.replace(/[^\d]/g, ""),
                            )
                          }
                          placeholder="Code SMS"
                          style={{ maxWidth: 200 }}
                          disabled={submittingPumpSessionRenewalCode}
                        />
                        <button
                          type="button"
                          onClick={() => void submitPumpSessionRenewalCode()}
                          disabled={
                            submittingPumpSessionRenewalCode ||
                            pumpRenewalSmsCode.trim().length < 4
                          }
                        >
                          {submittingPumpSessionRenewalCode
                            ? "Validation..."
                            : "Valider le code"}
                        </button>
                      </div>
                    ) : null}
                    {pumpSessionRenewal.error ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Erreur: {pumpSessionRenewal.error}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void startPumpSessionCapture()}
                    disabled={
                      startingPumpSessionCapture ||
                      cancellingPumpSessionCapture ||
                      Boolean(pumpSessionCapture?.active) ||
                      savingPumpConfig ||
                      importingPumpSession
                    }
                  >
                    {startingPumpSessionCapture
                      ? "Ouverture..."
                      : "Ouvrir le navigateur de capture"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void cancelPumpSessionCapture()}
                    disabled={
                      !pumpSessionCapture?.active ||
                      cancellingPumpSessionCapture
                    }
                  >
                    {cancellingPumpSessionCapture
                      ? "Annulation..."
                      : "Annuler la capture"}
                  </button>
                </div>
                {pumpSessionCapture ? (
                  <div
                    className="pump-health-card pump-health-card--neutral"
                    style={{ marginTop: 12 }}
                  >
                    <div className="pump-health-card__headline">
                      <span
                        className="pump-health-dot pump-health-dot--neutral"
                        aria-hidden="true"
                      />
                      <strong>
                        Capture interactive:{" "}
                        {pumpSessionCapture.active
                          ? "en cours"
                          : pumpSessionCapture.status}
                      </strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      {pumpSessionCapture.available
                        ? pumpSessionCapture.message
                        : "Disponible uniquement en local avec navigateur visible."}
                    </div>
                    {pumpSessionCapture.currentUrl ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        URL courante: {pumpSessionCapture.currentUrl}
                      </div>
                    ) : null}
                    {pumpSessionCapture.storageStateRelativePath ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Session sauvegardée:{" "}
                        {pumpSessionCapture.storageStateRelativePath}
                      </div>
                    ) : null}
                    {pumpSessionCapture.error ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Erreur: {pumpSessionCapture.error}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid-2" style={{ marginTop: 12 }}>
                  <label className="field">
                    URL Airbnb
                    <input
                      type="url"
                      value={pumpConfigDraft.baseUrl}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          baseUrl: event.target.value,
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                      placeholder="https://www.airbnb.fr/hosting/multicalendar"
                    />
                  </label>
                  <label className="field">
                    Email / username
                    <input
                      type="text"
                      value={pumpConfigDraft.username}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          username: event.target.value,
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                      placeholder="compte@exemple.com"
                    />
                  </label>
                  <label className="field">
                    Mode d'authentification
                    <select
                      value={pumpConfigDraft.authMode}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          authMode: event.target
                            .value as PumpAutomationConfig["authMode"],
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    >
                      <option value="persisted-only">
                        Session persistée uniquement
                      </option>
                      <option value="legacy-auto-login">
                        Legacy auto-login
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    Stratégie de login
                    <select
                      value={pumpConfigDraft.loginStrategy}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          loginStrategy: event.target
                            .value as PumpAutomationConfig["loginStrategy"],
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    >
                      <option value="simple">Simple</option>
                      <option value="multi-step">Multi-step</option>
                    </select>
                  </label>
                  <label className="field">
                    Sélecteur de scroll
                    <input
                      type="text"
                      value={pumpConfigDraft.scrollSelector}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          scrollSelector: event.target.value,
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                      placeholder=".v2-multi-calendar__grid"
                    />
                  </label>
                  <label className="field">
                    2FA / OTP
                    <select
                      value={pumpConfigDraft.hasOTP ? "1" : "0"}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          hasOTP: event.target.value === "1",
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    >
                      <option value="0">Non</option>
                      <option value="1">Oui</option>
                    </select>
                  </label>
                  <label className="field">
                    Session persistée
                    <select
                      value={pumpConfigDraft.persistSession ? "1" : "0"}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          persistSession: event.target.value === "1",
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    >
                      <option value="1">Oui</option>
                      <option value="0">Non</option>
                    </select>
                  </label>
                  <label className="field">
                    Attente avant scroll (ms)
                    <input
                      type="number"
                      min={0}
                      max={120000}
                      value={pumpConfigDraft.waitBeforeScroll}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          waitBeforeScroll: Math.min(
                            120000,
                            Math.max(0, Number(event.target.value || 0)),
                          ),
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    />
                  </label>
                  <label className="field">
                    Nombre de scrolls
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={pumpConfigDraft.scrollCount}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          scrollCount: Math.min(
                            500,
                            Math.max(1, Number(event.target.value || 1)),
                          ),
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    />
                  </label>
                  <label className="field">
                    Distance de scroll
                    <input
                      type="number"
                      min={1}
                      max={20000}
                      value={pumpConfigDraft.scrollDistance}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          scrollDistance: Math.min(
                            20000,
                            Math.max(1, Number(event.target.value || 1)),
                          ),
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    />
                  </label>
                  <label className="field">
                    Délai entre scrolls (ms)
                    <input
                      type="number"
                      min={0}
                      max={120000}
                      value={pumpConfigDraft.scrollDelay}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          scrollDelay: Math.min(
                            120000,
                            Math.max(0, Number(event.target.value || 0)),
                          ),
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    />
                  </label>
                  <label className="field">
                    Scroll manuel
                    <select
                      value={pumpConfigDraft.manualScrollMode ? "1" : "0"}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          manualScrollMode: event.target.value === "1",
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                    >
                      <option value="0">Non</option>
                      <option value="1">Oui</option>
                    </select>
                  </label>
                  <label className="field">
                    Durée scroll manuel (ms)
                    <input
                      type="number"
                      min={0}
                      max={600000}
                      value={pumpConfigDraft.manualScrollDuration}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          manualScrollDuration: Math.min(
                            600000,
                            Math.max(0, Number(event.target.value || 0)),
                          ),
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget ||
                        !pumpConfigDraft.manualScrollMode
                      }
                    />
                  </label>
                  <label className="field">
                    Dossier de sortie optionnel
                    <input
                      type="text"
                      value={pumpConfigDraft.outputFolder}
                      onChange={(event) =>
                        setPumpConfigDraft((previous) => ({
                          ...previous,
                          outputFolder: event.target.value,
                        }))
                      }
                      disabled={
                        savingPumpConfig ||
                        testingPumpConnection ||
                        testingPumpScrollTarget
                      }
                      placeholder="/chemin/vers/un/dossier"
                    />
                  </label>
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Le mode recommandé est <code>persisted-only</code>: le serveur
                  réutilise une session Playwright existante et n'essaie plus de
                  reconstruire la connexion via les boutons Airbnb.
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Le mot de passe n'est utilisé que pour le mode legacy. En
                  phase 1, privilégiez l'import/export de session persistée.
                </div>
                <details
                  className="settings-sources-accordion"
                  style={{ marginTop: 12 }}
                >
                  <summary>Sélecteurs avancés</summary>
                  <div className="grid-2" style={{ marginTop: 12 }}>
                    <label className="field">
                      Champ username
                      <textarea
                        rows={2}
                        value={pumpConfigDraft.advancedSelectors.usernameInput}
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              usernameInput: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Champ mot de passe
                      <textarea
                        rows={2}
                        value={pumpConfigDraft.advancedSelectors.passwordInput}
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              passwordInput: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton submit
                      <textarea
                        rows={2}
                        value={pumpConfigDraft.advancedSelectors.submitButton}
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              submitButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton email-first
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors.emailFirstButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              emailFirstButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton après username
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .continueAfterUsernameButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              continueAfterUsernameButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton final
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors.finalSubmitButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              finalSubmitButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton compte persistant
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .accountChooserContinueButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              accountChooserContinueButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Carte source calendrier
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors.calendarSourceCard
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              calendarSourceCard: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton modifier source
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .calendarSourceEditButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              calendarSourceEditButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton actualiser source
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .calendarSourceRefreshButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              calendarSourceRefreshButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Champ URL source
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .calendarSourceUrlField
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              calendarSourceUrlField: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                    <label className="field">
                      Bouton fermer source
                      <textarea
                        rows={2}
                        value={
                          pumpConfigDraft.advancedSelectors
                            .calendarSourceCloseButton
                        }
                        onChange={(event) =>
                          setPumpConfigDraft((previous) => ({
                            ...previous,
                            advancedSelectors: {
                              ...previous.advancedSelectors,
                              calendarSourceCloseButton: event.target.value,
                            },
                          }))
                        }
                        disabled={
                          savingPumpConfig ||
                          testingPumpConnection ||
                          testingPumpScrollTarget
                        }
                      />
                    </label>
                  </div>
                </details>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void savePumpConfig()}
                    disabled={
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget
                    }
                  >
                    {savingPumpConfig
                      ? "Enregistrement..."
                      : "Enregistrer la configuration"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void testPumpConnection()}
                    disabled={
                      testingPumpConnection ||
                      savingPumpConfig ||
                      !pumpConfigReady
                    }
                  >
                    {testingPumpConnection ? "Test..." : "Tester la connexion"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void testPumpScrollTarget()}
                    disabled={
                      testingPumpScrollTarget ||
                      savingPumpConfig ||
                      !pumpConfigReady
                    }
                  >
                    {testingPumpScrollTarget
                      ? "Test..."
                      : "Tester la zone de scroll"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadPumpConfig()}
                    disabled={
                      loadingPumpConfig ||
                      savingPumpConfig ||
                      importingPumpConfig ||
                      importingPumpSession
                    }
                  >
                    {loadingPumpConfig
                      ? "Chargement..."
                      : "Recharger la configuration"}
                  </button>
                </div>
                <div className="field-hint" style={{ marginTop: 8 }}>
                  Cron: {pumpCronState?.config.enabled ? "activé" : "désactivé"}{" "}
                  (
                  {pumpCronState?.scheduler === "external"
                    ? "déclenchement externe"
                    : "mémoire serveur"}
                  ). Prochain import:{" "}
                  {formatIsoDateTimeFr(pumpCronState?.next_run_at ?? null)}.
                  Dernier import:{" "}
                  {formatIsoDateTimeFr(pumpCronState?.last_run_at ?? null)}.
                </div>
                <div className="grid-2" style={{ marginTop: 12 }}>
                  <label className="field">
                    Cron actif
                    <select
                      value={pumpCronDraft.enabled ? "1" : "0"}
                      onChange={(event) =>
                        setPumpCronDraft((previous) => ({
                          ...previous,
                          enabled: event.target.value === "1",
                        }))
                      }
                      disabled={savingPumpCron}
                    >
                      <option value="1">Oui</option>
                      <option value="0">Non</option>
                    </select>
                  </label>
                  <label className="field">
                    Import au démarrage
                    <select
                      value={pumpCronDraft.run_on_start ? "1" : "0"}
                      onChange={(event) =>
                        setPumpCronDraft((previous) => ({
                          ...previous,
                          run_on_start: event.target.value === "1",
                        }))
                      }
                      disabled={savingPumpCron}
                    >
                      <option value="0">Non</option>
                      <option value="1">Oui</option>
                    </select>
                  </label>
                  <label className="field">
                    Tous les X jours
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={pumpCronDraft.interval_days}
                      onChange={(event) =>
                        setPumpCronDraft((previous) => ({
                          ...previous,
                          interval_days: Math.min(
                            30,
                            Math.max(1, Number(event.target.value || 1)),
                          ),
                        }))
                      }
                      disabled={savingPumpCron}
                    />
                  </label>
                  <label className="field">
                    Heure
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={pumpCronDraft.hour}
                      onChange={(event) =>
                        setPumpCronDraft((previous) => ({
                          ...previous,
                          hour: Math.min(
                            23,
                            Math.max(0, Number(event.target.value || 0)),
                          ),
                        }))
                      }
                      disabled={savingPumpCron}
                    />
                  </label>
                  <label className="field">
                    Minute
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={pumpCronDraft.minute}
                      onChange={(event) =>
                        setPumpCronDraft((previous) => ({
                          ...previous,
                          minute: Math.min(
                            59,
                            Math.max(0, Number(event.target.value || 0)),
                          ),
                        }))
                      }
                      disabled={savingPumpCron}
                    />
                  </label>
                </div>
                {pumpCronState?.running ? (
                  <div className="field-hint" style={{ marginTop: 8 }}>
                    Import Pump automatique en cours.
                  </div>
                ) : null}
                {pumpCronState?.last_error ? (
                  <div className="note" style={{ marginTop: 8 }}>
                    {pumpCronState.last_error}
                  </div>
                ) : null}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void savePumpCronConfig()}
                    disabled={
                      savingPumpCron ||
                      refreshingPump ||
                      analyzingPump ||
                      importingPump ||
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget
                    }
                  >
                    {savingPumpCron
                      ? "Enregistrement..."
                      : "Enregistrer le cron"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void refreshPump()}
                    disabled={
                      refreshingPump ||
                      analyzingPump ||
                      importingPump ||
                      savingPumpCron ||
                      savingPumpConfig ||
                      testingPumpConnection ||
                      testingPumpScrollTarget ||
                      !pumpConfigReady
                    }
                  >
                    {refreshingPump ? "Refresh..." : "Lancer refresh Pump"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void Promise.all([
                        loadPumpConfig(),
                        loadPumpStatus(),
                        loadPumpHealth(),
                        loadPumpCronState(),
                      ]).catch((error: any) =>
                        setPumpError(
                          error.message ??
                            "Impossible de rafraîchir les informations Pump.",
                        ),
                      )
                    }
                    disabled={
                      loadingPumpStatus ||
                      loadingPumpConfig ||
                      refreshingPump ||
                      importingPumpConfig ||
                      importingPumpSession
                    }
                  >
                    {loadingPumpStatus ? "Statut..." : "Rafraîchir le statut"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void analyzePump()}
                    disabled={
                      analyzingPump ||
                      importingPump ||
                      savingPumpCron ||
                      savingPumpConfig ||
                      !pumpConfigReady
                    }
                  >
                    {analyzingPump
                      ? "Analyse..."
                      : "Analyser la dernière extraction"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void importPump()}
                    disabled={
                      importingPump ||
                      !pumpPreview ||
                      selectedPumpCount === 0 ||
                      analyzingPump ||
                      savingPumpCron ||
                      savingPumpConfig
                    }
                  >
                    {importingPump
                      ? "Import..."
                      : `Importer (${selectedPumpCount})`}
                  </button>
                </div>
                {pumpStatus ? (
                  <div className="field-hint" style={{ marginTop: 8 }}>
                    Statut: <strong>{pumpStatus.status}</strong>
                    {pumpStatus.sessionId
                      ? ` | Session: ${pumpStatus.sessionId}`
                      : ""}
                    {typeof pumpStatus.reservationCount === "number"
                      ? ` | Réservations: ${pumpStatus.reservationCount}`
                      : ""}
                    {pumpStatus.updatedAt
                      ? ` | Mis à jour: ${formatIsoDateTimeFr(pumpStatus.updatedAt)}`
                      : ""}
                  </div>
                ) : null}
                {pumpHealth ? (
                  <div
                    className={`pump-health-card pump-health-card--${pumpHealth.tone}`}
                    style={{ marginTop: 12 }}
                  >
                    <div className="pump-health-card__headline">
                      <span
                        className={`pump-health-dot pump-health-dot--${pumpHealth.tone}`}
                        aria-hidden="true"
                      />
                      <strong>{pumpHealth.label}</strong>
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      {pumpHealth.summary}
                      {pumpHealth.storageStateId
                        ? ` | Session: ${pumpHealth.storageStateId}`
                        : ""}
                      {pumpHealth.sessionFileUpdatedAt
                        ? ` | Fichier: ${formatIsoDateTimeFr(pumpHealth.sessionFileUpdatedAt)}`
                        : ""}
                    </div>
                    <div className="field-hint" style={{ marginTop: 6 }}>
                      Dernier refresh OK:{" "}
                      {formatIsoDateTimeFr(pumpHealth.lastSuccessfulRefreshAt)}{" "}
                      | Scheduler:{" "}
                      {pumpHealth.cronScheduler === "external"
                        ? "externe"
                        : "interne"}{" "}
                      | Fenêtre stale: {pumpHealth.staleAfterHours}h
                    </div>
                    {pumpHealth.recommendedAction ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Action: {pumpHealth.recommendedAction}
                      </div>
                    ) : null}
                    {pumpHealth.latestError ? (
                      <div className="field-hint" style={{ marginTop: 6 }}>
                        Dernière erreur: {pumpHealth.latestError}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {pumpNotice && (
                  <div className="note note--success">{pumpNotice}</div>
                )}
                {pumpError && <div className="note">{pumpError}</div>}

                {pumpPreview && (
                  <div style={{ marginTop: 14 }}>
                    <div className="field-hint" style={{ marginBottom: 8 }}>
                      Source Pump: {pumpPreview.pump?.status ?? "-"}
                      {pumpPreview.pump?.session_id
                        ? ` | Session: ${pumpPreview.pump.session_id}`
                        : ""}
                      {pumpPreview.pump?.updated_at
                        ? ` | Mis à jour: ${formatIsoDateTimeFr(pumpPreview.pump.updated_at)}`
                        : ""}
                    </div>
                    <div className="field-hint" style={{ marginBottom: 8 }}>
                      Total: {pumpPreview.reservations.length} | Nouveaux:{" "}
                      {pumpPreview.counts.new} | Complétables:{" "}
                      {pumpPreview.counts.existing_updatable} | Déjà présents:{" "}
                      {pumpPreview.counts.existing} | Conflits:{" "}
                      {pumpPreview.counts.conflict} | Listing non mappé:{" "}
                      {pumpPreview.counts.unmapped_listing}
                    </div>
                    <table className="table">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Gîte</th>
                          <th>Dates</th>
                          <th>Hôte</th>
                          <th>Prix</th>
                          <th>Source</th>
                          <th>Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pumpPreview.reservations.slice(0, 120).map((item) => {
                          const selectable = isImportablePreviewStatus(
                            item.status,
                          );
                          return (
                            <tr key={item.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={Boolean(pumpSelections[item.id])}
                                  disabled={!selectable || importingPump}
                                  onChange={(event) =>
                                    setPumpSelections((previous) => ({
                                      ...previous,
                                      [item.id]: event.target.checked,
                                    }))
                                  }
                                />
                              </td>
                              <td>{item.gite_nom ?? item.listing_id}</td>
                              <td>
                                {formatIsoDateFr(item.check_in)} -{" "}
                                {formatIsoDateFr(item.check_out)}
                              </td>
                              <td>{item.hote_nom ?? "-"}</td>
                              <td>
                                {typeof item.prix_total === "number"
                                  ? `${item.prix_total.toFixed(2)} €`
                                  : "-"}
                              </td>
                              <td>{item.source_type}</td>
                              <td>
                                {importPreviewStatusLabelMap[item.status]}
                                {item.update_fields.length > 0
                                  ? ` (${item.update_fields.join(", ")})`
                                  : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {pumpPreview.reservations.length > 120 ? (
                      <div className="field-hint">
                        Affichage limité aux 120 premières lignes.
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
