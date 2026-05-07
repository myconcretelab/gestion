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
