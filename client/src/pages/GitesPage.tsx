import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch, isApiError } from "../utils/api";
import type { Gestionnaire, Gite, GitePhoto, ReservationPlaceholder } from "../utils/types";
import { getGiteColor } from "../utils/giteColors";

const emptyForm = {
  nom: "",
  prefixe_contrat: "",
  adresse_ligne1: "",
  adresse_ligne2: "",
  capacite_max: 1,
  nb_adultes_max: 1,
  nb_adultes_habituel: 1,
  nb_enfants_max: 0,
  proprietaires_noms: "",
  proprietaires_adresse: "",
  site_web: "",
  public_slug: "",
  public_title: "",
  public_summary: "",
  public_description: "",
  public_seo_title: "",
  public_seo_description: "",
  public_is_published: false,
  public_structured_content: "",
  public_equipment: "",
  public_rooms: "",
  public_practical_info: "",
  public_location_info: "",
  public_latitude: "",
  public_longitude: "",
  email: "",
  caracteristiques: "",
  airbnb_listing_id: "",
  telephones: "",
  taxe_sejour_par_personne_par_nuit: 0,
  iban: "",
  bic: "",
  titulaire: "",
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
  options_draps_par_lit: 0,
  options_linge_toilette_par_personne: 0,
  options_menage_forfait: 0,
  options_depart_tardif_forfait: 0,
  options_chiens_forfait: 0,
  heure_arrivee_defaut: "17:00",
  heure_depart_defaut: "12:00",
  caution_montant_defaut: 0,
  cheque_menage_montant_defaut: 0,
  arrhes_taux_defaut: 0.2,
  electricity_price_per_kwh: 0,
  prix_nuit_liste: "",
  gestionnaire_id: "",
};

type FormState = typeof emptyForm;
type GitesExportPayload = {
  version?: number;
  exported_at?: string;
  gites: unknown[];
};
type GitesImportResult = {
  created_count: number;
  updated_count: number;
};
type PhotoDraft = {
  title: string;
  alt: string;
  credit: string;
};
const PLACEHOLDER_FADE_OUT_MS = 320;
const GITE_PHOTO_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const GITE_PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const GITE_EDITOR_SECTIONS = [
  { id: "base-fiche", label: "Fiche gîte" },
  { id: "web-presentation", label: "Présentation" },
  { id: "web-donnees", label: "Équipement et infos" },
  { id: "web-chambres", label: "Chambres et couchages" },
  { id: "web-photos", label: "Photos" },
  { id: "gestion-finance", label: "Fiscalité & banque" },
  { id: "gestion-contact", label: "Propriétaires & contact" },
  { id: "sejour-services", label: "Services & horaires" },
  { id: "sejour-tarifs", label: "Tarifs & garanties" },
  { id: "sejour-regles", label: "Règles & descriptif" },
] as const;
const GITE_EDITOR_SECTION_GROUPS = [
  {
    title: "Base",
    items: ["base-fiche"],
  },
  {
    title: "Web",
    items: ["web-presentation", "web-donnees", "web-chambres", "web-photos"],
  },
  {
    title: "Gestion",
    items: ["gestion-finance", "gestion-contact"],
  },
  {
    title: "Séjour",
    items: ["sejour-services", "sejour-tarifs", "sejour-regles"],
  },
] as const;
const GITE_EDITOR_SECTION_BY_ID = new Map(GITE_EDITOR_SECTIONS.map((section) => [section.id, section]));
type GiteEditorSectionId = (typeof GITE_EDITOR_SECTIONS)[number]["id"];

const isGiteEditorSectionId = (value: string | null): value is GiteEditorSectionId =>
  Boolean(value && GITE_EDITOR_SECTION_BY_ID.has(value as GiteEditorSectionId));

const formatManagerLabel = (gite: Gite) =>
  gite.gestionnaire ? `${gite.gestionnaire.prenom} ${gite.gestionnaire.nom}` : "Gestion directe";

const formatAddressLabel = (gite: Gite) =>
  [gite.adresse_ligne1, gite.adresse_ligne2].map((part) => part?.trim()).filter(Boolean).join(", ");

const formatJsonField = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

const parseJsonTextarea = (label: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label}: le JSON n'est pas valide.`);
  }
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });

const parseStoredJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const toDisplayText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const serializeStructuredValue = (value: unknown) => JSON.stringify(value, null, 2);

type EquipmentData = Record<string, string[]>;
type RoomData = Array<{ nom: string; couchages: string[]; notes?: string }>;
type InfoData = Array<{ titre: string; contenu: string }>;
type LocationData = { points: Array<{ lieu: string; distance: string }>; notes: string[] };
const BED_TYPE_OPTIONS = [
  { type: "single", label: "Lit 90", size: "90 x 190", icon: "single" },
  { type: "double", label: "Lit 140", size: "140 x 190", icon: "double" },
  { type: "queen", label: "Lit 160", size: "160 x 200", icon: "queen" },
  { type: "king", label: "Lit 180", size: "180 x 200", icon: "king" },
  { type: "bunk", label: "Lits superposés", size: "2 couchages", icon: "bunk" },
  { type: "sofa_bed", label: "Canapé-lit", size: "Convertible", icon: "sofa" },
  { type: "baby", label: "Lit bébé", size: "Bébé", icon: "baby" },
] as const;

type BedType = (typeof BED_TYPE_OPTIONS)[number]["type"];
type BedItem = { kind: "bed"; type: BedType; count: number };
type StructuredContentItem = string | BedItem;
type StructuredContentGroup = { id: string; titre: string; items: StructuredContentItem[]; note?: string };
type StructuredContentSection = { id: string; titre: string; groupes: StructuredContentGroup[] };
type StructuredContentData = StructuredContentSection[];

const createStructuredId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_BED_ITEM: BedItem = { kind: "bed", type: "queen", count: 1 };
const BED_TYPE_BY_ID = new Map(BED_TYPE_OPTIONS.map((option) => [option.type, option]));
const isBedType = (value: unknown): value is BedType => typeof value === "string" && BED_TYPE_BY_ID.has(value as BedType);
const isBedItem = (value: StructuredContentItem): value is BedItem =>
  Boolean(value && typeof value === "object" && !Array.isArray(value) && value.kind === "bed");
const normalizeBedItem = (value: unknown): BedItem => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_BED_ITEM;
  const row = value as Record<string, unknown>;
  const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.max(1, Math.round(row.count)) : 1;
  return {
    kind: "bed",
    type: isBedType(row.type) ? row.type : DEFAULT_BED_ITEM.type,
    count,
  };
};
const normalizeStructuredItems = (items: unknown, sectionId: string): StructuredContentItem[] => {
  if (!Array.isArray(items)) return [];
  if (sectionId === "pieces-couchages") return items.map(normalizeBedItem);
  return items.map(toDisplayText);
};

const buildStructuredContentDefaults = (): StructuredContentData => [
  { id: "equipements", titre: "Équipements", groupes: [{ id: "equipements-general", titre: "Général", items: [] }] },
  { id: "pieces-couchages", titre: "Chambres et couchages", groupes: [{ id: "pieces-chambre-1", titre: "Chambre 1", items: [], note: "" }] },
  { id: "infos-pratiques", titre: "Infos pratiques", groupes: [{ id: "infos-general", titre: "Général", items: [] }] },
  { id: "localisation", titre: "Localisation", groupes: [{ id: "localisation-general", titre: "Général", items: [] }] },
];
const REQUIRED_STRUCTURED_SECTIONS = buildStructuredContentDefaults();
const ensureStructuredSections = (sections: StructuredContentData, sectionIds?: string[]) => {
  if (!sectionIds || sectionIds.length === 0) return sections;
  const existingIds = new Set(sections.map((section) => section.id));
  const missingSections = REQUIRED_STRUCTURED_SECTIONS.filter((section) => sectionIds.includes(section.id) && !existingIds.has(section.id));
  return missingSections.length > 0 ? [...sections, ...missingSections] : sections;
};

const normalizeEquipmentData = (value: string): EquipmentData => {
  const parsed = parseStoredJson(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([category, items]) => [
        category,
        Array.isArray(items)
          ? items.map(toDisplayText)
          : toDisplayText(items)
              .split(/[,;\n]+/)
              .map((item) => item.trim())
              .filter(Boolean),
      ])
    );
  }
  if (Array.isArray(parsed)) return { Équipements: parsed.map(toDisplayText) };
  const text = toDisplayText(parsed);
  return text ? { Équipements: [text] } : {};
};

const normalizeRoomsData = (value: string): RoomData => {
  const parsed = parseStoredJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const couchagesRaw = row.couchages ?? row.lits ?? row.beds ?? [];
        return {
          nom: toDisplayText(row.nom ?? row.name ?? row.titre ?? row.title),
          couchages: Array.isArray(couchagesRaw)
            ? couchagesRaw.map(toDisplayText)
            : toDisplayText(couchagesRaw)
                .split(/[,;\n]+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
          notes: toDisplayText(row.notes ?? row.description),
        };
      }
      return { nom: toDisplayText(item), couchages: [], notes: "" };
    });
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>).map(([nom, couchages]) => ({
      nom,
      couchages: Array.isArray(couchages)
        ? couchages.map(toDisplayText)
        : toDisplayText(couchages)
            .split(/[,;\n]+/)
            .map((entry) => entry.trim())
            .filter(Boolean),
      notes: "",
    }));
  }
  const text = toDisplayText(parsed);
  return text ? [{ nom: text, couchages: [], notes: "" }] : [];
};

const normalizeInfoData = (value: string): InfoData => {
  const parsed = parseStoredJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        return {
          titre: toDisplayText(row.titre ?? row.title ?? row.label ?? row.nom),
          contenu: toDisplayText(row.contenu ?? row.content ?? row.value ?? row.description),
        };
      }
      return { titre: "Info", contenu: toDisplayText(item) };
    });
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed as Record<string, unknown>).map(([titre, contenu]) => ({
      titre,
      contenu: Array.isArray(contenu) ? contenu.map(toDisplayText).filter(Boolean).join(", ") : toDisplayText(contenu),
    }));
  }
  const text = toDisplayText(parsed);
  return text ? [{ titre: "Info", contenu: text }] : [];
};

const normalizeLocationData = (value: string): LocationData => {
  const parsed = parseStoredJson(value);
  const empty: LocationData = { points: [], notes: [] };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const row = parsed as Record<string, unknown>;
    const rawPoints = row.points ?? row.distances ?? row.nearby ?? [];
    const points = Array.isArray(rawPoints)
      ? rawPoints.map((item) => {
          if (item && typeof item === "object") {
            const point = item as Record<string, unknown>;
            return {
              lieu: toDisplayText(point.lieu ?? point.nom ?? point.label ?? point.place),
              distance: toDisplayText(point.distance ?? point.value ?? point.temps),
            };
          }
          return { lieu: toDisplayText(item), distance: "" };
        })
      : [];
    const notesRaw = row.notes ?? row.description ?? row.info;
    const notes = Array.isArray(notesRaw) ? notesRaw.map(toDisplayText).filter(Boolean) : toDisplayText(notesRaw) ? [toDisplayText(notesRaw)] : [];
    return { points, notes };
  }
  if (Array.isArray(parsed)) return { points: parsed.map((item) => ({ lieu: toDisplayText(item), distance: "" })), notes: [] };
  const text = toDisplayText(parsed);
  return text ? { ...empty, notes: [text] } : empty;
};

const normalizeStructuredContentData = (value: string): StructuredContentData => {
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) return buildStructuredContentDefaults();

  const sections = parsed
    .map((section, sectionIndex): StructuredContentSection | null => {
      if (!section || typeof section !== "object") return null;
      const row = section as Record<string, unknown>;
      const rawGroups = row.groupes ?? row.groups ?? row.items ?? [];
      const sectionId = toDisplayText(row.id) || `section-${sectionIndex}`;
      const groupes = Array.isArray(rawGroups)
        ? rawGroups
            .map((group, groupIndex): StructuredContentGroup | null => {
              if (group && typeof group === "object") {
                const groupRow = group as Record<string, unknown>;
                const rawItems = groupRow.items ?? groupRow.lignes ?? groupRow.values ?? [];
                return {
                  id: toDisplayText(groupRow.id) || `section-${sectionIndex}-group-${groupIndex}`,
                  titre: toDisplayText(groupRow.titre ?? groupRow.title ?? groupRow.nom) || `Groupe ${groupIndex + 1}`,
                  items: normalizeStructuredItems(rawItems, sectionId),
                  note: toDisplayText(groupRow.note ?? groupRow.notes),
                };
              }
              return {
                id: `section-${sectionIndex}-group-${groupIndex}`,
                titre: `Groupe ${groupIndex + 1}`,
                items: sectionId === "pieces-couchages" ? [DEFAULT_BED_ITEM] : [toDisplayText(group)],
                note: "",
              };
            })
            .filter((group): group is StructuredContentGroup => Boolean(group))
        : [];

      return {
        id: sectionId,
        titre: toDisplayText(row.titre ?? row.title ?? row.nom) || `Section ${sectionIndex + 1}`,
        groupes,
      };
    })
    .filter((section): section is StructuredContentSection => Boolean(section));

  return sections.length > 0 ? sections : buildStructuredContentDefaults();
};

const hasStructuredContent = (value: unknown) => {
  const parsed = typeof value === "string" ? parseStoredJson(value) : value;
  return Array.isArray(parsed) && parsed.length > 0;
};

const buildStructuredContentFromLegacy = (gite: Gite): StructuredContentData => {
  if (hasStructuredContent(gite.public_structured_content)) {
    return normalizeStructuredContentData(formatJsonField(gite.public_structured_content));
  }

  const equipment = normalizeEquipmentData(formatJsonField(gite.public_equipment));
  const rooms = normalizeRoomsData(formatJsonField(gite.public_rooms));
  const practicalInfo = normalizeInfoData(formatJsonField(gite.public_practical_info));
  const location = normalizeLocationData(formatJsonField(gite.public_location_info));
  const sections = buildStructuredContentDefaults();

  sections[0] = {
    ...sections[0],
    groupes: Object.entries(equipment).map(([titre, items], index) => ({
      id: `equipements-${index}`,
      titre,
      items,
    })),
  };
  sections[1] = {
    ...sections[1],
    groupes: rooms.map((room, index) => ({
      id: `piece-${index}`,
      titre: room.nom || `Pièce ${index + 1}`,
      items: room.couchages.length > 0 ? room.couchages.map(() => DEFAULT_BED_ITEM) : [],
      note: room.notes ?? "",
    })),
  };
  sections[2] = {
    ...sections[2],
    groupes: practicalInfo.map((info, index) => ({
      id: `info-${index}`,
      titre: info.titre || `Info ${index + 1}`,
      items: info.contenu ? [info.contenu] : [],
    })),
  };
  sections[3] = {
    ...sections[3],
    groupes: [
      ...(location.points.length > 0
        ? [
            {
              id: "localisation-points",
              titre: "Lieux proches",
              items: location.points.map((point) => [point.lieu, point.distance].filter(Boolean).join(" - ")),
            },
          ]
        : []),
      ...(location.notes.length > 0
        ? [{ id: "localisation-notes", titre: "Notes", items: location.notes }]
        : []),
    ],
  };

  return sections.map((section) => (section.groupes.length > 0 ? section : { ...section, groupes: [] }));
};

type StructuredEditorProps = {
  value: string;
  onChange: (value: string) => void;
  sectionIds?: string[];
  excludeSectionIds?: string[];
  showToolbar?: boolean;
};

const BedPictogram = ({ type }: { type: BedType }) => {
  const option = BED_TYPE_BY_ID.get(type) ?? BED_TYPE_BY_ID.get(DEFAULT_BED_ITEM.type);
  return (
    <span className={`bed-picto bed-picto--${option?.icon ?? "queen"}`} aria-hidden="true">
      <svg viewBox="0 0 48 32" focusable="false">
        <rect className="bed-picto__frame" x="5" y="13" width="38" height="12" rx="3" />
        <rect className="bed-picto__pillow" x="8" y="9" width="11" height="8" rx="2" />
        <path className="bed-picto__base" d="M5 25h38M9 25v4M39 25v4" />
        {type === "bunk" ? <path className="bed-picto__detail" d="M8 7h32M8 7v19M40 7v19M8 16h32" /> : null}
        {type === "sofa_bed" ? <path className="bed-picto__detail" d="M10 12v-2h28v2M12 22h24" /> : null}
        {type === "baby" ? <path className="bed-picto__detail" d="M12 9h24M12 9v16M36 9v16M18 9v16M24 9v16M30 9v16" /> : null}
      </svg>
    </span>
  );
};

const StructuredContentEditor = ({ value, onChange, sectionIds, excludeSectionIds, showToolbar = true }: StructuredEditorProps) => {
  const sections = ensureStructuredSections(normalizeStructuredContentData(value), sectionIds);
  const visibleSectionIds = sectionIds ? new Set(sectionIds) : null;
  const excludedSectionIds = excludeSectionIds ? new Set(excludeSectionIds) : null;
  const locksVisibleSections = Boolean(visibleSectionIds);
  const [draggedSectionIndex, setDraggedSectionIndex] = useState<number | null>(null);
  const [dragOverSectionIndex, setDragOverSectionIndex] = useState<number | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const commit = (next: StructuredContentData) => onChange(serializeStructuredValue(next));
  const updateSection = (sectionIndex: number, updater: (section: StructuredContentSection) => StructuredContentSection) => {
    const next = [...sections];
    next[sectionIndex] = updater(next[sectionIndex]);
    commit(next);
  };
  const updateGroup = (
    sectionIndex: number,
    groupIndex: number,
    updater: (group: StructuredContentGroup) => StructuredContentGroup
  ) => {
    updateSection(sectionIndex, (section) => {
      const groupes = [...section.groupes];
      groupes[groupIndex] = updater(groupes[groupIndex]);
      return { ...section, groupes };
    });
  };
  const toggleSection = (sectionId: string) => {
    setCollapsedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  };

  return (
    <div className="structured-editor structured-editor--content">
      {showToolbar ? (
        <div className="structured-editor__toolbar">
        <button
          type="button"
          className="table-action table-action--primary"
          onClick={() =>
            commit([
              ...sections,
              {
                id: createStructuredId("section"),
                titre: "Nouvelle section",
                groupes: [{ id: createStructuredId("groupe"), titre: "Général", items: [] }],
              },
            ])
          }
        >
          Ajouter un bloc
        </button>
        </div>
      ) : null}
      <div className="structured-grid structured-grid--sections">
        {sections.map((section, sectionIndex) => {
          if (visibleSectionIds && !visibleSectionIds.has(section.id)) return null;
          if (excludedSectionIds && excludedSectionIds.has(section.id)) return null;
          const isCollapsed = collapsedSections[section.id] ?? false;
          const isBedsSection = section.id === "pieces-couchages";
          return (
            <article
              key={section.id}
              className={`structured-card structured-card--section${locksVisibleSections ? " structured-card--locked-root" : ""}${
                dragOverSectionIndex === sectionIndex ? " structured-card--drag-over" : ""
              }`}
              onDragOver={(event) => {
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) return;
                event.preventDefault();
                setDragOverSectionIndex(sectionIndex);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedSectionIndex === null || draggedSectionIndex === sectionIndex) {
                  setDraggedSectionIndex(null);
                  setDragOverSectionIndex(null);
                  return;
                }
                const next = [...sections];
                const [moved] = next.splice(draggedSectionIndex, 1);
                next.splice(sectionIndex, 0, moved);
                commit(next);
                setDraggedSectionIndex(null);
                setDragOverSectionIndex(null);
              }}
            >
              <div className={`structured-section-header${locksVisibleSections ? " structured-section-header--locked" : ""}`}>
                <button
                  type="button"
                  className="structured-toggle"
                  aria-label={isCollapsed ? `Ouvrir ${section.titre}` : `Fermer ${section.titre}`}
                  onClick={() => toggleSection(section.id)}
                >
                  {isCollapsed ? "›" : "⌄"}
                </button>
                {!locksVisibleSections ? (
                  <button
                    type="button"
                    className="structured-drag-handle"
                    draggable
                    aria-label={`Déplacer ${section.titre || "ce bloc"}`}
                    onDragStart={(event) => {
                      setDraggedSectionIndex(sectionIndex);
                      setDragOverSectionIndex(sectionIndex);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(sectionIndex));
                    }}
                    onDragEnd={() => {
                      setDraggedSectionIndex(null);
                      setDragOverSectionIndex(null);
                    }}
                  >
                    ⋮⋮
                  </button>
                ) : null}
                <input
                  className="structured-card__title-input structured-card__title-input--section"
                  value={section.titre}
                  onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, titre: event.target.value }))}
                  aria-label="Titre du bloc"
                />
                {!locksVisibleSections ? (
                  <button
                    type="button"
                    className="structured-icon-button structured-icon-button--danger"
                    onClick={() => commit(sections.filter((_, index) => index !== sectionIndex))}
                    aria-label={`Supprimer ${section.titre || "ce bloc"}`}
                    title="Supprimer le bloc"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {!isCollapsed ? (
                <div className={`structured-section-body${locksVisibleSections ? " structured-section-body--locked" : ""}`}>
                  {section.groupes.length === 0 ? <div className="structured-empty">Aucune rubrique dans ce bloc.</div> : null}
                  <div className="structured-group-list">
                    {section.groupes.map((group, groupIndex) => (
                      <div key={group.id} className="structured-group">
                        <div className="structured-group__header">
                          <input
                            className="structured-card__title-input structured-card__title-input--group"
                            value={group.titre}
                            onChange={(event) =>
                              updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, titre: event.target.value }))
                            }
                            aria-label="Titre de la rubrique"
                          />
                          <button
                            type="button"
                            className="structured-icon-button"
                            onClick={() =>
                              updateSection(sectionIndex, (current) => ({
                                ...current,
                                groupes: current.groupes.filter((_, index) => index !== groupIndex),
                              }))
                            }
                            aria-label={`Supprimer ${group.titre || "cette rubrique"}`}
                            title="Supprimer la rubrique"
                          >
                            ×
                          </button>
                        </div>
                        {isBedsSection ? (
                          <div className="bed-list">
                            {group.items.map((item, itemIndex) => {
                              const bed = isBedItem(item) ? item : DEFAULT_BED_ITEM;
                              const bedOption = BED_TYPE_BY_ID.get(bed.type) ?? BED_TYPE_BY_ID.get(DEFAULT_BED_ITEM.type);
                              return (
                                <div key={`${group.id}-${itemIndex}`} className="bed-row">
                                  <BedPictogram type={bed.type} />
                                  <label className="bed-row__type">
                                    <span>Type</span>
                                    <select
                                      value={bed.type}
                                      onChange={(event) =>
                                        updateGroup(sectionIndex, groupIndex, (current) => {
                                          const items = [...current.items];
                                          items[itemIndex] = { ...bed, type: event.target.value as BedType };
                                          return { ...current, items };
                                        })
                                      }
                                    >
                                      {BED_TYPE_OPTIONS.map((option) => (
                                        <option key={option.type} value={option.type}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="bed-row__meta">{bedOption?.size}</div>
                                  <label className="bed-row__count">
                                    <span>Qté</span>
                                    <input
                                      type="number"
                                      min="1"
                                      value={bed.count}
                                      onChange={(event) =>
                                        updateGroup(sectionIndex, groupIndex, (current) => {
                                          const items = [...current.items];
                                          const count = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
                                          items[itemIndex] = { ...bed, count };
                                          return { ...current, items };
                                        })
                                      }
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="structured-icon-button"
                                    onClick={() =>
                                      updateGroup(sectionIndex, groupIndex, (current) => ({
                                        ...current,
                                        items: current.items.filter((_, index) => index !== itemIndex),
                                      }))
                                    }
                                    aria-label={`Supprimer ${bedOption?.label ?? "ce couchage"}`}
                                    title="Supprimer le couchage"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                            <button
                              type="button"
                              className="structured-add-chip structured-add-chip--bed"
                              onClick={() =>
                                updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, items: [...current.items, DEFAULT_BED_ITEM] }))
                              }
                            >
                              + Ajouter un couchage
                            </button>
                          </div>
                        ) : (
                          <div className="structured-chips">
                            {group.items.map((item, itemIndex) => {
                              const textItem = toDisplayText(item);
                              return (
                                <span key={`${group.id}-${itemIndex}`} className="structured-chip">
                                  <input
                                    value={textItem}
                                    placeholder="Nouvel élément"
                                    size={Math.min(Math.max(textItem.length || 14, 14), 34)}
                                    onChange={(event) =>
                                      updateGroup(sectionIndex, groupIndex, (current) => {
                                        const items = [...current.items];
                                        items[itemIndex] = event.target.value;
                                        return { ...current, items };
                                      })
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateGroup(sectionIndex, groupIndex, (current) => ({
                                        ...current,
                                        items: current.items.filter((_, index) => index !== itemIndex),
                                      }))
                                    }
                                    aria-label={`Supprimer ${textItem || "cet élément"}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                            <button
                              type="button"
                              className="structured-add-chip"
                              onClick={() => updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, items: [...current.items, ""] }))}
                            >
                              + Ajouter
                            </button>
                          </div>
                        )}
                        <label className="field structured-note-field">
                          Note
                          <input
                            value={group.note ?? ""}
                            onChange={(event) => updateGroup(sectionIndex, groupIndex, (current) => ({ ...current, note: event.target.value }))}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="structured-add-rubric"
                    onClick={() =>
                      updateSection(sectionIndex, (current) => ({
                        ...current,
                        groupes: [
                          ...current.groupes,
                          {
                            id: createStructuredId("groupe"),
                            titre: isBedsSection ? `Chambre ${current.groupes.length + 1}` : "Nouvelle rubrique",
                            items: isBedsSection ? [DEFAULT_BED_ITEM] : [],
                          },
                        ],
                      }))
                    }
                  >
                    {isBedsSection ? "+ Ajouter une chambre" : "+ Ajouter une rubrique"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
};

const EquipmentStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const data = normalizeEquipmentData(value);
  const entries = Object.entries(data);
  const commit = (next: EquipmentData) => onChange(serializeStructuredValue(next));
  const addCategory = () => {
    const base = "Nouvelle catégorie";
    let name = base;
    let index = 2;
    while (Object.prototype.hasOwnProperty.call(data, name)) {
      name = `${base} ${index}`;
      index += 1;
    }
    commit({ ...data, [name]: [] });
  };

  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={addCategory}>
          Ajouter une catégorie
        </button>
      </div>
      {entries.length === 0 ? <div className="structured-empty">Aucune catégorie d'équipement.</div> : null}
      <div className="structured-grid">
        {entries.map(([category, items], categoryIndex) => (
          <article key={categoryIndex} className="structured-card">
            <div className="structured-card__header">
              <input
                className="structured-card__title-input"
                value={category}
                onChange={(event) => {
                  const next = { ...data };
                  delete next[category];
                  next[event.target.value || "Sans titre"] = items;
                  commit(next);
                }}
              />
              <button
                type="button"
                className="table-action table-action--neutral"
                onClick={() => {
                  const next = { ...data };
                  delete next[category];
                  commit(next);
                }}
              >
                Retirer
              </button>
            </div>
            <div className="structured-chips">
              {items.map((item, itemIndex) => (
                <span key={`${category}-${itemIndex}`} className="structured-chip">
                  <input
                    value={item}
                    size={Math.min(Math.max(item.length || 14, 14), 34)}
                    onChange={(event) => {
                      const nextItems = [...items];
                      nextItems[itemIndex] = event.target.value;
                      commit({ ...data, [category]: nextItems });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => commit({ ...data, [category]: items.filter((_, index) => index !== itemIndex) })}
                    aria-label={`Supprimer ${item || "cet équipement"}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, [category]: [...items, ""] })}>
              Ajouter un équipement
            </button>
          </article>
        ))}
      </div>
    </div>
  );
};

const RoomsStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const rooms = normalizeRoomsData(value);
  const commit = (next: RoomData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit([...rooms, { nom: "", couchages: [""], notes: "" }])}>
          Ajouter une pièce
        </button>
      </div>
      {rooms.length === 0 ? <div className="structured-empty">Aucune pièce ou couchage renseigné.</div> : null}
      <div className="structured-grid">
        {rooms.map((room, index) => (
          <article key={index} className="structured-card">
            <div className="structured-card__header">
              <input
                className="structured-card__title-input"
                value={room.nom}
                placeholder="Chambre 1"
                onChange={(event) => {
                  const next = [...rooms];
                  next[index] = { ...room, nom: event.target.value };
                  commit(next);
                }}
              />
              <button type="button" className="table-action table-action--neutral" onClick={() => commit(rooms.filter((_, roomIndex) => roomIndex !== index))}>
                Retirer
              </button>
            </div>
            <div className="structured-chips">
              {room.couchages.map((bed, bedIndex) => (
                <span key={`${index}-${bedIndex}`} className="structured-chip">
                  <input
                    value={bed}
                    placeholder="Lit 160"
                    size={Math.min(Math.max(bed.length || 14, 14), 34)}
                    onChange={(event) => {
                      const next = [...rooms];
                      const couchages = [...room.couchages];
                      couchages[bedIndex] = event.target.value;
                      next[index] = { ...room, couchages };
                      commit(next);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...rooms];
                      next[index] = { ...room, couchages: room.couchages.filter((_, itemIndex) => itemIndex !== bedIndex) };
                      commit(next);
                    }}
                    aria-label="Supprimer ce couchage"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="table-action table-action--neutral"
              onClick={() => {
                const next = [...rooms];
                next[index] = { ...room, couchages: [...room.couchages, ""] };
                commit(next);
              }}
            >
              Ajouter un couchage
            </button>
            <label className="field">
              Note
              <input
                value={room.notes ?? ""}
                onChange={(event) => {
                  const next = [...rooms];
                  next[index] = { ...room, notes: event.target.value };
                  commit(next);
                }}
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
};

const InfoStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const rows = normalizeInfoData(value);
  const commit = (next: InfoData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit([...rows, { titre: "", contenu: "" }])}>
          Ajouter une info
        </button>
      </div>
      {rows.length === 0 ? <div className="structured-empty">Aucune information pratique.</div> : null}
      <div className="structured-list">
        {rows.map((row, index) => (
          <div key={index} className="structured-row">
            <input
              value={row.titre}
              placeholder="Arrivée"
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, titre: event.target.value };
                commit(next);
              }}
            />
            <input
              value={row.contenu}
              placeholder="Boîte à clés, parking..."
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, contenu: event.target.value };
                commit(next);
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit(rows.filter((_, rowIndex) => rowIndex !== index))}>
              Retirer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const LocationStructuredEditor = ({ value, onChange }: StructuredEditorProps) => {
  const data = normalizeLocationData(value);
  const commit = (next: LocationData) => onChange(serializeStructuredValue(next));
  return (
    <div className="structured-editor">
      <div className="structured-editor__toolbar">
        <button type="button" className="table-action table-action--primary" onClick={() => commit({ ...data, points: [...data.points, { lieu: "", distance: "" }] })}>
          Ajouter un lieu proche
        </button>
        <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, notes: [...data.notes, ""] })}>
          Ajouter une note
        </button>
      </div>
      <div className="structured-list">
        {data.points.map((point, index) => (
          <div key={`point-${index}`} className="structured-row structured-row--location">
            <input
              value={point.lieu}
              placeholder="Forêt de Brocéliande"
              onChange={(event) => {
                const points = [...data.points];
                points[index] = { ...point, lieu: event.target.value };
                commit({ ...data, points });
              }}
            />
            <input
              value={point.distance}
              placeholder="5 min / 3 km"
              onChange={(event) => {
                const points = [...data.points];
                points[index] = { ...point, distance: event.target.value };
                commit({ ...data, points });
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, points: data.points.filter((_, rowIndex) => rowIndex !== index) })}>
              Retirer
            </button>
          </div>
        ))}
        {data.notes.map((note, index) => (
          <div key={`note-${index}`} className="structured-row">
            <input
              value={note}
              placeholder="À deux pas du bourg..."
              onChange={(event) => {
                const notes = [...data.notes];
                notes[index] = event.target.value;
                commit({ ...data, notes });
              }}
            />
            <button type="button" className="table-action table-action--neutral" onClick={() => commit({ ...data, notes: data.notes.filter((_, rowIndex) => rowIndex !== index) })}>
              Retirer
            </button>
          </div>
        ))}
      </div>
      {data.points.length === 0 && data.notes.length === 0 ? <div className="structured-empty">Aucune information de localisation.</div> : null}
    </div>
  );
};

const GitesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [gites, setGites] = useState<Gite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get("gite") || null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingGites, setImportingGites] = useState(false);
  const [exportingGites, setExportingGites] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [placeholders, setPlaceholders] = useState<ReservationPlaceholder[]>([]);
  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [placeholderTargets, setPlaceholderTargets] = useState<Record<string, string>>({});
  const [photoDrafts, setPhotoDrafts] = useState<Record<string, PhotoDraft>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const [activeEditorSection, setActiveEditorSection] = useState<GiteEditorSectionId>(() => {
    const section = searchParams.get("section");
    return isGiteEditorSectionId(section) ? section : "base-fiche";
  });
  const [attachingPlaceholderId, setAttachingPlaceholderId] = useState<string | null>(null);
  const [fadingPlaceholderIds, setFadingPlaceholderIds] = useState<string[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const formCardRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => gites.find((g) => g.id === selectedId) ?? null, [gites, selectedId]);
  const activeEditorSectionLabel = GITE_EDITOR_SECTION_BY_ID.get(activeEditorSection)?.label ?? "Section";

  useEffect(() => {
    const queryGiteId = searchParams.get("gite") || null;
    const querySection = searchParams.get("section");
    const nextSection = isGiteEditorSectionId(querySection) ? querySection : "base-fiche";

    setSelectedId((current) => (current === queryGiteId ? current : queryGiteId));
    setActiveEditorSection((current) => (current === nextSection ? current : nextSection));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    if (selectedId) {
      next.set("gite", selectedId);
    } else {
      next.delete("gite");
    }
    next.set("section", activeEditorSection);

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeEditorSection, searchParams, selectedId, setSearchParams]);

  const load = async () => {
    const [gitesData, placeholdersData, gestionnairesData] = await Promise.all([
      apiFetch<Gite[]>("/gites"),
      apiFetch<ReservationPlaceholder[]>("/reservations/placeholders"),
      apiFetch<Gestionnaire[]>("/managers"),
    ]);
    setGites(gitesData);
    setPlaceholders(placeholdersData);
    setGestionnaires(gestionnairesData);
    setPlaceholderTargets((prev) => {
      const next = { ...prev };
      for (const placeholder of placeholdersData) {
        if (!next[placeholder.id] && gitesData[0]?.id) {
          next[placeholder.id] = gitesData[0].id;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) {
      setForm(emptyForm);
      setPhotoDrafts({});
      return;
    }
    setForm({
      nom: selected.nom,
      prefixe_contrat: selected.prefixe_contrat,
      adresse_ligne1: selected.adresse_ligne1,
      adresse_ligne2: selected.adresse_ligne2 ?? "",
      capacite_max: selected.capacite_max,
      nb_adultes_max: selected.nb_adultes_max,
      nb_adultes_habituel: selected.nb_adultes_habituel,
      nb_enfants_max: selected.nb_enfants_max,
      proprietaires_noms: selected.proprietaires_noms,
      proprietaires_adresse: selected.proprietaires_adresse,
      site_web: selected.site_web ?? "",
      public_slug: selected.public_slug ?? "",
      public_title: selected.public_title ?? "",
      public_summary: selected.public_summary ?? "",
      public_description: selected.public_description ?? "",
      public_seo_title: selected.public_seo_title ?? "",
      public_seo_description: selected.public_seo_description ?? "",
      public_is_published: selected.public_is_published ?? false,
      public_structured_content: serializeStructuredValue(buildStructuredContentFromLegacy(selected)),
      public_equipment: formatJsonField(selected.public_equipment),
      public_rooms: formatJsonField(selected.public_rooms),
      public_practical_info: formatJsonField(selected.public_practical_info),
      public_location_info: formatJsonField(selected.public_location_info),
      public_latitude: selected.public_latitude ?? "",
      public_longitude: selected.public_longitude ?? "",
      email: selected.email ?? "",
      caracteristiques: selected.caracteristiques ?? "",
      airbnb_listing_id: selected.airbnb_listing_id ?? "",
      telephones: Array.isArray(selected.telephones) ? selected.telephones.join(", ") : "",
      taxe_sejour_par_personne_par_nuit: selected.taxe_sejour_par_personne_par_nuit,
      iban: selected.iban,
      bic: selected.bic ?? "",
      titulaire: selected.titulaire,
      regle_animaux_acceptes: selected.regle_animaux_acceptes,
      regle_bois_premiere_flambee: selected.regle_bois_premiere_flambee,
      regle_tiers_personnes_info: selected.regle_tiers_personnes_info,
      options_draps_par_lit: selected.options_draps_par_lit,
      options_linge_toilette_par_personne: selected.options_linge_toilette_par_personne,
      options_menage_forfait: selected.options_menage_forfait,
      options_depart_tardif_forfait: selected.options_depart_tardif_forfait,
      options_chiens_forfait: selected.options_chiens_forfait,
      heure_arrivee_defaut: selected.heure_arrivee_defaut ?? "17:00",
      heure_depart_defaut: selected.heure_depart_defaut ?? "12:00",
      caution_montant_defaut: selected.caution_montant_defaut ?? 0,
      cheque_menage_montant_defaut: selected.cheque_menage_montant_defaut ?? 0,
      arrhes_taux_defaut: selected.arrhes_taux_defaut ?? 0.2,
      electricity_price_per_kwh: selected.electricity_price_per_kwh ?? 0,
      prix_nuit_liste: Array.isArray(selected.prix_nuit_liste) ? selected.prix_nuit_liste.join(", ") : "",
      gestionnaire_id: selected.gestionnaire_id ?? "",
    });
    setPhotoDrafts(
      Object.fromEntries(
        (selected.photos ?? []).map((photo) => [
          photo.id,
          {
            title: photo.title ?? "",
            alt: photo.alt ?? "",
            credit: photo.credit ?? "",
          },
        ])
      )
    );
  }, [selected]);

  const handleChange = (key: keyof FormState, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const jumpToEditorSection = (sectionId: (typeof GITE_EDITOR_SECTIONS)[number]["id"]) => {
    setActiveEditorSection(sectionId);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, id: string) => {
    if (reordering) return;
    setDraggedId(id);
    setDragOverId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverId !== targetId) setDragOverId(targetId);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    if (reordering) return;
    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const fromIndex = gites.findIndex((gite) => gite.id === sourceId);
    const targetIndex = gites.findIndex((gite) => gite.id === targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;

    const reordered = [...gites];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setGites(reordered);

    setReordering(true);
    setError(null);
    try {
      const updated = await apiFetch<Gite[]>("/gites/reorder", {
        method: "POST",
        json: { ids: reordered.map((gite) => gite.id) },
      });
      setGites(updated);
    } catch (err: any) {
      setError(err.message);
      await load();
    } finally {
      setReordering(false);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const save = async (options: { keepOpen?: boolean } = {}) => {
    const keepOpen = options.keepOpen ?? false;
    const savedSelectedId = selectedId;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const prixNuitListe = form.prix_nuit_liste
        .split(/[,;\n]+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const payload = {
        ...form,
        public_slug: form.public_slug || null,
        public_title: form.public_title || null,
        public_summary: form.public_summary || null,
        public_description: form.public_description || null,
        public_seo_title: form.public_seo_title || null,
        public_seo_description: form.public_seo_description || null,
        public_structured_content: parseJsonTextarea(
          "Contenu structuré site",
          form.public_structured_content || serializeStructuredValue(buildStructuredContentDefaults())
        ),
        public_equipment: null,
        public_rooms: null,
        public_practical_info: null,
        public_location_info: null,
        public_latitude: null,
        public_longitude: null,
        heure_arrivee_defaut: form.heure_arrivee_defaut || "17:00",
        heure_depart_defaut: form.heure_depart_defaut || "12:00",
        gestionnaire_id: form.gestionnaire_id || null,
        prix_nuit_liste: prixNuitListe,
        telephones: form.telephones
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      let created: Gite | null = null;
      if (savedSelectedId) {
        await apiFetch(`/gites/${savedSelectedId}`, { method: "PUT", json: payload });
      } else {
        created = await apiFetch<Gite>(`/gites`, { method: "POST", json: payload });
      }
      await load();
      if (created) {
        setSelectedId(created.id);
        const matchingPlaceholder = placeholders.find(
          (placeholder) => placeholder.abbreviation === created.prefixe_contrat.toUpperCase()
        );
        if (
          matchingPlaceholder &&
          confirm(
            `Associer le nouveau gîte ${created.nom} au placeholder ${matchingPlaceholder.abbreviation} (${matchingPlaceholder.reservations_count} réservations) ?`
          )
        ) {
          await apiFetch(`/reservations/placeholders/${matchingPlaceholder.id}/assign`, {
            method: "POST",
            json: { gite_id: created.id },
          });
          await load();
        }
      } else if (keepOpen && savedSelectedId) {
        setSelectedId(savedSelectedId);
        setNotice(`${activeEditorSectionLabel} enregistrée.`);
      } else {
        setSelectedId(null);
        setForm(emptyForm);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const duplicate = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<Gite>(`/gites/${id}/duplicate`, { method: "POST" });
      await load();
      setSelectedId(created.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (gite: Gite) => {
    const contratsCount = gite.contrats_count ?? 0;
    const message =
      contratsCount > 0
        ? `Supprimer ce gîte et ses ${contratsCount} contrats ?`
        : "Supprimer ce gîte ?";
    if (!confirm(message)) return;
    setNotice(null);
    try {
      await apiFetch(`/gites/${gite.id}`, { method: "DELETE" });
      await load();
      if (selectedId === gite.id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const attachPlaceholder = async (placeholder: ReservationPlaceholder) => {
    const targetGiteId = placeholderTargets[placeholder.id] ?? selectedId ?? "";
    if (!targetGiteId) {
      setError("Choisissez un gîte cible avant de rattacher un placeholder.");
      return;
    }
    setError(null);
    setNotice(null);
    setAttachingPlaceholderId(placeholder.id);
    try {
      await apiFetch(`/reservations/placeholders/${placeholder.id}/assign`, {
        method: "POST",
        json: { gite_id: targetGiteId },
      });
      const targetGite = gites.find((gite) => gite.id === targetGiteId);
      setNotice(
        `Placeholder ${placeholder.abbreviation} rattaché à ${targetGite?.nom ?? "ce gîte"} (${placeholder.reservations_count} réservation(s)).`
      );
      setFadingPlaceholderIds((prev) => (prev.includes(placeholder.id) ? prev : [...prev, placeholder.id]));
      await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_FADE_OUT_MS));
      setPlaceholders((prev) => prev.filter((item) => item.id !== placeholder.id));
      setPlaceholderTargets((prev) => {
        const { [placeholder.id]: _removed, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err: any) {
      if (isApiError(err) && err.status === 409) {
        const conflicts = Array.isArray((err.payload as any).conflicts) ? (err.payload as any).conflicts : [];
        const deduplicated = Number((err.payload as any).skipped_duplicates_count ?? 0);
        const suffixParts: string[] = [];
        if (conflicts.length > 0) suffixParts.push(`${conflicts.length} conflit(s)`);
        if (deduplicated > 0) suffixParts.push(`${deduplicated} doublon(s) ignoré(s)`);
        const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
        setError(`${err.message}${suffix}`);
      } else {
        setError(err.message);
      }
    } finally {
      setFadingPlaceholderIds((prev) => prev.filter((id) => id !== placeholder.id));
      setAttachingPlaceholderId(null);
    }
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const triggerPhotoUpload = () => {
    photoInputRef.current?.click();
  };

  const startCreate = () => {
    setSelectedId(null);
    setForm(emptyForm);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const selectGite = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const exportGites = async () => {
    setExportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await apiFetch<GitesExportPayload>("/gites/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gites-export-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`${payload.gites.length} fiche(s) exportée(s).`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExportingGites(false);
    }
  };

  const importGitesFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImportingGites(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      let payload: { gites: unknown[] };

      if (Array.isArray(parsed)) {
        payload = { gites: parsed };
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { gites?: unknown[] }).gites)
      ) {
        payload = { gites: (parsed as { gites: unknown[] }).gites };
      } else {
        throw new Error("Format invalide: utilisez un JSON exporté depuis l'application.");
      }

      const result = await apiFetch<GitesImportResult>("/gites/import", {
        method: "POST",
        json: payload,
      });
      await load();
      setNotice(`Import terminé: ${result.created_count} créé(s), ${result.updated_count} mis à jour.`);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setError("Le fichier n'est pas un JSON valide.");
      } else {
        setError(err.message);
      }
    } finally {
      input.value = "";
      setImportingGites(false);
    }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !selected) return;

    setUploadingPhoto(true);
    setError(null);
    setNotice(null);
    try {
      if (!GITE_PHOTO_ALLOWED_MIME_TYPES.has(file.type)) {
        throw new Error("Format non pris en charge. Utilisez JPG, PNG, WEBP ou AVIF.");
      }
      if (file.size > GITE_PHOTO_MAX_BYTES) {
        throw new Error(`La photo dépasse ${Math.round(GITE_PHOTO_MAX_BYTES / (1024 * 1024))} Mo.`);
      }
      const data = await readFileAsDataUrl(file);
      await apiFetch<GitePhoto>(`/gites/${selected.id}/photos/upload`, {
        method: "POST",
        json: {
          filename: file.name,
          mimeType: file.type,
          data,
          title: file.name.replace(/\.[^.]+$/, ""),
          alt: selected.public_title || selected.nom,
          is_primary: (selected.photos ?? []).length === 0,
          is_public: true,
        },
      });
      await load();
      setNotice("Photo ajoutée.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      input.value = "";
      setUploadingPhoto(false);
    }
  };

  const updatePhotoDraft = (photoId: string, key: keyof PhotoDraft, value: string) => {
    setPhotoDrafts((prev) => ({
      ...prev,
      [photoId]: {
        title: prev[photoId]?.title ?? "",
        alt: prev[photoId]?.alt ?? "",
        credit: prev[photoId]?.credit ?? "",
        [key]: value,
      },
    }));
  };

  const savePhoto = async (photo: GitePhoto, patch: Partial<Pick<GitePhoto, "is_primary" | "is_public">> = {}) => {
    if (!selected) return;
    setSavingPhotoId(photo.id);
    setError(null);
    setNotice(null);
    try {
      const draft = photoDrafts[photo.id] ?? { title: photo.title ?? "", alt: photo.alt ?? "", credit: photo.credit ?? "" };
      await apiFetch<GitePhoto>(`/gites/${selected.id}/photos/${photo.id}`, {
        method: "PUT",
        json: {
          url: photo.url,
          title: draft.title || null,
          alt: draft.alt || null,
          credit: draft.credit || null,
          is_primary: patch.is_primary ?? photo.is_primary,
          is_public: patch.is_public ?? photo.is_public,
        },
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPhotoId(null);
    }
  };

  const deletePhoto = async (photo: GitePhoto) => {
    if (!selected || !confirm("Supprimer cette photo ?")) return;
    setSavingPhotoId(photo.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/gites/${selected.id}/photos/${photo.id}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPhotoId(null);
    }
  };

  const movePhoto = async (photoId: string, direction: -1 | 1) => {
    if (!selected) return;
    const photos = [...(selected.photos ?? [])];
    const index = photos.findIndex((photo) => photo.id === photoId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= photos.length) return;
    const [moved] = photos.splice(index, 1);
    photos.splice(targetIndex, 0, moved);
    setSavingPhotoId(photoId);
    setError(null);
    setNotice(null);
    try {
      await apiFetch<GitePhoto[]>(`/gites/${selected.id}/photos/reorder`, {
        method: "POST",
        json: { ids: photos.map((photo) => photo.id) },
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingPhotoId(null);
    }
  };

  return (
    <div>
      <div className="gites-listing-shell">
        <div className="gites-header gites-header--listing">
          <div className="gites-tools">
            <button type="button" className="gites-primary-action" onClick={startCreate} disabled={loading}>
              Nouveau gîte
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(event) => void importGitesFromFile(event)}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={() => void exportGites()}
              disabled={exportingGites || importingGites}
            >
              {exportingGites ? "Export..." : "Exporter"}
            </button>
            <button
              type="button"
              className="table-action table-action--neutral gites-tool-button"
              onClick={triggerImport}
              disabled={importingGites || exportingGites}
            >
              {importingGites ? "Import..." : "Importer"}
            </button>
          </div>
          {reordering && <div className="gites-header__status">Enregistrement de l'ordre...</div>}
        </div>
        {notice && <div className="note note--success">{notice}</div>}
        {error && <div className="note">{error}</div>}
        {gites.length > 0 ? (
          <div className="gites-listing-grid">
            {gites.map((gite, index) => {
              const accent = getGiteColor(gite, index);
              const accentStyle = { "--gite-card-accent": accent } as CSSProperties;
              const managerLabel = formatManagerLabel(gite);
              const addressLabel = formatAddressLabel(gite);
              const primaryPhoto =
                (gite.photos ?? []).find((photo) => photo.is_primary) ?? (gite.photos ?? [])[0] ?? null;
              const tags = [
                `${gite.capacite_max} voyageurs`,
                `${gite.nb_adultes_max} adultes max`,
                gite.public_is_published ? "Publié site" : null,
              ].filter((tag): tag is string => Boolean(tag));

              return (
                <article
                  key={gite.id}
                  className={[
                    "gite-listing-card",
                    primaryPhoto ? "gite-listing-card--with-photo" : "",
                    selectedId === gite.id ? "gite-listing-card--selected" : "",
                    draggedId === gite.id ? "gite-listing-card--dragging" : "",
                    dragOverId === gite.id && draggedId !== gite.id ? "gite-listing-card--drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={accentStyle}
                  onDragOver={(event) => handleDragOver(event, gite.id)}
                  onDrop={(event) => void handleDrop(event, gite.id)}
                >
                  <div className="gite-listing-card__visual">
                    {primaryPhoto ? (
                      <img
                        className="gite-listing-card__photo"
                        src={primaryPhoto.url}
                        alt={primaryPhoto.alt || primaryPhoto.title || gite.nom}
                      />
                    ) : null}
                    <div className="gite-listing-card__visual-top">
                      <span className="gite-listing-card__pill">{gite.prefixe_contrat}</span>
                      <button
                        type="button"
                        className="drag-handle gite-listing-card__drag"
                        draggable={!reordering}
                        onDragStart={(event) => handleDragStart(event, gite.id)}
                        onDragEnd={handleDragEnd}
                        aria-label={`Réorganiser ${gite.nom}`}
                        title="Glisser pour réorganiser"
                        disabled={reordering}
                      >
                        ≡
                      </button>
                    </div>
                    <div className="gite-listing-card__visual-content">
                      <div className="gite-listing-card__visual-title">{gite.nom}</div>
                      <div className="gite-listing-card__visual-meta">{managerLabel}</div>
                    </div>
                  </div>

                  <div className="gite-listing-card__body">
                    <div className="gite-listing-card__heading">
                      <p>{addressLabel || "Adresse à compléter"}</p>
                    </div>

                    <div className="gite-listing-card__tags">
                      {tags.map((tag) => (
                        <span key={tag} className="gite-listing-card__tag">
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="gite-listing-card__stats">
                      <div>
                        <strong>{gite.reservations_count ?? 0}</strong>
                        <span>Rés.</span>
                      </div>
                      <div>
                        <strong>{gite.contrats_count ?? 0}</strong>
                        <span>Contrats</span>
                      </div>
                      <div>
                        <strong>{gite.factures_count ?? 0}</strong>
                        <span>Factures</span>
                      </div>
                    </div>

                    <div className="gite-listing-card__actions">
                      <button type="button" className="table-action table-action--primary" onClick={() => selectGite(gite.id)}>
                        Éditer
                      </button>
                      <button type="button" className="table-action table-action--neutral" onClick={() => duplicate(gite.id)}>
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--icon gite-listing-card__delete"
                        onClick={() => remove(gite)}
                        aria-label={`Supprimer ${gite.nom}`}
                        title={`Supprimer ${gite.nom}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path
                            d="M9 3h6m-9 3h12m-9 3v7m3-7v7m3-7v7M8 6l.7 11.2a2 2 0 0 0 2 1.8h2.6a2 2 0 0 0 2-1.8L16 6"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="gites-empty-state">
            <div className="gites-empty-state__title">Aucun gîte pour le moment</div>
            <div className="field-hint">Créez votre premier gîte pour commencer à générer contrats et factures.</div>
          </div>
        )}
      </div>

      {placeholders.length > 0 && (
        <div className="card gites-placeholders-card">
          <div className="gites-placeholders-card__header">
            <div>
              <div className="section-title">Réservations non attribuées</div>
              <div className="field-hint gites-reorder-hint">
                Lorsqu'un gîte importé n'est pas reconnu, un placeholder est créé. Rattachez-le ici.
              </div>
            </div>
            <div className="gites-placeholders-card__count">{placeholders.length} en attente</div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Abréviation</th>
                <th>Libellé</th>
                <th>Réservations</th>
                <th>Gîte cible</th>
                <th className="table-actions-cell">Action</th>
              </tr>
            </thead>
            <tbody>
              {placeholders.map((placeholder) => (
                <tr
                  key={placeholder.id}
                  className={`placeholder-row ${fadingPlaceholderIds.includes(placeholder.id) ? "placeholder-row--fading" : ""}`}
                >
                  <td>{placeholder.abbreviation}</td>
                  <td>{placeholder.label ?? ""}</td>
                  <td>
                    <span className="badge">{placeholder.reservations_count}</span>
                  </td>
                  <td>
                    <select
                      className="placeholder-target-select"
                      value={placeholderTargets[placeholder.id] ?? selectedId ?? ""}
                      onChange={(event) =>
                        setPlaceholderTargets((prev) => ({
                          ...prev,
                          [placeholder.id]: event.target.value,
                        }))
                      }
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      <option value="">Choisir un gîte</option>
                      {gites.map((gite) => (
                        <option key={gite.id} value={gite.id}>
                          {gite.nom} ({gite.prefixe_contrat})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="table-actions-cell">
                    <button
                      type="button"
                      className="table-action table-action--primary"
                      onClick={() => attachPlaceholder(placeholder)}
                      disabled={attachingPlaceholderId === placeholder.id || fadingPlaceholderIds.includes(placeholder.id)}
                    >
                      {attachingPlaceholderId === placeholder.id ? "Rattachement..." : "Rattacher"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div ref={formCardRef} className="gites-editor-layout">
        <aside className="gites-editor-sidebar">
          <div className="gites-editor-sidebar__panel">
            <div className="gites-editor-sidebar__title">{selected ? selected.nom : "Nouveau gîte"}</div>
            <nav className="gites-editor-sidebar__nav" aria-label="Rubriques du formulaire gîte">
              {GITE_EDITOR_SECTION_GROUPS.map((group) => (
                <div key={group.title} className="gites-editor-sidebar__group">
                  <div className="gites-editor-sidebar__group-title">{group.title}</div>
                  <div className="gites-editor-sidebar__group-links">
                    {group.items.map((sectionId) => {
                      const section = GITE_EDITOR_SECTION_BY_ID.get(sectionId);
                      if (!section) return null;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          className={`gites-editor-sidebar__link${
                            activeEditorSection === section.id ? " gites-editor-sidebar__link--active" : ""
                          }`}
                          onClick={() => jumpToEditorSection(section.id)}
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        <div className="gites-editor-content">
          <div className="card gites-editor-card">
            <div className="gites-editor-header">
              <div>
                <div className="gites-editor-header__eyebrow">{selected ? "Édition en cours" : "Nouveau gîte"}</div>
                <div className="section-title">{selected ? `Edition de ${selected.nom}` : "Créer un gîte"}</div>
              </div>
              {gites.length > 0 ? (
                <div className="gites-editor-tabs" role="tablist" aria-label="Changer de gîte">
                  {gites.map((gite) => (
                    <button
                      key={gite.id}
                      type="button"
                      role="tab"
                      aria-selected={selectedId === gite.id}
                      className={`gites-editor-tabs__item${selectedId === gite.id ? " gites-editor-tabs__item--active" : ""}`}
                      onClick={() => setSelectedId(gite.id)}
                    >
                      {gite.nom}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="gites-editor-header__actions">
                <button
                  type="button"
                  className="table-action table-action--primary"
                  onClick={() => void save({ keepOpen: true })}
                  disabled={loading}
                >
                  {loading ? "Enregistrement..." : "Enregistrer cette section"}
                </button>
              </div>
            </div>
          </div>

        <div id="gite-editor-identite" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Identité</div>
          <div className="grid-2">
            <label className="field">
              Nom
              <input value={form.nom} onChange={(e) => handleChange("nom", e.target.value)} />
            </label>
            <label className="field">
              Préfixe contrat
              <input
                value={form.prefixe_contrat}
                onChange={(e) => handleChange("prefixe_contrat", e.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              Gestionnaire
              <select
                value={form.gestionnaire_id}
                onChange={(e) => handleChange("gestionnaire_id", e.target.value)}
              >
                <option value="">Aucun</option>
                {gestionnaires.map((gestionnaire) => (
                  <option key={gestionnaire.id} value={gestionnaire.id}>
                    {gestionnaire.prenom} {gestionnaire.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              ID Airbnb
              <input
                value={form.airbnb_listing_id}
                onChange={(e) => handleChange("airbnb_listing_id", e.target.value)}
                placeholder="48504640"
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-capacite" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Capacité</div>
          <div className="grid-2">
            <label className="field">
              Capacité max
              <input
                type="number"
                value={form.capacite_max}
                onChange={(e) => handleChange("capacite_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'adultes max
              <input
                type="number"
                value={form.nb_adultes_max}
                onChange={(e) => handleChange("nb_adultes_max", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'adultes habituel
              <input
                type="number"
                value={form.nb_adultes_habituel}
                onChange={(e) => handleChange("nb_adultes_habituel", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Nombre d'enfants max
              <input
                type="number"
                min={0}
                value={form.nb_enfants_max}
                onChange={(e) => handleChange("nb_enfants_max", Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-adresse" className="form-section gites-editor-section" hidden={activeEditorSection !== "base-fiche"}>
          <div className="section-subtitle">Adresse</div>
          <div className="grid-2">
            <label className="field">
              Adresse ligne 1
              <input
                value={form.adresse_ligne1}
                onChange={(e) => handleChange("adresse_ligne1", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse ligne 2
              <input
                value={form.adresse_ligne2}
                onChange={(e) => handleChange("adresse_ligne2", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-identite" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">Identité & publication</div>
          <div className="grid-2">
            <label className="field">
              Slug public
              <input
                value={form.public_slug}
                onChange={(e) => handleChange("public_slug", e.target.value.toLowerCase())}
                placeholder="gite-le-liberte"
              />
            </label>
            <label className="field">
              Titre public
              <input value={form.public_title} onChange={(e) => handleChange("public_title", e.target.value)} />
            </label>
          </div>
          <div className="rules-grid" style={{ marginTop: 12 }}>
            <div className="rule-card">
              <div>
                <div className="rule-title">Publication site</div>
                <div className="rule-sub">Rendre ce gîte disponible dans l'API publique.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.public_is_published}
                  onChange={(e) => handleChange("public_is_published", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div id="gite-editor-site-textes" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">Textes</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Accroche courte
              <textarea
                value={form.public_summary}
                onChange={(e) => handleChange("public_summary", e.target.value)}
                rows={2}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Description longue
              <textarea
                value={form.public_description}
                onChange={(e) => handleChange("public_description", e.target.value)}
                rows={6}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-seo" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-presentation"}>
          <div className="section-subtitle">SEO</div>
          <div className="grid-2">
            <label className="field">
              Titre SEO
              <input value={form.public_seo_title} onChange={(e) => handleChange("public_seo_title", e.target.value)} />
            </label>
            <label className="field">
              Description SEO
              <input
                value={form.public_seo_description}
                onChange={(e) => handleChange("public_seo_description", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-site-structure" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-donnees"}>
          <div className="section-subtitle">Équipement et infos</div>
          <div className="grid-2">
            <div className="structured-panel">
              <div className="structured-panel__title">Contenu du site</div>
              <StructuredContentEditor
                value={form.public_structured_content}
                onChange={(nextValue) => handleChange("public_structured_content", nextValue)}
                excludeSectionIds={["pieces-couchages"]}
              />
            </div>
          </div>
        </div>

        <div id="gite-editor-site-chambres" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-chambres"}>
          <div className="grid-2">
            <div className="structured-panel structured-panel--bare">
              <StructuredContentEditor
                value={form.public_structured_content}
                onChange={(nextValue) => handleChange("public_structured_content", nextValue)}
                sectionIds={["pieces-couchages"]}
                showToolbar={false}
              />
            </div>
          </div>
        </div>

        <div id="gite-editor-photos" className="form-section gites-editor-section" hidden={activeEditorSection !== "web-photos"}>
          <div className="section-subtitle">Photos</div>
          {!selected ? (
            <div className="field-hint">Enregistrez le gîte avant d'ajouter des photos.</div>
          ) : (
            <>
              <div className="gite-photo-toolbar">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={(event) => void uploadPhoto(event)}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="table-action table-action--primary"
                  onClick={triggerPhotoUpload}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? "Upload..." : "Ajouter une photo"}
                </button>
                <span className="field-hint">JPG, PNG, WEBP ou AVIF. 12 Mo max.</span>
              </div>
              {(selected.photos ?? []).length > 0 ? (
                <div className="gite-photo-grid">
                  {(selected.photos ?? []).map((photo, index, photos) => {
                    const draft = photoDrafts[photo.id] ?? {
                      title: photo.title ?? "",
                      alt: photo.alt ?? "",
                      credit: photo.credit ?? "",
                    };
                    const busy = savingPhotoId === photo.id;
                    return (
                      <article key={photo.id} className="gite-photo-card">
                        <div className="gite-photo-card__image-wrap">
                          <img className="gite-photo-card__image" src={photo.url} alt={draft.alt || photo.alt || selected.nom} />
                          <div className="gite-photo-card__badges">
                            {photo.is_primary ? <span>Principale</span> : null}
                            {photo.is_public ? <span>Publique</span> : <span>Masquée</span>}
                          </div>
                        </div>
                        <div className="gite-photo-card__fields">
                          <label className="field">
                            Titre
                            <input
                              value={draft.title}
                              onChange={(event) => updatePhotoDraft(photo.id, "title", event.target.value)}
                            />
                          </label>
                          <label className="field">
                            Texte alternatif
                            <input
                              value={draft.alt}
                              onChange={(event) => updatePhotoDraft(photo.id, "alt", event.target.value)}
                            />
                          </label>
                          <label className="field">
                            Crédit
                            <input
                              value={draft.credit}
                              onChange={(event) => updatePhotoDraft(photo.id, "credit", event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="gite-photo-card__actions">
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void movePhoto(photo.id, -1)}
                            disabled={busy || index === 0}
                          >
                            Monter
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void movePhoto(photo.id, 1)}
                            disabled={busy || index === photos.length - 1}
                          >
                            Descendre
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void savePhoto(photo, { is_primary: true })}
                            disabled={busy || photo.is_primary}
                          >
                            Principale
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void savePhoto(photo, { is_public: !photo.is_public })}
                            disabled={busy}
                          >
                            {photo.is_public ? "Masquer" : "Publier"}
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--primary"
                            onClick={() => void savePhoto(photo)}
                            disabled={busy}
                          >
                            Enregistrer
                          </button>
                          <button
                            type="button"
                            className="table-action table-action--neutral"
                            onClick={() => void deletePhoto(photo)}
                            disabled={busy}
                          >
                            Supprimer
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="gites-empty-state gites-empty-state--compact">
                  <div className="gites-empty-state__title">Aucune photo</div>
                  <div className="field-hint">Ajoutez la première image pour alimenter la galerie du site.</div>
                </div>
              )}
            </>
          )}
        </div>

        <div id="gite-editor-proprietaires" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-contact"}>
          <div className="section-subtitle">Propriétaires</div>
          <div className="grid-2">
            <label className="field">
              Propriétaires
              <input
                value={form.proprietaires_noms}
                onChange={(e) => handleChange("proprietaires_noms", e.target.value)}
              />
            </label>
            <label className="field">
              Adresse propriétaires
              <input
                value={form.proprietaires_adresse}
                onChange={(e) => handleChange("proprietaires_adresse", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-contact" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-contact"}>
          <div className="section-subtitle">Contact</div>
          <div className="grid-2">
            <label className="field">
              Site web
              <input value={form.site_web} onChange={(e) => handleChange("site_web", e.target.value)} />
            </label>
            <label className="field">
              Email
              <input value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
            </label>
            <label className="field">
              Téléphones (séparés par des virgules)
              <input value={form.telephones} onChange={(e) => handleChange("telephones", e.target.value)} />
            </label>
          </div>
        </div>

        <div id="gite-editor-fiscalite" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-finance"}>
          <div className="section-subtitle">Fiscalité</div>
          <div className="grid-2">
            <label className="field">
              Taxe de séjour / personne / nuit
              <input
                type="number"
                step="0.01"
                value={form.taxe_sejour_par_personne_par_nuit}
                onChange={(e) => handleChange("taxe_sejour_par_personne_par_nuit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Prix électricité / kWh
              <input
                type="number"
                step="0.0001"
                min={0}
                value={form.electricity_price_per_kwh}
                onChange={(e) =>
                  handleChange("electricity_price_per_kwh", Number(e.target.value))
                }
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-banque" className="form-section gites-editor-section" hidden={activeEditorSection !== "gestion-finance"}>
          <div className="section-subtitle">Banque</div>
          <div className="grid-2">
            <label className="field">
              IBAN
              <input value={form.iban} onChange={(e) => handleChange("iban", e.target.value)} />
            </label>
            <label className="field">
              BIC
              <input value={form.bic} onChange={(e) => handleChange("bic", e.target.value)} />
            </label>
            <label className="field">
              Titulaire
              <input value={form.titulaire} onChange={(e) => handleChange("titulaire", e.target.value)} />
            </label>
          </div>
        </div>

        <div id="gite-editor-services" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-services"}>
          <div className="section-subtitle">Services</div>
          <div className="grid-2">
            <label className="field">
              Draps / lit (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_draps_par_lit}
                onChange={(e) => handleChange("options_draps_par_lit", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Linge toilette / personne (par séjour)
              <input
                type="number"
                step={1}
                value={form.options_linge_toilette_par_personne}
                onChange={(e) => handleChange("options_linge_toilette_par_personne", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Ménage forfait
              <input
                type="number"
                step={1}
                value={form.options_menage_forfait}
                onChange={(e) => handleChange("options_menage_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Départ tardif forfait
              <input
                type="number"
                step={1}
                value={form.options_depart_tardif_forfait}
                onChange={(e) => handleChange("options_depart_tardif_forfait", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chiens / nuit
              <input
                type="number"
                step={1}
                value={form.options_chiens_forfait}
                onChange={(e) => handleChange("options_chiens_forfait", Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-horaires" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-services"}>
          <div className="section-subtitle">Horaires</div>
          <div className="grid-2">
            <label className="field">
              Heure d'arrivée par défaut
              <input
                type="time"
                value={form.heure_arrivee_defaut}
                onChange={(e) => handleChange("heure_arrivee_defaut", e.target.value)}
              />
            </label>
            <label className="field">
              Heure de départ par défaut
              <input
                type="time"
                value={form.heure_depart_defaut}
                onChange={(e) => handleChange("heure_depart_defaut", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-garanties" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-tarifs"}>
          <div className="section-subtitle">Garanties & arrhes</div>
          <div className="grid-2">
            <label className="field">
              Caution par défaut
              <input
                type="number"
                step={1}
                value={form.caution_montant_defaut}
                onChange={(e) => handleChange("caution_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Chèque ménage par défaut
              <input
                type="number"
                step={1}
                value={form.cheque_menage_montant_defaut}
                onChange={(e) => handleChange("cheque_menage_montant_defaut", Number(e.target.value))}
              />
            </label>
            <label className="field">
              Arrhes par défaut (%)
              <input
                type="number"
                step="0.1"
                value={Math.round((form.arrhes_taux_defaut ?? 0) * 1000) / 10}
                onChange={(e) => handleChange("arrhes_taux_defaut", Number(e.target.value) / 100)}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-caracteristiques" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-regles"}>
          <div className="section-subtitle">Caractéristiques</div>
          <div className="grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Caractéristiques (1 ligne = 1 bullet PDF)
              <textarea
                value={form.caracteristiques}
                onChange={(e) => handleChange("caracteristiques", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-tarifs" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-tarifs"}>
          <div className="section-subtitle">Tarifs de nuit</div>
          <div className="grid-2">
            <label className="field">
              Prix/nuit (liste séparée par virgules ou retours ligne)
              <textarea
                value={form.prix_nuit_liste}
                onChange={(e) => handleChange("prix_nuit_liste", e.target.value)}
                rows={3}
              />
            </label>
          </div>
        </div>

        <div id="gite-editor-regles" className="form-section gites-editor-section" hidden={activeEditorSection !== "sejour-regles"}>
          <div className="section-subtitle">Règles du gîte</div>
          <div className="rules-grid">
            <div className="rule-card">
              <div>
                <div className="rule-title">Animaux acceptés</div>
                <div className="rule-sub">Autoriser la présence d'animaux dans le gîte.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_animaux_acceptes}
                  onChange={(e) => handleChange("regle_animaux_acceptes", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Bois première flambée</div>
                <div className="rule-sub">Inclure du bois pour l'arrivée des locataires.</div>
              </div>
              <label className="switch switch--pink">
                <input
                  type="checkbox"
                  checked={form.regle_bois_premiere_flambee}
                  onChange={(e) => handleChange("regle_bois_premiere_flambee", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
            <div className="rule-card">
              <div>
                <div className="rule-title">Info tiers personnes</div>
                <div className="rule-sub">Informer des passages éventuels de tiers.</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={form.regle_tiers_personnes_info}
                  onChange={(e) => handleChange("regle_tiers_personnes_info", e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" onClick={save} disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer"}
          </button>
          {selected && (
            <button type="button" className="secondary" onClick={startCreate}>
              Annuler
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default GitesPage;
