import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  createReport,
  evaluateReport,
  reportPeriodKey,
  reportMutationSchema,
} from "@contrats/shared";

const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const screenshots =
  process.env.REPORTS_SCREENSHOT_DIR ||
  (await mkdtemp(path.join(tmpdir(), "reports-live-")));
await mkdir(screenshots, { recursive: true });
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const baseOperation = {
  reservation: "RES-2026",
  reservationId: "reservation-a",
  guest: "Camille Martin",
  propertyId: "g1",
  propertyLabel: "La Maison du verger",
  category: "accommodation",
  amountCents: 50000,
  nights: 0,
  paymentDate: "2026-10-10",
  stayDate: "2026-11-02",
  channel: "Direct",
  paymentMethod: "cash",
  basis: "payment",
  allocationNote:
    "Règlement ventilé au prorata des montants restant dus par catégorie.",
};
function data() {
  return {
    version: 3,
    organizationId: "org_browser_test",
    revision: 0,
    factsRevision: "facts-v1",
    properties: [
      {
        id: "g1",
        name: "La Maison du verger",
        initials: "MV",
        operatorId: "entity-a",
      },
      {
        id: "g2",
        name: "Le Refuge des bois",
        initials: "RB",
        operatorId: null,
      },
    ],
    operators: [{ id: "entity-a", name: "Entreprise Martin", legacy: false }],
    propertyOperators: { g1: "entity-a", g2: null },
    operationEdits: {},
    drafts: {},
    overrides: {},
    progress: {},
    reports: [
      {
        ...createReport("social", "social"),
        name: "Cotisations sociales",
        recipient: "Entreprise Martin",
        operatorId: "entity-a",
        propertyIds: ["g1", "g2"],
      },
      {
        ...createReport("custom", "owner"),
        name: "Relevé propriétaire",
        recipient: "Entreprise Martin",
        propertyIds: ["g1"],
        categories: ["accommodation"],
      },
      {
        ...createReport("custom", "fees"),
        name: "Prestations",
        recipient: "Suivi des prestations",
        propertyIds: ["g1"],
        categories: ["cleaning"],
      },
    ],
    operations: [
      { ...baseOperation, id: "a" },
      {
        ...baseOperation,
        id: "b",
        amountCents: 20000,
        paymentMethod: "transfer",
      },
      { ...baseOperation, id: "c", amountCents: 5000, category: "cleaning" },
      {
        ...baseOperation,
        id: "d",
        reservationId: "reservation-d",
        propertyId: "g2",
        propertyLabel: "Le Refuge des bois",
        paymentDate: null,
        amountCents: 10000,
      },
      {
        ...baseOperation,
        id: "e",
        reservationId: "reservation-extra",
        amountCents: 2000,
        category: "extras",
        categoryUncertain: true,
      },
    ],
    legacyDeclarations: [
      {
        id: "legacy",
        kind: "social",
        period: "2026-09",
        subject: "Entreprise Martin",
        value: 12345,
        confirmedAt: "2026-10-01T12:00:00Z",
      },
    ],
  };
}
let browser;
const runtimeErrors = [];
const unexpectedRequests = [];
try {
  browser = await chromium.launch({ headless: true });
  async function createPage({
    canWrite = true,
    canViewAmounts = true,
    canAccess = true,
    finances = true,
    blockedStorage = false,
    viewport = { width: 1440, height: 1050 },
  } = {}) {
    const context = await browser.newContext({ viewport });
    if (blockedStorage)
      await context.addInitScript(() =>
        Object.defineProperty(window, "sessionStorage", {
          get() {
            throw new Error("Storage unavailable");
          },
        }),
      );
    const page = await context.newPage();
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const fixture = {
      state: data(),
      commands: [],
      failRead: 0,
      failMutation: 0,
      conflict: false,
      reads: 0,
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      let body;
      let status = 200;
      if (pathname === "/api/auth/session")
        body = {
          required: true,
          authenticated: true,
          passwordConfigured: true,
          sessionDurationHours: 168,
          sessionExpiresAt: null,
          user: {
            id: "browser-user",
            displayName: "Compte de test",
            status: "custom",
            pageAccess: canAccess
              ? ["statistics", "reservations", "gites", "settings"]
              : [],
            permissions: { isOwner: false, canWrite, canViewAmounts },
          },
        };
      else if (pathname === "/api/installation/public-config")
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
            website: "",
          },
          modules: { finances },
        };
      else if (pathname === "/api/reports" && method === "GET") {
        fixture.reads++;
        if (fixture.failRead-- > 0) {
          status = 503;
          body = { error: "Rapports indisponibles" };
        } else body = fixture.state;
      } else if (pathname === "/api/reports/commands" && method === "POST") {
        const payload = reportMutationSchema.parse(request.postDataJSON());
        fixture.commands.push(payload.command);
        assert.equal(payload.revision, fixture.state.revision);
        assert.equal(payload.factsRevision, fixture.state.factsRevision);
        if (fixture.failMutation-- > 0) {
          status = 503;
          body = { error: "Enregistrement indisponible" };
        } else if (fixture.conflict) {
          fixture.conflict = false;
          fixture.state.revision++;
          status = 409;
          body = {
            error: "Les données ont changé. Votre brouillon est conservé.",
          };
        } else {
          const state = fixture.state;
          const command = payload.command;
          if (command.type === "save") {
            const index = state.reports.findIndex(
              (report) => report.id === command.definition.id,
            );
            if (index < 0) state.reports.push(command.definition);
            else state.reports[index] = command.definition;
          } else {
            const report = state.reports.find(
              (report) => report.id === command.reportId,
            );
            const key = reportPeriodKey(report, payload.month);
            if (command.type === "favorite") report.favorite = command.favorite;
            else if (command.type === "override") {
              state.overrides[key] ??= {};
              if (command.override)
                state.overrides[key][command.operationId] = command.override;
              else delete state.overrides[key][command.operationId];
            } else if (command.type === "ready")
              state.progress[key] = { ready: true };
            else if (command.type === "confirm")
              state.progress[key] = {
                ready: true,
                snapshot: {
                  confirmedAt: "2026-10-29T12:00:00Z",
                  definition: structuredClone(report),
                  result: evaluateReport(
                    report,
                    payload.month,
                    state.overrides[key],
                    state.operations,
                    state,
                  ),
                },
              };
          }
          state.revision++;
          body = state;
        }
      } else if (
        pathname === "/api/reservations/reservation-extra/reporting-allocation"
      ) {
        body = {
          reservationId: "reservation-extra",
          guest: "Camille Martin",
          property: "La Maison du verger",
          totalCents: 2000,
          updatedAt: "2026-10-29T10:00:00Z",
          amounts: null,
        };
        if (method === "PUT") {
          const payload = request.postDataJSON();
          assert.deepEqual(payload.amounts, {
            cleaning: 1500,
            linen: 500,
            extras: 0,
          });
          fixture.state.operations = fixture.state.operations.filter(
            (row) => row.id !== "e",
          );
          fixture.state.operations.push(
            {
              ...baseOperation,
              id: "e-cleaning",
              reservationId: "reservation-extra",
              amountCents: 1500,
              category: "cleaning",
            },
            {
              ...baseOperation,
              id: "e-linen",
              reservationId: "reservation-extra",
              amountCents: 500,
              category: "linen",
            },
          );
          fixture.state.factsRevision = "facts-allocation";
        }
      } else {
        unexpectedRequests.push(`${method} ${pathname}`);
        body = {};
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    return { page, fixture };
  }
  const capture = async (page, name) => {
    await page.screenshot({
      path: path.join(screenshots, name),
      fullPage: true,
      animations: "disabled",
    });
  };
  const open = async (page, suffix = "") => {
    await page.goto(
      `${origin}/rapports${suffix}${suffix.includes("?") ? "&" : "?"}periode=2026-10`,
    );
  };
  const total = (page) => page.locator(".rp-total-value").innerText();
  const noOverflow = async (page) =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );

  const { page, fixture } = await createPage();
  // Demo state from earlier prototypes is deliberately ignored.
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "contrats:reports-prototype:v1",
      JSON.stringify({ reports: [{ name: "ANCIEN EXEMPLE" }] }),
    ),
  );
  await open(page);
  await page
    .getByRole("heading", { name: "Rapports et déclarations" })
    .waitFor();
  assert.equal(await page.locator(".rp-report-row").count(), 3);
  assert.equal(
    await page
      .getByText(/ANCIEN EXEMPLE|Données fictives|Aperçu interactif/)
      .count(),
    0,
  );
  await page.getByText(/Déclarations historiques/).click();
  assert.ok(
    await page
      .getByText("2026-09 · Cotisations sociales", { exact: true })
      .isVisible(),
  );
  await capture(page, "reports-desktop.png");
  await page
    .getByRole("link", { name: "Cotisations sociales", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .waitFor();
  assert.match(await total(page), /770/);
  const header = page.locator(".rp-page-header");
  assert.ok((await header.boundingBox()).height < 100);
  assert.ok(
    await header
      .getByRole("link", { name: "Réglages", exact: true })
      .isVisible(),
  );
  const back = await header
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .boundingBox();
  assert.ok(back.width >= 44 && back.height >= 44);
  assert.ok(
    (
      await page
        .getByRole("link", { name: /Rattacher le gîte/ })
        .getAttribute("href")
    ).startsWith("/gites?gite=g2"),
  );
  assert.ok(
    (
      await page
        .getByRole("link", { name: /Renseigner l’encaissement/ })
        .getAttribute("href")
    ).includes("/reservations/reservation-d/reglements?back="),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Marquer comme prêt", exact: true })
      .count(),
    0,
  );
  await capture(page, "reports-detail-desktop.png");
  await page
    .getByRole("button", { name: /Camille Martin/ })
    .first()
    .click();
  assert.equal(await page.getByLabel("Traitement", { exact: true }).count(), 0);
  assert.ok(
    await page.getByRole("link", { name: /Ouvrir les règlements/ }).isVisible(),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter", exact: true }).click();
  assert.match(
    (await downloadPromise).suggestedFilename(),
    /^rapport-social-2026-10-01.csv$/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await capture(page, "reports-detail-mobile.png");

  await open(page, "/owner");
  await page
    .getByRole("heading", { name: "Relevé propriétaire", exact: true })
    .waitFor();
  const frozenTotal = await total(page);
  await page
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .waitFor();
  fixture.state.operations[0].amountCents += 100;
  fixture.state.factsRevision = "facts-v2";
  await page
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await page
    .getByText("Les données ont évolué depuis votre confirmation.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .click();
  assert.equal(await total(page), frozenTotal);
  await page.reload();
  await page
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .click();
  assert.equal(await total(page), frozenTotal);

  await page.setViewportSize({ width: 1440, height: 1050 });
  await open(page, "/social/modifier");
  await page.getByRole("heading", { name: "Réglages", exact: true }).waitFor();
  assert.equal(
    await page
      .getByText(
        /Choisissez les modes de paiement|Moyens de paiement à inclure/,
      )
      .count(),
    0,
  );
  await page
    .getByLabel("Nom du rapport", { exact: true })
    .fill("Cotisations octobre");
  await page.reload();
  assert.equal(
    await page.getByLabel("Nom du rapport", { exact: true }).inputValue(),
    "Cotisations octobre",
  );
  await noOverflow(page);
  await capture(page, "reports-editor-desktop.png");
  fixture.failMutation = 1;
  await page.getByRole("button", { name: /Appliquer les règles/ }).click();
  await page
    .getByText("Enregistrement indisponible", { exact: true })
    .waitFor();
  assert.match(page.url(), /modifier/);
  assert.equal(
    await page.getByLabel("Nom du rapport", { exact: true }).inputValue(),
    "Cotisations octobre",
  );
  fixture.conflict = true;
  await page.getByRole("button", { name: /Appliquer les règles/ }).click();
  await page.getByText(/Les données ont changé/).waitFor();
  assert.equal(
    await page.getByLabel("Nom du rapport", { exact: true }).inputValue(),
    "Cotisations octobre",
  );
  await page.getByRole("button", { name: /Appliquer les règles/ }).click();
  await page
    .getByRole("heading", { name: "Cotisations octobre", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Cotisations octobre", exact: true })
    .waitFor();

  await open(page, "/fees");
  await page
    .getByRole("heading", { name: "Prestations", exact: true })
    .waitFor();
  await page.getByRole("link", { name: /Vérifier les prestations/ }).click();
  await page
    .getByRole("heading", { name: "Ventiler les prestations", exact: true })
    .waitFor();
  await page.getByLabel("Ménage (€)", { exact: true }).fill("15");
  await page.getByLabel("Linge (€)", { exact: true }).fill("5");
  await page.getByLabel("Autres prestations (€)", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Enregistrer la ventilation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Prestations", exact: true })
    .waitFor();
  assert.match(await total(page), /65/);

  await open(page, "/nouveau");
  await page.getByRole("button", { name: /Rapport personnalisé/ }).click();
  await page.getByLabel("Nom du rapport", { exact: true }).fill("Suivi annuel");
  await page
    .getByLabel("Destinataire ou usage", { exact: true })
    .fill("Comptable");
  await page.getByRole("button", { name: /Créer ce rapport/ }).click();
  await page
    .getByRole("heading", { name: "Suivi annuel", exact: true })
    .waitFor();
  assert.equal(
    fixture.commands.filter((command) => command.type === "save").at(-1)
      .definition.name,
    "Suivi annuel",
  );

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page, "/social/modifier");
    await page
      .getByRole("heading", { name: "Réglages", exact: true })
      .waitFor();
    await noOverflow(page);
    if (width === 390) await capture(page, "reports-editor-mobile.png");
  }
  const { page: readonly } = await createPage({ canWrite: false });
  await open(readonly, "/owner");
  await readonly
    .getByRole("heading", { name: "Relevé propriétaire", exact: true })
    .waitFor();
  assert.equal(
    await readonly.getByRole("link", { name: "Réglages", exact: true }).count(),
    0,
  );
  assert.equal(
    await readonly
      .getByRole("button", { name: "Marquer comme prêt", exact: true })
      .count(),
    0,
  );
  for (const options of [
    { canAccess: false },
    { canViewAmounts: false },
    { finances: false },
  ]) {
    const { page: denied, fixture: deniedFixture } = await createPage(options);
    await open(denied);
    await denied.waitForLoadState("networkidle");
    assert.equal(
      await denied
        .getByRole("heading", { name: "Rapports et déclarations" })
        .count(),
      0,
    );
    assert.equal(deniedFixture.reads, 0);
  }
  const { page: failed, fixture: failedFixture } = await createPage();
  failedFixture.failRead = 100;
  await open(failed);
  await failed.getByText("Rapports indisponibles", { exact: true }).waitFor();
  assert.equal(await failed.locator(".rp-report-row").count(), 0);
  failedFixture.failRead = 0;
  await failed.getByRole("button", { name: "Actualiser", exact: true }).click();
  await failed
    .getByRole("heading", { name: "Rapports et déclarations" })
    .waitFor();
  const { page: blocked } = await createPage({ blockedStorage: true });
  await open(blocked);
  await blocked
    .getByText(/Le navigateur ne permet pas de conserver les brouillons/)
    .waitFor();
  await blocked
    .getByRole("heading", { name: "Rapports et déclarations" })
    .waitFor();
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(runtimeErrors, []);
  console.log(
    `Rapports réels : API, persistance, conflits, copies figées, sources, ventilation, CSV, droits et responsive validés. Captures : ${screenshots}`,
  );
} finally {
  await browser?.close();
  await vite.close();
}
