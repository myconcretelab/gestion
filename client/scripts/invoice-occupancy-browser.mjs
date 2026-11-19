import assert from "node:assert/strict";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { DEFAULT_TOURIST_TAX_COLLECTION } from "@contrats/shared";

const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(root, "__invoice_occupancy_test.html");
const screenshots = await mkdtemp(path.join(tmpdir(), "invoice-occupancy-"));
const gite = {
  id: "g1",
  nom: "Gîte de test",
  capacite_max: 4,
  nb_adultes_max: 4,
  nb_enfants_max: 0,
  prix_nuit_liste: [70],
  arrhes_taux_defaut: 0.2,
};
const reservation = {
  id: "r1",
  gite_id: "g1",
  gite,
  hote_nom: "Client de test",
  nb_adultes: 2,
  nb_enfants_2_17: 2,
  date_entree: "2026-10-20",
  date_sortie: "2026-10-23",
  nb_nuits: 3,
  prix_par_nuit: 70,
  prix_total: 210,
  remise_montant: 0,
  frais_optionnels_montant: 0,
  options: {},
};
const fiscalInput = {
  version: 1,
  buyer: {
    kind: "individual",
    country_code: "FR",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    siren: "",
    vat_number: "",
  },
  lines: [
    {
      id: "line-1",
      label: "Location",
      quantity: 3,
      unit: "DAY",
      unit_price_ttc: 70,
      vat_category: "E",
      vat_rate: 0,
      exemption_reason: "TVA non applicable, article 293 B du CGI",
    },
  ],
};
const touristTax = {
  version: 1, stay_label: "", collector: "host", platform: "",
  included: false, classified: true, nights: 3, occupants: 4,
  taxable_adults: 2, exempt_people: 2, exemption_reason: "",
  unit_amount: 1, amount: 6, host_amount: 6, accommodation_amount: 210,
  authority: "Commune de test", issues: [],
};
let browser;
let vite;
try {
  await writeFile(
    fixture,
    `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Form from "/src/pages/FactureFormPage.tsx";
import List from "/src/pages/FacturesListPage.tsx";
import "/src/styles.css";
const view = new URLSearchParams(location.search).get("view");
history.replaceState(null, "", view === "list" ? "/factures" : view === "edit" ? "/factures/draft-1/edition" : "/factures/nouvelle?fromReservationId=r1");
createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(Routes,null,
  React.createElement(Route,{path:"/factures",element:React.createElement(List)}),
  React.createElement(Route,{path:"/factures/:id/edition",element:React.createElement(Form)}),
  React.createElement(Route,{path:"/factures/nouvelle",element:React.createElement(Form)}),
)));
</script></body></html>`,
  );
  vite = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let childrenMax = 0;
  let saveAttempts = 0;
  let savedInvoice;
  let listInvoices = [];
  let manualPreviewGate;
  const savedPayloads = [];
  const addressQueries = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body;
    if (pathname === "/api/gites") body = [{ ...gite, nb_enfants_max: childrenMax }];
    else if (pathname === "/api/settings/tourist-tax-collection/defaults")
      body = DEFAULT_TOURIST_TAX_COLLECTION;
    else if (pathname === "/api/gites/g1")
      body = { ...gite, nb_enfants_max: childrenMax };
    else if (pathname === "/api/reservations/invoice-options")
      body = [reservation];
    else if (pathname === "/api/reservations/prefill/r1") body = reservation;
    else if (pathname === "/api/invoices" && method === "GET") body = listInvoices;
    else if (pathname === "/api/invoices/draft-1" && method === "GET") body = savedInvoice;
    else if (pathname === "/api/invoices/draft-1" && method === "PUT") {
      const payload = route.request().postDataJSON();
      assert.equal(payload.revision, savedInvoice.revision);
      body = savedInvoice = { ...savedInvoice, ...payload, revision: savedInvoice.revision + 1 };
    }
    else if (pathname === "/api/invoices/address-suggestions" && method === "POST") {
      const input = route.request().postDataJSON();
      addressQueries.push(input.query);
      assert.deepEqual(Object.keys(input), ["query"]);
      if (input.query === "Service indisponible") {
        return route.fulfill({ status: 503, json: { error: "Suggestions indisponibles." } });
      }
      body = [
        { address_line1: "5 rue du Grand Pré", postal_code: "87280", city: "Limoges" },
        { address_line1: "5 Rue du Grand Pré", postal_code: "60000", city: "Beauvais" },
      ];
    }
    else if (pathname === "/api/invoices/fiscal-preview") {
      const input = route.request().postDataJSON();
      if (input.locataire_nom && manualPreviewGate) await manualPreviewGate;
      const exempt = input.nb_enfants_2_17 ?? 0;
      const touristTaxes = [{ ...touristTax, occupants: 2 + exempt, exempt_people: exempt }];
      body = {
        fiscal_input: { ...fiscalInput, tourist_taxes: touristTaxes },
        validation_options: {
          vatRegime: "franchise_en_base",
          sellerCountryCode: "FR",
          touristTax: 6,
          touristTaxes,
        },
      };
    }
    else if (pathname === "/api/invoices/preview-html") {
      const theme = route.request().postDataJSON().clauses?.invoice_theme ?? "heritage";
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Facture</title><body data-invoice-theme="${theme}"><p>Brouillon de test</p></body>`,
      });
      return;
    } else if (pathname === "/api/invoices" && method === "POST") {
      saveAttempts++;
      const payload = route.request().postDataJSON();
      savedPayloads.push(payload);
      if (saveAttempts === 1) {
        // A setting changed on the server after the form loaded: the error must still be visible.
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Validation",
            details: {
              fieldErrors: {
                nb_enfants_2_17: ["Aucun enfant n'est configuré pour ce gîte."],
              },
            },
          }),
        });
        return;
      }
      body = savedInvoice = {
        ...payload,
        id: "draft-1",
        revision: 1,
        lifecycle_status: "draft",
        document_kind: "invoice",
      };
    } else throw new Error(`Unexpected request: ${method} ${pathname}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  const fixtureUrl = `http://127.0.0.1:${vite.httpServer.address().port}/__invoice_occupancy_test.html`;
  await page.goto(fixtureUrl);
  const children = page.locator("#invoice-children");
  await page.waitForFunction(
    () => document.querySelector("#invoice-children")?.value === "2",
  );
  assert.equal(
    await page.locator("#invoice-adults").inputValue(),
    "2",
  );
  assert.equal(await children.getAttribute("aria-invalid"), "true");
  await page.locator("#invoice-children-error").waitFor();
  assert.match(
    await page.locator("#invoice-children-error").innerText(),
    /Aucun enfant/,
  );
  const save = page.getByRole("button", {
    name: "Enregistrer ma facture en brouillon",
    exact: true,
  });
  assert.equal(await save.isDisabled(), true);
  const assistant = page.getByRole("complementary", {
    name: "Assistant de création de facture",
  });
  await assistant.locator(".form-assistant__toggle").click();
  await assistant
    .getByRole("button", { name: /Aucun enfant n'est configuré/ })
    .click();
  assert.equal(
    await children.evaluate((input) => input === document.activeElement),
    true,
  );
  const config = page.getByRole("link", {
    name: /capacités configurées du gîte/,
  });
  assert.equal(await config.getAttribute("target"), "_blank");
  assert.match(await config.getAttribute("href"), /gite=g1&section=base-fiche/);
  await page.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(screenshots, "mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  childrenMax = 2;
  await page
    .getByRole("button", {
      name: "Actualiser les capacités après modification",
    })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#invoice-children")
        ?.getAttribute("aria-invalid") === "false",
  );
  assert.equal(
    await children.inputValue(),
    "2",
    "Refreshing capacities preserves the entered children",
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Nom et prénom", exact: true })
      .inputValue(),
    "Client de test",
  );
  await save.click();
  await page.locator("#invoice-children-error").waitFor();
  assert.equal(saveAttempts, 1);
  await assistant.locator(".form-assistant__toggle").click();
  await assistant
    .getByRole("button", { name: /Aucun enfant n'est configuré/ })
    .waitFor();
  await children.fill("1");
  await children.fill("2");
  await page.waitForFunction(
    () =>
      document
        .querySelector("#invoice-children")
        ?.getAttribute("aria-invalid") === "false",
  );
  const fiscalReview = page.locator("#invoice-reviewed");
  const taxReview = page.locator("#tourist-tax-reviewed");
  await save.waitFor();
  await page.waitForFunction(() => !document.querySelector("#invoice-save button")?.disabled);
  await fiscalReview.check();
  await taxReview.check();
  assert.equal(await fiscalReview.isChecked(), true, "La taxe et la vérification fiscale se cochent dans les deux ordres");

  await page.getByText("Une précision à ajouter ?", { exact: false }).click();
  await page.getByLabel("Clause additionnelle", { exact: true }).fill("Arrivée convenue avec le client.");
  await page.locator("#invoice-buyer-phone").fill("0612345678");
  assert.equal(await fiscalReview.isChecked(), true);
  assert.equal(await taxReview.isChecked(), true);

  const paidAmount = page.getByLabel("Sommes réellement reçues (€)");
  const { promise, resolve } = Promise.withResolvers();
  manualPreviewGate = promise;
  const recalculate = page.getByRole("button", { name: "Recalculer les lignes", exact: true });
  page.once("dialog", (dialog) => dialog.accept());
  await recalculate.click();
  await page.getByRole("button", { name: "Préparation…", exact: true }).waitFor();
  await paidAmount.fill("20");
  await fiscalReview.check();
  resolve();
  await recalculate.waitFor();
  assert.equal(await paidAmount.inputValue(), "20", "Le recalcul conserve la saisie effectuée en attendant.");
  assert.equal(await fiscalReview.isChecked(), true);
  assert.equal(await taxReview.isChecked(), true);

  const unchangedPreview = page.waitForResponse((response) => response.url().endsWith("/invoices/fiscal-preview"));
  await page.getByText("Ajouter une ventilation personnalisée", { exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une ligne de ventilation", exact: true }).click();
  assert.equal(await fiscalReview.isChecked(), false, "La ventilation modifiée doit être vérifiée.");
  await fiscalReview.check();
  await unchangedPreview;
  await page.waitForFunction(() => !document.querySelector("#invoice-save button")?.disabled);
  assert.equal(await fiscalReview.isChecked(), true, "Le recalcul identique préserve la vérification des lignes manuelles.");
  assert.equal(await taxReview.isChecked(), true);

  await children.fill("1");
  await page.getByText(/1 personne\(s\) exonérée\(s\)/).waitFor();
  assert.equal(await taxReview.isChecked(), false, "Le nombre de personnes exonérées a changé.");
  assert.equal(await fiscalReview.isChecked(), true);
  await children.fill("2");
  await page.getByText(/2 personne\(s\) exonérée\(s\)/).waitFor();
  await taxReview.check();
  await paidAmount.fill("50");
  assert.equal(await fiscalReview.isChecked(), false, "Le montant encaissé a changé.");
  assert.equal(await taxReview.isChecked(), true);
  await fiscalReview.check();
  const themePicker = page.getByRole("group", { name: "Modèle de facture" });
  const heritageTheme = themePicker.getByRole("button", { name: /^Héritage Par défaut/ });
  const signatureTheme = themePicker.getByRole("button", { name: /^Signature/ });
  const invoicePreview = page.frameLocator('iframe[title="Prévisualisation facture"]');
  assert.equal(await heritageTheme.getAttribute("aria-pressed"), "true");
  await signatureTheme.click();
  await invoicePreview.locator('body[data-invoice-theme="signature"]').waitFor();
  await save.click();
  await page
    .getByRole("link", { name: /Ouvrir la fiche pour vérifier/ })
    .waitFor();
  assert.equal(saveAttempts, 2);
  assert.equal(savedPayloads[1].nb_adultes, 2);
  assert.equal(savedPayloads[1].nb_enfants_2_17, 2);
  assert.equal(savedPayloads[1].locataire_nom, "Client de test");
  assert.equal(savedPayloads[1].fiscal_input.reviewed, true);
  assert.equal(savedPayloads[1].fiscal_input.tourist_tax_reviewed, true);
  assert.equal(savedPayloads[1].clauses.invoice_theme, "signature");

  const restoredPreview = page.waitForResponse((response) => response.url().endsWith("/invoices/fiscal-preview"));
  await page.goto(`${fixtureUrl}?view=edit`);
  await restoredPreview;
  await page.waitForFunction(() => !document.querySelector("#invoice-save button")?.disabled);
  assert.equal(await fiscalReview.isChecked(), true, "La réouverture conserve la validation enregistrée.");
  assert.equal(await taxReview.isChecked(), true);
  assert.equal(await signatureTheme.getAttribute("aria-pressed"), "true");

  await themePicker.getByRole("button", { name: /^Horizon/ }).click();
  await invoicePreview.locator('body[data-invoice-theme="horizon"]').waitFor();
  await heritageTheme.click();
  assert.equal(await heritageTheme.getAttribute("aria-pressed"), "true");
  await invoicePreview.locator('body[data-invoice-theme="heritage"]').waitFor();
  assert.equal(await fiscalReview.isChecked(), true);
  await page.getByRole("button", { name: "Enregistrer les modifications", exact: true }).click();
  await page.getByRole("link", { name: /Ouvrir la fiche pour vérifier/ }).waitFor();
  assert.equal(savedInvoice.clauses.invoice_theme, "heritage");

  listInvoices = [
    { ...savedInvoice, locataire_nom: "Client avec deux points", fiscal_issues: ["Adresse", "TVA"] },
    { ...savedInvoice, id: "draft-2", locataire_nom: "Client avec un point", fiscal_issues: ["Adresse"] },
    { ...savedInvoice, id: "draft-3", locataire_nom: "Client avec zéro point", fiscal_issues: [] },
    { ...savedInvoice, id: "issued-1", numero_facture: "2027-01", locataire_nom: "Client facturé", lifecycle_status: "issued", fiscal_issues: ["Adresse"] },
    { ...savedInvoice, id: "credit-1", locataire_nom: "Client avec avoir", document_kind: "credit_note", fiscal_issues: [] },
  ];
  await page.goto(`${fixtureUrl}?view=list`);
  await page.getByRole("row").filter({ hasText: "Client avec deux points" }).getByText("2 points à compléter", { exact: true }).waitFor();
  await page.getByRole("row").filter({ hasText: "Client avec un point" }).getByText("1 point à compléter", { exact: true }).waitFor();
  await page.getByRole("row").filter({ hasText: "Client avec zéro point" }).getByText("Aucun point fiscal à compléter", { exact: true }).waitFor();
  const issuedRow = page.getByRole("row").filter({ hasText: "Client facturé" });
  assert.doesNotMatch(await issuedRow.innerText(), /à compléter/);
  assert.equal(await issuedRow.getByRole("link", { name: "Modifier", exact: true }).count(), 0);
  assert.equal(await page.getByRole("row").filter({ hasText: "Client avec avoir" }).getByRole("link", { name: "Modifier", exact: true }).count(), 0);
  const draftRow = page.getByRole("row").filter({ hasText: "Client avec deux points" });
  const invoiceTable = page.getByRole("region", { name: "Tableau des factures" });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [row, count] of [[draftRow, 3], [issuedRow, 2]]) {
      const positions = await row.locator(".table-actions > *").evaluateAll((actions) =>
        actions.map((action) => {
          const { left, right, top, height } = action.getBoundingClientRect();
          return { left, right, center: top + height / 2 };
        }),
      );
      assert.equal(positions.length, count);
      for (const [index, action] of positions.entries()) {
        assert.ok(Math.abs(action.center - positions[0].center) < 2, `Actions alignées à ${width} px`);
        if (index) assert.ok(positions[index - 1].right < action.left);
      }
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.ok(await invoiceTable.evaluate((table) => table.scrollWidth > table.clientWidth));
  await issuedRow.getByRole("button", { name: /Actions pour la facture/ }).click();
  await page.getByRole("menuitem", { name: "Envoyer par email" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await draftRow.getByRole("link", { name: "Modifier", exact: true }).click();
  await page.waitForURL("**/factures/draft-1/edition");
  await page.waitForFunction(() => document.querySelector("#invoice-buyer-name")?.value === "Client de test");

  const address = page.locator("#buyer-address");
  const postalCode = page.locator("#buyer-postal-code");
  const city = page.locator("#buyer-city");
  const complement = page.getByLabel("Complément d’adresse");
  const suggestions = page.getByRole("listbox", { name: "Suggestions d’adresses" });
  for (const field of [
    address, postalCode, city, complement, page.locator("#buyer-country"),
    page.locator("#invoice-buyer-name"), page.locator("#invoice-buyer-phone"), page.locator("#invoice-buyer-email"),
  ]) {
    assert.equal(await field.getAttribute("autocomplete"), "off");
  }
  assert.equal(addressQueries.length, 0);
  await complement.fill("Appartement 4");
  await address.fill("cin");
  await address.fill("cinq rue du Grand Pré");
  await suggestions.getByRole("option", { name: /60000 Beauvais/ }).waitFor();
  assert.deepEqual(addressQueries, ["cinq rue du Grand Pré"]);
  await address.press("ArrowDown");
  await address.press("ArrowDown");
  assert.equal(await suggestions.getByRole("option", { name: /60000 Beauvais/ }).getAttribute("aria-selected"), "true");
  await address.press("Enter");
  await suggestions.waitFor({ state: "hidden" });
  assert.equal(await address.inputValue(), "5 Rue du Grand Pré");
  assert.equal(await postalCode.inputValue(), "60000");
  assert.equal(await city.inputValue(), "Beauvais");
  assert.equal(await complement.inputValue(), "Appartement 4");

  await page.setViewportSize({ width: 390, height: 900 });
  await address.fill("5 rue du Grand");
  await suggestions.getByRole("option", { name: /87280 Limoges/ }).waitFor();
  await address.evaluate((input) => input.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(screenshots, "address-suggestions-mobile.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await suggestions.getByRole("option", { name: /87280 Limoges/ }).click();
  assert.equal(await city.inputValue(), "Limoges");
  assert.equal(await postalCode.inputValue(), "87280");

  await address.fill("Service indisponible");
  await page.getByText("Suggestions indisponibles. Vous pouvez continuer la saisie.", { exact: true }).waitFor();
  await city.fill("Rennes");
  assert.equal(await city.inputValue(), "Rennes");
  const requestsWithFrance = addressQueries.length;
  await page.locator("#buyer-country").selectOption("BE");
  await address.fill("Rue manuelle en Belgique");
  await page.waitForTimeout(450);
  assert.equal(addressQueries.length, requestsWithFrance);
  assert.equal(await address.getAttribute("autocomplete"), "off");
  assert.equal(await address.inputValue(), "Rue manuelle en Belgique");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, saveAttempts, screenshots }));
} finally {
  await browser?.close();
  await vite?.close();
  await unlink(fixture).catch(() => {});
}
