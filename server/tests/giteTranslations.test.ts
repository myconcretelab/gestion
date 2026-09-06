import assert from "node:assert/strict";
import test from "node:test";
import { giteTranslationsSchema, localizeGite, resolveGiteLanguage } from "../src/services/giteTranslations.ts";
import prisma from "../src/db/prisma.ts";
import bookedRouter from "../src/routes/booked.ts";
import publicRouter from "../src/routes/publicGites.ts";

const source = {
  id: "g1", nom: "La Grée", public_title: "Le gîte", public_summary: "Bienvenue", public_slug: "la-gree",
  public_description: "Description française", capacite_max: 4,
  photos: [{id: "p1", title: "Cuisine", alt: "La cuisine", url: "https://example.com/photo.jpg"}],
  public_translations: {en: {public_title: "The cottage", public_summary: "", photos: {p1: {alt: "The kitchen"}}}, es: {public_title: "La casa rural"}},
};
test("language resolution accepts regional locales and defaults safely", () => {
  for (const value of [undefined, "de", [], ""]) assert.equal(resolveGiteLanguage(value), "fr");
  assert.equal(resolveGiteLanguage("EN_gb"), "en");
  assert.equal(resolveGiteLanguage("es-ES"), "es");
});
test("translations preserve French fallback, shared data and photo metadata", () => {
  const localized = localizeGite(source, "en");
  assert.equal(localized.public_title, "The cottage");
  assert.equal(localized.public_summary, "Bienvenue");
  assert.equal(localized.capacite_max, 4);
  assert.equal(localized.photos[0].alt, "The kitchen");
  assert.equal(localized.photos[0].title, "Cuisine");
  assert.equal(source.photos[0].alt, "La cuisine");
  assert.equal(localizeGite(source, "fr"), source);
  assert.equal(localizeGite({...source, public_translations: JSON.stringify(source.public_translations)}, "es").public_title, "La casa rural");
});
test("validation rejects unsupported languages, oversized SEO and shared financial fields", () => {
  assert.equal(giteTranslationsSchema.safeParse({de: {}}).success, false);
  assert.equal(giteTranslationsSchema.safeParse({en: {public_seo_title: "x".repeat(71)}}).success, false);
  assert.equal(giteTranslationsSchema.safeParse({es: {capacite_max: 100}}).success, false);
});
test("both public and Booked endpoints deliver the requested language without exposing translation storage", async () => {
  const originalUnique = prisma.gite.findUnique;
  const originalFirst = prisma.gite.findFirst;
  const originalMany = prisma.gite.findMany;
  try {
    prisma.gite.findUnique = async () => source as any;
    prisma.gite.findFirst = async () => source as any;
    prisma.gite.findMany = async () => [source] as any;
    for (const [router, path, field] of [[bookedRouter, "/gites/:id/content", "public_title"], [publicRouter, "/:slug", "name"], [publicRouter, "/", "name"]] as const) {
      const handler = router.stack.find((layer: any) => layer.route?.path === path && layer.route?.methods.get)?.route.stack[0].handle;
      assert.ok(handler);
      for (const [lang, title] of [["fr", "Le gîte"], ["en", "The cottage"], ["es", "La casa rural"]]) {
        let result: any;
        await handler({params: {id: "g1", slug: "la-gree"}, query: {lang}}, {json: (body: any) => {result = body;}}, (error: any) => {if (error) throw error;});
        const body = Array.isArray(result) ? result[0] : result;
        assert.equal(body[field], title);
        assert.equal(body.language, lang);
        assert.equal(body.public_translations, undefined);
      }
    }
  } finally {
    prisma.gite.findUnique = originalUnique;
    prisma.gite.findFirst = originalFirst;
    prisma.gite.findMany = originalMany;
  }
});

test("translated sections retain canonical IDs, new French groups and bed capacities", () => {
  const sections = [{id: "s", titre: "Étage", groupes: [{id: "r", titre: "Chambre", type: "chambre", note: "Vue", items: [{kind: "bed", type: "queen", count: 1}]}, {id: "new", titre: "Nouveau", items: ["Four"]}]}];
  const translated = [{id: "s", titre: "Upstairs", groupes: [{id: "r", titre: "Bedroom", type: "chambre", note: "", items: [{kind: "bed", type: "king", count: 8}]}]}];
  const localized = localizeGite({public_structured_content: JSON.stringify(sections), public_translations: {en: {public_structured_content: translated}}}, "en");
  const result = localized.public_structured_content as any;
  assert.equal(result[0].titre, "Upstairs");
  assert.equal(result[0].groupes[0].titre, "Bedroom");
  assert.deepEqual(result[0].groupes[0].items, sections[0].groupes[0].items);
  assert.equal(result[0].groupes[0].note, "Vue");
  assert.equal(result[0].groupes[1].id, "new");
});
