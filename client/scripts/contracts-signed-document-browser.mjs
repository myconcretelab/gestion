import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const screenshots = await mkdtemp(
  path.join(tmpdir(), "contracts-signed-document-"),
);
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
const originalContract = {
  id: "contract-a",
  numero_contrat: "LIB-2027-000003",
  gite_id: "g1",
  date_creation: "2026-10-20T10:00:00Z",
  date_derniere_modif: "2026-10-25T10:00:00Z",
  locataire_nom: "Camille Martin",
  locataire_adresse: "10 rue des Lilas",
  locataire_tel: "",
  nb_adultes: 2,
  nb_enfants_2_17: 1,
  date_debut: "2027-04-02",
  date_fin: "2027-04-05",
  heure_arrivee: "17:00",
  heure_depart: "12:00",
  nb_nuits: 3,
  prix_par_nuit: 250,
  remise_montant: 0,
  options: {},
  clauses: {},
  arrhes_montant: 140,
  arrhes_date_limite: "2026-10-25",
  solde_montant: 610,
  caution_montant: 500,
  cheque_menage_montant: 80,
  pdf_path: "contract.pdf",
  pdf_sent_path: "contract-sent.pdf",
  statut_reception_contrat: "recu",
  date_reception_contrat: "2026-10-25T10:00:00Z",
  statut_paiement_arrhes: "recu",
  date_paiement_arrhes: "2026-10-25T10:00:00Z",
  mode_paiement_arrhes: "Virement",
  statut_paiement_solde: "non_regle",
  commentaire_interne: "Retour validé, conserver les options.",
  reservation_id: "reservation-a",
  payments_managed: true,
  gite: { id: "g1", nom: "La Libellule", prefixe_contrat: "LIB" },
};
let contract = structuredClone(originalContract);
let linkedReservation = {
  id: "reservation-a",
  gite_id: "g1",
  hote_nom: originalContract.locataire_nom,
  adresse: null,
  email: "camille@example.com",
  telephone: null,
  booking_source: "Direct",
  payments_managed: true,
  date_entree: originalContract.date_debut,
  date_sortie: originalContract.date_fin,
  nb_nuits: originalContract.nb_nuits,
  nb_adultes: originalContract.nb_adultes,
  nb_enfants_2_17: originalContract.nb_enfants_2_17,
  prix_par_nuit: originalContract.prix_par_nuit,
  options: {},
};
let failUpload = false;
let uploads = 0;
const returnUpdates = [];
const unexpectedRequests = [];
const errors = [];
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    let body;
    if (pathname === "/api/auth/session") {
      body = {
        required: true,
        authenticated: true,
        user: {
          id: "test",
          status: "custom",
          displayName: "Compte de test",
          pageAccess: ["contracts", "invoices"],
          permissions: { isOwner: false, canWrite: true, canViewAmounts: true },
        },
      };
    } else if (pathname === "/api/installation/public-config") {
      body = {
        setupComplete: true,
        organization: {
          tradeName: "Gestion des séjours",
          publicDisplayName: "Gestion des séjours",
          primaryColor: "#ff575f",
          logoUrl: "",
          faviconUrl: "",
          locale: "fr-FR",
          currency: "EUR",
          country: "FR",
          timezone: "Europe/Paris",
        },
        modules: {
          contracts: true,
          invoices: true,
          reservations: false,
          ical: false,
          pump_airbnb: false,
        },
      };
    } else if (pathname === "/api/gites") {
      body = [contract.gite];
    } else if (pathname === "/api/contracts") {
      body = [contract];
    } else if (pathname === "/api/contracts/contract-a") {
      const { adresse, email, telephone } = linkedReservation;
      body = { ...contract, reservation_contact: contract.reservation_id ? { adresse, email, telephone } : null };
    } else if (["/api/reservations/reservation-a", "/api/reservations/prefill/reservation-a"].includes(pathname)) {
      body = linkedReservation;
    } else if (pathname === "/api/reservations/invoice-options") {
      body = [linkedReservation];
    } else if (pathname === "/api/invoices") {
      body = [];
    } else if (pathname === "/api/invoices/fiscal-preview") {
      body = { fiscal_input: { lines: [], tourist_taxes: [] }, validation_options: {} };
    } else if (pathname === "/api/settings/tourist-tax-collection/defaults") {
      body = { rules: [], sources: [] };
    } else if (
      pathname === "/api/contracts/contract-a/return-processing" &&
      method === "PATCH"
    ) {
      const input = request.postDataJSON();
      returnUpdates.push(input);
      const { reservation, ...tracking } = input;
      linkedReservation = { ...linkedReservation, ...reservation?.contact };
      contract = { ...contract, ...tracking };
      body = contract;
    } else if (
      pathname === "/api/contracts/contract-a/signed-document" &&
      method === "POST"
    ) {
      uploads++;
      if (failUpload)
        return route.fulfill({
          status: 503,
          json: { error: "Envoi temporairement indisponible." },
        });
      const input = request.postDataJSON();
      assert.equal(
        Buffer.from(input.data, "base64").toString(),
        pdf.toString(),
      );
      assert.equal(input.mimeType, "application/pdf");
      contract = {
        ...contract,
        signed_document_filename: input.filename,
        signed_document_path: "signed-contract.pdf",
        signed_document_mime_type: input.mimeType,
        signed_document_size: pdf.length,
        signed_document_uploaded_at: new Date().toISOString(),
      };
      // The existing upload response omits the derived payment flag.
      const { payments_managed, ...response } = contract;
      body = response;
    } else if (
      /\/api\/contracts\/contract-a\/(signed-document|pdf)$/.test(pathname) &&
      method === "GET"
    ) {
      return route.fulfill({ contentType: "application/pdf", body: pdf });
    } else {
      unexpectedRequests.push(`${method} ${pathname}`);
      return route.fulfill({
        status: 500,
        json: { error: `Requête inattendue : ${method} ${pathname}` },
      });
    }
    return route.fulfill({ json: body });
  });
  const dialog = page.getByRole("dialog", {
    name: `Contrat ${contract.numero_contrat}`,
    exact: true,
  });
  const save = dialog.getByRole("button", {
    name: "Enregistrer le document",
    exact: true,
  });
  const file = () => dialog.locator('input[type="file"]');
  const selectPdf = (name = "contrat-photographie.pdf") =>
    file().setInputFiles({ name, mimeType: "application/pdf", buffer: pdf });
  const menu = () =>
    page.getByRole("button", {
      name: `Actions pour le contrat ${contract.numero_contrat}`,
      exact: true,
    });
  const waitForUpload = async () => {
    await dialog.waitFor();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("type") === "file",
    );
  };

  await page.goto(`${origin}/contrats`);
  await page.getByText("Retour reçu", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Ajouter le contrat signé", exact: true })
    .click();
  await waitForUpload();
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await menu().click();
  await page
    .getByRole("menuitem", { name: "Ajouter le contrat signé", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Voir le contrat signé", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: path.join(screenshots, "menu-desktop.png"),
    animations: "disabled",
  });
  await page
    .getByRole("menuitem", { name: "Ajouter le contrat signé", exact: true })
    .click();
  await waitForUpload();
  assert.equal(
    await dialog.getByText("Retour courrier", { exact: true }).count(),
    0,
  );
  assert.equal(await save.isDisabled(), true);
  await file().setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await dialog.getByText(/Format non pris en charge/).waitFor();
  assert.equal(await save.isDisabled(), true);
  await file().setInputFiles({
    name: "trop-grand.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(12 * 1024 * 1024 + 1),
  });
  await dialog.getByText(/dépasse 12 Mo/).waitFor();
  assert.equal(await save.isDisabled(), true);
  await selectPdf();
  await dialog.getByText(/Nouveau fichier prêt/).waitFor();
  await page.screenshot({ path: path.join(screenshots, "upload-desktop.png") });
  failUpload = true;
  await save.click();
  await dialog
    .getByText("Envoi temporairement indisponible.", { exact: true })
    .waitFor();
  assert.equal(contract.signed_document_path, undefined);
  assert.equal(await save.isDisabled(), false);
  failUpload = false;
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByText("Le contrat signé a été enregistré.", { exact: true })
    .waitFor();
  assert.equal(uploads, 2);
  for (const [key, value] of Object.entries(originalContract))
    assert.deepEqual(contract[key], value, key);
  await page.reload();
  await page.locator(".contract-return-status").hover();
  await page
    .getByRole("button", {
      name: `Voir le contrat signé ${contract.numero_contrat}`,
      exact: true,
    })
    .click();
  const preview = page.getByRole("dialog", {
    name: `Contrat signe ${contract.numero_contrat}`,
    exact: true,
  });
  await preview.waitFor();
  assert.match(
    await preview.locator("iframe").getAttribute("src"),
    /\/signed-document\?/,
  );
  await preview.getByRole("button", { name: "Fermer", exact: true }).click();
  await menu().click();
  await page
    .getByRole("menuitem", { name: "Voir le contrat signé", exact: true })
    .click();
  await preview.waitFor();
  await preview
    .getByText("contrat-photographie.pdf", { exact: true })
    .waitFor();
  assert.match(
    await preview.locator("iframe").getAttribute("src"),
    /\/signed-document\?/,
  );
  await preview.getByRole("button", { name: "Fermer", exact: true }).click();
  await menu().click();
  await page
    .getByRole("menuitem", { name: "Remplacer le contrat signé", exact: true })
    .click();
  await waitForUpload();
  await dialog.getByText(/Document enregistré/).waitFor();
  await selectPdf("autre-scan.pdf");
  await dialog.getByText(/Nouveau fichier prêt/).waitFor();
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  assert.equal(contract.signed_document_filename, "contrat-photographie.pdf");
  assert.equal(uploads, 2);

  // A separate visit to the detail page also supports upload on mobile.
  contract = structuredClone(originalContract);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/contrats/contract-a`);
  await page
    .getByRole("button", { name: "Ajouter le contrat signé", exact: true })
    .click();
  await waitForUpload();
  await selectPdf();
  await dialog.getByText(/Nouveau fichier prêt/).waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await page.screenshot({ path: path.join(screenshots, "upload-mobile.png") });
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByLabel("Date de réception du contrat", { exact: true })
      .inputValue(),
    "2026-10-25",
  );
  assert.equal(
    await page
      .getByLabel("Date de paiement des arrhes", { exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Voir le contrat retourné", exact: true })
    .click();
  await preview.waitFor();
  await preview.getByRole("button", { name: "Fermer", exact: true }).click();
  await page
    .getByRole("button", { name: "Remplacer le contrat signé", exact: true })
    .click();
  await waitForUpload();
  await selectPdf("contrat-complet.pdf");
  await dialog.getByText(/Nouveau fichier prêt/).waitFor();
  await save.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(contract.signed_document_filename, "contrat-complet.pdf");
  assert.equal(uploads, 4);
  assert.deepEqual(returnUpdates, []);
  await page.goto(`${origin}/contrats`);
  await menu().click();
  await page
    .getByRole("menuitem", { name: "Remplacer le contrat signé", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(screenshots, "menu-mobile.png"),
    animations: "disabled",
  });
  await page
    .getByRole("menuitem", { name: "Voir le contrat signé", exact: true })
    .click();
  await preview.waitFor();
  await preview.getByText("contrat-complet.pdf", { exact: true }).waitFor();
  await preview.getByRole("button", { name: "Fermer", exact: true }).click();
  await menu().click();
  await page
    .getByRole("menuitem", { name: "Remplacer le contrat signé", exact: true })
    .click();
  await waitForUpload();
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();

  // The normal return workflow still displays and saves its tracking fields.
  contract = {
    ...originalContract,
    reservation_id: null,
    payments_managed: false,
    statut_reception_contrat: "non_recu",
  };
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`${origin}/contrats`);
  await page
    .getByRole("button", { name: "Traiter le retour", exact: true })
    .click();
  await dialog.getByText("Retour courrier", { exact: true }).waitFor();
  await dialog.getByText("Notes internes", { exact: true }).waitFor();
  await dialog
    .locator(".contract-return-drawer__toggle-field .switch")
    .first()
    .click();
  assert.equal(await dialog.getByRole("checkbox").first().isChecked(), true);
  await dialog
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(returnUpdates.length, 1);
  assert.equal(contract.statut_reception_contrat, "recu");
  assert.equal(returnUpdates[0].reservation.contact, undefined);

  contract = { ...originalContract, statut_reception_contrat: "non_recu" };
  await page.goto(`${origin}/contrats`);
  await page.getByRole("button", { name: "Traiter le retour", exact: true }).click();
  const contactSummary = dialog.getByText("Coordonnées du locataire", { exact: true });
  const address = dialog.getByLabel("Adresse postale");
  const email = dialog.getByLabel("Adresse e-mail");
  const phone = dialog.getByLabel("Téléphone");
  const saveReturn = dialog.getByRole("button", { name: "Enregistrer", exact: true });
  await contactSummary.waitFor();
  assert.equal(await address.isVisible(), false);
  await contactSummary.focus();
  await contactSummary.press("Enter");
  assert.equal(await address.inputValue(), originalContract.locataire_adresse);
  assert.equal(await email.inputValue(), "camille@example.com");
  await email.fill("invalide");
  await contactSummary.click();
  await saveReturn.click();
  await email.waitFor();
  assert.equal(returnUpdates.length, 1);
  await email.fill("nouvelle.adresse@example.com");
  await address.fill("12 rue des Lilas\n35000 Rennes");
  await phone.fill("+33 6 12 34 56 78");
  await page.screenshot({ path: path.join(screenshots, "coordonnees-locataire.png") });
  await saveReturn.click();
  await dialog.waitFor({ state: "hidden" });
  const savedContact = {
    adresse: "12 rue des Lilas\n35000 Rennes",
    email: "nouvelle.adresse@example.com",
    telephone: "+33 6 12 34 56 78",
  };
  assert.deepEqual(returnUpdates[1].reservation.contact, savedContact);
  assert.equal(contract.locataire_adresse, originalContract.locataire_adresse);

  await page.getByRole("button", { name: "Traiter le retour", exact: true }).click();
  await contactSummary.click();
  assert.equal(await address.inputValue(), savedContact.adresse);
  assert.equal(await email.inputValue(), savedContact.email);
  assert.equal(await phone.inputValue(), savedContact.telephone);
  await saveReturn.click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(returnUpdates[2].reservation.contact, undefined);

  for (const source of ["fromContractId=contract-a", "fromReservationId=reservation-a"]) {
    await page.goto(`${origin}/factures/nouvelle?${source}`);
    await page.getByText(/Facture préremplie depuis/).waitFor();
    assert.equal(await page.locator("#buyer-address").inputValue(), "12 rue des Lilas 35000 Rennes");
    assert.equal(await page.locator("#invoice-buyer-phone").inputValue(), savedContact.telephone);
    assert.equal(await page.locator("#invoice-buyer-email").inputValue(), savedContact.email);
  }
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    `Contrat signé, coordonnées du locataire et préremplissage de facture validés. Captures : ${screenshots}`,
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({
    path: path.join(screenshots, "failure.png"),
    animations: "disabled",
  });
  console.error(`Captures du scénario : ${screenshots}`);
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}
