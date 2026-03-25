import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { apiFetch, buildApiUrl } from "../utils/api";
import {
  type ServerAuthSession,
  type ServerSecuritySaveResult,
  type ServerSecuritySettings,
} from "../utils/auth";
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
  errors: Array<{ source_id: string; gite_nom: string; url: string; message: string }>;
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
  per_gite?: Record<string, { inserted: number; updated: number; skipped: number }>;
  inserted_items?: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }>;
};

type IcalCronState = {
  config: {
    enabled: boolean;
    auto_sync_on_app_load: boolean;
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
  perGite?: Record<string, { inserted?: number; updated?: number; skipped?: number }>;
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
  status: "new" | "existing" | "existing_updatable" | "conflict" | "unmapped_listing";
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
  status: "connected" | "stale" | "auth_required" | "refresh_failed" | "disabled";
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
  status: "idle" | "starting" | "waiting_for_login" | "saving" | "saved" | "failed" | "cancelled" | "timed_out";
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
  mapping_errors: Array<{ source_gite_id: string; mapped_to: string; message: string }>;
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

type SettingsPageProps = {
  onAuthSessionUpdated?: (session: ServerAuthSession) => void;
};

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
  const normalized = String(source ?? "").trim().toLowerCase();
  if (normalized === "ical-manual") return "ICAL manuel";
  if (normalized === "ical-cron") return "ICAL cron";
  if (normalized === "ical-startup") return "ICAL démarrage";
  if (normalized === "pump") return "Pump";
  if (normalized === "pump-cron") return "Pump cron";
  if (normalized === "pump-refresh") return "Pump refresh";
  return source || "Import";
};

const formatImportLogTitle = (entry: Pick<ImportLogEntry, "source" | "status">) =>
  entry.status === "error" ? `${formatImportSource(entry.source)} · échec` : formatImportSource(entry.source);

const isPumpRefreshImportSource = (source: string | null | undefined) =>
  String(source ?? "").trim().toLowerCase() === "pump-refresh";

const formatImportLogSummary = (entry: ImportLogEntry) => {
  if (entry.status === "error") {
    return `Erreur: ${entry.errorMessage || "Erreur inconnue lors de l'import."}`;
  }

  if (isPumpRefreshImportSource(entry.source)) {
    return `Réservations extraites: ${entry.selectionCount ?? 0}`;
  }

  return `Sélectionnées: ${entry.selectionCount ?? 0} | Ajoutées: ${entry.inserted ?? 0} | Mises à jour: ${entry.updated ?? 0} | Ignorées: ${entry.skipped?.unknown ?? 0}`;
};

const getIcalExportUrl = (feed: Pick<IcalExportFeed, "id" | "ical_export_token">) =>
  buildApiUrl(`/gites/${feed.id}/calendar.ics?token=${encodeURIComponent(feed.ical_export_token ?? "")}`);

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const uniqueNonEmpty = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];

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

const parseDeclarationSourcesInput = (value: string) => normalizeSourceList(value.split(/[\n,;]+/g));

const createSmsTextDraftId = () =>
  globalThis.crypto?.randomUUID?.() ?? `sms-text-${Math.random().toString(36).slice(2, 10)}`;

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
  const airbnb = url.match(/calendar\/ical\/(\d+)\.ics/i)?.[1] ?? url.match(/multicalendar\/(\d+)/i)?.[1] ?? null;
  if (airbnb) labels.push(`Airbnb #${airbnb}`);

  const abritel = url.match(/\/icalendar\/([a-z0-9]+)\.ics/i)?.[1] ?? null;
  if (abritel) labels.push(`Abritel #${abritel}`);

  const gdfCode = url.match(/\/(\d{2}G\d{3,})\//i)?.[1] ?? null;
  if (gdfCode) labels.push(`GDF ${gdfCode.toUpperCase()}`);

  const gdfCalendar = url.match(/ical_([a-z0-9]{8,})\.ics/i)?.[1] ?? null;
  if (gdfCalendar) labels.push(`Cal #${gdfCalendar.slice(0, 10)}...`);

  return uniqueNonEmpty(labels);
};

const getUnknownImportExamples = (item: IcalSourcesImportPreviewUnknown): IcalSourcesImportPreviewUnknownExample[] => {
  if (Array.isArray(item.examples) && item.examples.length > 0) return item.examples.slice(0, 4);
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

const formatImportLogUpdatedFields = (fields: Array<string | null | undefined> | undefined) => {
  const labels = uniqueNonEmpty((fields ?? []).map((field) => IMPORT_LOG_UPDATE_FIELD_LABELS[String(field ?? "").trim()] ?? null));
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

const importPreviewStatusLabelMap: Record<ImportPreviewItem["status"], string> = {
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
  const [deletingManagerId, setDeletingManagerId] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerNotice, setManagerNotice] = useState<string | null>(null);

  const [loadingSources, setLoadingSources] = useState(true);
  const [icalExports, setIcalExports] = useState<IcalExportFeed[]>([]);
  const [loadingIcalExports, setLoadingIcalExports] = useState(true);
  const [resettingIcalExportId, setResettingIcalExportId] = useState<string | null>(null);
  const [resettingIcalExportReservationsId, setResettingIcalExportReservationsId] = useState<string | null>(null);
  const [icalExportsError, setIcalExportsError] = useState<string | null>(null);
  const [icalExportsNotice, setIcalExportsNotice] = useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = useState<IcalSourceDraft>(DEFAULT_SOURCE_DRAFT);
  const [savingSourceId, setSavingSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [creatingSource, setCreatingSource] = useState(false);
  const [exportingSources, setExportingSources] = useState(false);
  const [importingSources, setImportingSources] = useState(false);
  const [analyzingSourcesImport, setAnalyzingSourcesImport] = useState(false);
  const [sourceImportFileName, setSourceImportFileName] = useState("");
  const [sourceImportRows, setSourceImportRows] = useState<unknown[] | null>(null);
  const [sourceImportMapping, setSourceImportMapping] = useState<Record<string, string>>({});
  const [sourceImportPreview, setSourceImportPreview] = useState<IcalSourcesImportPreviewResult | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const importSourcesInputRef = useRef<HTMLInputElement | null>(null);
  const [declarationNightsSettings, setDeclarationNightsSettings] = useState<DeclarationNightsSettings>(
    DEFAULT_DECLARATION_NIGHTS_SETTINGS
  );
  const [declarationExcludedSourcesDraft, setDeclarationExcludedSourcesDraft] = useState<string[]>(
    DEFAULT_DECLARATION_NIGHTS_SETTINGS.excluded_sources
  );
  const [loadingDeclarationNights, setLoadingDeclarationNights] = useState(true);
  const [savingDeclarationNights, setSavingDeclarationNights] = useState(false);
  const [declarationNightsError, setDeclarationNightsError] = useState<string | null>(null);
  const [declarationNightsNotice, setDeclarationNightsNotice] = useState<string | null>(null);
  const [sourceColorSettings, setSourceColorSettings] = useState<SourceColorSettings>(DEFAULT_SOURCE_COLOR_SETTINGS);
  const [sourceColorDraft, setSourceColorDraft] = useState<Record<string, string>>(DEFAULT_SOURCE_COLOR_SETTINGS.colors);
  const [loadingSourceColors, setLoadingSourceColors] = useState(true);
  const [savingSourceColors, setSavingSourceColors] = useState(false);
  const [sourceColorError, setSourceColorError] = useState<string | null>(null);
  const [sourceColorNotice, setSourceColorNotice] = useState<string | null>(null);
  const [newSourceColorLabel, setNewSourceColorLabel] = useState("");
  const [newSourceColorValue, setNewSourceColorValue] = useState("#D3D3D3");
  const [smsTextSettings, setSmsTextSettings] = useState<SmsTextSettings>(DEFAULT_SMS_TEXT_SETTINGS);
  const [smsTextDraft, setSmsTextDraft] = useState<SmsTextItem[]>(DEFAULT_SMS_TEXT_SETTINGS.texts);
  const [loadingSmsTexts, setLoadingSmsTexts] = useState(true);
  const [savingSmsTexts, setSavingSmsTexts] = useState(false);
  const [smsTextError, setSmsTextError] = useState<string | null>(null);
  const [smsTextNotice, setSmsTextNotice] = useState<string | null>(null);
  const [serverSecuritySettings, setServerSecuritySettings] = useState<ServerSecuritySettings>(
    DEFAULT_SERVER_SECURITY_SETTINGS
  );
  const [serverSecurityDurationDraft, setServerSecurityDurationDraft] = useState(
    DEFAULT_SERVER_SECURITY_SETTINGS.sessionDurationHours
  );
  const [serverSecurityCurrentPassword, setServerSecurityCurrentPassword] = useState("");
  const [serverSecurityNewPassword, setServerSecurityNewPassword] = useState("");
  const [serverSecurityConfirmPassword, setServerSecurityConfirmPassword] = useState("");
  const [loadingServerSecurity, setLoadingServerSecurity] = useState(true);
  const [savingServerSecurity, setSavingServerSecurity] = useState(false);
  const [serverSecurityError, setServerSecurityError] = useState<string | null>(null);
  const [serverSecurityNotice, setServerSecurityNotice] = useState<string | null>(null);

  const [icalPreview, setIcalPreview] = useState<IcalPreviewResult | null>(null);
  const [icalCronState, setIcalCronState] = useState<IcalCronState | null>(null);
  const [cronDraft, setCronDraft] = useState<IcalCronConfig>({
    enabled: true,
    auto_sync_on_app_load: false,
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
  const [pumpConfig, setPumpConfig] = useState<PumpAutomationConfig | null>(null);
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
      usernameInput: 'input[type="email"], input[type="text"][placeholder*="email"], input[name*="email"]',
      passwordInput: 'input[type="password"]',
      submitButton: 'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")',
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
  const [pumpCronState, setPumpCronState] = useState<PumpCronState | null>(null);
  const [pumpCronDraft, setPumpCronDraft] = useState<PumpCronConfig>({
    enabled: true,
    interval_days: 3,
    hour: 10,
    minute: 0,
    run_on_start: false,
  });
  const [pumpPreview, setPumpPreview] = useState<PumpPreviewResult | null>(null);
  const [pumpHealth, setPumpHealth] = useState<PumpHealthResult | null>(null);
  const [pumpSessionCapture, setPumpSessionCapture] = useState<PumpSessionCaptureResult | null>(null);
  const [pumpSelections, setPumpSelections] = useState<Record<string, boolean>>({});
  const [loadingPumpConfig, setLoadingPumpConfig] = useState(false);
  const [importingPumpConfig, setImportingPumpConfig] = useState(false);
  const [exportingPumpConfig, setExportingPumpConfig] = useState(false);
  const [importingPumpSession, setImportingPumpSession] = useState(false);
  const [exportingPumpSession, setExportingPumpSession] = useState(false);
  const [startingPumpSessionCapture, setStartingPumpSessionCapture] = useState(false);
  const [cancellingPumpSessionCapture, setCancellingPumpSessionCapture] = useState(false);
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

  const [importLog, setImportLog] = useState<ImportLogEntry[]>([]);
  const [importLogTotal, setImportLogTotal] = useState(0);
  const [importLogVisibleCount, setImportLogVisibleCount] = useState(IMPORT_LOG_VISIBLE_COUNT);
  const [loadingImportLog, setLoadingImportLog] = useState(false);
  const [importLogError, setImportLogError] = useState<string | null>(null);

  const linkedGitesCount = useMemo(
    () => gestionnaires.reduce((sum, item) => sum + Number(item.gites_count ?? 0), 0),
    [gestionnaires]
  );
  const selectedPumpCount = useMemo(
    () => Object.values(pumpSelections).filter(Boolean).length,
    [pumpSelections]
  );
  const pumpConfigReady = useMemo(
    () => Boolean(pumpConfigDraft.baseUrl.trim() && pumpConfigDraft.scrollSelector.trim()),
    [pumpConfigDraft.baseUrl, pumpConfigDraft.scrollSelector]
  );
  const sourceImportUnknownIds = useMemo(
    () => (sourceImportPreview?.unknown_gites ?? []).map((item) => item.source_gite_id),
    [sourceImportPreview]
  );
  const sourceImportUnresolvedCount = useMemo(
    () =>
      sourceImportUnknownIds.filter((sourceGiteId) => {
        const target = sourceImportMapping[sourceGiteId];
        return !target;
      }).length,
    [sourceImportMapping, sourceImportUnknownIds]
  );
  const availableDeclarationSources = useMemo(
    () =>
      normalizeSourceList([
        ...declarationNightsSettings.available_sources,
        ...declarationNightsSettings.excluded_sources,
        ...declarationExcludedSourcesDraft,
      ]),
    [declarationExcludedSourcesDraft, declarationNightsSettings]
  );
  const paymentColorMap = useMemo(() => buildPaymentColorMap(sourceColorDraft), [sourceColorDraft]);
  const availableSourceColorLabels = useMemo(
    () =>
      normalizeSourceList([
        ...Object.keys(DEFAULT_PAYMENT_SOURCE_COLORS),
        ...sourceColorSettings.available_sources,
        ...Object.keys(sourceColorSettings.colors ?? {}),
        ...Object.keys(sourceColorDraft),
      ]),
    [sourceColorDraft, sourceColorSettings]
  );
  const customizedSourceColorCount = useMemo(
    () =>
      Object.entries(sourceColorDraft).filter(([label, color]) => {
        const normalizedColor = normalizePaymentHexColor(color);
        const defaultColor = getPaymentColor(label, DEFAULT_PAYMENT_SOURCE_COLORS);
        return Boolean(normalizedColor) && normalizedColor !== defaultColor;
      }).length,
    [sourceColorDraft]
  );
  const smsTextCount = useMemo(() => smsTextDraft.filter((item) => item.title.trim() && item.text.trim()).length, [smsTextDraft]);
  const activeIcalSourcesCount = useMemo(
    () => sources.filter((source) => source.is_active).length,
    [sources]
  );
  const readyIcalExportsCount = useMemo(
    () => icalExports.filter((feed) => Boolean(feed.ical_export_token)).length,
    [icalExports]
  );
  const importHeroStats = useMemo(() => {
    const totalImports = importLogTotal > 0 ? importLogTotal : importLog.length;
    const latestImport = importLog[0] ?? null;
    const previousImport = importLog[1] ?? null;

    if (!latestImport) {
      return [
        {
          label: "Source",
          value: loadingImportLog ? "..." : "-",
          detail: importLogError ? "journal indisponible" : "aucun import récent",
          tone: "rose",
        },
        {
          label: "Date",
          value: loadingImportLog ? "..." : "-",
          detail: "dernier passage",
          tone: "blue",
        },
        {
          label: "Heure",
          value: loadingImportLog ? "..." : "-",
          detail: "dernier passage",
          tone: "amber",
        },
        {
          label: "Imports",
          value: String(totalImports),
          detail: importLogError ? "journal indisponible" : "historique vide",
          tone: "green",
        },
      ] as const;
    }

    const latestSource = formatImportLogTitle(latestImport);
    const latestDate = formatDateFr(latestImport.at);
    const latestTime = formatTimeFr(latestImport.at);
    const latestVolume =
      latestImport.status === "error"
        ? latestImport.errorMessage || "échec du dernier import"
        : `${latestImport.selectionCount ?? 0} sélectionnée(s)`;
    const latestChanges =
      latestImport.status === "error"
        ? "aucune donnée importée"
        : `${latestImport.inserted ?? 0} ajoutée(s) • ${latestImport.updated ?? 0} mise(s) à jour`;

    return [
      {
        label: "Source",
        value: latestSource,
        detail: previousImport ? `précédent ${formatImportLogTitle(previousImport)}` : "dernier import",
        tone: "rose",
      },
      {
        label: "Date",
        value: latestDate,
        detail: previousImport ? formatDateFr(previousImport.at) : "dernier passage",
        tone: "blue",
      },
      {
        label: "Heure",
        value: latestTime,
        detail: latestVolume,
        tone: "amber",
      },
      {
        label: "Imports",
        value: String(totalImports),
        detail: latestChanges,
        tone: "green",
      },
    ] as const;
  }, [importLog, importLogError, importLogTotal, loadingImportLog]);
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
      const resolvedGite = source.gite_id ? giteLookup.get(source.gite_id) : null;
      const giteId = source.gite?.id ?? resolvedGite?.id ?? source.gite_id ?? `unknown-${source.id}`;
      const existing = groups.get(giteId);

      if (existing) {
        existing.sources.push(source);
        return;
      }

      groups.set(giteId, {
        key: giteId,
        giteId,
        giteName: source.gite?.nom ?? resolvedGite?.nom ?? "Gîte inconnu",
        gitePrefix: source.gite?.prefixe_contrat ?? resolvedGite?.prefixe_contrat ?? null,
        giteOrder: source.gite?.ordre ?? resolvedGite?.ordre ?? Number.MAX_SAFE_INTEGER,
        sources: [source],
      });
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        activeCount: group.sources.filter((source) => source.is_active).length,
        sources: [...group.sources].sort((left, right) => left.ordre - right.ordre),
      }))
      .sort((left, right) => {
        if (left.giteOrder !== right.giteOrder) return left.giteOrder - right.giteOrder;
        return left.giteName.localeCompare(right.giteName, "fr", { sensitivity: "base" });
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
    const data = await apiFetch<DeclarationNightsSettings>("/settings/declaration-nights");
    applyDeclarationNightsSettings(data);
  };

  const applySourceColorSettings = (data: SourceColorSettings) => {
    const colors = Object.fromEntries(
      Object.entries(data.colors ?? {}).flatMap(([label, color]) => {
        const trimmedLabel = String(label ?? "").trim();
        const normalizedColor = normalizePaymentHexColor(color);
        if (!trimmedLabel || !normalizedColor) return [];
        return [[trimmedLabel, normalizedColor]];
      })
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

    const nextTexts = normalizedTexts.length > 0 ? normalizedTexts : DEFAULT_SMS_TEXT_SETTINGS.texts;
    setSmsTextSettings({ texts: nextTexts });
    setSmsTextDraft(nextTexts);
  };

  const applyServerSecuritySettings = (data: ServerSecuritySettings) => {
    const nextSettings: ServerSecuritySettings = {
      enabled: Boolean(data.enabled || data.passwordConfigured),
      passwordConfigured: Boolean(data.passwordConfigured),
      sessionDurationHours: Math.max(1, Number(data.sessionDurationHours) || DEFAULT_SERVER_SECURITY_SETTINGS.sessionDurationHours),
      sessionExpiresAt: data.sessionExpiresAt ?? null,
    };

    setServerSecuritySettings(nextSettings);
    setServerSecurityDurationDraft(nextSettings.sessionDurationHours);
  };

  const loadSmsTextSettings = async () => {
    const data = await apiFetch<SmsTextSettings>("/settings/sms-texts");
    applySmsTextSettings(data);
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
        `/settings/import-log?limit=${limit}`
      );
      setImportLog(Array.isArray(data.entries) ? data.entries : []);
      setImportLogTotal(Number.isFinite(data.total) ? data.total : 0);
      setImportLogVisibleCount((previous) => Math.max(IMPORT_LOG_VISIBLE_COUNT, previous));
    } catch (error: any) {
      setImportLogError(error.message ?? "Impossible de charger le journal des imports.");
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
      setPumpError(error.message ?? "Impossible de charger l'état de connexion Pump.");
    }
  };

  const loadPumpSessionCaptureStatus = async () => {
    try {
      const data = await apiFetch<PumpSessionCaptureResult>("/settings/pump/session/capture/status");
      setPumpSessionCapture(data);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de charger l'état de capture Pump.");
    }
  };

  const loadPumpConfig = async () => {
    setLoadingPumpConfig(true);
    setPumpError(null);
    try {
      const data = await apiFetch<PumpAutomationConfig>("/settings/pump/config");
      setPumpConfig(data);
      setPumpConfigDraft(data);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de charger la configuration Pump.");
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
    setLoadingServerSecurity(true);
    Promise.all([
      loadManagers(),
      loadSources(),
      loadDeclarationNightsSettings(),
      loadSourceColorSettings(),
      loadSmsTextSettings(),
      loadServerSecuritySettings(),
      loadCronState(),
      loadImportLog(),
      loadPumpConfig(),
      loadPumpStatus(),
      loadPumpHealth(),
      loadPumpSessionCaptureStatus(),
      loadPumpCronState(),
    ])
      .catch((error: any) => {
        const message = error?.message ?? "Impossible de charger les paramètres.";
        setManagerError(message);
        setSourceError(message);
        setIcalExportsError(message);
        setDeclarationNightsError(message);
        setSourceColorError(message);
        setSmsTextError(message);
        setServerSecurityError(message);
      })
      .finally(() => {
        setLoadingManagers(false);
        setLoadingSources(false);
        setLoadingIcalExports(false);
        setLoadingDeclarationNights(false);
        setLoadingSourceColors(false);
        setLoadingSmsTexts(false);
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
    if (!pumpSessionCapture || pumpSessionCapture.active) return;
    if (pumpSessionCapture.status === "saved") {
      void Promise.all([loadPumpHealth(), loadPumpStatus()]).catch(() => undefined);
    }
  }, [pumpSessionCapture]);

  const saveDeclarationNightsSettings = async () => {
    setSavingDeclarationNights(true);
    setDeclarationNightsError(null);
    setDeclarationNightsNotice(null);
    try {
      const response = await apiFetch<DeclarationNightsSettings>("/settings/declaration-nights", {
        method: "PUT",
        json: {
          excluded_sources: declarationExcludedSourcesDraft,
        },
      });
      applyDeclarationNightsSettings(response);
      setDeclarationNightsNotice("Sources d'exclusion enregistrées.");
    } catch (error: any) {
      setDeclarationNightsError(error.message ?? "Impossible d'enregistrer les sources exclues.");
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
        ([label, color]) => String(label ?? "").trim() && !normalizePaymentHexColor(color)
      );
      if (invalidEntry) {
        setSourceColorError(`Couleur invalide pour "${invalidEntry[0]}". Utilisez un format #RRGGBB.`);
        return;
      }

      const response = await apiFetch<SourceColorSettings>("/settings/source-colors", {
        method: "PUT",
        json: {
          colors: Object.fromEntries(
            Object.entries(sourceColorDraft).flatMap(([label, color]) => {
              const trimmedLabel = String(label ?? "").trim();
              const normalizedColor = normalizePaymentHexColor(color);
              if (!trimmedLabel || !normalizedColor) return [];
              return [[trimmedLabel, normalizedColor]];
            })
          ),
        },
      });
      applySourceColorSettings(response);
      setSourceColorNotice("Couleurs des sources enregistrées.");
    } catch (error: any) {
      setSourceColorError(error.message ?? "Impossible d'enregistrer les couleurs des sources.");
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
      available_sources: normalizeSourceList([...previous.available_sources, label]),
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

      const invalidItem = sanitizedTexts.find((item) => !item.title || !item.text);
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
      setSmsTextError(error.message ?? "Impossible d'enregistrer les textes SMS.");
    } finally {
      setSavingSmsTexts(false);
    }
  };

  const saveServerSecuritySettings = async () => {
    const nextDuration = Math.max(1, Math.min(24 * 90, Math.round(Number(serverSecurityDurationDraft) || 1)));
    const trimmedNewPassword = serverSecurityNewPassword.trim();
    const trimmedConfirmPassword = serverSecurityConfirmPassword.trim();

    setSavingServerSecurity(true);
    setServerSecurityError(null);
    setServerSecurityNotice(null);

    try {
      if (trimmedNewPassword || trimmedConfirmPassword) {
        if (trimmedNewPassword.length < 8) {
          setServerSecurityError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
          return;
        }
        if (trimmedNewPassword !== trimmedConfirmPassword) {
          setServerSecurityError("La confirmation du nouveau mot de passe ne correspond pas.");
          return;
        }
      }

      const response = await apiFetch<ServerSecuritySaveResult>("/settings/security", {
        method: "PUT",
        json: {
          currentPassword: serverSecurityCurrentPassword,
          newPassword: trimmedNewPassword || undefined,
          sessionDurationHours: nextDuration,
        },
      });
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
          : "Durée d'expiration enregistrée."
      );
    } catch (error: any) {
      setServerSecurityError(error.message ?? "Impossible d'enregistrer la sécurité serveur.");
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
    if (!sourceDraft.gite_id || !sourceDraft.url.trim() || !sourceDraft.type.trim()) {
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

  const updateSourceField = (sourceId: string, field: keyof IcalSource, value: string | boolean) => {
    setSources((previous) =>
      previous.map((item) =>
        item.id === sourceId
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
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
    if (!confirm(`Supprimer la source ${source.type} pour ${source.gite?.nom ?? "ce gîte"} ?`)) return;

    setDeletingSourceId(source.id);
    setSourceError(null);
    setSourceNotice(null);
    try {
      await apiFetch(`/settings/ical-sources/${source.id}`, { method: "DELETE" });
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
    if (!confirm(`Régénérer le token iCal de ${feed.nom} ? Les anciennes URL OTA cesseront de fonctionner.`)) return;

    setResettingIcalExportId(feed.id);
    setIcalExportsError(null);
    setIcalExportsNotice(null);
    try {
      await apiFetch(`/settings/ical-exports/${feed.id}/reset-token`, { method: "POST" });
      await loadSources();
      setIcalExportsNotice(`Token iCal régénéré pour ${feed.nom}.`);
    } catch (error: any) {
      setIcalExportsError(error.message ?? "Impossible de régénérer le token iCal.");
    } finally {
      setResettingIcalExportId(null);
    }
  };

  const resetIcalExportReservations = async (feed: IcalExportFeed) => {
    if (
      !confirm(
        `Reset OTA pour ${feed.nom} ? Toutes les réservations actuellement prévues pour cet iCal passeront à non exportées. Le macaron retombera à 0 jusqu'à la prochaine création de réservation.`
      )
    ) {
      return;
    }

    setResettingIcalExportReservationsId(feed.id);
    setIcalExportsError(null);
    setIcalExportsNotice(null);
    try {
      const result = await apiFetch<{ gite_id: string; gite_nom: string; reset_count: number }>(
        `/settings/ical-exports/${feed.id}/reset`,
        { method: "POST" }
      );
      await loadSources();
      setIcalExportsNotice(`${result.reset_count} réservation(s) retirée(s) de l'export OTA pour ${result.gite_nom}.`);
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
      const payload = await apiFetch<IcalSourcesExportPayload>("/settings/ical-sources/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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

  const handleIcalSourcesImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
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
        throw new Error("Format invalide: utilisez un JSON exporté depuis l'application.");
      }

      setSourceImportRows(sourcesPayload);
      setSourceImportMapping({});
      setSourceImportPreview(null);
      setSourceImportFileName(file.name);
      setSourceNotice(`Fichier chargé (${sourcesPayload.length} ligne(s)). Cliquez sur "Analyser".`);
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
      const preview = await apiFetch<IcalSourcesImportPreviewResult>("/settings/ical-sources/import/preview", {
        method: "POST",
        json: {
          sources: sourceImportRows,
          gite_mapping: sourceImportMapping,
        },
      });
      setSourceImportPreview(preview);
      if (preview.unresolved_count > 0) {
        setSourceNotice(`${preview.unresolved_count} gîte(s) introuvable(s): attribuez-les puis importez.`);
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
      const result = await apiFetch<IcalSourcesImportResult>("/settings/ical-sources/import", {
        method: "POST",
        json: {
          sources: sourceImportRows,
          gite_mapping: sourceImportMapping,
        },
      });
      await loadSources();
      setSourceImportRows(null);
      setSourceImportMapping({});
      setSourceImportPreview(null);
      setSourceImportFileName("");
      setSourceNotice(`Import terminé: ${result.created_count} créée(s), ${result.updated_count} mise(s) à jour.`);
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
      const response = await apiFetch<{ config: IcalCronConfig; state: IcalCronState }>("/settings/ical/cron", {
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
      const payload = await apiFetch<IcalCronExportPayload>("/settings/ical/cron/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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

  const importIcalCronConfigFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
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
        throw new Error("Format invalide: utilisez un JSON exporté depuis l'application.");
      }

      const response = await apiFetch<{ config: IcalCronConfig; state: IcalCronState }>("/settings/ical/cron/import", {
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
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
      setPumpError(error.message ?? "Impossible d'exporter la configuration Pump.");
    } finally {
      setExportingPumpConfig(false);
    }
  };

  const importPumpConfigFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
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
        parsed && typeof parsed === "object" && "config" in parsed && (parsed as { config?: unknown }).config
          ? (parsed as { config: unknown }).config
          : parsed;

      const response = await apiFetch<PumpConfigSaveResult>("/settings/pump/config/import", {
        method: "POST",
        json: {
          config: source,
        },
      });
      setPumpConfig(response.config);
      setPumpConfigDraft(response.config);
      setPumpNotice(`Configuration Pump importée depuis ${file.name}.`);
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setPumpError("Le fichier de configuration Pump n'est pas un JSON valide.");
      } else {
        setPumpError(error.message ?? "Impossible d'importer la configuration Pump.");
      }
    } finally {
      input.value = "";
      setImportingPumpConfig(false);
    }
  };

  const importPumpSessionFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingPumpSession(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const response = await apiFetch<PumpSessionImportResult>("/settings/pump/session/import", {
        method: "POST",
        json: {
          storageState: parsed,
          filename: file.name,
        },
      });
      const persistHint = pumpConfigDraft.persistSession ? "" : ' Activez "Session persistée" pour l’utiliser.';
      setPumpNotice(`Session persistée importée vers ${response.relativePath}.${persistHint}`);
      await loadPumpHealth();
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        setPumpError("Le fichier de session persistée n'est pas un JSON valide.");
      } else {
        setPumpError(error.message ?? "Impossible d'importer la session persistée.");
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
      const response = await apiFetch<PumpSessionExportResult>("/settings/pump/session/export");
      const blob = new Blob([JSON.stringify(response.storageState, null, 2)], { type: "application/json" });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = response.filename || `${response.storageStateId || "pump-session"}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(objectUrl);
      setPumpNotice(`Session persistée exportée depuis ${response.relativePath}.`);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'exporter la session persistée.");
    } finally {
      setExportingPumpSession(false);
    }
  };

  const startPumpSessionCapture = async () => {
    setStartingPumpSessionCapture(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionCaptureResult>("/settings/pump/session/capture/start", {
        method: "POST",
      });
      setPumpSessionCapture(response);
      setPumpNotice("Navigateur de capture Pump lancé. Connectez-vous dans la fenêtre ouverte.");
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de lancer la capture interactive Pump.");
    } finally {
      setStartingPumpSessionCapture(false);
    }
  };

  const cancelPumpSessionCapture = async () => {
    setCancellingPumpSessionCapture(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<PumpSessionCaptureResult>("/settings/pump/session/capture/cancel", {
        method: "POST",
      });
      setPumpSessionCapture(response);
      setPumpNotice("Demande d'annulation envoyée à la capture Pump.");
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'annuler la capture interactive Pump.");
    } finally {
      setCancellingPumpSessionCapture(false);
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
      const deletedLabel = typeof result.deleted_count === "number" ? `, ${result.deleted_count} suppression(s)` : "";
      setIcalNotice(
        `Synchronisation terminée: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour${deletedLabel}, ${result.skipped_count} ignorée(s).${toVerifyLabel}`
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
      const result = await apiFetch<{ sessionId: string; status: string; message?: string }>("/settings/pump/refresh", {
        method: "POST",
      });
      await Promise.all([loadPumpStatus(), loadPumpHealth()]);
      setPumpNotice(result.message ?? `Refresh Pump lancé (${result.sessionId}).`);
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
      const response = await apiFetch<PumpConfigSaveResult>("/settings/pump/config", {
        method: "PUT",
        json: pumpConfigDraft,
      });
      setPumpConfig(response.config);
      setPumpConfigDraft(response.config);
      await loadPumpHealth();
      setPumpNotice("Configuration Pump enregistrée.");
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'enregistrer la configuration Pump.");
    } finally {
      setSavingPumpConfig(false);
    }
  };

  const testPumpConnection = async () => {
    setTestingPumpConnection(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const result = await apiFetch<PumpConnectionTestResult>("/settings/pump/config/test-connection", {
        method: "POST",
        json: pumpConfigDraft,
      });
      const method = result.result?.method ? ` (${result.result.method})` : "";
      setPumpNotice(`Connexion Pump validée${method}.`);
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
      const result = await apiFetch<PumpScrollTargetTestResult>("/settings/pump/config/test-scroll-target", {
        method: "POST",
        json: pumpConfigDraft,
      });
      const selector = result.result?.selector ? ` ${result.result.selector}` : "";
      setPumpNotice(`Zone de scroll Pump validée${selector}.`);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de tester la zone de scroll Pump.");
    } finally {
      setTestingPumpScrollTarget(false);
    }
  };

  const savePumpCronConfig = async () => {
    setSavingPumpCron(true);
    setPumpError(null);
    setPumpNotice(null);
    try {
      const response = await apiFetch<{ config: PumpCronConfig; state: PumpCronState }>("/settings/pump/cron", {
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
      const result = await apiFetch<PumpPreviewResult>("/settings/pump/preview", {
        method: "POST",
      });
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
      setPumpError(error.message ?? "Impossible d'analyser la dernière extraction Pump.");
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
        `Import Pump terminé: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour, ${result.skipped_count} ignorée(s).`
      );
      dispatchRecentImportedReservationsCreated(result.created_count);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'importer les réservations Pump.");
    } finally {
      setImportingPump(false);
    }
  };

  return (
    <div className="settings-page">
      <section className="card settings-hero">
        <div className="settings-hero__main">
          <div className="settings-hero__eyebrow">Tableau de bord</div>
          <h1 className="settings-hero__title">Paramètres</h1>
          <p className="settings-hero__text">
            Une vue plus claire pour piloter l'équipe, la diffusion iCal et les imports externes depuis un seul espace.
          </p>
        </div>
        <div className="settings-hero__stats">
          {importHeroStats.map((item) => (
            <div key={item.label} className={`settings-kpi settings-kpi--${item.tone}`}>
              <span className="settings-kpi__label">{item.label}</span>
              <strong
                className={[
                  "settings-kpi__value",
                  item.value.length > 10 ? "settings-kpi__value--compact" : "",
                  item.value.length > 14 ? "settings-kpi__value--dense" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {item.value}
              </strong>
              <span className="settings-kpi__detail">{item.detail}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="settings-security" className="settings-cluster">
        <div className="settings-cluster__header">
          <div>
            <div className="settings-cluster__eyebrow">Sécurité</div>
            <h2 className="settings-cluster__title">Accès serveur</h2>
          </div>
          <p className="settings-cluster__text">
            Le mot de passe administrateur est hashé côté serveur et la session est portée par un cookie HTTP-only.
          </p>
        </div>
        <div className="settings-cluster__grid">
          <div className="card settings-card settings-card--sand settings-card--span-12">
            <div className="settings-card__topline">
              <span className="settings-card__tag">Session</span>
              <span className="settings-card__badge">
                {serverSecuritySettings.enabled ? "Protection active" : "Protection inactive"}
              </span>
            </div>
            <div className="section-title">Mot de passe et expiration</div>
            <div className="field-hint">
              {serverSecuritySettings.passwordConfigured
                ? `Session courante valable jusqu'au ${formatIsoDateTimeFr(serverSecuritySettings.sessionExpiresAt)}.`
                : "Aucun mot de passe serveur n'est encore enregistré. Définissez-en un pour activer la protection."}
            </div>
            {loadingServerSecurity ? (
              <div className="field-hint" style={{ marginTop: 12 }}>Chargement...</div>
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
                        setServerSecurityDurationDraft(Math.max(1, Math.min(24 * 90, Number(event.target.value || 1))));
                      }}
                      disabled={savingServerSecurity}
                    />
                  </label>
                  <div className="field-hint" style={{ alignSelf: "end" }}>
                    La durée s'applique aux nouvelles connexions et renouvelle la session courante après enregistrement.
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
                          setServerSecurityCurrentPassword(event.target.value);
                        }}
                        placeholder="Requis uniquement si vous changez le mot de passe"
                        disabled={savingServerSecurity}
                      />
                    </label>
                  ) : (
                    <div className="field-hint" style={{ alignSelf: "end" }}>
                      Le premier mot de passe active la protection immédiatement pour ce navigateur.
                    </div>
                  )}
                  <label className="field">
                    {serverSecuritySettings.passwordConfigured ? "Nouveau mot de passe" : "Mot de passe initial"}
                    <input
                      type="password"
                      value={serverSecurityNewPassword}
                      onChange={(event) => {
                        setServerSecurityError(null);
                        setServerSecurityNotice(null);
                        setServerSecurityNewPassword(event.target.value);
                      }}
                      placeholder={serverSecuritySettings.passwordConfigured ? "Laisser vide pour conserver l'actuel" : "Minimum 8 caractères"}
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
                        setServerSecurityConfirmPassword(event.target.value);
                      }}
                      placeholder="Confirmer le nouveau mot de passe"
                      disabled={savingServerSecurity}
                    />
                  </label>
                </div>
                <div className="actions" style={{ marginTop: 16 }}>
                  <button type="button" onClick={() => void saveServerSecuritySettings()} disabled={savingServerSecurity}>
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
                {serverSecurityNotice ? <div className="note note--success">{serverSecurityNotice}</div> : null}
                {serverSecurityError ? <div className="note">{serverSecurityError}</div> : null}
              </>
            )}
          </div>
        </div>
      </section>

      <section id="settings-exploitation" className="settings-cluster">
        <div className="settings-cluster__header">
          <div>
            <div className="settings-cluster__eyebrow">Exploitation</div>
            <h2 className="settings-cluster__title">Pilotage quotidien</h2>
          </div>
          <p className="settings-cluster__text">
            Réglez ce qui alimente les totaux mensuels et gardez une trace des imports réellement appliqués.
          </p>
        </div>
        <div className="settings-cluster__grid">
          <div className="card settings-card settings-card--neutral settings-card--span-8">
            <div className="settings-managers-header">
              <div>
                <div className="settings-card__tag">Traçabilité</div>
                <div className="section-title">Journal des imports</div>
              </div>
              <button type="button" className="secondary" onClick={() => void loadImportLog()} disabled={loadingImportLog}>
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
                      <div className="field-group__label">{formatImportLogTitle(entry)}</div>
                      <div className="field-hint">{formatIsoDateTimeFr(entry.at)}</div>
                    </div>
                    <div className="field-hint">{formatImportLogSummary(entry)}</div>
                    {Array.isArray(entry.insertedItems) && entry.insertedItems.length > 0 ? (
                      <div style={{ marginTop: 8 }}>
                        <div className="field-hint" style={{ marginBottom: 4 }}>Nouvelles réservations</div>
                        <div style={{ display: "grid", gap: 4 }}>
                          {entry.insertedItems.slice(0, IMPORT_LOG_EVENT_VISIBLE_COUNT).map((item, index) => (
                            <div
                              key={`${entry.id}-inserted-${index}`}
                              className="field-hint"
                              style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                            >
                              <span style={{ color: "#111827", fontWeight: 600 }}>{item.giteName || item.giteId || "-"}</span>
                              <span>
                                {item.checkIn ? formatIsoDateFr(item.checkIn) : "-"} - {item.checkOut ? formatIsoDateFr(item.checkOut) : "-"}
                              </span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "999px",
                                    background: getPaymentColor(item.source, paymentColorMap),
                                    border: "1px solid rgba(17, 24, 39, 0.2)",
                                  }}
                                />
                                <span>{item.source || "-"}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {Array.isArray(entry.updatedItems) && entry.updatedItems.length > 0 ? (
                      <div style={{ marginTop: 8 }}>
                        <div className="field-hint" style={{ marginBottom: 4 }}>Mises à jour</div>
                        <div style={{ display: "grid", gap: 4 }}>
                          {entry.updatedItems.slice(0, IMPORT_LOG_EVENT_VISIBLE_COUNT).map((item, index) => {
                            const updatedFields = formatImportLogUpdatedFields(item.updatedFields);
                            return (
                              <div
                                key={`${entry.id}-updated-${index}`}
                                className="field-hint"
                                style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                              >
                                <span style={{ color: "#111827", fontWeight: 600 }}>{item.giteName || item.giteId || "-"}</span>
                                <span>
                                  {item.checkIn ? formatIsoDateFr(item.checkIn) : "-"} - {item.checkOut ? formatIsoDateFr(item.checkOut) : "-"}
                                </span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: "999px",
                                      background: getPaymentColor(item.source, paymentColorMap),
                                      border: "1px solid rgba(17, 24, 39, 0.2)",
                                    }}
                                  />
                                  <span>{item.source || "-"}</span>
                                </span>
                                {updatedFields ? <span>Modifié: {updatedFields}</span> : null}
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
                      setImportLogVisibleCount((previous) => Math.min(importLog.length, previous + IMPORT_LOG_VISIBLE_STEP));
                    }}
                  >
                    Afficher plus ({importLog.length - importLogVisibleCount} restante{importLog.length - importLogVisibleCount > 1 ? "s" : ""})
                  </button>
                ) : null}
              </div>
            )}
          </div>

          <div className="card settings-card settings-card--blue settings-card--span-4">
            <div className="settings-card__topline">
              <span className="settings-card__tag">SMS</span>
              <span className="settings-card__badge">{smsTextCount} texte(s)</span>
            </div>
            <div className="section-title">Textes optionnels</div>
            <div className="field-hint">
              Ces textes alimentent les switches du bloc SMS dans la prise de réservation mobile.
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              {smsTextSettings.texts.length} texte(s) actuellement enregistrés.
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Variables disponibles: {"{nom}"}, {"{gite}"}, {"{adresse}"}, {"{dateDebut}"}, {"{dateFin}"}, {"{nbNuits}"},{" "}
              {"{heureArrivee}"}, {"{heureDepart}"}
            </div>
            {loadingSmsTexts ? (
              <div className="field-hint" style={{ marginTop: 12 }}>
                Chargement...
              </div>
            ) : (
              <>
                <div className="settings-sms-texts" style={{ marginTop: 16 }}>
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
                            setSmsTextDraft((previous) => previous.filter((entry) => entry.id !== item.id));
                          }}
                          disabled={savingSmsTexts || smsTextDraft.length <= 1}
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
                                entry.id === item.id ? { ...entry, title: event.target.value } : entry
                              )
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
                                entry.id === item.id ? { ...entry, text: event.target.value } : entry
                              )
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
                  <button type="button" onClick={() => void saveSmsTextSettings()} disabled={savingSmsTexts}>
                    {savingSmsTexts ? "Enregistrement..." : "Enregistrer"}
                  </button>
                </div>
                {smsTextNotice ? <div className="note note--success">{smsTextNotice}</div> : null}
                {smsTextError ? <div className="note">{smsTextError}</div> : null}
              </>
            )}
          </div>

          <details className="card settings-card settings-card--rose settings-card--span-4 settings-card-accordion">
            <summary className="settings-card-accordion__summary">
              <div className="settings-card__topline">
                <span className="settings-card__tag">Totaux mensuels</span>
                <div className="settings-card-accordion__meta">
                  <span className="settings-card__badge">{declarationExcludedSourcesDraft.length} exclue(s)</span>
                  <span className="settings-accordion__icon" aria-hidden="true" />
                </div>
              </div>
              <div className="section-title">Nuitées à déclarer</div>
              <div className="field-hint">
                Les sources listées ici sont retirées du macaron "Nuitées à déclarer" dans les totaux mensuels.
              </div>
            </summary>
            <div className="settings-card-accordion__content">
              {loadingDeclarationNights ? (
                <div className="field-hint">Chargement...</div>
              ) : (
                <>
                  {availableDeclarationSources.length > 0 ? (
                    <div className="field-group">
                      <div className="field-group__header">
                        <div className="field-group__label">Sources détectées</div>
                        <div className="field-hint">Cochez les sources à exclure du total à déclarer.</div>
                      </div>
                      <div className="checkbox-grid">
                        {availableDeclarationSources.map((source) => {
                          const checked = declarationExcludedSourcesDraft.some(
                            (item) => normalizeTextKey(item) === normalizeTextKey(source)
                          );

                          return (
                            <label key={source} className="checkbox-inline">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setDeclarationNightsNotice(null);
                                  setDeclarationNightsError(null);
                                  setDeclarationExcludedSourcesDraft((previous) =>
                                    event.target.checked
                                      ? normalizeSourceList([...previous, source])
                                      : previous.filter((item) => normalizeTextKey(item) !== normalizeTextKey(source))
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
                        setDeclarationExcludedSourcesDraft(parseDeclarationSourcesInput(event.target.value));
                      }}
                      placeholder={"Airbnb\nHomeExchange"}
                      disabled={savingDeclarationNights}
                    />
                  </label>
                  <div className="field-hint">Une source par ligne. Les variantes accent/casse sont reconnues.</div>
                  <div className="actions">
                    <button type="button" onClick={() => void saveDeclarationNightsSettings()} disabled={savingDeclarationNights}>
                      {savingDeclarationNights ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                  {declarationNightsNotice ? <div className="note note--success">{declarationNightsNotice}</div> : null}
                  {declarationNightsError ? <div className="note">{declarationNightsError}</div> : null}
                </>
              )}
            </div>
          </details>

          <details className="card settings-card settings-card--sand settings-card--span-8 settings-card-accordion">
            <summary className="settings-card-accordion__summary">
              <div className="settings-card__topline">
                <span className="settings-card__tag">Palette</span>
                <div className="settings-card-accordion__meta">
                  <span className="settings-card__badge">{customizedSourceColorCount} personnalisée(s)</span>
                  <span className="settings-accordion__icon" aria-hidden="true" />
                </div>
              </div>
              <div className="section-title">Couleurs des sources</div>
              <div className="field-hint">
                Personnalisez les couleurs utilisées dans le calendrier et la répartition des paiements.
              </div>
            </summary>
            <div className="settings-card-accordion__content">
              {loadingSourceColors ? (
                <div className="field-hint">Chargement...</div>
              ) : (
                <>
                  <div className="settings-source-colors">
                    {availableSourceColorLabels.map((source) => {
                      const color = sourceColorDraft[source] ?? getPaymentColor(source, DEFAULT_PAYMENT_SOURCE_COLORS);
                      const hasDefaultColor = Object.keys(DEFAULT_PAYMENT_SOURCE_COLORS).some(
                        (label) => normalizeTextKey(label) === normalizeTextKey(source)
                      );
                      return (
                        <div key={source} className="settings-source-color-row">
                          <div className="settings-source-color-row__label">
                            <span className="settings-source-color-row__swatch" style={{ backgroundColor: color }} />
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
                                  [source]: getPaymentColor(source, DEFAULT_PAYMENT_SOURCE_COLORS),
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
                      <div className="field-group__label">Ajouter une source</div>
                      <div className="field-hint">Ajoutez un libellé si une source n'apparaît pas encore.</div>
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
                        onChange={(event) => setNewSourceColorValue(event.target.value.toUpperCase())}
                        disabled={savingSourceColors}
                      />
                      <button type="button" className="secondary" onClick={addSourceColorLabel} disabled={savingSourceColors}>
                        Ajouter
                      </button>
                    </div>
                  </div>

                  <div className="actions">
                    <button type="button" onClick={() => void saveSourceColorSettings()} disabled={savingSourceColors}>
                      {savingSourceColors ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                  {sourceColorNotice ? <div className="note note--success">{sourceColorNotice}</div> : null}
                  {sourceColorError ? <div className="note">{sourceColorError}</div> : null}
                </>
              )}
            </div>
          </details>
        </div>
      </section>

      <section className="settings-overview">
        <a href="#settings-security" className="settings-overview-card settings-overview-card--sand">
          <span className="settings-overview-card__kicker">Sécurité</span>
          <strong className="settings-overview-card__title">Accès serveur</strong>
          <span className="settings-overview-card__meta">
            {serverSecuritySettings.enabled
              ? `Protection active, expiration ${serverSecuritySettings.sessionDurationHours}h.`
              : "Aucun mot de passe serveur configuré pour le moment."}
          </span>
        </a>
        <a href="#settings-exploitation" className="settings-overview-card settings-overview-card--rose">
          <span className="settings-overview-card__kicker">Exploitation</span>
          <strong className="settings-overview-card__title">Nuitées et journal</strong>
          <span className="settings-overview-card__meta">
            {declarationExcludedSourcesDraft.length} source(s) exclue(s), {importLogTotal} entrée(s) d'import.
          </span>
        </a>
        <a href="#settings-team" className="settings-overview-card settings-overview-card--sand">
          <span className="settings-overview-card__kicker">Équipe</span>
          <strong className="settings-overview-card__title">Gestionnaires</strong>
          <span className="settings-overview-card__meta">
            {gestionnaires.length} profil(s), {linkedGitesCount} affectation(s) actives.
          </span>
        </a>
        <a href="#settings-ical" className="settings-overview-card settings-overview-card--blue">
          <span className="settings-overview-card__kicker">Distribution</span>
          <strong className="settings-overview-card__title">Écosystème iCal</strong>
          <span className="settings-overview-card__meta">
            {sources.length > 0
              ? `${activeIcalSourcesCount}/${sources.length} sources actives, ${readyIcalExportsCount} export(s) prêts.`
              : `Aucune source configurée, ${readyIcalExportsCount} export(s) prêt(s).`}
          </span>
        </a>
        <a href="#settings-imports" className="settings-overview-card settings-overview-card--green">
          <span className="settings-overview-card__kicker">Imports</span>
          <strong className="settings-overview-card__title">Pump</strong>
          <span className="settings-overview-card__meta">
            Pump {pumpCronState?.config.enabled ? "actif" : "en pause"}, extraction {pumpPreview ? "analysée" : "à lancer"}.
          </span>
        </a>
      </section>

      <details id="settings-team" className="settings-cluster settings-cluster-accordion">
        <summary className="settings-cluster-accordion__summary">
          <div className="settings-cluster-accordion__summary-main">
            <div>
              <div className="settings-cluster__eyebrow">Équipe</div>
              <h2 className="settings-cluster__title">Gestionnaires et répartition</h2>
            </div>
            <p className="settings-cluster__text">
              Ajoutez rapidement des gestionnaires et gardez une lecture claire de leur couverture sur les gîtes.
            </p>
          </div>
          <span className="settings-accordion__icon" aria-hidden="true" />
        </summary>
        <div className="settings-cluster__grid settings-cluster-accordion__content">
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
              <button type="button" onClick={() => void createManager()} disabled={savingManager}>
                {savingManager ? "Ajout..." : "Ajouter"}
              </button>
            </div>
            {managerNotice && <div className="note note--success">{managerNotice}</div>}
            {managerError && <div className="note">{managerError}</div>}
          </div>

          <div className="card settings-card settings-card--neutral settings-card--span-8">
            <div className="settings-managers-header">
              <div>
                <div className="settings-card__tag">Vue d'ensemble</div>
                <div className="section-title">Gestionnaires</div>
              </div>
              <div className="field-hint">
                {gestionnaires.length} gestionnaire(s), {linkedGitesCount} gîte(s) associé(s)
              </div>
            </div>
            {loadingManagers ? (
              <div className="field-hint">Chargement...</div>
            ) : gestionnaires.length === 0 ? (
              <div className="field-hint">Aucun gestionnaire enregistré.</div>
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
                        <span className="badge">{manager.gites_count ?? 0}</span>
                      </td>
                      <td className="table-actions-cell">
                        <button
                          type="button"
                          className="table-action table-action--danger"
                          onClick={() => void removeManager(manager)}
                          disabled={deletingManagerId === manager.id}
                        >
                          {deletingManagerId === manager.id ? "Suppression..." : "Supprimer"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </details>

      <details id="settings-ical" className="settings-cluster settings-cluster-accordion">
        <summary className="settings-cluster-accordion__summary">
          <div className="settings-cluster-accordion__summary-main">
            <div>
              <div className="settings-cluster__eyebrow">Distribution</div>
              <h2 className="settings-cluster__title">Écosystème iCal</h2>
            </div>
            <p className="settings-cluster__text">
              Centralisez vos sources entrantes, vos exports OTA et les automatismes de synchronisation.
            </p>
          </div>
          <span className="settings-accordion__icon" aria-hidden="true" />
        </summary>
        <div className="settings-cluster__grid settings-cluster-accordion__content">
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
                  onChange={(event) => setSourceDraft((previous) => ({ ...previous, gite_id: event.target.value }))}
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
                  onChange={(event) => setSourceDraft((previous) => ({ ...previous, type: event.target.value }))}
                  placeholder="Airbnb"
                  disabled={creatingSource}
                />
              </label>
              <label className="field">
                URL iCal
                <input
                  value={sourceDraft.url}
                  onChange={(event) => setSourceDraft((previous) => ({ ...previous, url: event.target.value }))}
                  placeholder="https://.../calendar/ical/..."
                  disabled={creatingSource}
                />
              </label>
              <label className="field">
                Inclure si résumé contient
                <input
                  value={sourceDraft.include_summary}
                  onChange={(event) => setSourceDraft((previous) => ({ ...previous, include_summary: event.target.value }))}
                  placeholder="Reserved, BOOKED"
                  disabled={creatingSource}
                />
              </label>
              <label className="field">
                Exclure si résumé contient
                <input
                  value={sourceDraft.exclude_summary}
                  onChange={(event) => setSourceDraft((previous) => ({ ...previous, exclude_summary: event.target.value }))}
                  placeholder="Blocked"
                  disabled={creatingSource}
                />
              </label>
              <label className="field">
                Active
                <div className="switch-group settings-switch-row">
                  <span>{sourceDraft.is_active ? "Active" : "Inactive"}</span>
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
              <button type="button" onClick={() => void createSource()} disabled={creatingSource || loadingSources}>
                {creatingSource ? "Ajout..." : "Ajouter la source"}
              </button>
            </div>
            {sourceNotice && <div className="note note--success">{sourceNotice}</div>}
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
                  disabled={exportingSources || importingSources || loadingSources}
                >
                  {exportingSources ? "Export..." : "Exporter"}
                </button>
                <button
                  type="button"
                  className="table-action table-action--neutral gites-tool-button"
                  onClick={triggerSourceImport}
                  disabled={analyzingSourcesImport || importingSources || exportingSources || loadingSources}
                >
                  {analyzingSourcesImport ? "Lecture..." : "Charger fichier"}
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
                  <div className="field-hint">{sourceImportFileName || "Fichier JSON"}</div>
                </div>
                <div className="field-hint">
                  Lignes: {sourceImportRows.length}
                  {sourceImportPreview ? ` | Prêtes: ${sourceImportPreview.ready_count}/${sourceImportPreview.total_count}` : ""}
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
                    Mapping invalide: {sourceImportPreview.mapping_errors.map((item) => item.message).join(" ; ")}
                  </div>
                ) : null}
                {sourceImportPreview && sourceImportPreview.unknown_gites.length > 0 ? (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <div className="field-hint">
                      Gîtes introuvables: {sourceImportPreview.unknown_gites.length}. Attribuez un gîte local.
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
                            (item.sample_types && item.sample_types.length > 0 ? item.sample_types : [item.sample_type]) as Array<
                              string | null | undefined
                            >
                          );
                          const hosts = uniqueNonEmpty(
                            (item.sample_hosts && item.sample_hosts.length > 0
                              ? item.sample_hosts
                              : examples.map((example) => extractUrlHost(example.url))) as Array<string | null | undefined>
                          );
                          const identifiers = uniqueNonEmpty(
                            examples.flatMap((example) => extractIcalUrlIdentifiers(example.url))
                          );
                          const importLabel = item.sample_gite_nom
                            ? `${item.sample_gite_nom}${item.sample_gite_prefixe ? ` (${item.sample_gite_prefixe})` : ""}`
                            : null;

                          return (
                            <tr key={item.source_gite_id}>
                              <td>
                                <div style={{ display: "grid", gap: 2 }}>
                                  <div>{importLabel || item.source_gite_id}</div>
                                  {importLabel ? <div className="field-hint">ID: {item.source_gite_id}</div> : null}
                                </div>
                              </td>
                              <td>{item.count}</td>
                              <td>
                                <div style={{ display: "grid", gap: 4 }}>
                                  {types.length > 0 ? <div>Type: {types.join(", ")}</div> : null}
                                  {hosts.length > 0 ? <div>Domaine: {hosts.join(", ")}</div> : null}
                                  {identifiers.length > 0 ? <div>Identifiant: {identifiers.join(" | ")}</div> : null}
                                  {item.sample_source_id ? <div className="field-hint">Source: {item.sample_source_id}</div> : null}
                                  {examples.length > 0 ? (
                                    <div className="field-hint" style={{ display: "grid", gap: 2 }}>
                                      {examples.map((example, index) => (
                                        <div key={`${item.source_gite_id}-example-${index}`}>
                                          {(example.type || "-") + " | " + truncateMiddle(example.url || "-")}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <select
                                  value={sourceImportMapping[item.source_gite_id] ?? item.mapped_to ?? ""}
                                  onChange={(event) =>
                                    setSourceImportMapping((previous) => ({
                                      ...previous,
                                      [item.source_gite_id]: event.target.value,
                                    }))
                                  }
                                  disabled={analyzingSourcesImport || importingSources}
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
                      <div className="field-hint">{sourceImportUnresolvedCount} attribution(s) manquante(s).</div>
                    ) : (
                      <div className="field-hint">Toutes les attributions sont renseignées.</div>
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
                <div className="field-hint">Aucune source iCal configurée.</div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {groupedIcalSources.map((group) => (
                    <div key={group.key} className="settings-source-group">
                      <div className="settings-source-group__header">
                        <div>
                          <div className="settings-source-group__eyebrow">{group.gitePrefix || "Gîte"}</div>
                          <div className="settings-source-group__title">{group.giteName}</div>
                          <div className="settings-source-group__meta">
                            {group.sources.length} source(s) | {group.activeCount} active(s)
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
                              <div className="field-group__label">{source.type || "Source iCal"}</div>
                              <div className="field-hint">Source #{source.ordre + 1}</div>
                            </div>
                            <div className="grid-2">
                              <label className="field">
                                Gîte
                                <select
                                  value={source.gite_id}
                                  onChange={(event) => updateSourceField(source.id, "gite_id", event.target.value)}
                                  disabled={savingSourceId === source.id || deletingSourceId === source.id}
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
                                  onChange={(event) => updateSourceField(source.id, "type", event.target.value)}
                                  disabled={savingSourceId === source.id || deletingSourceId === source.id}
                                />
                              </label>
                              <label className="field">
                                URL iCal
                                <input
                                  value={source.url}
                                  onChange={(event) => updateSourceField(source.id, "url", event.target.value)}
                                  disabled={savingSourceId === source.id || deletingSourceId === source.id}
                                />
                              </label>
                              <label className="field">
                                Inclure résumé
                                <input
                                  value={source.include_summary ?? ""}
                                  onChange={(event) => updateSourceField(source.id, "include_summary", event.target.value)}
                                  placeholder="Reserved, BOOKED"
                                  disabled={savingSourceId === source.id || deletingSourceId === source.id}
                                />
                              </label>
                              <label className="field">
                                Exclure résumé
                                <input
                                  value={source.exclude_summary ?? ""}
                                  onChange={(event) => updateSourceField(source.id, "exclude_summary", event.target.value)}
                                  placeholder="Blocked"
                                  disabled={savingSourceId === source.id || deletingSourceId === source.id}
                                />
                              </label>
                              <label className="field">
                                Active
                                <div className="switch-group settings-switch-row">
                                  <span>{source.is_active ? "Active" : "Inactive"}</span>
                                  <label className="switch switch--pink">
                                    <input
                                      type="checkbox"
                                      checked={source.is_active}
                                      onChange={(event) =>
                                        updateSourceField(source.id, "is_active", event.target.checked)
                                      }
                                      disabled={savingSourceId === source.id || deletingSourceId === source.id}
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
                                disabled={savingSourceId === source.id || deletingSourceId === source.id}
                              >
                                {savingSourceId === source.id ? "Enregistrement..." : "Enregistrer"}
                              </button>
                              <button
                                type="button"
                                className="table-action table-action--danger"
                                onClick={() => void removeSource(source)}
                                disabled={savingSourceId === source.id || deletingSourceId === source.id}
                              >
                                {deletingSourceId === source.id ? "Suppression..." : "Supprimer"}
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

          <div className="card settings-card settings-card--blue settings-card--span-5">
            <div className="settings-card__topline">
              <span className="settings-card__tag">Publication OTA</span>
              <span className="settings-card__badge">{readyIcalExportsCount} prêt(s)</span>
            </div>
            <div className="section-title">Exports iCal OTA</div>
            <div className="field-hint">
              Publie les réservations locales et celles insérées par <code>what-today</code>. Les réservations importées depuis iCal, Pump ou CSV ne sont pas réémises.
            </div>
            {icalExportsNotice && <div className="note note--success">{icalExportsNotice}</div>}
            {icalExportsError && <div className="note">{icalExportsError}</div>}
            {loadingIcalExports ? (
              <div className="field-hint" style={{ marginTop: 10 }}>Chargement...</div>
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
                          {feed.reservations_count} réservation(s) | {feed.exported_reservations_count} exportée(s)
                        </div>
                      </div>
                    </div>
                    <label className="field">
                      URL iCal publique
                      <input value={feed.ical_export_token ? getIcalExportUrl(feed) : ""} readOnly />
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
                        onClick={() => void resetIcalExportReservations(feed)}
                        disabled={
                          feed.exported_reservations_count === 0 ||
                          resettingIcalExportId === feed.id ||
                          resettingIcalExportReservationsId === feed.id
                        }
                      >
                        {resettingIcalExportReservationsId === feed.id ? "Reset..." : "Reset OTA"}
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--danger"
                        onClick={() => void resetIcalExportToken(feed)}
                        disabled={
                          resettingIcalExportId === feed.id || resettingIcalExportReservationsId === feed.id
                        }
                      >
                        {resettingIcalExportId === feed.id ? "Régénération..." : "Régénérer le token"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card settings-card settings-card--blue settings-card--span-7">
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
                  disabled={exportingCron || importingCron || savingCron || syncingIcal || loadingIcalPreview}
                >
                  {exportingCron ? "Export..." : "Exporter paramètres"}
                </button>
                <button
                  type="button"
                  className="table-action table-action--neutral gites-tool-button"
                  onClick={triggerCronImport}
                  disabled={importingCron || exportingCron || savingCron || syncingIcal || loadingIcalPreview}
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
              Déclenchement iCal par URL externe Alwaysdata. Statut cron: {icalCronState?.config.enabled ? "activé" : "désactivé"}.
              {" "}Import auto au chargement: {icalCronState?.config.auto_sync_on_app_load ? "activé" : "désactivé"}.
              {" "}Dernière tentative: {formatIsoDateTimeFr(icalCronState?.last_run_at ?? null)}.
            </div>
            {icalCronState?.last_success_at ? (
              <div className="field-hint" style={{ marginTop: 6 }}>
                Dernier succès: {formatIsoDateTimeFr(icalCronState.last_success_at)}
              </div>
            ) : null}
            {icalCronState?.last_error ? (
              <div className="note" style={{ marginTop: 8 }}>
                Dernière erreur cron: {icalCronState.last_error}
              </div>
            ) : null}
            <div className="field-hint" style={{ marginTop: 8 }}>
              Déclenchement externe possible via URL HTTP Alwaysdata sur <code>/api/settings/ical/cron/run?token=...</code>.
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
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => void saveCronConfig()} disabled={savingCron || syncingIcal || loadingIcalPreview}>
                {savingCron ? "Enregistrement..." : "Enregistrer le cron"}
              </button>
              <button type="button" className="secondary" onClick={() => void runIcalPreview()} disabled={loadingIcalPreview || syncingIcal}>
                {loadingIcalPreview ? "Lecture iCal..." : "Prévisualiser iCal"}
              </button>
              <button type="button" onClick={() => void runIcalSync()} disabled={syncingIcal || loadingIcalPreview}>
                {syncingIcal ? "Synchronisation..." : "Synchroniser maintenant"}
              </button>
            </div>
            {icalNotice && <div className="note note--success">{icalNotice}</div>}
            {icalError && <div className="note">{icalError}</div>}
            {icalPreview && (
              <div style={{ marginTop: 14 }}>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  Sources lues: {icalPreview.fetched_sources} | Événements: {icalPreview.parsed_events} | Nouveaux: {icalPreview.counts.new} | Complétables: {icalPreview.counts.existing_updatable} | Conflits: {icalPreview.counts.conflict}
                </div>
                {icalPreview.errors.length > 0 ? (
                  <div className="note" style={{ marginBottom: 10 }}>
                    {icalPreview.errors.length} source(s) en erreur: {icalPreview.errors.map((error) => `${error.gite_nom} (${error.message})`).join(" ; ")}
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
                          {formatIsoDateFr(item.date_entree)} - {formatIsoDateFr(item.date_sortie)}
                        </td>
                        <td>{item.source_type}</td>
                        <td>{item.final_source}</td>
                        <td>
                          {statusLabelMap[item.status]}
                          {item.update_fields.length > 0 ? ` (${item.update_fields.join(", ")})` : ""}
                        </td>
                        <td>{item.summary || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {icalPreview.reservations.length > 80 ? (
                  <div className="field-hint">Affichage limité aux 80 premières lignes.</div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </details>

      <details id="settings-imports" className="settings-cluster settings-cluster-accordion">
        <summary className="settings-cluster-accordion__summary">
          <div className="settings-cluster-accordion__summary-main">
            <div>
              <div className="settings-cluster__eyebrow">Imports externes</div>
              <h2 className="settings-cluster__title">Pump</h2>
            </div>
            <p className="settings-cluster__text">
              Déclenchement, contrôle de session et import des réservations Pump depuis un seul espace.
            </p>
          </div>
          <span className="settings-accordion__icon" aria-hidden="true" />
        </summary>
        <div className="settings-cluster__grid settings-cluster-accordion__content">
          <div className="card settings-card settings-card--green settings-card--span-8">
            <div className="settings-card__topline">
              <span className="settings-card__tag">Import automatisé</span>
              <span className="settings-card__badge">{pumpConfigReady ? "Configuré" : "À configurer"}</span>
            </div>
            <div className="section-title">Import Pump</div>
            <div className="field-hint">
              Déclenche un refresh dans l'automatisation Pump locale, attend une extraction exploitable, puis crée ou complète les réservations. Le cron utilise le même enchaînement.
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Configuration: {pumpConfigDraft.baseUrl ? pumpConfigDraft.baseUrl : "URL absente"}{pumpConfigDraft.username ? ` | Compte: ${pumpConfigDraft.username}` : ""}{pumpConfigDraft.scrollSelector ? ` | Scroll: ${pumpConfigDraft.scrollSelector}` : ""}
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
                disabled={exportingPumpConfig || importingPumpConfig || savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
              >
                {exportingPumpConfig ? "Export config..." : "Exporter config Pump"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={triggerPumpConfigImport}
                disabled={importingPumpConfig || exportingPumpConfig || savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
              >
                {importingPumpConfig ? "Import config..." : "Importer config Pump"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={triggerPumpSessionImport}
                disabled={importingPumpSession || savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
              >
                {importingPumpSession ? "Import session..." : "Importer session persistée"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void exportPumpSession()}
                disabled={exportingPumpSession || importingPumpSession || savingPumpConfig}
              >
                {exportingPumpSession ? "Export..." : "Exporter session persistée"}
              </button>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Import JSON compatible avec l'ancien Pump: configuration <code>last.json</code> et storage state Playwright.
            </div>
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
                {startingPumpSessionCapture ? "Ouverture..." : "Ouvrir le navigateur de capture"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void cancelPumpSessionCapture()}
                disabled={!pumpSessionCapture?.active || cancellingPumpSessionCapture}
              >
                {cancellingPumpSessionCapture ? "Annulation..." : "Annuler la capture"}
              </button>
            </div>
            {pumpSessionCapture ? (
              <div className="pump-health-card pump-health-card--neutral" style={{ marginTop: 12 }}>
                <div className="pump-health-card__headline">
                  <span className="pump-health-dot pump-health-dot--neutral" aria-hidden="true" />
                  <strong>
                    Capture interactive: {pumpSessionCapture.active ? "en cours" : pumpSessionCapture.status}
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
                    Session sauvegardée: {pumpSessionCapture.storageStateRelativePath}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      authMode: event.target.value as PumpAutomationConfig["authMode"],
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                >
                  <option value="persisted-only">Session persistée uniquement</option>
                  <option value="legacy-auto-login">Legacy auto-login</option>
                </select>
              </label>
              <label className="field">
                Stratégie de login
                <select
                  value={pumpConfigDraft.loginStrategy}
                  onChange={(event) =>
                    setPumpConfigDraft((previous) => ({
                      ...previous,
                      loginStrategy: event.target.value as PumpAutomationConfig["loginStrategy"],
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      waitBeforeScroll: Math.min(120000, Math.max(0, Number(event.target.value || 0))),
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      scrollCount: Math.min(500, Math.max(1, Number(event.target.value || 1))),
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      scrollDistance: Math.min(20000, Math.max(1, Number(event.target.value || 1))),
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      scrollDelay: Math.min(120000, Math.max(0, Number(event.target.value || 0))),
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                      manualScrollDuration: Math.min(600000, Math.max(0, Number(event.target.value || 0))),
                    }))
                  }
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget || !pumpConfigDraft.manualScrollMode}
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
                  disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  placeholder="/chemin/vers/un/dossier"
                />
              </label>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Le mode recommandé est <code>persisted-only</code>: le serveur réutilise une session Playwright existante et n'essaie plus de reconstruire la connexion via les boutons Airbnb.
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Le mot de passe n'est utilisé que pour le mode legacy. En phase 1, privilégiez l'import/export de session persistée.
            </div>
            <details className="settings-sources-accordion" style={{ marginTop: 12 }}>
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
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
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
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton email-first
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.emailFirstButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          emailFirstButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton après username
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.continueAfterUsernameButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          continueAfterUsernameButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton final
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.finalSubmitButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          finalSubmitButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton compte persistant
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.accountChooserContinueButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          accountChooserContinueButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Carte source calendrier
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.calendarSourceCard}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          calendarSourceCard: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton modifier source
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.calendarSourceEditButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          calendarSourceEditButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton actualiser source
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.calendarSourceRefreshButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          calendarSourceRefreshButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Champ URL source
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.calendarSourceUrlField}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          calendarSourceUrlField: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
                <label className="field">
                  Bouton fermer source
                  <textarea
                    rows={2}
                    value={pumpConfigDraft.advancedSelectors.calendarSourceCloseButton}
                    onChange={(event) =>
                      setPumpConfigDraft((previous) => ({
                        ...previous,
                        advancedSelectors: {
                          ...previous.advancedSelectors,
                          calendarSourceCloseButton: event.target.value,
                        },
                      }))
                    }
                    disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
                  />
                </label>
              </div>
            </details>
            <div className="actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => void savePumpConfig()}
                disabled={savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}
              >
                {savingPumpConfig ? "Enregistrement..." : "Enregistrer la configuration"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void testPumpConnection()}
                disabled={testingPumpConnection || savingPumpConfig || !pumpConfigReady}
              >
                {testingPumpConnection ? "Test..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void testPumpScrollTarget()}
                disabled={testingPumpScrollTarget || savingPumpConfig || !pumpConfigReady}
              >
                {testingPumpScrollTarget ? "Test..." : "Tester la zone de scroll"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void loadPumpConfig()}
                disabled={loadingPumpConfig || savingPumpConfig || importingPumpConfig || importingPumpSession}
              >
                {loadingPumpConfig ? "Chargement..." : "Recharger la configuration"}
              </button>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Cron: {pumpCronState?.config.enabled ? "activé" : "désactivé"} ({pumpCronState?.scheduler === "external" ? "déclenchement externe" : "mémoire serveur"}). Prochain import: {formatIsoDateTimeFr(pumpCronState?.next_run_at ?? null)}. Dernier import: {formatIsoDateTimeFr(pumpCronState?.last_run_at ?? null)}.
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
                      interval_days: Math.min(30, Math.max(1, Number(event.target.value || 1))),
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
                      hour: Math.min(23, Math.max(0, Number(event.target.value || 0))),
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
                      minute: Math.min(59, Math.max(0, Number(event.target.value || 0))),
                    }))
                  }
                  disabled={savingPumpCron}
                />
              </label>
            </div>
            {pumpCronState?.running ? (
              <div className="field-hint" style={{ marginTop: 8 }}>Import Pump automatique en cours.</div>
            ) : null}
            {pumpCronState?.last_error ? <div className="note" style={{ marginTop: 8 }}>{pumpCronState.last_error}</div> : null}
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => void savePumpCronConfig()} disabled={savingPumpCron || refreshingPump || analyzingPump || importingPump || savingPumpConfig || testingPumpConnection || testingPumpScrollTarget}>
                {savingPumpCron ? "Enregistrement..." : "Enregistrer le cron"}
              </button>
              <button type="button" className="secondary" onClick={() => void refreshPump()} disabled={refreshingPump || analyzingPump || importingPump || savingPumpCron || savingPumpConfig || testingPumpConnection || testingPumpScrollTarget || !pumpConfigReady}>
                {refreshingPump ? "Refresh..." : "Lancer refresh Pump"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void Promise.all([loadPumpConfig(), loadPumpStatus(), loadPumpHealth(), loadPumpCronState()]).catch((error: any) =>
                    setPumpError(error.message ?? "Impossible de rafraîchir les informations Pump.")
                  )
                }
                disabled={loadingPumpStatus || loadingPumpConfig || refreshingPump || importingPumpConfig || importingPumpSession}
              >
                {loadingPumpStatus ? "Statut..." : "Rafraîchir le statut"}
              </button>
              <button type="button" className="secondary" onClick={() => void analyzePump()} disabled={analyzingPump || importingPump || savingPumpCron || savingPumpConfig || !pumpConfigReady}>
                {analyzingPump ? "Analyse..." : "Analyser la dernière extraction"}
              </button>
              <button type="button" onClick={() => void importPump()} disabled={importingPump || !pumpPreview || selectedPumpCount === 0 || analyzingPump || savingPumpCron || savingPumpConfig}>
                {importingPump ? "Import..." : `Importer (${selectedPumpCount})`}
              </button>
            </div>
            {pumpStatus ? (
              <div className="field-hint" style={{ marginTop: 8 }}>
                Statut: <strong>{pumpStatus.status}</strong>
                {pumpStatus.sessionId ? ` | Session: ${pumpStatus.sessionId}` : ""}
                {typeof pumpStatus.reservationCount === "number" ? ` | Réservations: ${pumpStatus.reservationCount}` : ""}
                {pumpStatus.updatedAt ? ` | Mis à jour: ${formatIsoDateTimeFr(pumpStatus.updatedAt)}` : ""}
              </div>
            ) : null}
            {pumpHealth ? (
              <div className={`pump-health-card pump-health-card--${pumpHealth.tone}`} style={{ marginTop: 12 }}>
                <div className="pump-health-card__headline">
                  <span className={`pump-health-dot pump-health-dot--${pumpHealth.tone}`} aria-hidden="true" />
                  <strong>{pumpHealth.label}</strong>
                </div>
                <div className="field-hint" style={{ marginTop: 6 }}>
                  {pumpHealth.summary}
                  {pumpHealth.storageStateId ? ` | Session: ${pumpHealth.storageStateId}` : ""}
                  {pumpHealth.sessionFileUpdatedAt ? ` | Fichier: ${formatIsoDateTimeFr(pumpHealth.sessionFileUpdatedAt)}` : ""}
                </div>
                <div className="field-hint" style={{ marginTop: 6 }}>
                  Dernier refresh OK: {formatIsoDateTimeFr(pumpHealth.lastSuccessfulRefreshAt)} | Scheduler: {pumpHealth.cronScheduler === "external" ? "externe" : "interne"} | Fenêtre stale: {pumpHealth.staleAfterHours}h
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
            {pumpNotice && <div className="note note--success">{pumpNotice}</div>}
            {pumpError && <div className="note">{pumpError}</div>}

            {pumpPreview && (
              <div style={{ marginTop: 14 }}>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  Source Pump: {pumpPreview.pump?.status ?? "-"}
                  {pumpPreview.pump?.session_id ? ` | Session: ${pumpPreview.pump.session_id}` : ""}
                  {pumpPreview.pump?.updated_at ? ` | Mis à jour: ${formatIsoDateTimeFr(pumpPreview.pump.updated_at)}` : ""}
                </div>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  Total: {pumpPreview.reservations.length} | Nouveaux: {pumpPreview.counts.new} | Complétables: {pumpPreview.counts.existing_updatable} | Déjà présents: {pumpPreview.counts.existing} | Conflits: {pumpPreview.counts.conflict} | Listing non mappé: {pumpPreview.counts.unmapped_listing}
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
                      const selectable = isImportablePreviewStatus(item.status);
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
                            {formatIsoDateFr(item.check_in)} - {formatIsoDateFr(item.check_out)}
                          </td>
                          <td>{item.hote_nom ?? "-"}</td>
                          <td>{typeof item.prix_total === "number" ? `${item.prix_total.toFixed(2)} €` : "-"}</td>
                          <td>{item.source_type}</td>
                          <td>
                            {importPreviewStatusLabelMap[item.status]}
                            {item.update_fields.length > 0 ? ` (${item.update_fields.join(", ")})` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pumpPreview.reservations.length > 120 ? (
                  <div className="field-hint">Affichage limité aux 120 premières lignes.</div>
                ) : null}
              </div>
            )}
          </div>

        </div>
      </details>
    </div>
  );
};

export default SettingsPage;
