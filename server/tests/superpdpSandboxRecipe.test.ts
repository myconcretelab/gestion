import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  buildSandboxRecipe,
  checksum,
  recipeBindingSchema,
  requireLocalSandboxRecipe,
  requirePositiveRecipeValidation,
  SandboxRecipeLedger,
} from "../src/modules/superpdp/sandboxRecipe.js";
import type { Validation } from "../src/modules/superpdp/transport.js";

const binding = {
  organizationId: "org-test",
  sender: {
    entityId: "entity-a",
    connectionId: "connection-a",
    companyId: "114214",
    number: "000000002" as const,
    address: "0225:315143296_114214",
  },
  recipient: {
    entityId: "entity-b",
    connectionId: "connection-b",
    companyId: "114213",
    number: "000000001" as const,
    address: "0225:315143296_114213",
  },
};
const id = "5f92e556-6b81-421e-9b91-f213588b50a0";
test("le parcours refuse production, autre base, absence de confirmation et flux automatiques", () => {
  const safe = {
    mode: "development",
    confirmed: true,
    database: "file:/local/dev.db",
    expectedDatabase: "/local/dev.db",
    sandboxEnabled: true,
    pdfDisabled: false,
    automatedOrOrdinaryFlows: [false, false, false, false, false],
  };
  assert.doesNotThrow(() => requireLocalSandboxRecipe(safe));
  for (const patch of [
    { mode: "production" },
    { mode: "test" },
    { confirmed: false },
    { database: undefined },
    { database: "postgresql://example.invalid/db" },
    { database: "file:/another/dev.db" },
    { sandboxEnabled: false },
    { pdfDisabled: true },
    ...safe.automatedOrOrdinaryFlows.map((_, index) => ({
      automatedOrOrdinaryFlows: safe.automatedOrOrdinaryFlows.map(
        (_, i) => i === index,
      ),
    })),
  ])
    assert.throws(() => requireLocalSandboxRecipe({ ...safe, ...patch }));
});
test("la recette fictive est déterministe, isolée et cohérente entre PDF et EN16931", () => {
  const before = structuredClone(binding);
  const recipe = buildSandboxRecipe(binding, id, "2026-10-16");
  assert.deepEqual(recipe, buildSandboxRecipe(binding, id, "2026-10-16"));
  assert.deepEqual(binding, before);
  assert.match(recipe.number, /^TEST-PDP-20261016-/);
  assert.equal(recipe.render.invoice.test_environment, "superpdp-sandbox");
  assert.equal(recipe.render.invoice.fiscal, recipe.input);
  assert.equal(recipe.render.invoice.seller?.siret, null);
  assert.equal("identifiers" in recipe.payload.seller, false);
  assert.deepEqual(recipe.payload.seller.electronic_address, {
    scheme: "0225",
    value: "315143296_114214",
  });
  assert.deepEqual(recipe.payload.buyer.electronic_address, {
    scheme: "0225",
    value: "315143296_114213",
  });
  assert.equal(
    recipe.payload.seller.legal_registration_identifier.value,
    "000000002",
  );
  assert.equal(
    recipe.payload.buyer.legal_registration_identifier?.value,
    "000000001",
  );
  assert.equal(recipe.payload.process_control.business_process_type, "S1");
  assert.equal(recipe.payload.totals.total_without_vat, "150.00");
  assert.equal(recipe.payload.totals.total_vat_amount.value, "25.00");
  assert.equal(recipe.payload.totals.total_with_vat, "175.00");
  assert.equal(
    recipe.render.totals.totalGlobal * 100,
    recipe.computed.total_with_vat_cents,
  );
  assert.equal(recipe.payload.totals.paid_amount, "0.00");
  assert.equal(recipe.input.buyer.address_line1, "1 rue de la Recette fictive");
  assert.ok(
    recipe.payload.notes.some((note) =>
      note.note.includes("aucune valeur comptable"),
    ),
  );
  recipe.input.lines[0].unit_price_ttc = 999;
  assert.equal(
    buildSandboxRecipe(binding, id, "2026-10-16").input.lines[0].unit_price_ttc,
    120,
  );
});

test("les paires inversées, partagées ou routées vers un tiers sont refusées", () => {
  const mutations = [
    { ...binding, sender: binding.recipient, recipient: binding.sender },
    {
      ...binding,
      recipient: { ...binding.recipient, companyId: binding.sender.companyId },
    },
    {
      ...binding,
      recipient: { ...binding.recipient, entityId: binding.sender.entityId },
    },
    {
      ...binding,
      recipient: {
        ...binding.recipient,
        connectionId: binding.sender.connectionId,
      },
    },
    { ...binding, sender: { ...binding.sender, number: "732829320" } },
    {
      ...binding,
      recipient: { ...binding.recipient, address: "0225:000000001" },
    },
    {
      ...binding,
      recipient: { ...binding.recipient, companyId: "9223372036854775808" },
    },
  ];
  for (const candidate of mutations)
    assert.equal(recipeBindingSchema.safeParse(candidate).success, false);
  for (const bad of ["../escape", "random", ""])
    assert.throws(() => buildSandboxRecipe(binding, bad, "2026-10-16"));
  assert.throws(() => buildSandboxRecipe(binding, id, "2026-02-31"));
});

test("le modèle PDF distingue le test sans ajouter de bandeau aux factures métier", async () => {
  const { buildInvoiceHtml } = await import("../src/services/pdfService.js");
  const recipe = buildSandboxRecipe(binding, id, "2026-10-16");
  const sandbox = await buildInvoiceHtml(recipe.render);
  assert.ok(sandbox.includes('<div class="sandbox-notice">TEST SUPERPDP'));
  assert.ok(sandbox.includes("Aucune valeur comptable."));
  assert.ok(sandbox.includes("FACTURE TEST<span>TEST-PDP-"));
  assert.ok(sandbox.includes("Prestation fictive de recette A"));
  assert.ok(sandbox.includes("175,00"));
  assert.ok(!sandbox.includes("SIRET :"));
  const normal = await buildInvoiceHtml({
    ...recipe.render,
    invoice: {
      ...recipe.render.invoice,
      test_environment: undefined,
      numero_facture: "FACTURE-METIER",
    },
  });
  assert.ok(!normal.includes('<div class="sandbox-notice">'));
  assert.ok(normal.includes("FACTURE<span>FACTURE-METIER"));
  assert.ok(!normal.includes("FACTURE TEST"));
  const draft = await buildInvoiceHtml({
    ...recipe.render,
    invoice: {
      ...recipe.render.invoice,
      test_environment: undefined,
      lifecycle_status: "draft",
    },
  });
  assert.ok(draft.includes("BROUILLON<span>Non émis"));
});

test("aucun rapport négatif, contradictoire, vide ou sans contrôle ne permet l’envoi", () => {
  const report: Validation = {
    data: [
      {
        file_name: "invoice.pdf",
        file_size: 100,
        is_valid: true,
        format: "Factur-X",
        conformance_level: "EN16931",
        subreports: [
          { validator: "test", checks_count: 10, failures: [], messages: [] },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => requirePositiveRecipeValidation(report));
  for (const change of [
    { is_valid: false },
    { error: "invalid" },
    { subreports: [] },
    {
      subreports: [
        { ...report.data[0].subreports[0], failures: [{ message: "failed" }] },
      ],
    },
    { subreports: [{ ...report.data[0].subreports[0], checks_count: 0 }] },
  ])
    assert.throws(() =>
      requirePositiveRecipeValidation({
        data: [{ ...report.data[0], ...change }],
      }),
    );
});

test("le journal durable est privé, exclusif, non rejouable et ne stocke pas les erreurs sensibles", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-recipe-test-"));
  const ledger = new SandboxRecipeLedger(root, crypto.randomUUID(), true);
  assert.equal(fs.statSync(ledger.directory).mode & 0o777, 0o700);
  ledger.json("manifest.json", { hello: "world" });
  assert.equal(
    fs.statSync(path.join(ledger.directory, "manifest.json")).mode & 0o777,
    0o600,
  );
  assert.throws(() => ledger.json("manifest.json", {}));
  assert.throws(() => ledger.read("../manifest.json"));
  assert.throws(() => ledger.write("../escape", "bad"));
  let calls = 0;
  const send = async () => {
    calls++;
    assert.ok(ledger.read("send-intent.json").length);
    throw new Error("secret-must-not-be-saved");
  };
  await assert.rejects(
    ledger.sendOnce({ externalId: id }, send),
    /NEVER_RETRY/,
  );
  const reopened = new SandboxRecipeLedger(
    root,
    path.basename(ledger.directory),
  );
  await assert.rejects(reopened.sendOnce({ externalId: id }, send));
  assert.equal(calls, 1);
  const saved = fs
    .readdirSync(ledger.directory)
    .map((name) => ledger.read(name).toString())
    .join("");
  assert.ok(!saved.includes("secret-must-not-be-saved"));
  const success = new SandboxRecipeLedger(root, crypto.randomUUID(), true);
  const responses = await Promise.allSettled([
    success.sendOnce({ externalId: id }, async () => {
      calls++;
      return { id: "123" };
    }),
    success.sendOnce({ externalId: id }, async () => {
      calls++;
      return { id: "456" };
    }),
  ]);
  assert.equal(
    responses.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(calls, 2);
  assert.ok(success.read("send-response.json").length);
  assert.equal(
    checksum("test"),
    crypto.createHash("sha256").update("test").digest("hex"),
  );
});

test("le journal refuse les liens symboliques de dossier et de preuve", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "sandbox-recipe-link-test-"),
  );
  const real = new SandboxRecipeLedger(root, crypto.randomUUID(), true);
  real.write("proof.txt", "private");
  fs.symlinkSync(
    path.join(real.directory, "proof.txt"),
    path.join(real.directory, "link.txt"),
  );
  assert.throws(() => real.read("link.txt"));
  const linkId = crypto.randomUUID();
  fs.symlinkSync(real.directory, path.join(root, linkId));
  assert.throws(() => new SandboxRecipeLedger(root, linkId));
});
