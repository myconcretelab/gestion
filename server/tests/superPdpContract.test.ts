import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("contrat e-reporting : détail MEN explicite, date, note BAR et TVA entreprise, sans idempotence documentée", () => {
  const contract = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/superpdp-1.37.0.beta.json", import.meta.url),
      "utf8",
    ),
  );
  const body =
    contract.event_post.requestBody.content["application/json"].schema;
  assert.deepEqual(body.required, ["invoice_id", "status_code"]);
  assert.ok(body.properties.details);
  assert.equal(body.properties.invoice_id.type, "integer");
  assert.ok(
    !contract.event_post.parameters?.some((p: { name: string }) =>
      /idempotency/.test(p.name),
    ),
  );
  const schemas = contract.reporting_schemas;
  for (const key of [
    "amount",
    "type_code",
    "value_percent",
    "currency_code",
    "date",
  ])
    assert.ok(schemas.invoice_event_reported_data.properties[key]);
  assert.ok(schemas.invoice_note.properties.subject_code);
  assert.deepEqual(schemas.vat_regime.enum, [
    "monthly",
    "quarterly",
    "simplified",
    "vat_exemption",
  ]);
  assert.equal(schemas.has_vat_on_debits.type, "boolean");
});

test("contrat de réception : pagination globale, filtre de direction et téléchargement original", () => {
  const contract = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/superpdp-1.37.0.beta.json", import.meta.url),
      "utf8",
    ),
  );
  for (const name of ["direction", "starting_after_id", "limit", "order"])
    assert.ok(
      contract.paths["/v1.beta/invoices"].get.parameters.some(
        (parameter: { name: string }) => parameter.name === name,
      ),
    );
  assert.ok(
    contract.paths["/v1.beta/invoice_events"].get.parameters.some(
      (parameter: { name: string }) => parameter.name === "starting_after_id",
    ),
  );
  const format = contract.paths["/v1.beta/invoices/{id}"].get.parameters.find(
    (parameter: { name: string }) => parameter.name === "format",
  ).schema.enum;
  assert.ok(format.includes("original"));
  assert.ok(format.includes("en16931"));
});

test("contrat officiel SuperPDP versionné : conversion multipart, validation et dépôt non idempotent", () => {
  // A curated, unmodified structural subset, not a complete or self-contained OpenAPI document.
  const contract = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/superpdp-1.37.0.beta.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(contract.version, "1.37.0.beta");
  assert.deepEqual(
    contract.paths["/v1.beta/invoices/convert"].post.requestBody.content[
      "multipart/form-data"
    ].schema.required,
    ["pdf", "invoice"],
  );
  assert.deepEqual(
    contract.paths["/v1.beta/invoices/convert"].post.security,
    [],
  );
  assert.deepEqual(
    contract.paths["/v1.beta/validation_reports"].post.security,
    [],
  );
  const deposit = contract.paths["/v1.beta/invoices"].post;
  assert.ok("application/pdf" in deposit.requestBody.content);
  assert.equal(
    deposit.parameters.find(
      (parameter: { name: string }) => parameter.name === "external_id",
    ).schema.maxLength,
    36,
  );
  assert.equal(
    deposit.parameters.some((parameter: { name: string }) =>
      /idempotency/i.test(parameter.name),
    ),
    false,
  );
  assert.ok(contract.schemas.invoice.required.includes("company_id"));
  assert.ok(contract.schemas.event.required.includes("invoice_id"));
  assert.ok(contract.en_invoice_required.includes("process_control"));
  assert.ok(contract.schemas.report.required.includes("is_valid"));
  assert.equal(contract.schemas.invoice.properties.id.type, "integer");
});

test("les motifs techniques, notes et données d’événements restent disponibles pour le suivi", async () => {
  const { eventSchema } = await import("../src/modules/superpdp/transport.js");
  const event = eventSchema.parse({
    id: "9223372036854775807",
    invoice_id: "9007199254740993123",
    status_code: "api:invalid",
    created_at: "2026-10-16T10:00:00Z",
    status_text: "Refus fictif",
    data: { reason: "Routage refusé" },
    details: [
      {
        reason: "TEST",
        notes: [
          {
            subject: "Diagnostic",
            contents: [{ content: "Adresse électronique à vérifier" }],
          },
        ],
        reported_data: [
          {
            amount: "120.00",
            currency_code: "EUR",
            type_code: "MEN",
            value_percent: "20",
          },
        ],
      },
    ],
  });
  assert.equal(event.data?.reason, "Routage refusé");
  assert.equal(
    event.details?.[0].notes?.[0].contents?.[0].content,
    "Adresse électronique à vérifier",
  );
  assert.equal(event.details?.[0].reported_data?.[0].amount, "120.00");
});
