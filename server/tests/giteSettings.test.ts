import assert from "node:assert/strict";
import test from "node:test";
import prisma from "../src/db/prisma.js";
import router from "../src/routes/gites.js";

const settings = {
  version: 1,
  classified: true,
  stars: 1,
  included: true,
  fixed_rate: 0.8,
  percentage: 0,
  cap: 0,
  additional_percentage: 0,
  accommodation_vat_rate: 0,
  authority: "Collectivité exemple",
  effective_from: "2026-11-02",
};
const payload = {
  nom: "Le Jardin",
  prefixe_contrat: "JA",
  adresse_ligne1: "1 rue Exemple",
  capacite_max: 4,
  nb_adultes_max: 4,
  nb_adultes_habituel: 2,
  proprietaires_noms: "Camille Exemple",
  proprietaires_adresse: "2 rue Exemple",
  iban: "FR761234",
  titulaire: "Camille Exemple",
  taxe_sejour_par_personne_par_nuit: 0.6,
  taxe_sejour_config: settings,
  public_summary: "Un séjour au calme",
  telephones: ["06 12 34 56 78", "02 99 00 00 00"],
};

const call = async (method: string, routePath: string, body?: unknown) => {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === routePath && item.route.methods[method],
  );
  assert.ok(layer, `Route introuvable : ${method} ${routePath}`);
  const response = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      return this;
    },
  };
  let error: unknown;
  await layer.route.stack[0].handle(
    { params: { id: "gite-test" }, body },
    response,
    (err: unknown) => {
      error = err;
    },
  );
  return { ...response, error };
};

for (const databaseUrl of [
  "file:/tmp/gite-settings-test.db",
  "postgresql://unused/test",
]) {
  test(`les réglages du gîte sont enregistrés et relus (${databaseUrl.split(":")[0]})`, async (t) => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const original = {
      aggregate: prisma.gite.aggregate,
      create: prisma.gite.create,
      update: prisma.gite.update,
      findMany: prisma.gite.findMany,
    };
    t.after(() => {
      Object.assign(prisma.gite, original);
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    });
    let stored: any;
    const persist = ({ data }: any) => {
      // Prisma expects text for the tax column on both database providers.
      if (
        data.taxe_sejour_config !== undefined &&
        data.taxe_sejour_config !== null
      ) {
        assert.equal(typeof data.taxe_sejour_config, "string");
        assert.deepEqual(JSON.parse(data.taxe_sejour_config), settings);
      }
      assert.equal(
        typeof data.telephones,
        databaseUrl.startsWith("file:") ? "string" : "object",
      );
      stored = { id: "gite-test", ...stored, ...data };
      return stored;
    };
    prisma.gite.aggregate = (async () => ({ _max: { ordre: null } })) as any;
    prisma.gite.create = (async (args: any) => persist(args)) as any;
    prisma.gite.update = (async (args: any) => persist(args)) as any;
    prisma.gite.findMany = (async () => [stored]) as any;

    const created = await call("post", "/", payload);
    assert.ifError(created.error);
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.body.taxe_sejour_config, settings);

    const updated = await call("put", "/:id", {
      ...payload,
      public_summary: "Une nouvelle accroche",
      telephones: ["06 98 76 54 32"],
    });
    assert.ifError(updated.error);
    const reloaded = await call("get", "/");
    assert.ifError(reloaded.error);
    assert.deepEqual(reloaded.body[0].taxe_sejour_config, settings);
    assert.equal(reloaded.body[0].public_summary, "Une nouvelle accroche");
    assert.deepEqual(reloaded.body[0].telephones, ["06 98 76 54 32"]);

    // Clients omitting tax settings preserve the existing configuration.
    const { taxe_sejour_config: _tax, ...withoutTax } = payload;
    const preserved = await call("put", "/:id", withoutTax);
    assert.ifError(preserved.error);
    assert.deepEqual(preserved.body.taxe_sejour_config, settings);
    const cleared = await call("put", "/:id", {
      ...payload,
      taxe_sejour_config: null,
    });
    assert.ifError(cleared.error);
    assert.equal(stored.taxe_sejour_config, null);
    assert.equal(cleared.body.taxe_sejour_config, null);

    const invalid = await call("put", "/:id", {
      ...payload,
      taxe_sejour_config: {
        ...settings,
        classified: false,
        percentage: 0,
        cap: 0,
      },
    });
    assert.ok(invalid.error);
    assert.equal(stored.taxe_sejour_config, null);
  });
}
