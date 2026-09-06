import { normalizeBookedGiteContentSections } from "./bookedGiteContent.js";
import { z } from "zod";
import { fromJsonString } from "../utils/jsonFields.js";

export const giteLanguages = ["fr", "en", "es"] as const;
export type GiteLanguage = typeof giteLanguages[number];
export const resolveGiteLanguage = (value: unknown): GiteLanguage => {
  const language = typeof value === "string" ? value.toLowerCase().split(/[-_]/)[0] : "fr";
  return giteLanguages.includes(language as GiteLanguage) ? language as GiteLanguage : "fr";
};
const text = (max?: number) => (max ? z.string().trim().max(max) : z.string().trim()).nullable().optional();
const translationSchema = z.object({
  public_title: text(140), public_summary: text(500), public_description: text(),
  public_technical_description: text(), public_seo_title: text(70), public_seo_description: text(180),
  caracteristiques: text(),
  public_structured_content: z.array(z.object({
    id: z.string(), titre: z.string(), groupes: z.array(z.object({
      id: z.string(), titre: z.string(), type: z.enum(["rubrique", "chambre"]).optional(),
      items: z.array(z.union([z.string(), z.object({kind: z.literal("bed"), type: z.enum(["single", "double", "queen", "king", "bunk", "sofa_bed", "baby"]), count: z.number().int().positive()})])),
      note: z.string().optional(),
    })),
  })).nullable().optional(),
  public_equipment: z.unknown().optional(), public_rooms: z.unknown().optional(),
  public_practical_info: z.unknown().optional(), public_location_info: z.unknown().optional(),
  photos: z.record(z.object({ title: text(), alt: text() }).strict()).optional(),
}).strict();
export const giteTranslationsSchema = z.object({en: translationSchema.optional(), es: translationSchema.optional()}).strict().nullable().optional();

// French remains the canonical content, including all non-linguistic data.
export const localizeGite = <T extends Record<string, any>>(source: T, language: GiteLanguage): T => {
  const translations = fromJsonString<Record<string, any>>(source.public_translations, {}) ?? {};
  const candidate = language === "fr" ? undefined : translations[language];
  const parsed = translationSchema.safeParse(candidate);
  if (!parsed.success) return source;
  const { photos, ...fields } = parsed.data;
  const translated = Object.fromEntries(Object.entries(fields).filter(([, value]) =>
    value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0)
  ));
  if (parsed.data.public_structured_content?.length) {
    const rawSections = fromJsonString<unknown>(source.public_structured_content, null);
    const canonical = translationSchema.shape.public_structured_content.safeParse(rawSections);
    const sections = canonical.success && canonical.data?.length ? canonical.data : normalizeBookedGiteContentSections(source);
    translated.public_structured_content = sections.map(section => {
      const localized = parsed.data.public_structured_content?.find(row => row.id === section.id);
      return {...section, titre: localized?.titre || section.titre, groupes: section.groupes.map(group => {
        const localizedGroup = localized?.groupes.find(row => row.id === group.id);
        return {...group, titre: localizedGroup?.titre || group.titre, note: localizedGroup?.note || group.note,
          items: group.items.map((item, index) => typeof item === "string" && typeof localizedGroup?.items[index] === "string"
            ? localizedGroup.items[index] || item : item)};
      })};
    });
  }
  return { ...source, ...translated, ...(Array.isArray(source.photos) ? {
    photos: source.photos.map((photo: any) => ({...photo,
      title: photos?.[photo.id]?.title || photo.title,
      alt: photos?.[photo.id]?.alt || photo.alt,
    })),
  } : {}) };
};
