import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Use the browser dependency already owned by the PDF-generating server workspace.
const serverRequire = createRequire(
  new URL("../../server/package.json", import.meta.url),
);
const { chromium } = serverRequire("playwright");
const clientRoot = fileURLToPath(new URL("..", import.meta.url));
const screenshots =
  process.env.REPORTS_SCREENSHOT_DIR ||
  (await mkdtemp(path.join(tmpdir(), "reports-prototype-")));
await mkdir(screenshots, { recursive: true });
const vite = await createServer({
  root: clientRoot,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const unexpectedRequests = [];
  const runtimeErrors = [];
  async function createPage({
    canWrite = true,
    canViewAmounts = true,
    canAccess = true,
    finances = true,
    viewport = { width: 1440, height: 1050 },
    blockedStorage = false,
  } = {}) {
    const context = await browser.newContext({ viewport });
    if (blockedStorage)
      await context.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", {
          get() {
            throw new Error("Storage unavailable for test");
          },
        });
      });
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let body;
      if (pathname === "/api/auth/session" && request.method() === "GET") {
        body = {
          required: true,
          authenticated: true,
          passwordConfigured: true,
          sessionDurationHours: 168,
          sessionExpiresAt: null,
          user: {
            id: "demo-user",
            displayName: "Compte de test",
            status: "custom",
            pageAccess: canAccess ? ["statistics"] : [],
            permissions: { isOwner: false, canWrite, canViewAmounts },
          },
        };
      } else if (
        pathname === "/api/installation/public-config" &&
        request.method() === "GET"
      ) {
        body = {
          setupComplete: true,
          organization: {
            tradeName: "Atelier des séjours",
            publicDisplayName: "Atelier des séjours",
            primaryColor: "#315f4b",
            logoUrl: "",
            faviconUrl: "",
            locale: "fr-FR",
            currency: "EUR",
            country: "FR",
            timezone: "Europe/Paris",
            website: "",
          },
          modules: { finances },
        };
      } else {
        unexpectedRequests.push(`${request.method()} ${pathname}`);
        body = {};
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    return page;
  }
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const capture = async (page, filename) => {
    await page.evaluate(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: path.join(screenshots, filename),
      fullPage: true,
      animations: "disabled",
    });
  };
  const page = await createPage();
  await page.goto(`${origin}/rapports`);
  await page
    .getByRole("heading", { name: "Rapports et déclarations" })
    .waitFor();
  assert.equal(await page.locator(".rp-report-row").count(), 4);
  assert.equal(
    await page
      .getByText(
        /Les bons chiffres|Quelques vérifications avant|Un fil conducteur/,
      )
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Favoris", exact: true }).click();
  assert.equal(await page.locator(".rp-report-row").count(), 1);
  await page
    .getByRole("button", { name: "Tous les rapports", exact: true })
    .click();
  await capture(page, "reports-desktop.png");
  const headerPage = await createPage();
  await headerPage.goto(`${origin}/rapports/demo-social`);
  await headerPage
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .waitFor();
  const header = headerPage.locator(".rp-page-header");
  assert.equal(await header.locator(".rp-page-description").count(), 0);
  assert.equal(
    await header.getByRole("link", { name: "Réglages", exact: true }).count(),
    1,
  );
  const titleBox = await header
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .boundingBox();
  const badgeBox = await header
    .getByText("4 à vérifier", { exact: true })
    .boundingBox();
  assert.ok(
    Math.abs(
      titleBox.y + titleBox.height / 2 - badgeBox.y - badgeBox.height / 2,
    ) < 8,
    "Status is on the title line",
  );
  assert.ok(
    (await header.boundingBox()).height < 100,
    "Desktop report header stays compact",
  );
  const backBox = await header
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .boundingBox();
  assert.ok(
    backBox.width >= 44 && backBox.height >= 44,
    "Back button has a visible, usable target",
  );
  await capture(headerPage, "reports-detail-desktop.png");
  await headerPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await overflow(headerPage), false);
  await capture(headerPage, "reports-detail-header-mobile.png");

  assert.equal(await overflow(page), false);

  // Confirm a report, change a single operation, and verify that the frozen copy survives.
  await page
    .getByRole("link", { name: "Relevé propriétaire", exact: true })
    .click();
  const initialTotal = await page.locator(".rp-total-value").innerText();
  await page
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Confirmer dans la démonstration",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Alix Robert/ }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Traitement")
    .selectOption("excluded");
  await page
    .getByRole("dialog")
    .getByLabel("Explication de votre correction")
    .fill("Correction de démonstration à rapprocher de la copie confirmée.");
  await page
    .getByRole("button", { name: "Appliquer la correction", exact: true })
    .click();
  await page
    .getByText("Les données ont évolué depuis votre confirmation.", {
      exact: true,
    })
    .waitFor();
  assert.notEqual(
    await page.locator(".rp-total-value").innerText(),
    initialTotal,
  );
  await page
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .click();
  assert.equal(await page.locator(".rp-total-value").innerText(), initialTotal);
  await page.locator(".rp-operation-row").first().click();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Appliquer la correction" })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter", exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^exemple-rapport-owner/);
  await page.reload();
  await page
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .click();
  assert.equal(await page.locator(".rp-total-value").innerText(), initialTotal);
  await page
    .getByRole("button", { name: "Revenir au calcul courant", exact: true })
    .click();

  // Drafts survive navigation/reload, and editing doesn't alter a published report until applied.
  await page.getByRole("link", { name: "Réglages", exact: true }).click();
  await page
    .getByLabel("Nom du rapport", { exact: true })
    .fill("Recettes du verger");
  await page.getByRole("checkbox", { name: "Ménage", exact: true }).uncheck();
  await capture(page, "reports-editor-desktop.png");
  await page
    .getByRole("link", { name: "Fermer le brouillon", exact: true })
    .click();
  await page.getByRole("heading", { name: "Relevé propriétaire" }).waitFor();
  await page.reload();
  assert.equal(
    await page
      .getByRole("link", { name: "Reprendre le brouillon", exact: true })
      .count(),
    0,
  );
  await page.getByRole("link", { name: "Réglages", exact: true }).click();
  assert.equal(
    await page.getByLabel("Nom du rapport", { exact: true }).inputValue(),
    "Recettes du verger",
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Ménage", exact: true })
      .isChecked(),
    false,
  );
  await page.getByLabel("Périodicité").selectOption("quarterly");
  await page
    .getByRole("button", { name: "Appliquer les règles", exact: true })
    .click();
  await page.getByRole("heading", { name: "Recettes du verger" }).waitFor();
  await page.getByRole("button", { name: /Historique/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /octobre 2026/ })
    .click();
  assert.equal(await page.locator(".rp-total-value").innerText(), initialTotal);
  await page.getByRole("heading", { name: "Relevé propriétaire" }).waitFor();

  // Creation, mobile preview, keyboard dialog dismissal and empty states.
  await page
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "reports-mobile.png");
  assert.equal(await overflow(page), false);
  await page
    .getByRole("link", { name: "Créer un rapport", exact: true })
    .click();
  await page.getByRole("button", { name: /Rapport personnalisé/ }).click();
  await page.getByLabel("Nom du rapport", { exact: true }).fill("");
  await page.getByRole("button", { name: /^Aperçu ·/ }).click();
  await page
    .getByRole("button", { name: "Créer ce rapport", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Nom du rapport", { exact: true }).isVisible(),
    true,
  );
  await page
    .getByRole("alert")
    .filter({ hasText: "Renseignez un nom" })
    .waitFor();
  await page
    .getByLabel("Nom du rapport", { exact: true })
    .fill("Mes prestations");
  await page.getByRole("button", { name: /^Aperçu ·/ }).click();
  assert.equal(await page.locator(".rp-editor-preview").isVisible(), true);
  assert.equal(await page.locator(".rp-editor-settings").isVisible(), false);
  assert.equal(await overflow(page), false);
  const toastClose = page.getByRole("button", {
    name: "Masquer la notification",
    exact: true,
  });
  if (await toastClose.count()) await toastClose.click();
  await capture(page, "reports-editor-mobile.png");
  await page
    .getByRole("button", { name: "Créer ce rapport", exact: true })
    .click();
  await page.getByRole("heading", { name: "Mes prestations" }).waitFor();
  await page.getByRole("button", { name: /^Examiner/ }).click();
  await page.getByRole("button", { name: /Lou Bernard/ }).click();
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.classList.contains("rp-operation-row"),
    ),
    true,
  );
  await capture(page, "reports-detail-mobile.png");
  await page
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .click();
  await page.getByLabel("Période de travail").fill("2027-06");
  await page
    .getByRole("link", { name: "Cotisations sociales", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Marquer comme prêt", exact: true })
      .isEnabled(),
    false,
  );

  // Access and persistence degradation work even on a direct nested URL.
  const readOnly = await createPage({ canWrite: false });
  await readOnly.goto(`${origin}/rapports/demo-social/modifier`);
  await readOnly
    .getByRole("heading", { name: "Consultation des rapports" })
    .waitFor();
  assert.equal(
    await readOnly
      .getByRole("button", { name: "Appliquer les règles" })
      .count(),
    0,
  );
  for (const options of [{ canAccess: false }, { finances: false }]) {
    const restricted = await createPage(options);
    await restricted.goto(`${origin}/rapports/demo-social`);
    await restricted
      .getByRole("heading", { name: "Page non autorisée" })
      .waitFor();
  }
  const noAmounts = await createPage({ canViewAmounts: false });
  await noAmounts.goto(`${origin}/rapports`);
  await noAmounts.getByRole("heading", { name: "Accès restreint" }).waitFor();
  const noStorage = await createPage({ blockedStorage: true });
  await noStorage.goto(`${origin}/rapports`);
  await noStorage
    .getByRole("alert")
    .filter({ hasText: "ce navigateur ne permet pas" })
    .waitFor();

  // Alerts open the relevant source form and resolve all affected operations.
  const fixes = await createPage();
  await fixes.goto(`${origin}/rapports/demo-social`);
  await fixes
    .getByRole("link", { name: "Rattacher le gîte", exact: true })
    .click();
  await fixes
    .getByRole("heading", {
      name: "Rattacher le gîte à un exploitant",
      exact: true,
    })
    .waitFor();
  await fixes.getByLabel("Exploitant").selectOption("operator-a");
  await fixes.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await fixes
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .waitFor();
  assert.equal(
    await fixes
      .getByRole("link", { name: "Rattacher le gîte", exact: true })
      .count(),
    0,
  );
  await fixes
    .getByRole("link", { name: "Renseigner l’encaissement", exact: true })
    .click();
  await fixes.getByLabel("Date du paiement reçu").fill("2026-10-11");
  await fixes.getByLabel("Mode de paiement").selectOption("cash");
  await fixes.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await fixes
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .waitFor();
  assert.equal(
    await fixes
      .getByRole("region", { name: "Problèmes à corriger", exact: true })
      .count(),
    0,
  );
  await fixes.reload();
  await fixes
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .waitFor();

  // Reference dates remain editable; payment methods only provide a breakdown.
  const rules = await createPage();
  await rules.goto(`${origin}/rapports/demo-owner/modifier`);
  await rules.getByRole("heading", { name: "Réglages", exact: true }).waitFor();
  assert.equal(
    (await rules.locator(".rp-preview-value").innerText())
      .replace(/\s/g, "")
      .includes("2125,00"),
    true,
  );
  await rules.getByRole("radio", { name: /Date d’arrivée/ }).check();
  assert.equal(
    (await rules.locator(".rp-preview-value").innerText())
      .replace(/\s/g, "")
      .includes("1535,00"),
    true,
  );
  await rules.getByRole("radio", { name: /Date du paiement reçu/ }).check();
  assert.equal(
    await rules
      .getByRole("group", {
        name: "Hébergement : modes de paiement inclus",
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    (await rules.locator(".rp-preview-value").innerText())
      .replace(/\s/g, "")
      .includes("2125,00"),
    true,
  );
  await rules
    .getByRole("button", { name: "Appliquer les règles", exact: true })
    .click();
  await rules
    .getByRole("heading", { name: "Relevé propriétaire", exact: true })
    .waitFor();
  assert.equal(
    (await rules.locator(".rp-total-value").innerText())
      .replace(/\s/g, "")
      .includes("2125,00"),
    true,
  );
  const breakdown = await rules
    .getByRole("region", {
      name: "Hébergement par mode de paiement",
      exact: true,
    })
    .innerText();
  assert.equal(breakdown.includes("Virement"), true);
  assert.equal(breakdown.includes("Carte bancaire"), true);
  await rules.setViewportSize({ width: 390, height: 844 });
  await rules.getByRole("link", { name: "Réglages", exact: true }).click();
  assert.equal(await overflow(rules), false);
  await capture(rules, "reports-settings-mobile.png");
  await fixes.setViewportSize({ width: 390, height: 844 });
  assert.equal(await overflow(fixes), false);
  await noStorage
    .getByRole("link", { name: "Relevé propriétaire", exact: true })
    .click();
  await noStorage
    .getByRole("heading", { name: "Relevé propriétaire" })
    .waitFor();

  // Narrow viewports and all installed themes must preserve a usable layout.
  for (const template of ["classic", "retro", "midnight", "garden"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.template = theme;
    }, template);
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(
      await overflow(page),
      false,
      `No horizontal overflow in ${template}`,
    );
  }
  assert.deepEqual(runtimeErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log(
    "Rapports : parcours ordinateur/mobile, brouillons, copies, export, droits et stockage vérifiés.",
  );
  console.log(`Captures : ${screenshots}`);
} finally {
  await browser?.close();
  await vite.close();
}
