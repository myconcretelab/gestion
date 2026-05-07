import { fromJsonString } from "../utils/jsonFields.js";

type BedType = "single" | "double" | "queen" | "king" | "bunk" | "sofa_bed" | "baby";

export type BookedGiteContentItem = string | { kind: "bed"; type: BedType; count: number };

export type BookedGiteContentGroup = {
  id: string;
  titre: string;
  items: BookedGiteContentItem[];
  note?: string;
};

export type BookedGiteContentSection = {
  id: string;
  titre: string;
  groupes: BookedGiteContentGroup[];
};

export type BookedGiteContentSource = {
  public_structured_content?: unknown;
  public_equipment?: unknown;
  public_rooms?: unknown;
};

const BED_TYPES = new Set<BedType>(["single", "double", "queen", "king", "bunk", "sofa_bed", "baby"]);
const BED_SECTION_ID = "pieces-couchages";

const parseStoredJson = (value: unknown) => fromJsonString<unknown>(value, value ?? null);

const textValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const createFallbackId = (prefix: string, index: number) => `${prefix}-${index + 1}`;

const normalizeBedItem = (value: unknown): BookedGiteContentItem | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "bed") return null;
  const type = typeof row.type === "string" && BED_TYPES.has(row.type as BedType) ? (row.type as BedType) : "queen";
  const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.max(1, Math.round(row.count)) : 1;
  return { kind: "bed", type, count };
};

const normalizeItems = (items: unknown, sectionId: string): BookedGiteContentItem[] => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (sectionId === BED_SECTION_ID) {
        const bed = normalizeBedItem(item);
        if (bed) return bed;
      }
      return textValue(item);
    })
    .filter((item): item is BookedGiteContentItem => (typeof item === "string" ? item.length > 0 : true));
};

const normalizeStructuredContent = (value: unknown): BookedGiteContentSection[] => {
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((section, sectionIndex): BookedGiteContentSection | null => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return null;
      const sectionRow = section as Record<string, unknown>;
      const sectionId = textValue(sectionRow.id) || createFallbackId("section", sectionIndex);
      const sectionTitle = textValue(sectionRow.titre ?? sectionRow.title ?? sectionRow.nom) || `Section ${sectionIndex + 1}`;
      const rawGroups = sectionRow.groupes ?? sectionRow.groups ?? sectionRow.items ?? [];
      const groupes = Array.isArray(rawGroups)
        ? rawGroups
            .map((group, groupIndex): BookedGiteContentGroup | null => {
              if (!group || typeof group !== "object" || Array.isArray(group)) return null;
              const groupRow = group as Record<string, unknown>;
              const items = normalizeItems(groupRow.items ?? groupRow.lignes ?? groupRow.values ?? [], sectionId);
              const note = textValue(groupRow.note ?? groupRow.notes);
              return {
                id: textValue(groupRow.id) || `${sectionId}-group-${groupIndex + 1}`,
                titre: textValue(groupRow.titre ?? groupRow.title ?? groupRow.nom) || `Rubrique ${groupIndex + 1}`,
                items,
                ...(note ? { note } : {}),
              };
            })
            .filter((group): group is BookedGiteContentGroup => Boolean(group))
        : [];

      return { id: sectionId, titre: sectionTitle, groupes };
    })
    .filter((section): section is BookedGiteContentSection => Boolean(section));
};

const normalizeEquipmentLegacy = (value: unknown): BookedGiteContentSection | null => {
  const parsed = parseStoredJson(value);
  const groups: BookedGiteContentGroup[] = [];

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    Object.entries(parsed as Record<string, unknown>).forEach(([title, rawItems], index) => {
      const items = Array.isArray(rawItems)
        ? rawItems.map(textValue).filter(Boolean)
        : textValue(rawItems).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
      groups.push({ id: `equipements-${index + 1}`, titre: title || `Équipements ${index + 1}`, items });
    });
  } else if (Array.isArray(parsed)) {
    groups.push({ id: "equipements-1", titre: "Général", items: parsed.map(textValue).filter(Boolean) });
  } else {
    const text = textValue(parsed);
    if (text) groups.push({ id: "equipements-1", titre: "Général", items: [text] });
  }

  return groups.length > 0 ? { id: "equipements", titre: "Équipements", groupes: groups } : null;
};

const normalizeRoomsLegacy = (value: unknown): BookedGiteContentSection | null => {
  const parsed = parseStoredJson(value);
  const groups: BookedGiteContentGroup[] = [];

  if (Array.isArray(parsed)) {
    parsed.forEach((room, index) => {
      if (room && typeof room === "object" && !Array.isArray(room)) {
        const row = room as Record<string, unknown>;
        const rawBeds = row.couchages ?? row.lits ?? row.beds ?? [];
        const items = Array.isArray(rawBeds)
          ? rawBeds.map(textValue).filter(Boolean)
          : textValue(rawBeds).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
        const note = textValue(row.notes ?? row.description);
        groups.push({
          id: `pieces-${index + 1}`,
          titre: textValue(row.nom ?? row.name ?? row.titre ?? row.title) || `Pièce ${index + 1}`,
          items,
          ...(note ? { note } : {}),
        });
      } else {
        const title = textValue(room);
        if (title) groups.push({ id: `pieces-${index + 1}`, titre: title, items: [] });
      }
    });
  } else if (parsed && typeof parsed === "object") {
    Object.entries(parsed as Record<string, unknown>).forEach(([title, rawBeds], index) => {
      const items = Array.isArray(rawBeds)
        ? rawBeds.map(textValue).filter(Boolean)
        : textValue(rawBeds).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
      groups.push({ id: `pieces-${index + 1}`, titre: title || `Pièce ${index + 1}`, items });
    });
  }

  return groups.length > 0 ? { id: BED_SECTION_ID, titre: "Chambres et couchages", groupes: groups } : null;
};

export const normalizeBookedGiteContentSections = (source: BookedGiteContentSource): BookedGiteContentSection[] => {
  const structured = normalizeStructuredContent(source.public_structured_content);
  if (structured.length > 0) return structured;

  return [normalizeEquipmentLegacy(source.public_equipment), normalizeRoomsLegacy(source.public_rooms)].filter(
    (section): section is BookedGiteContentSection => Boolean(section)
  );
};
