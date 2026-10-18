import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { emptyInvoiceFiscalInput } from "@contrats/shared";
import { WorkshopDocument } from "../src/pages/shared/SandboxWorkshopDocument.tsx";
import {
  canSendWorkshop,
  workshopStep,
  type WorkshopRun,
} from "../src/pages/shared/sandboxWorkshopState.ts";

const run: WorkshopRun = {
  id: "f9162699-3817-4299-98df-484087e09676",
  revision: 0,
  createdAt: "2026-10-18T12:00:00Z",
  date: "2026-10-18",
  number: "TEST-FA-EXAMPLE",
  kind: "invoice",
  writable: true,
  source: { reservationId: "source", label: "Séjour fictif", total: 175 },
  original: null,
  input: emptyInvoiceFiscalInput(),
  status: "draft",
  nativeSha: null,
  artifactSha: null,
  remoteId: null,
  error: null,
  issues: ["Choisir la TVA"],
  validation: null,
  events: [],
  hasSendIntent: false,
  hasCredit: false,
};
const markup = (value = run) =>
  renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: "/factures/test-superpdp" },
      createElement(WorkshopDocument, {
        run: value,
        active: true,
        busy: false,
        action: async () => {},
        onDirty: () => {},
      }),
    ),
  );
test("les quatre étapes sont explicites et l’envoi ne dépend jamais du seul affichage d’un PDF", () => {
  assert.equal(workshopStep(null), 0);
  assert.equal(workshopStep(run), 1);
  assert.equal(workshopStep({ ...run, status: "ready" }), 2);
  assert.equal(workshopStep({ ...run, status: "submitted" }), 3);
  for (const status of [
    "draft",
    "issued",
    "send_unknown",
    "submitted",
    "preparing",
    "prepare_failed",
  ])
    assert.equal(canSendWorkshop({ ...run, status }), false);
  assert.equal(canSendWorkshop({ ...run, status: "ready" }), true);
  assert.equal(
    canSendWorkshop({ ...run, status: "ready", writable: false }),
    false,
  );
  assert.equal(
    canSendWorkshop({ ...run, status: "ready", hasSendIntent: true }),
    false,
  );
});
test("le brouillon de test ne propose pas de modifier des identités ou un SIRET", () => {
  const html = markup();
  assert.match(html, /Facture de test/);
  assert.match(html, /Burger Queen et Tricatel/);
  assert.ok(!html.includes('id="buyer-siren"'));
  assert.ok(!html.includes('id="buyer-address"'));
  assert.match(html, /aucun SIRET inventé/);
  assert.match(html, /Émettre le document test/);
});
test("document prêt, renvoi bloqué, pause après redémarrage et avoir sont distingués", () => {
  const html = markup({
    ...run,
    status: "ready",
    nativeSha: "a",
    artifactSha: "b",
    validation: { valid: true, checks: 191, failures: [] },
  });
  assert.match(html, /Télécharger et relire le Factur-X final/);
  assert.match(html, /Envoyer ce test à Tricatel/);
  assert.ok(html.includes('type="checkbox" disabled=""'));
  const unknown = markup({
    ...run,
    status: "send_unknown",
    hasSendIntent: true,
    writable: false,
  });
  assert.match(unknown, /Lecture seule après redémarrage/);
  assert.match(unknown, /Vérifier les statuts, sans renvoyer/);
  assert.ok(!unknown.includes("Envoyer ce test à Tricatel"));
  const credit = markup({
    ...run,
    kind: "credit_note",
    original: { id: run.id, number: "TEST-ORIGINAL", date: run.date },
  });
  assert.match(credit, /Avoir intégral de test/);
  assert.match(credit, /TEST-ORIGINAL/);
});
test("B2C : particulier explicite, encaissements séparés et aucune option d’avoir ou d’achat entrant", () => {
  const html = markup({
    ...run,
    scenario: "b2c",
    status: "submitted",
    payments: [],
    reporting: null,
  });
  assert.match(html, /Facture B2C de test/);
  assert.match(html, /particulier entièrement fictif/);
  assert.match(html, /aucun paiement réel|Aucun transfert|paiement réel/);
  assert.match(html, /Non vérifiée/);
  assert.ok(!html.includes("Créer l’avoir intégral"));
  assert.ok(!html.includes("Consulter les achats reçus"));
  assert.match(html, /Aucune déclaration rattachée/);
});
