import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInvoiceFiscal, invoiceFiscalIssues } from "@contrats/shared";
import { createInvoiceFormInput } from "../src/pages/shared/invoiceFormDefaults.ts";
import {
  applyIndividualVatPreset,
  changedVatLineIds,
} from "../src/pages/shared/invoiceVatPreset.ts";

const context = {
  giteId: "gite-fr",
  vatRegime: "franchise_en_base",
  sellerCountryCode: "FR",
  grouped: false,
};
const invoice = () => {
  const input = createInvoiceFormInput();
  input.lines = [
    {
      id: "stay",
      label: "Location · nuitée",
      quantity: 3,
      unit: "DAY",
      unit_price_ttc: 70,
      vat_category: "unknown",
      vat_rate: 0,
      exemption_reason: "",
    },
  ];
  return input;
};

test("un particulier n’est prérempli en franchise que sur la base du régime français renseigné de l’émetteur", () => {
  const input = invoice();
  input.reviewed = true;
  const result = applyIndividualVatPreset(input, context);
  assert.equal(result.input.lines[0].vat_category, "E");
  assert.equal(result.input.lines[0].vat_rate, 0);
  assert.equal(
    result.input.lines[0].exemption_reason,
    "TVA non applicable, article 293 B du CGI",
  );
  assert.equal(result.input.reviewed, false);
  assert.equal(input.lines[0].vat_category, "unknown");
  assert.equal(
    computeInvoiceFiscal(result.input).gross_cents,
    computeInvoiceFiscal(input).gross_cents,
  );
  assert.equal(computeInvoiceFiscal(result.input).vat_cents, 0);
  assert.ok(
    !invoiceFiscalIssues(result.input, 210, {
      vatRegime: "franchise_en_base",
    }).some((issue) => issue.includes("Ligne 1")),
  );
  assert.equal(
    applyIndividualVatPreset(result.input, context, result.applied).input,
    result.input,
  );
});

test("le préréglage se déclenche aussi lors d’une bascule entreprise vers particulier", () => {
  const input = invoice();
  input.buyer.kind = "business";
  assert.equal(applyIndividualVatPreset(input, context).input, input);
  input.buyer.kind = "individual";
  assert.equal(
    applyIndividualVatPreset(input, context).input.lines[0].vat_category,
    "E",
  );
});

test("aucun taux ni motif de franchise n’est déduit du statut particulier pour les autres régimes", () => {
  for (const vatRegime of [
    undefined,
    "unknown",
    "reel_normal",
    "reel_simplifie",
    "hors_champ",
  ]) {
    const input = invoice();
    assert.equal(
      applyIndividualVatPreset(input, { ...context, vatRegime }).input,
      input,
    );
  }
  for (const sellerCountryCode of [undefined, "BE"]) {
    const input = invoice();
    assert.equal(
      applyIndividualVatPreset(input, { ...context, sellerCountryCode }).input,
      input,
    );
  }
  const input = invoice();
  assert.equal(
    applyIndividualVatPreset(input, { ...context, grouped: true }).input,
    input,
  );
  const exempt = applyIndividualVatPreset(input, {
    ...context,
    vatRegime: "exonere",
  }).input;
  assert.equal(exempt.lines[0].vat_category, "E");
  assert.equal(exempt.lines[0].exemption_reason, ""); // No invented reference to article 261 D or 293 B.
  assert.ok(
    invoiceFiscalIssues(exempt, 210).some((issue) =>
      issue.includes("référence d’exonération"),
    ),
  );
});

test("les choix saisis et les brouillons existants ne sont jamais écrasés, y compris un retour explicite à À préciser", () => {
  for (const vat_category of ["S", "E", "O", "Z"] as const) {
    const input = invoice();
    Object.assign(input.lines[0], {
      vat_category,
      vat_rate: vat_category === "S" ? 10 : 0,
      exemption_reason:
        vat_category === "E"
          ? "Location exonérée, article 261 D, 4° du CGI"
          : "",
    });
    assert.equal(applyIndividualVatPreset(input, context).input, input);
  }
  const initial = applyIndividualVatPreset(invoice(), context);
  const edited = structuredClone(initial.input);
  edited.lines[0].vat_category = "unknown";
  edited.lines[0].exemption_reason = "";
  const touched = new Map(
    changedVatLineIds(initial.input, edited).map((id) => [
      id,
      edited.lines.find((line) => line.id === id)!,
    ]),
  );
  assert.deepEqual([...touched.keys()], ["stay"]);
  assert.equal(
    applyIndividualVatPreset(edited, context, initial.applied, touched).input,
    edited,
  );
});

test("changer d’émetteur/régime ou regrouper des séjours invalide seulement nos propres suggestions", () => {
  const initial = applyIndividualVatPreset(invoice(), context);
  for (const next of [
    { ...context, giteId: "other", vatRegime: "reel_normal" },
    { ...context, grouped: true },
  ]) {
    const result = applyIndividualVatPreset(
      initial.input,
      next,
      initial.applied,
    );
    assert.equal(result.input.lines[0].vat_category, "unknown");
    assert.equal(result.input.lines[0].exemption_reason, "");
    assert.equal(initial.input.lines[0].vat_category, "E");
  }
  const manual = structuredClone(initial.input);
  manual.lines[0].exemption_reason =
    "Exonération saisie et confirmée par l’utilisateur";
  assert.equal(
    applyIndividualVatPreset(
      manual,
      { ...context, vatRegime: "reel_normal" },
      initial.applied,
    ).input,
    manual,
  );
  const business = {
    ...initial.input,
    buyer: { ...initial.input.buyer, kind: "business" as const },
  };
  assert.equal(
    applyIndividualVatPreset(business, context, initial.applied).input,
    business,
  );
});

test("le choix manuel d’un frais ne bloque pas le préréglage d’une nouvelle option réutilisant son identifiant", () => {
  const input = invoice();
  input.lines.push({
    ...input.lines[0],
    id: "line-2",
    label: "Panier",
    quantity: 1,
    unit: "C62",
    unit_price_ttc: 20,
    vat_category: "S",
    vat_rate: 10,
  });
  const touched = new Map([["line-2", input.lines[1]]]);
  const next = invoice();
  next.lines.push({
    ...next.lines[0],
    id: "line-2",
    label: "Ménage",
    quantity: 1,
    unit: "C62",
    unit_price_ttc: 40,
  });
  next.lines.push({ ...input.lines[1], id: "line-3" });
  const result = applyIndividualVatPreset(next, context, {}, touched);
  assert.equal(result.input.lines[1].vat_category, "E");
  assert.equal(result.input.lines[2].vat_category, "S");
  assert.equal(result.input.lines[2].vat_rate, 10);
});
