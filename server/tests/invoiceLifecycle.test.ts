import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "contrats-invoice-lifecycle-"),
);
const serverRoot = path.resolve(
  process.cwd().endsWith(`${path.sep}server`)
    ? process.cwd()
    : path.join(process.cwd(), "server"),
);
const postgresUrl = process.env.TEST_INVOICE_POSTGRES_URL;
const databaseUrl = postgresUrl ?? `file:${path.join(temp, "test.db")}`;
const orgA = "org_invoice_a";
const orgB = "org_invoice_b";
let db: typeof import("../src/db/prisma.js");
let server: Server;
let origin: string;
const payload = {
  gite_id: "gite-a",
  locataire_nom: "Client Exemple",
  locataire_adresse: "2 rue Client, 35000 Rennes",
  locataire_tel: "0102030405",
  locataire_email: "client@example.test",
  nb_adultes: 2,
  nb_enfants_2_17: 0,
  date_debut: "2027-03-01",
  date_fin: "2027-03-04",
  heure_arrivee: "17:00",
  heure_depart: "12:00",
  prix_par_nuit: 100,
  options: { menage: { enabled: true } },
  arrhes_montant: 60,
  arrhes_date_limite: "2027-02-01",
  caution_montant: 0,
  cheque_menage_montant: 0,
};
const request = async (
  url: string,
  method = "GET",
  body?: unknown,
  organizationId = orgA,
) => {
  const response = await fetch(origin + url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-org": organizationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = response.headers
    .get("content-type")
    ?.includes("application/json");
  return {
    status: response.status,
    body: json ? await response.json() : null,
    bytes: json ? null : Buffer.from(await response.arrayBuffer()),
  };
};
const createDraft = async (
  overrides: Record<string, unknown> = {},
  organizationId = orgA,
) => {
  const prepared = await request(
    "/invoices/fiscal-preview",
    "POST",
    { ...payload, ...overrides },
    organizationId,
  );
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const fiscal = prepared.body.fiscal_input;
  fiscal.buyer = {
    kind: "individual",
    address_line1: overrides.locataire_adresse === "" ? "" : "2 rue Client",
    address_line2: "",
    postal_code: "35000",
    city: "Rennes",
    country_code: "FR",
    siren: "",
    vat_number: "",
  };
  fiscal.lines = fiscal.lines.map((line: Record<string, unknown>) => ({
    ...line,
    vat_category: "E",
    vat_rate: 0,
    exemption_reason: "TVA non applicable, article 293 B du CGI",
  }));
  fiscal.reviewed = true;
  fiscal.tourist_tax_reviewed = true;
  fiscal.paid_amount = 60;
  fiscal.payment_terms = "Solde avant l’arrivée";
  const result = await request(
    "/invoices",
    "POST",
    { ...payload, fiscal_input: fiscal, ...overrides },
    organizationId,
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
};

before(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL_SQLITE = databaseUrl;
  if (postgresUrl) process.env.DATABASE_URL_POSTGRES = postgresUrl;
  process.env.DATA_DIR = path.join(temp, "data");
  process.env.SKIP_PDF_GENERATION = "1";
  process.env.NODE_ENV = "test";
  if (!postgresUrl) fs.writeFileSync(path.join(temp, "test.db"), "");
  const migrate = spawnSync(
    process.execPath,
    [
      "scripts/prisma.mjs",
      "migrate",
      "deploy",
      ...(postgresUrl ? ["--schema", "prisma/postgres/schema.prisma"] : []),
    ],
    { cwd: serverRoot, env: process.env, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
  db = await import("../src/db/prisma.js");
  await db.systemPrisma.organization.createMany({
    data: [
      { id: orgA, name: "Compte A", slug: "invoice-test-a" },
      { id: orgB, name: "Compte B", slug: "invoice-test-b" },
    ],
  });
  for (const [organizationId, suffix] of [
    [orgA, "a"],
    [orgB, "b"],
  ]) {
    const tenant = db.getTenantPrisma(organizationId);
    await tenant.fiscalEntity.create({
      data: {
        id: `entity-${suffix}`,
        legal_name: `Entreprise ${suffix}`,
        siren: "732829320",
        vat_regime: "franchise_en_base",
        address_line1: "1 rue Exemple",
        postal_code: "35000",
        city: "Rennes",
      },
    });
    await tenant.fiscalEstablishment.create({
      data: {
        id: `establishment-${suffix}`,
        name: "Siège",
        siret: "73282932000074",
        fiscal_entity_id: `entity-${suffix}`,
      },
    });
    await tenant.gite.create({
      data: {
        id: `gite-${suffix}`,
        nom: `Gîte ${suffix}`,
        prefixe_contrat: "EX",
        adresse_ligne1: "1 rue Exemple",
        capacite_max: 4,
        nb_adultes_max: 4,
        proprietaires_noms: "Propriétaire historique",
        proprietaires_adresse: "Ancienne adresse",
        telephones: "[]",
        iban: "FR761234",
        titulaire: "Compte Exemple",
        taxe_sejour_par_personne_par_nuit: 1,
        options_menage_forfait: 30,
        fiscal_establishment_id: `establishment-${suffix}`,
      },
    });
  }
  const { runWithOrganization } =
    await import("../src/modules/organizations/context.js");
  const { default: invoices } = await import("../src/routes/invoices.js");
  const { default: fiscalEntities } =
    await import("../src/modules/fiscal/routes.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) =>
    runWithOrganization(
      {
        organizationId: String(req.headers["x-test-org"] || orgA),
        source: "test",
      },
      next,
    ),
  );
  app.use("/invoices", invoices);
  app.use("/fiscal-entities", fiscalEntities);
  app.use(((error, _req, res, _next) =>
    res
      .status(error.name === "ZodError" ? 400 : (error.status ?? 500))
      .json({ error: error.message })) as express.ErrorRequestHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (db) await db.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("un brouillon ne consomme aucun numéro et ne peut pas être envoyé avant validation", async () => {
  const invoice = await createDraft();
  assert.equal(invoice.lifecycle_status, "draft");
  assert.match(invoice.numero_facture, /^BROUILLON-/);
  assert.equal(await db.systemPrisma.factureCounter.count(), 0);
  assert.equal(await db.systemPrisma.invoiceSequence.count(), 0);
  assert.equal(
    (await request(`/invoices/${invoice.id}/send-email`, "POST", {})).status,
    409,
  );
  assert.equal(
    (await request(`/invoices/${invoice.id}`, "DELETE")).status,
    204,
  );
  assert.equal(await db.systemPrisma.invoiceSequence.count(), 0);
});

test("une entreprise sandbox sans SIREN/SIRET ne peut pas émettre de facture française", async () => {
  const entity = await db.systemPrisma.fiscalEntity.create({
    data: {
      organization_id: orgA,
      legal_name: "Entreprise fictive sans identité légale",
      vat_regime: "franchise_en_base",
      address_line1: "1 rue fictive",
      postal_code: "12100",
      city: "Millau",
    },
  });
  const establishment = await db.systemPrisma.fiscalEstablishment.create({
    data: {
      organization_id: orgA,
      fiscal_entity_id: entity.id,
      name: "Établissement fictif",
    },
  });
  await db.systemPrisma.gite.update({
    where: { id: "gite-a" },
    data: { fiscal_establishment_id: establishment.id },
  });
  try {
    const draft = await createDraft();
    const beforeSequences = await db.systemPrisma.invoiceSequence.count();
    const result = await request(`/invoices/${draft.id}/issue`, "POST", {
      revision: draft.revision,
    });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /SIREN/);
    assert.match(result.body.error, /SIRET/);
    const stored = await db.systemPrisma.facture.findUniqueOrThrow({
      where: { id: draft.id },
    });
    assert.equal(stored.lifecycle_status, "draft");
    assert.equal(stored.immutable_snapshot, null);
    assert.equal(
      await db.systemPrisma.invoiceSequence.count(),
      beforeSequences,
    );
    await request(`/invoices/${draft.id}`, "DELETE");
  } finally {
    await db.systemPrisma.gite.update({
      where: { id: "gite-a" },
      data: { fiscal_establishment_id: "establishment-a" },
    });
  }
});

test("la validation fige l’émetteur, les montants et les octets PDF ; les retry sont idempotents", async () => {
  let invoice = await createDraft();
  const saved = await request(`/invoices/${invoice.id}`, "PUT", {
    ...payload,
    revision: invoice.revision,
    fiscal_input: invoice.fiscal_input,
    locataire_nom: "Client modifié",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(
    (
      await request(`/invoices/${invoice.id}/issue`, "POST", {
        revision: invoice.revision,
      })
    ).status,
    409,
  );
  invoice = saved.body;
  await db.systemPrisma.gite.update({
    where: { id: "gite-a" },
    data: {
      options_menage_forfait: 999,
      ical_export_token: "never-in-snapshot",
    },
  });
  const issued = await request(`/invoices/${invoice.id}/issue`, "POST", {
    revision: invoice.revision,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const year = new Intl.DateTimeFormat("fr", {
    timeZone: "Europe/Paris",
    year: "numeric",
  }).format(new Date());
  assert.equal(issued.body.numero_facture, `F-${year}-732829320-000001`);
  assert.equal(issued.body.lifecycle_status, "issued");
  assert.equal(
    (
      await request(
        "/fiscal-entities/entity-a/establishments/establishment-a",
        "PUT",
        { name: "Changement interdit", siret: "" },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/fiscal-entities/entity-a", "PUT", {
        legal_name: "Changement interdit",
        siren: "123456789",
      })
    ).status,
    409,
  );
  assert.equal(issued.body.solde_montant, 270);
  const row = await db.systemPrisma.facture.findUniqueOrThrow({
    where: { id: invoice.id },
  });
  const archive = JSON.parse(row.immutable_snapshot!);
  assert.equal(archive.calculation.totals.totalGlobal, 330);
  assert.equal(archive.issuer.entity.legal_name, "Entreprise a");
  assert.equal(archive.structured_invoice.en_invoice_candidate.type_code, 380);
  assert.equal(
    archive.structured_invoice.en_invoice_candidate.totals.total_with_vat,
    "330.00",
  );
  assert.equal(archive.structured_invoice.transport_ready, false);
  const structured = await request(`/invoices/${invoice.id}/structured`);
  assert.equal(structured.status, 200);
  assert.equal(row.immutable_snapshot!.includes("never-in-snapshot"), false);
  const pdf = await request(`/invoices/${invoice.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(
    (
      await request(`/invoices/${invoice.id}`, "PUT", {
        ...payload,
        locataire_nom: "Interdit",
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(`/invoices/${invoice.id}`, "DELETE")).status,
    409,
  );
  assert.equal(
    (await request(`/invoices/${invoice.id}/regenerate`, "POST")).status,
    409,
  );
  const { deleteGitePreservingInvoices } =
    await import("../src/modules/properties/deleteGite.js");
  const { runWithOrganization } =
    await import("../src/modules/organizations/context.js");
  await assert.rejects(
    () =>
      runWithOrganization({ organizationId: orgA, source: "test" }, () =>
        deleteGitePreservingInvoices("gite-a"),
      ),
    { status: 409 },
  );
  const again = await request(`/invoices/${invoice.id}/issue`, "POST", {
    revision: 0,
  });
  assert.equal(again.body.numero_facture, issued.body.numero_facture);
  await db.systemPrisma.fiscalEntity.update({
    where: { id: "entity-a" },
    data: { legal_name: "Nouveau nom" },
  });
  assert.equal(
    (await request(`/invoices/${invoice.id}`)).body.issuer.legal_name,
    "Entreprise a",
  );
  assert.equal(
    (
      await request(`/invoices/${invoice.id}/payment`, "PATCH", {
        statut_paiement: "reglee",
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await request(`/invoices/${invoice.id}/pdf`)).bytes,
    pdf.bytes,
  );
  assert.equal(
    (
      await db.systemPrisma.facture.findUniqueOrThrow({
        where: { id: invoice.id },
      })
    ).pdf_sha256,
    row.pdf_sha256,
  );
  assert.equal(
    (
      await db.systemPrisma.invoiceSequence.findFirstOrThrow({
        where: { organization_id: orgA },
      })
    ).last_number,
    1,
  );
  const originalBytes = fs.readFileSync(path.resolve(row.pdf_path));
  fs.writeFileSync(path.resolve(row.pdf_path), "tampered");
  assert.equal((await request(`/invoices/${invoice.id}/pdf`)).status, 409);
  fs.writeFileSync(path.resolve(row.pdf_path), originalBytes);
  fs.renameSync(
    path.resolve(row.pdf_path),
    path.resolve(row.pdf_path) + ".backup",
  );
  assert.equal((await request(`/invoices/${invoice.id}/pdf`)).status, 409);
  fs.renameSync(
    path.resolve(row.pdf_path) + ".backup",
    path.resolve(row.pdf_path),
  );
});

test("un avoir intégral conserve la source et utilise l’émetteur et les montants figés", async () => {
  const original = await db.systemPrisma.facture.findFirstOrThrow({
    where: { organization_id: orgA, lifecycle_status: "issued" },
  });
  const credit = await request(`/invoices/${original.id}/credit-note`, "POST", {
    reason: "Annulation du séjour",
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  assert.equal(credit.body.solde_montant, -330);
  assert.equal(credit.body.document_kind, "credit_note");
  assert.equal(credit.body.lifecycle_status, "draft");
  const duplicate = await request(
    `/invoices/${original.id}/credit-note`,
    "POST",
    { reason: "Nouvelle tentative" },
  );
  assert.equal(duplicate.body.id, credit.body.id);
  assert.equal(
    (await request(`/invoices/${credit.body.id}`, "PUT", payload)).status,
    409,
  );
  const issued = await request(`/invoices/${credit.body.id}/issue`, "POST", {
    revision: 0,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.numero_facture, /000002$/);
  assert.equal(issued.body.issuer.legal_name, "Entreprise a");
  const structured = await request(`/invoices/${credit.body.id}/structured`);
  assert.equal(structured.body.en_invoice_candidate.type_code, 381);
  assert.equal(
    structured.body.en_invoice_candidate.totals.total_with_vat,
    "330.00",
  );
  assert.equal(structured.body.en_invoice_candidate.totals.paid_amount, "0.00");
  assert.equal(
    structured.body.en_invoice_candidate.preceding_invoice_references[0]
      .reference,
    original.numero_facture,
  );
  assert.equal(
    (await request(`/invoices/${original.id}`)).body.credit_notes[0].id,
    credit.body.id,
  );
  assert.equal(
    (
      await request(`/invoices/${credit.body.id}/credit-note`, "POST", {
        reason: "Double annulation",
      })
    ).status,
    409,
  );
  assert.equal(
    Number(
      (
        await db.systemPrisma.facture.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).solde_montant,
    ),
    Number(original.solde_montant),
  );
});

test("un échec PDF ne consomme pas de numéro et les comptes restent isolés", async () => {
  const invoice = await createDraft({ gite_id: "gite-b" }, orgB);
  const year = new Intl.DateTimeFormat("fr", {
    timeZone: "Europe/Paris",
    year: "numeric",
  }).format(new Date());
  const obstruction = path.join(
    temp,
    "data",
    "organizations",
    orgB,
    "invoices",
    "issued",
    year,
  );
  fs.mkdirSync(path.dirname(obstruction), { recursive: true });
  fs.writeFileSync(obstruction, "not-a-directory");
  assert.equal(
    (
      await request(
        `/invoices/${invoice.id}/issue`,
        "POST",
        { revision: 0 },
        orgB,
      )
    ).status,
    500,
  );
  assert.equal(
    await db.systemPrisma.invoiceSequence.count({
      where: { organization_id: orgB },
    }),
    0,
  );
  assert.equal(
    (await request(`/invoices/${invoice.id}`, "GET", undefined, orgB)).body
      .lifecycle_status,
    "draft",
  );
  fs.unlinkSync(obstruction);
  const issued = await request(
    `/invoices/${invoice.id}/issue`,
    "POST",
    { revision: 0 },
    orgB,
  );
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.numero_facture, /000001$/);
  assert.equal((await request(`/invoices/${invoice.id}`)).status, 404);
  assert.equal(
    (await request(`/invoices/${invoice.id}/issue`, "POST", { revision: 0 }))
      .status,
    404,
  );
  assert.equal(
    (
      await request(`/invoices/${invoice.id}/credit-note`, "POST", {
        reason: "Accès croisé",
      })
    ).status,
    404,
  );
});

test("les validations concurrentes ne créent ni doublons ni trous dans la séquence", async () => {
  const invoice = await createDraft({ gite_id: "gite-b" }, orgB);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(`/invoices/${invoice.id}/issue`, "POST", { revision: 0 }, orgB),
    ),
  );
  assert.ok(
    results.some((result) => result.status === 200),
    JSON.stringify(results),
  );
  assert.ok(
    results.every((result) => [200, 409].includes(result.status)),
    JSON.stringify(results),
  );
  assert.equal(
    new Set(
      results
        .filter((result) => result.status === 200)
        .map((result) => result.body.numero_facture),
    ).size,
    1,
  );
  assert.equal(
    (
      await db.systemPrisma.invoiceSequence.findFirstOrThrow({
        where: { organization_id: orgB },
      })
    ).last_number,
    2,
  );
});

test("les contrôles d’émetteur et d’adresse client précèdent l’attribution d’un numéro", async () => {
  const invoice = await createDraft({ locataire_adresse: "" });
  const counterBefore = (
    await db.systemPrisma.invoiceSequence.findFirstOrThrow({
      where: { organization_id: orgA },
    })
  ).last_number;
  assert.equal(
    (await request(`/invoices/${invoice.id}/issue`, "POST", { revision: 0 }))
      .status,
    409,
  );
  await db.systemPrisma.gite.update({
    where: { id: "gite-a" },
    data: { fiscal_establishment_id: null },
  });
  const noIssuer = await createDraft();
  assert.equal(
    (await request(`/invoices/${noIssuer.id}/issue`, "POST", { revision: 0 }))
      .status,
    409,
  );
  await db.systemPrisma.gite.update({
    where: { id: "gite-a" },
    data: { fiscal_establishment_id: "establishment-a" },
  });
  assert.equal(
    (
      await db.systemPrisma.invoiceSequence.findFirstOrThrow({
        where: { organization_id: orgA },
      })
    ).last_number,
    counterBefore,
  );
});

test("le détail fiscal incomplet ou déséquilibré bloque avant le compteur et reste modifiable", async () => {
  const previous = await db.systemPrisma.invoiceSequence.findFirstOrThrow({
    where: { organization_id: orgA },
  });
  let draft = await createDraft({ fiscal_input: null });
  assert.equal(
    (await request(`/invoices/${draft.id}/issue`, "POST", { revision: 0 }))
      .status,
    409,
  );
  assert.equal((await request(`/invoices/${draft.id}/structured`)).status, 409);
  draft = await createDraft();
  for (const patch of [
    { reviewed: false },
    { tourist_tax_reviewed: false },
    { buyer: { ...draft.fiscal_input.buyer, kind: "business", siren: "" } },
    {
      lines: draft.fiscal_input.lines.map((line: Record<string, unknown>) => ({
        ...line,
        vat_category: "unknown",
        exemption_reason: "",
      })),
    },
    {
      lines: draft.fiscal_input.lines.map((line: Record<string, unknown>) => ({
        ...line,
        unit_price_ttc: Number(line.unit_price_ttc) + 0.01,
      })),
    },
  ]) {
    const changed = await request(`/invoices/${draft.id}`, "PUT", {
      ...payload,
      revision: draft.revision,
      fiscal_input: { ...draft.fiscal_input, ...patch },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const rejected = await request(`/invoices/${draft.id}/issue`, "POST", {
      revision: changed.body.revision,
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    draft.revision = changed.body.revision;
  }
  assert.equal(
    (
      await db.systemPrisma.invoiceSequence.findFirstOrThrow({
        where: { organization_id: orgA },
      })
    ).last_number,
    previous.last_number,
  );
  const malformed = await request(`/invoices/${draft.id}`, "PUT", {
    ...payload,
    revision: draft.revision,
    fiscal_input: { ...draft.fiscal_input, payment_due_date: "2026-99-99" },
  });
  assert.equal(malformed.status, 400);
});

test("TVA multi-taux, adresse structurée, encaissements explicites et export figé", async () => {
  await db.systemPrisma.fiscalEntity.update({
    where: { id: "entity-a" },
    data: { vat_regime: "reel_normal", vat_number: "FR01732829320" },
  });
  const draft = await createDraft();
  const fiscal = draft.fiscal_input;
  fiscal.lines = [
    {
      ...fiscal.lines[0],
      id: "stay",
      label: "Location",
      unit_price_ttc: 300,
      vat_category: "S",
      vat_rate: 10,
      exemption_reason: "",
    },
    {
      ...fiscal.lines[0],
      id: "clean",
      label: "Ménage",
      unit_price_ttc: 999,
      vat_category: "S",
      vat_rate: 20,
      exemption_reason: "",
    },
  ];
  fiscal.paid_amount = 0;
  fiscal.buyer = {
    ...fiscal.buyer,
    kind: "business",
    siren: "123456789",
    vat_number: "FR00123456789",
    address_line1: "Adresse fiscale différente",
  };
  const saved = await request(`/invoices/${draft.id}`, "PUT", {
    ...payload,
    revision: draft.revision,
    fiscal_input: fiscal,
  });
  assert.equal(saved.status, 200);
  const issued = await request(`/invoices/${draft.id}/issue`, "POST", {
    revision: saved.body.revision,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const exported = await request(`/invoices/${draft.id}/structured`);
  assert.equal(
    exported.body.en_invoice_candidate.totals.total_with_vat,
    "1299.00",
  );
  assert.equal(exported.body.en_invoice_candidate.totals.paid_amount, "0.00");
  assert.equal(
    exported.body.en_invoice_candidate.totals.amount_due_for_payment,
    "1299.00",
  );
  assert.equal(
    exported.body.en_invoice_candidate.buyer.postal_address.address_line1,
    "Adresse fiscale différente",
  );
  assert.equal(exported.body.en_invoice_candidate.vat_break_down.length, 2);
  assert.equal(exported.body.processing_rule_candidate, "B2B");
  assert.equal(
    (await request(`/invoices/${draft.id}/structured`, "GET", undefined, orgB))
      .status,
    404,
  );
  await db.systemPrisma.fiscalEntity.update({
    where: { id: "entity-a" },
    data: {
      vat_regime: "franchise_en_base",
      vat_number: null,
      legal_name: "Encore un nouveau nom",
    },
  });
  await request(`/invoices/${draft.id}/payment`, "PATCH", {
    statut_paiement: "reglee",
  });
  assert.deepEqual(
    (await request(`/invoices/${draft.id}/structured`)).body,
    exported.body,
  );
  const credit = await request(`/invoices/${draft.id}/credit-note`, "POST", {
    reason: "Annulation multi-taux",
  });
  const issuedCredit = await request(
    `/invoices/${credit.body.id}/issue`,
    "POST",
    { revision: 0 },
  );
  assert.equal(issuedCredit.status, 200, JSON.stringify(issuedCredit.body));
  const creditExport = await request(`/invoices/${credit.body.id}/structured`);
  assert.deepEqual(
    creditExport.body.en_invoice_candidate.vat_break_down,
    exported.body.en_invoice_candidate.vat_break_down,
  );
  assert.equal(creditExport.body.document_sign, -1);
});

test("les avoirs des factures émises avant le modèle fiscal restent possibles sans inventer de TVA", async () => {
  const draft = await createDraft();
  const legacyArchive = {
    version: 1,
    issuer: {
      entity: await db.systemPrisma.fiscalEntity.findUniqueOrThrow({
        where: { id: "entity-a" },
      }),
      establishment:
        await db.systemPrisma.fiscalEstablishment.findUniqueOrThrow({
          where: { id: "establishment-a" },
        }),
    },
    calculation: JSON.parse(
      (
        await db.systemPrisma.facture.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).calculation_snapshot!,
    ),
    invoice: { issued_at: new Date().toISOString() },
  };
  await db.systemPrisma.facture.update({
    where: { id: draft.id },
    data: {
      lifecycle_status: "issued",
      issued_at: new Date(),
      fiscal_data: null,
      immutable_snapshot: JSON.stringify(legacyArchive),
    },
  });
  const credit = await request(`/invoices/${draft.id}/credit-note`, "POST", {
    reason: "Source étape 2",
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  assert.deepEqual(credit.body.fiscal_issues, []);
  const issued = await request(`/invoices/${credit.body.id}/issue`, "POST", {
    revision: 0,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(
    (await request(`/invoices/${credit.body.id}/structured`)).status,
    409,
  );
});
