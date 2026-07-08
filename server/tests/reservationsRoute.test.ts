import assert from "node:assert/strict";
import test from "node:test";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  end: () => MockResponse;
};

const createMockResponse = (): MockResponse => {
  const response: MockResponse = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return response;
};

const getRouteHandler = (router: any, method: "get" | "post", routePath: string) => {
  const layer = router.stack.find(
    (item: any) => item.route?.path === routePath && item.route?.methods?.[method],
  );
  assert.ok(layer, `Route introuvable: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[0].handle as (req: any, res: any, next: (err?: unknown) => void) => Promise<void>;
};

test("POST /reservations conserve un séjour qui chevauche deux années en une seule réservation", async () => {
  const envBackup = {
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.env.DATABASE_URL = "";

  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;
  const original = {
    giteFindUnique: prisma.gite.findUnique,
    reservationFindMany: prisma.reservation.findMany,
    reservationCreate: prisma.reservation.create,
    transaction: prisma.$transaction,
  };

  const createdRows: any[] = [];

  try {
    prisma.gite.findUnique = async () => ({ id: "g1", airbnb_listing_id: null });
    prisma.reservation.findMany = async () => [];
    prisma.reservation.create = async ({ data }: any) => {
      createdRows.push(data);
      return {
        id: `r${createdRows.length}`,
        ...data,
        gite: { id: "g1", nom: "Gîte", prefixe_contrat: "G", ordre: 1 },
        placeholder: null,
      };
    };
    prisma.$transaction = async (operations: any) => {
      if (Array.isArray(operations)) return Promise.all(operations);
      return operations(prisma);
    };

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const postReservation = getRouteHandler(reservationsRouterModule.default, "post", "/");
    const response = createMockResponse();
    let nextError: unknown = null;

    await postReservation(
      {
        body: {
          gite_id: "g1",
          hote_nom: "Client réveillon",
          date_entree: "2026-12-29",
          date_sortie: "2027-01-03",
          nb_adultes: 2,
          nb_enfants_2_17: 0,
          prix_total: 1750,
          price_driver: "total",
          source_paiement: "A définir",
          frais_optionnels_montant: 0,
          frais_optionnels_declares: false,
          options: {},
        },
        params: {},
        query: {},
      },
      response,
      (err) => {
        nextError = err ?? null;
      },
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 201);
    assert.equal(createdRows.length, 1);
    assert.equal(createdRows[0].nb_nuits, 5);
    assert.equal(Number(createdRows[0].prix_total), 1750);
    assert.equal((response.body as any).created_reservations, undefined);
  } finally {
    prisma.gite.findUnique = original.giteFindUnique;
    prisma.reservation.findMany = original.reservationFindMany;
    prisma.reservation.create = original.reservationCreate;
    prisma.$transaction = original.transaction;
    if (envBackup.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = envBackup.DATABASE_URL;
  }
});

test("GET /reservations/prefill/:id agrège les anciens segments d'un même séjour", async () => {
  const envBackup = {
    DATABASE_URL: process.env.DATABASE_URL,
  };
  process.env.DATABASE_URL = "";

  const prismaModule = await import("../src/db/prisma.ts");
  const prisma = prismaModule.default as any;
  const original = {
    reservationFindUnique: prisma.reservation.findUnique,
    reservationFindMany: prisma.reservation.findMany,
  };

  const firstSegment = {
    id: "r-dec",
    gite_id: "g1",
    stay_group_id: "stay-1",
    placeholder_id: null,
    origin_system: "app",
    origin_reference: null,
    export_to_ical: true,
    airbnb_url: null,
    hote_nom: "Client réveillon",
    telephone: "0600000000",
    email: "client@example.com",
    date_entree: new Date("2026-12-29T00:00:00.000Z"),
    date_sortie: new Date("2027-01-01T00:00:00.000Z"),
    nb_nuits: 3,
    nb_adultes: 2,
    nb_enfants_2_17: 1,
    prix_par_nuit: 350,
    prix_total: 1050,
    source_paiement: "A définir",
    commentaire: null,
    remise_montant: 0,
    commission_channel_mode: "euro",
    commission_channel_value: 0,
    frais_optionnels_montant: 30,
    frais_optionnels_libelle: "Draps",
    frais_optionnels_declares: true,
    options: "{}",
    energy_consumption_kwh: 0,
    energy_cost_eur: 0,
    energy_price_per_kwh: null,
    energy_tracking: "[]",
    gite: { id: "g1", nom: "Gîte", prefixe_contrat: "G", ordre: 1 },
    placeholder: null,
  };
  const secondSegment = {
    ...firstSegment,
    id: "r-jan",
    date_entree: new Date("2027-01-01T00:00:00.000Z"),
    date_sortie: new Date("2027-01-03T00:00:00.000Z"),
    nb_nuits: 2,
    prix_total: 700,
    frais_optionnels_montant: 20,
  };

  try {
    prisma.reservation.findUnique = async () => secondSegment;
    prisma.reservation.findMany = async ({ where }: any) => {
      if (where?.stay_group_id === "stay-1") return [firstSegment, secondSegment];
      return [];
    };

    const reservationsRouterModule = await import("../src/routes/reservations.ts");
    const prefillReservation = getRouteHandler(reservationsRouterModule.default, "get", "/prefill/:id");
    const response = createMockResponse();
    let nextError: unknown = null;

    await prefillReservation(
      { params: { id: "r-jan" }, query: {}, body: {} },
      response,
      (err) => {
        nextError = err ?? null;
      },
    );

    assert.equal(nextError, null);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as any).id, "r-dec");
    assert.equal(new Date((response.body as any).date_entree).toISOString(), "2026-12-29T00:00:00.000Z");
    assert.equal(new Date((response.body as any).date_sortie).toISOString(), "2027-01-03T00:00:00.000Z");
    assert.equal((response.body as any).nb_nuits, 5);
    assert.equal((response.body as any).prix_total, 1750);
    assert.equal((response.body as any).prix_par_nuit, 350);
    assert.equal((response.body as any).frais_optionnels_montant, 50);
  } finally {
    prisma.reservation.findUnique = original.reservationFindUnique;
    prisma.reservation.findMany = original.reservationFindMany;
    if (envBackup.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = envBackup.DATABASE_URL;
  }
});
