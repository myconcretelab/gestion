import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { apiFetch } from "../utils/api";
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
  skipped_count: number;
  to_verify_marked_count?: number;
  to_verify_cleared_count?: number;
  per_gite?: Record<string, { inserted: number; updated: number; skipped: number }>;
  inserted_items?: Array<{ giteName: string; giteId: string; checkIn: string; checkOut: string; source: string }>;
};

type IcalCronState = {
  config: {
    enabled: boolean;
    hour: number;
    minute: number;
    run_on_start: boolean;
  };
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: IcalSyncResult | null;
};

type IcalCronConfig = IcalCronState["config"];

type ImportLogEntry = {
  id: string;
  at: string;
  source: string;
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
  }>;
};

type HarPreviewItem = {
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

type HarPreviewResult = {
  reservations: HarPreviewItem[];
  counts: {
    new: number;
    existing: number;
    existing_updatable: number;
    conflict: number;
    unmapped_listing: number;
  };
};

type HarImportResult = HarPreviewResult & {
  selected_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
};

type PumpStatusResult = {
  sessionId: string | null;
  status: string;
  updatedAt?: string | null;
  reservationCount?: number;
  errors?: Array<{ message?: string | null }>;
};

type PumpPreviewResult = HarPreviewResult & {
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
  running: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: PumpImportResult | null;
  last_error: string | null;
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

type DeclarationNightsSettings = {
  excluded_sources: string[];
  available_sources: string[];
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

const formatIsoDateFr = (value: string) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR");
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
  if (normalized === "har") return "HAR";
  if (normalized === "pump") return "Pump";
  if (normalized === "pump-cron") return "Pump cron";
  return source || "Import";
};

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

const SOURCE_COLOR_BY_KEY: Record<string, string> = {
  [normalizeTextKey("Airbnb")]: "#E11D48",
  [normalizeTextKey("Abritel")]: "#0EA5E9",
  [normalizeTextKey("Gites de France")]: "#16A34A",
  [normalizeTextKey("HomeExchange")]: "#7C3AED",
  [normalizeTextKey("Virement")]: "#1D4ED8",
  [normalizeTextKey("Chèque")]: "#B45309",
  [normalizeTextKey("Espèces")]: "#CA8A04",
  [normalizeTextKey("A définir")]: "#6B7280",
};

const sourceColor = (source: string | null | undefined) =>
  SOURCE_COLOR_BY_KEY[normalizeTextKey(String(source ?? ""))] ?? "#6B7280";

const isHarImportableStatus = (status: HarPreviewItem["status"]) => status === "new" || status === "existing_updatable";

const statusLabelMap: Record<IcalPreviewItem["status"], string> = {
  new: "Nouveau",
  existing: "Déjà présent",
  existing_updatable: "Complétable",
  conflict: "Conflit",
};

const harStatusLabelMap: Record<HarPreviewItem["status"], string> = {
  new: "Nouveau",
  existing: "Déjà présent",
  existing_updatable: "Complétable",
  conflict: "Conflit",
  unmapped_listing: "Listing non mappé",
};

const SettingsPage = () => {
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

  const [icalPreview, setIcalPreview] = useState<IcalPreviewResult | null>(null);
  const [icalCronState, setIcalCronState] = useState<IcalCronState | null>(null);
  const [cronDraft, setCronDraft] = useState<IcalCronConfig>({
    enabled: true,
    hour: 3,
    minute: 15,
    run_on_start: false,
  });
  const [savingCron, setSavingCron] = useState(false);
  const [loadingIcalPreview, setLoadingIcalPreview] = useState(false);
  const [syncingIcal, setSyncingIcal] = useState(false);
  const [exportingCron, setExportingCron] = useState(false);
  const [importingCron, setImportingCron] = useState(false);
  const [icalError, setIcalError] = useState<string | null>(null);
  const [icalNotice, setIcalNotice] = useState<string | null>(null);
  const importCronInputRef = useRef<HTMLInputElement | null>(null);

  const [harPayload, setHarPayload] = useState<unknown | null>(null);
  const [harFileName, setHarFileName] = useState<string>("");
  const [harPreview, setHarPreview] = useState<HarPreviewResult | null>(null);
  const [harSelections, setHarSelections] = useState<Record<string, boolean>>({});
  const [analyzingHar, setAnalyzingHar] = useState(false);
  const [importingHar, setImportingHar] = useState(false);
  const [harError, setHarError] = useState<string | null>(null);
  const [harNotice, setHarNotice] = useState<string | null>(null);

  const [pumpStatus, setPumpStatus] = useState<PumpStatusResult | null>(null);
  const [pumpCronState, setPumpCronState] = useState<PumpCronState | null>(null);
  const [pumpCronDraft, setPumpCronDraft] = useState<PumpCronConfig>({
    enabled: true,
    interval_days: 3,
    hour: 10,
    minute: 0,
    run_on_start: false,
  });
  const [pumpPreview, setPumpPreview] = useState<PumpPreviewResult | null>(null);
  const [pumpSelections, setPumpSelections] = useState<Record<string, boolean>>({});
  const [loadingPumpStatus, setLoadingPumpStatus] = useState(false);
  const [savingPumpCron, setSavingPumpCron] = useState(false);
  const [refreshingPump, setRefreshingPump] = useState(false);
  const [analyzingPump, setAnalyzingPump] = useState(false);
  const [importingPump, setImportingPump] = useState(false);
  const [pumpError, setPumpError] = useState<string | null>(null);
  const [pumpNotice, setPumpNotice] = useState<string | null>(null);

  const [importLog, setImportLog] = useState<ImportLogEntry[]>([]);
  const [loadingImportLog, setLoadingImportLog] = useState(false);
  const [importLogError, setImportLogError] = useState<string | null>(null);

  const linkedGitesCount = useMemo(
    () => gestionnaires.reduce((sum, item) => sum + Number(item.gites_count ?? 0), 0),
    [gestionnaires]
  );

  const selectedHarCount = useMemo(
    () => Object.values(harSelections).filter(Boolean).length,
    [harSelections]
  );
  const selectedPumpCount = useMemo(
    () => Object.values(pumpSelections).filter(Boolean).length,
    [pumpSelections]
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

  const loadManagers = async () => {
    const data = await apiFetch<Gestionnaire[]>("/managers");
    setGestionnaires(data);
  };

  const loadSources = async () => {
    const [gitesData, sourcesData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<IcalSource[]>("/settings/ical-sources"),
    ]);
    setGites(gitesData);
    setSources(sourcesData);
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

  const loadCronState = async () => {
    const data = await apiFetch<IcalCronState>("/settings/ical/cron");
    setIcalCronState(data);
    setCronDraft(data.config);
  };

  const loadImportLog = async (limit = 10) => {
    setLoadingImportLog(true);
    setImportLogError(null);
    try {
      const data = await apiFetch<{ entries: ImportLogEntry[]; total: number }>(
        `/settings/import-log?limit=${limit}`
      );
      setImportLog(Array.isArray(data.entries) ? data.entries : []);
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

  const loadPumpCronState = async () => {
    const data = await apiFetch<PumpCronState>("/settings/pump/cron");
    setPumpCronState(data);
    setPumpCronDraft(data.config);
  };

  useEffect(() => {
    setLoadingManagers(true);
    setLoadingSources(true);
    setLoadingDeclarationNights(true);
    Promise.all([
      loadManagers(),
      loadSources(),
      loadDeclarationNightsSettings(),
      loadCronState(),
      loadImportLog(),
      loadPumpStatus(),
      loadPumpCronState(),
    ])
      .catch((error: any) => {
        const message = error?.message ?? "Impossible de charger les paramètres.";
        setManagerError(message);
        setSourceError(message);
        setDeclarationNightsError(message);
      })
      .finally(() => {
        setLoadingManagers(false);
        setLoadingSources(false);
        setLoadingDeclarationNights(false);
      });
  }, []);

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
      setIcalNotice(
        `Synchronisation terminée: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour, ${result.skipped_count} ignorée(s).${toVerifyLabel}`
      );
    } catch (error: any) {
      setIcalError(error.message);
    } finally {
      setSyncingIcal(false);
    }
  };

  const handleHarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setHarError(null);
    setHarNotice(null);
    setHarPreview(null);
    setHarSelections({});

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setHarPayload(parsed);
      setHarFileName(file.name);
    } catch {
      setHarPayload(null);
      setHarFileName("");
      setHarError("Le fichier HAR est invalide (JSON non lisible).");
    }
  };

  const analyzeHar = async () => {
    if (!harPayload) {
      setHarError("Chargez d'abord un fichier HAR.");
      return;
    }

    setAnalyzingHar(true);
    setHarError(null);
    setHarNotice(null);
    try {
      const result = await apiFetch<HarPreviewResult>("/settings/har/preview", {
        method: "POST",
        json: { har: harPayload },
      });
      setHarPreview(result);
      const defaults: Record<string, boolean> = {};
      result.reservations.forEach((item) => {
        if (isHarImportableStatus(item.status)) {
          defaults[item.id] = true;
        }
      });
      setHarSelections(defaults);
    } catch (error: any) {
      setHarError(error.message);
    } finally {
      setAnalyzingHar(false);
    }
  };

  const importHar = async () => {
    if (!harPayload || !harPreview) return;

    const selectedIds = Object.entries(harSelections)
      .filter(([, checked]) => checked)
      .map(([id]) => id);

    if (selectedIds.length === 0) {
      setHarError("Aucune réservation HAR sélectionnée.");
      return;
    }

    setImportingHar(true);
    setHarError(null);
    setHarNotice(null);
    try {
      const result = await apiFetch<HarImportResult>("/settings/har/import", {
        method: "POST",
        json: {
          har: harPayload,
          selected_ids: selectedIds,
        },
      });
      setHarPreview(result);
      await loadImportLog();
      setHarNotice(
        `Import HAR terminé: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour, ${result.skipped_count} ignorée(s).`
      );
    } catch (error: any) {
      setHarError(error.message);
    } finally {
      setImportingHar(false);
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
      await loadPumpStatus();
      setPumpNotice(result.message ?? `Refresh Pump lancé (${result.sessionId}).`);
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible de lancer le refresh Pump.");
    } finally {
      setRefreshingPump(false);
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
        if (isHarImportableStatus(item.status)) {
          defaults[item.id] = true;
        }
      });
      setPumpSelections(defaults);
      await loadPumpStatus();
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
      await loadPumpStatus();
      setPumpNotice(
        `Import Pump terminé: ${result.created_count} création(s), ${result.updated_count} mise(s) à jour, ${result.skipped_count} ignorée(s).`
      );
    } catch (error: any) {
      setPumpError(error.message ?? "Impossible d'importer les réservations Pump.");
    } finally {
      setImportingPump(false);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="section-title">Paramètres</div>
        <div className="field-hint">Gestion des gestionnaires, des sources iCal et de l'import HAR.</div>
      </div>

      <div className="card">
        <div className="section-title">Nuitées à déclarer</div>
        <div className="field-hint">
          Les sources listées ici sont retirées du macaron "Nuitées à déclarer" dans les totaux mensuels.
        </div>
        {loadingDeclarationNights ? (
          <div className="field-hint" style={{ marginTop: 12 }}>
            Chargement...
          </div>
        ) : (
          <>
            {availableDeclarationSources.length > 0 ? (
              <div className="field-group" style={{ marginTop: 16 }}>
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

            <label className="field" style={{ marginTop: 16 }}>
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
            <div className="actions" style={{ marginTop: 16 }}>
              <button type="button" onClick={() => void saveDeclarationNightsSettings()} disabled={savingDeclarationNights}>
                {savingDeclarationNights ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
            {declarationNightsNotice ? <div className="note note--success">{declarationNightsNotice}</div> : null}
            {declarationNightsError ? <div className="note">{declarationNightsError}</div> : null}
          </>
        )}
      </div>

      <div className="card">
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

      <div className="card">
        <div className="settings-managers-header">
          <div className="section-title">Gestionnaires</div>
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

      <div className="card">
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
            <select
              value={sourceDraft.is_active ? "1" : "0"}
              onChange={(event) =>
                setSourceDraft((previous) => ({
                  ...previous,
                  is_active: event.target.value === "1",
                }))
              }
              disabled={creatingSource}
            >
              <option value="1">Oui</option>
              <option value="0">Non</option>
            </select>
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

      <div className="card">
        <div className="settings-managers-header">
          <div className="section-title">Sources iCal</div>
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
              {sources.map((source) => (
                <div key={source.id} className="field-group">
                  <div className="field-group__header">
                    <div className="field-group__label">{source.gite?.nom ?? "Gîte inconnu"}</div>
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
                      <select
                        value={source.is_active ? "1" : "0"}
                        onChange={(event) => updateSourceField(source.id, "is_active", event.target.value === "1")}
                        disabled={savingSourceId === source.id || deletingSourceId === source.id}
                      >
                        <option value="1">Oui</option>
                        <option value="0">Non</option>
                      </select>
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
          )}
        </details>
      </div>

      <div className="card">
        <div className="settings-managers-header">
          <div className="section-title">Synchronisation iCal</div>
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
          Cron: {icalCronState?.config.enabled ? "activé" : "désactivé"}.
          {" "}
          Prochain passage: {formatIsoDateTimeFr(icalCronState?.next_run_at ?? null)}.
          {" "}
          Dernier passage: {formatIsoDateTimeFr(icalCronState?.last_run_at ?? null)}.
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <label className="field">
            Cron actif
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
            Synchroniser au démarrage
            <select
              value={cronDraft.run_on_start ? "1" : "0"}
              onChange={(event) =>
                setCronDraft((previous) => ({
                  ...previous,
                  run_on_start: event.target.value === "1",
                }))
              }
              disabled={savingCron}
            >
              <option value="0">Non</option>
              <option value="1">Oui</option>
            </select>
          </label>
          <label className="field">
            Heure
            <input
              type="number"
              min={0}
              max={23}
              value={cronDraft.hour}
              onChange={(event) =>
                setCronDraft((previous) => ({
                  ...previous,
                  hour: Math.min(23, Math.max(0, Number(event.target.value || 0))),
                }))
              }
              disabled={savingCron}
            />
          </label>
          <label className="field">
            Minute
            <input
              type="number"
              min={0}
              max={59}
              value={cronDraft.minute}
              onChange={(event) =>
                setCronDraft((previous) => ({
                  ...previous,
                  minute: Math.min(59, Math.max(0, Number(event.target.value || 0))),
                }))
              }
              disabled={savingCron}
            />
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

      <div className="card">
        <div className="section-title">Import Pump</div>
        <div className="field-hint">
          Déclenche un refresh dans le repo <code>pump</code>, attend une extraction exploitable, puis crée ou complète les réservations. Le cron utilise le même enchaînement.
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          Cron: {pumpCronState?.config.enabled ? "activé" : "désactivé"}.
          {" "}
          Prochain import: {formatIsoDateTimeFr(pumpCronState?.next_run_at ?? null)}.
          {" "}
          Dernier import: {formatIsoDateTimeFr(pumpCronState?.last_run_at ?? null)}.
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
          <button type="button" className="secondary" onClick={() => void savePumpCronConfig()} disabled={savingPumpCron || refreshingPump || analyzingPump || importingPump}>
            {savingPumpCron ? "Enregistrement..." : "Enregistrer le cron"}
          </button>
          <button type="button" className="secondary" onClick={() => void refreshPump()} disabled={refreshingPump || analyzingPump || importingPump || savingPumpCron}>
            {refreshingPump ? "Refresh..." : "Lancer refresh Pump"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void Promise.all([loadPumpStatus(), loadPumpCronState()]).catch((error: any) =>
                setPumpError(error.message ?? "Impossible de rafraîchir les informations Pump.")
              )
            }
            disabled={loadingPumpStatus || refreshingPump}
          >
            {loadingPumpStatus ? "Statut..." : "Rafraîchir le statut"}
          </button>
          <button type="button" className="secondary" onClick={() => void analyzePump()} disabled={analyzingPump || importingPump || savingPumpCron}>
            {analyzingPump ? "Analyse..." : "Analyser la dernière extraction"}
          </button>
          <button type="button" onClick={() => void importPump()} disabled={importingPump || !pumpPreview || selectedPumpCount === 0 || analyzingPump || savingPumpCron}>
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
                  const selectable = isHarImportableStatus(item.status);
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
                        {harStatusLabelMap[item.status]}
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

      <div className="card">
        <div className="section-title">Analyse HAR</div>
        <div className="field-hint">
          Analyse d'un fichier HAR Airbnb pour créer ou compléter des réservations (nom, source, prix, commentaire).
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <label className="table-action table-action--neutral" style={{ cursor: "pointer" }}>
            Charger un HAR
            <input
              type="file"
              accept=".har,application/json"
              onChange={(event) => void handleHarFile(event)}
              style={{ display: "none" }}
            />
          </label>
          <button type="button" className="secondary" onClick={() => void analyzeHar()} disabled={analyzingHar || !harPayload || importingHar}>
            {analyzingHar ? "Analyse..." : "Analyser"}
          </button>
          <button type="button" onClick={() => void importHar()} disabled={importingHar || !harPreview || selectedHarCount === 0 || analyzingHar}>
            {importingHar ? "Import..." : `Importer (${selectedHarCount})`}
          </button>
        </div>
        {harFileName ? <div className="field-hint" style={{ marginTop: 8 }}>Fichier: {harFileName}</div> : null}
        {harNotice && <div className="note note--success">{harNotice}</div>}
        {harError && <div className="note">{harError}</div>}

        {harPreview && (
          <div style={{ marginTop: 14 }}>
            <div className="field-hint" style={{ marginBottom: 8 }}>
              Total: {harPreview.reservations.length} | Nouveaux: {harPreview.counts.new} | Complétables: {harPreview.counts.existing_updatable} | Déjà présents: {harPreview.counts.existing} | Conflits: {harPreview.counts.conflict} | Listing non mappé: {harPreview.counts.unmapped_listing}
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
                {harPreview.reservations.slice(0, 120).map((item) => {
                  const selectable = isHarImportableStatus(item.status);
                  return (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(harSelections[item.id])}
                          disabled={!selectable || importingHar}
                          onChange={(event) =>
                            setHarSelections((previous) => ({
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
                        {harStatusLabelMap[item.status]}
                        {item.update_fields.length > 0 ? ` (${item.update_fields.join(", ")})` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {harPreview.reservations.length > 120 ? (
              <div className="field-hint">Affichage limité aux 120 premières lignes.</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="card">
        <div className="settings-managers-header">
          <div className="section-title">Journal des imports</div>
          <button type="button" className="secondary" onClick={() => void loadImportLog()} disabled={loadingImportLog}>
            {loadingImportLog ? "Chargement..." : "Rafraîchir"}
          </button>
        </div>
        {importLogError && <div className="note">{importLogError}</div>}
        {!importLogError && importLog.length === 0 ? (
          <div className="field-hint">Aucun import enregistré.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {importLog.map((entry) => (
              <div key={entry.id} className="field-group">
                <div className="field-group__header">
                  <div className="field-group__label">{formatImportSource(entry.source)}</div>
                  <div className="field-hint">{formatIsoDateTimeFr(entry.at)}</div>
                </div>
                <div className="field-hint">
                  Sélectionnées: {entry.selectionCount ?? 0} | Ajoutées: {entry.inserted ?? 0} | Mises à jour: {entry.updated ?? 0} | Ignorées: {entry.skipped?.unknown ?? 0}
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="field-hint" style={{ marginBottom: 4 }}>Nouvelles réservations</div>
                  {Array.isArray(entry.insertedItems) && entry.insertedItems.length > 0 ? (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Gîte</th>
                          <th>Dates</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.insertedItems.slice(0, 30).map((item, index) => (
                          <tr key={`${entry.id}-inserted-${index}`}>
                            <td>{item.giteName || item.giteId || "-"}</td>
                            <td>
                              {item.checkIn ? formatIsoDateFr(item.checkIn) : "-"} - {item.checkOut ? formatIsoDateFr(item.checkOut) : "-"}
                            </td>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "999px",
                                    background: sourceColor(item.source),
                                    border: "1px solid rgba(17, 24, 39, 0.2)",
                                  }}
                                />
                                <span>{item.source || "-"}</span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="field-hint">Aucune nouvelle réservation.</div>
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="field-hint" style={{ marginBottom: 4 }}>Mises à jour</div>
                  {Array.isArray(entry.updatedItems) && entry.updatedItems.length > 0 ? (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Gîte</th>
                          <th>Dates</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.updatedItems.slice(0, 30).map((item, index) => (
                          <tr key={`${entry.id}-updated-${index}`}>
                            <td>{item.giteName || item.giteId || "-"}</td>
                            <td>
                              {item.checkIn ? formatIsoDateFr(item.checkIn) : "-"} - {item.checkOut ? formatIsoDateFr(item.checkOut) : "-"}
                            </td>
                            <td>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "999px",
                                    background: sourceColor(item.source),
                                    border: "1px solid rgba(17, 24, 39, 0.2)",
                                  }}
                                />
                                <span>{item.source || "-"}</span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="field-hint">Aucune mise à jour.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
