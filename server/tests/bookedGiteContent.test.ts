import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.ts";
import bookedRouter from "../src/routes/booked.ts";
import { normalizeBookedGiteContentSections } from "../src/services/bookedGiteContent.ts";

const getRouteHandler = (router: any, method: "get", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method]
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

const createMockResponse = () => ({
  statusCode: 200,
  body: null as unknown,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  },
});

test("normalizeBookedGiteContentSections privilégie le JSON structuré", () => {
  const sections = normalizeBookedGiteContentSections({
    public_structured_content: JSON.stringify([
      {
        id: "equipements",
        titre: "Équipements",
        groupes: [{ id: "equipements-general", titre: "Général", items: ["Wifi", "Poêle"] }],
      },
      {
        id: "pieces-couchages",
        titre: "Chambres et couchages",
        groupes: [
          {
            id: "pieces-chambre-1",
            titre: "Chambre 1",
            items: [{ kind: "bed", type: "queen", count: 2 }],
            note: "Étage",
          },
        ],
      },
    ]),
    public_equipment: JSON.stringify({ Ancien: ["Ignoré"] }),
  });

  assert.equal(sections.length, 2);
  assert.equal(sections[0].groupes[0].items[0], "Wifi");
  assert.deepEqual(sections[1].groupes[0].items[0], { kind: "bed", type: "queen", count: 2 });
});

test("normalizeBookedGiteContentSections utilise les champs legacy en fallback", () => {
  const sections = normalizeBookedGiteContentSections({
    public_structured_content: null,
    public_equipment: JSON.stringify({ Cuisine: ["Four", "Lave-vaisselle"] }),
    public_rooms: JSON.stringify([{ nom: "Chambre 1", couchages: ["Lit 160"], notes: "Rez-de-chaussée" }]),
  });

  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, "equipements");
  assert.deepEqual(sections[0].groupes[0].items, ["Four", "Lave-vaisselle"]);
  assert.equal(sections[0].groupes[1].type, "chambre");
  assert.equal(sections[0].groupes[1].titre, "Chambre 1");
  assert.equal(sections[0].groupes[1].note, "Rez-de-chaussée");
});

test("normalizeBookedGiteContentSections retourne une liste vide sans contenu", () => {
  assert.deepEqual(normalizeBookedGiteContentSections({}), []);
});

test("GET /gites/:id/content retourne 404 pour un gîte introuvable", async () => {
  const originalFindUnique = prisma.gite.findUnique;
  try {
    prisma.gite.findUnique = async () => null;
    const handler = getRouteHandler(bookedRouter, "get", "/gites/:id/content");
    const response = createMockResponse();
    let nextError: unknown = null;

    await handler({ params: { id: "missing" } }, response, (error) => {
      nextError = error ?? null;
    });

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, { error: "Gîte introuvable." });
  } finally {
    prisma.gite.findUnique = originalFindUnique;
  }
});

test("GET /gites/:id/content expose les variables publiques du gîte", async () => {
  const originalFindUnique = prisma.gite.findUnique;
  try {
    prisma.gite.findUnique = async () =>
      ({
        id: "g1",
        nom: "Le Grand Gîte",
        prefixe_contrat: "grand",
        adresse_ligne1: "1 rue des Pins",
        adresse_ligne2: "29100 Douarnenez",
        public_title: "Grand gîte",
        public_summary: "Résumé",
        public_description: "Description",
        public_structured_content: null,
        public_equipment: null,
        public_rooms: null,
        options_draps_par_lit: 15,
        options_linge_toilette_par_personne: 5,
        options_menage_forfait: 45,
        options_depart_tardif_forfait: 0,
        options_chiens_forfait: 15,
        heure_arrivee_defaut: "17:00",
        heure_depart_defaut: "12:00",
        prix_nuit_basse_saison: 70,
        prix_nuit_haute_saison: 75,
      }) as any;

    const handler = getRouteHandler(bookedRouter, "get", "/gites/:id/content");
    const response = createMockResponse();
    let nextError: unknown = null;

    await handler({ params: { id: "g1" } }, response, (error) => {
      nextError = error ?? null;
    });

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as any).adresse_complete, "1 rue des Pins, 29100 Douarnenez");
    assert.deepEqual((response.body as any).variables, {
      prix_nuit_basse_saison: "70 €",
      prix_nuit_haute_saison: "75 €",
      adresse_complete: "1 rue des Pins, 29100 Douarnenez",
      service_draps_par_lit: "15 € / lit",
      service_linge_toilette_par_personne: "5 € / personne",
      service_menage_forfait: "45 €",
      service_depart_tardif_forfait: "0 €",
      service_chiens_par_nuit: "15 € / nuit",
      horaire_arrivee: "17h00",
      horaire_depart: "12h00",
    });
  } finally {
    prisma.gite.findUnique = originalFindUnique;
  }
});
