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
  buildReportReminders,
  parseAirbnbCsv,
  findOtaRoundingAdjustment,
  DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
} from "@contrats/shared";
import { airbnbFixture } from "../../packages/shared/dist/tests/fixtures/airbnb.js";

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
        stayDate: "2026-10-05",
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
      reminderReads: 0,
      failReminders: false,
      otaImported: false,
      otaStoredAmountCents: 8500,
      otaApplyInputs: [],
      otaFailApply: 0,
      otaApplies: 0,
      otaHistory: [],
      paymentPosts: [],
      paymentSettings: {
        platform_payments_received_automatically: true,
        first_payment_default: "full",
        shortcuts: DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
      },
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
      else if (pathname === "/api/settings/reservation-payments") {
        if (method === "PUT") fixture.paymentSettings = request.postDataJSON();
        body = fixture.paymentSettings;
      } else if (pathname === "/api/reports/ota/imports")
        body = fixture.otaHistory;
      else if (pathname === "/api/reports/ota/preview") {
        const rows = parseAirbnbCsv(request.postDataJSON().content);
        body = {
          fingerprint: "a".repeat(64),
          rows: rows.map(({ raw, ...row }) => ({
            ...row,
            reservationId: row.type === "payout" ? null : "reservation-a",
            reservationLabel: "Client Test · Maison du verger",
            existingAmountCents: fixture.otaStoredAmountCents,
            suggestedBasis:
              row.type === "reservation"
                ? fixture.otaStoredAmountCents === row.netCents
                  ? "net"
                  : fixture.otaStoredAmountCents === row.grossCents
                    ? "gross"
                    : null
                : null,
            roundingAdjustment:
              row.type === "reservation" && !fixture.otaImported
                ? findOtaRoundingAdjustment(
                    fixture.otaStoredAmountCents,
                    row.grossCents,
                    row.netCents,
                  )
                : null,
            status: fixture.otaImported ? "imported" : "new",
            warning:
              row.type === "resolution"
                ? "Précisez la catégorie de ce règlement complémentaire."
                : null,
          })),
          reservations: [
            {
              id: "reservation-a",
              label: "Client Test · Maison du verger",
              amountCents: fixture.otaStoredAmountCents,
              payments: [],
            },
          ],
          totals: {
            grossCents: 11500,
            feeCents: 1500,
            netCents: 10000,
            payouts: 1,
            reservations: 1,
            resolutions: 1,
          },
        };
      } else if (pathname === "/api/reports/ota/apply") {
        fixture.otaApplies++;
        if (fixture.otaFailApply-- > 0) {
          status = 503;
          body = { error: "Import indisponible" };
        } else {
          const input = request.postDataJSON();
          fixture.otaApplyInputs.push(input);
          assert.equal(input.fingerprint, "a".repeat(64));
          const rows = parseAirbnbCsv(input.content);
          fixture.state.operations = rows
            .filter((row) => row.type !== "payout")
            .map((row) => ({
              ...baseOperation,
              id: row.key,
              propertyId: "g1",
              amountCents: row.grossCents,
              paymentDate: row.date,
              stayDate: row.start,
              channel: "Airbnb",
              paymentMethod: "platform",
              category:
                row.type === "reservation"
                  ? "accommodation"
                  : input.choices.find((choice) => choice.key === row.key)
                      .category,
              ota: {
                channel: "Airbnb",
                grossCents: row.grossCents,
                feeCents: row.feeCents,
                netCents: row.netCents,
                source: "import",
                category:
                  row.type === "reservation" ? "accommodation" : "linen",
              },
            }));
          fixture.state.factsRevision = "ota-imported";
          fixture.otaImported = true;
          fixture.otaHistory = [
            {
              id: "import-a",
              fileName: input.fileName,
              createdAt: "2026-10-31T12:00:00Z",
              rows: 3,
              regularized: input.choices.filter(
                (choice) => choice.regularizeOneCent,
              ).length,
              roundingAdjustments: input.choices
                .filter((choice) => choice.regularizeOneCent)
                .map((choice) => ({
                  ...findOtaRoundingAdjustment(
                    fixture.otaStoredAmountCents,
                    10000,
                    8500,
                  ),
                  reservationId: choice.reservationId,
                  reservationLabel: "Client Test · Maison du verger",
                })),
              totals: { netCents: 10000 },
            },
          ];
          body = {
            added: 3,
            regularized: input.choices.filter(
              (choice) => choice.regularizeOneCent,
            ).length,
          };
        }
      } else if (pathname === "/api/reservations/prefill/reservation-extra")
        body = {
          id: "reservation-extra",
          hote_nom: "Client Test",
          booking_source: "Airbnb",
          source_paiement: "Airbnb",
          options: {},
          date_entree: "2026-10-30",
          date_sortie: "2026-11-03",
          gite: { nom: "Maison du verger" },
          payment_tracking: {
            managed: true,
            total: 100,
            deposit: 0,
            received: 85,
            remaining: 15,
            overpaid: 0,
            requires_review: false,
            payment_shortcuts: [],
            entries: [],
            platform: {
              source: "Airbnb",
              automatic: true,
              accommodation: 85,
              expected: 0,
              extras_remaining: 15,
            },
          },
        };
      else if (
        pathname === "/api/reservations/reservation-extra/payments" &&
        method === "POST"
      ) {
        const input = request.postDataJSON();
        fixture.paymentPosts.push(input);
        assert.equal(input.method, "Versement plateforme");
        assert.equal(input.channel, "Airbnb");
        assert.equal(input.category, "linen");
        assert.equal(input.fee_amount, 0);
        assert.equal(input.purpose, "extras");
        body = {
          managed: true,
          total: 100,
          deposit: 0,
          received: 100,
          remaining: 0,
          overpaid: 0,
          requires_review: false,
          entries: [
            {
              id: input.id,
              amount: 15,
              method: input.method,
              origin: "manual",
              purpose: input.purpose,
              paid_on: "2026-10-31",
              note: null,
              voided_at: null,
              ota: {
                channel: "Airbnb",
                grossCents: 1500,
                feeCents: 0,
                netCents: 1500,
                category: "linen",
                source: "manual",
              },
            },
          ],
        };
      } else if (pathname === "/api/reports/reminders" && method === "GET") {
        fixture.reminderReads++;
        status = fixture.failReminders ? 503 : 200;
        body = fixture.failReminders
          ? { error: "Indisponible" }
          : {
              reminders: buildReportReminders(
                fixture.state,
                Number(new URL(request.url()).searchParams.get("year")),
                new Date("2026-11-05T12:00:00Z"),
              ),
            };
      } else if (pathname === "/api/gites")
        body = fixture.state.properties.map((property) => ({
          id: property.id,
          nom: property.name,
          prefixe_contrat: property.initials,
          capacite_max: 4,
          prix_nuit: 100,
          ordre: 0,
        }));
      else if (pathname === "/api/reservations/years") body = [2026];
      else if (
        [
          "/api/reservations",
          "/api/reservations/placeholders",
          "/api/reservations/monthly-energy/eligible-gites",
          "/api/reservations/monthly-energy",
          "/api/school-holidays",
        ].includes(pathname)
      )
        body = [];
      else if (pathname === "/api/reservations/live-energy") body = {};
      else if (pathname === "/api/statistics")
        body = { gites: [], entriesByGite: {}, availableYears: [2026] };
      else if (pathname === "/api/settings/source-colors")
        body = { colors: {}, available_sources: [] };
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

  const editorActionsAccessible = async (page) => {
    const save = page.getByRole("button", {
      name: /Appliquer les règles|Créer ce rapport/,
    });
    await save.scrollIntoViewIfNeeded();
    const covered = await save.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const points = [0.2, 0.5, 0.8].flatMap((x) =>
        [0.25, 0.5, 0.75].map((y) => [
          rect.x + rect.width * x,
          rect.y + rect.height * y,
        ]),
      );
      return points.filter(
        ([x, y]) => !button.contains(document.elementFromPoint(x, y)),
      ).length;
    });
    assert.equal(
      covered,
      0,
      "Le bouton d’enregistrement doit rester entièrement accessible, sans superposition de l’aperçu.",
    );
    await save.click({ trial: true });
  };

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
  const socialDate = page.getByRole("group", {
    name: "Date de référence",
    exact: true,
  });
  assert.equal(await socialDate.getByRole("radio").count(), 0);
  assert.ok(
    await socialDate
      .getByText("Date du paiement reçu", { exact: true })
      .isVisible(),
  );
  await capture(page, "reports-editor-desktop.png");
  for (const [width, height] of [
    [1440, 900],
    [1100, 700],
    [900, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await editorActionsAccessible(page);
    await page.screenshot({
      path: path.join(screenshots, `reports-editor-actions-${width}.png`),
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
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
  const dateChoices = page.getByRole("group", {
    name: "Quelle date détermine la période ?",
    exact: true,
  });
  assert.equal(await dateChoices.getByRole("radio").count(), 2);
  await dateChoices.getByRole("radio", { name: /^Date d’arrivée/ }).check();
  assert.ok(
    await dateChoices
      .getByRole("radio", { name: /^Date d’arrivée/ })
      .isChecked(),
  );
  assert.equal(await page.getByLabel("Base OTA", { exact: true }).count(), 0);
  await dateChoices
    .getByRole("radio", { name: /^Date du paiement reçu/ })
    .check();
  assert.ok(await page.getByLabel("Base OTA", { exact: true }).isVisible());
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

  const { page: nightsEditor } = await createPage();
  await open(nightsEditor, "/nouveau");
  await nightsEditor.getByRole("button", { name: /^Nuitées/ }).click();
  const nightsDate = nightsEditor.getByRole("group", {
    name: "Date de référence",
    exact: true,
  });
  assert.equal(await nightsDate.getByRole("radio").count(), 0);
  assert.ok(
    await nightsDate.getByText("Date des nuitées", { exact: true }).isVisible(),
  );

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await open(page, "/social/modifier");
    await page
      .getByRole("heading", { name: "Réglages", exact: true })
      .waitFor();
    await noOverflow(page);
    await editorActionsAccessible(page);
    if (width === 390) {
      await page.getByRole("button", { name: /^Aperçu ·/ }).click();
      await editorActionsAccessible(page);
      await page.screenshot({
        path: path.join(screenshots, "reports-editor-actions-mobile.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Réglages", exact: true }).click();
      await capture(page, "reports-editor-mobile.png");
    }
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
  const { page: reservations, fixture: reservationFixture } =
    await createPage();
  reservationFixture.state.reports = [
    { ...reservationFixture.state.reports[0], propertyIds: ["g1"] },
  ];
  reservationFixture.state.operations = [
    reservationFixture.state.operations[0],
  ];
  reservationFixture.state.operations[0].amountCents = 123456;
  await reservations
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  const reservationUrl = `${origin}/reservations?year=2026&month=10&tab=all-gites`;
  await reservations.goto(reservationUrl);
  const reminders = reservations.getByRole("region", {
    name: /Déclarations à traiter/,
  });
  await reminders.waitFor();
  assert.match(await reminders.innerText(), /octobre 2026/);
  assert.equal(await reminders.locator("li").count(), 1);
  assert.match(
    await reminders.locator(".reservation-declarations__value").innerText(),
    /1\s*234,56\s*€/,
  );
  await reminders.getByRole("button", { name: /^Copier le montant/ }).click();
  await reminders
    .getByRole("button", { name: /^Copier le montant/ })
    .getByText("Copié", { exact: true })
    .waitFor();
  assert.equal(
    await reservations.evaluate(() => navigator.clipboard.readText()),
    "1234,56",
  );
  await reservations.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
  });
  await reminders.getByRole("button", { name: /^Copier le montant/ }).click();
  await reservations
    .getByText("Copie impossible. Sélectionnez le montant pour le copier.", {
      exact: true,
    })
    .waitFor();
  await reservations.evaluate(() => {
    delete navigator.clipboard;
  });
  reservationFixture.state.operations[0].paymentMethod = "unknown";
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders.getByText("1 à vérifier", { exact: true }).waitFor();
  assert.equal(
    await reminders.getByRole("button", { name: /^Copier/ }).count(),
    0,
  );
  assert.match(await reminders.innerText(), /Total inclus · à vérifier/);
  reservationFixture.state.operations[0].paymentMethod = "cash";
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders.getByRole("button", { name: /^Copier le montant/ }).waitFor();
  assert.deepEqual(reservationFixture.commands, []);
  await reservations.locator(".app-sync-notice").waitFor({ state: "hidden" });
  await capture(reservations, "reservations-reminder-desktop.png");
  for (const width of [360, 390, 768]) {
    await reservations.setViewportSize({ width, height: 844 });
    assert.equal(
      await reminders.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
      true,
    );
    if (width === 390)
      await reminders.screenshot({
        path: path.join(screenshots, "reservations-reminder-mobile.png"),
      });
  }
  await reservations.getByRole("tab", { name: /Le Refuge des bois/ }).click();
  assert.equal(await reminders.count(), 0);
  await reservations.getByRole("tab", { name: /La Maison du verger/ }).click();
  await reminders.waitFor();
  reservationFixture.state.operations[0].paymentDate = "2026-06-10";
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders
    .getByRole("button", { name: "Voir 2 autres déclarations", exact: true })
    .waitFor();
  assert.equal(await reminders.locator("li").count(), 3);
  await reminders
    .locator("li")
    .nth(1)
    .getByRole("button", { name: /^Copier le montant/ })
    .click();
  await reminders
    .locator("li")
    .nth(1)
    .getByText("Copié", { exact: true })
    .waitFor();
  assert.equal(
    await reservations.evaluate(() => navigator.clipboard.readText()),
    "0,00",
  );
  await reminders
    .getByRole("button", { name: "Voir 2 autres déclarations", exact: true })
    .click();
  assert.equal(await reminders.locator("li").count(), 5);
  await reminders
    .getByRole("button", { name: "Réduire la liste", exact: true })
    .click();
  assert.equal(await reminders.locator("li").count(), 3);
  reservationFixture.state.operations[0].paymentDate = "2026-10-10";
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders
    .getByText("octobre 2026 · Entreprise Martin", { exact: true })
    .waitFor();
  await reminders.getByRole("link", { name: /^Ouvrir/ }).click();
  assert.match(reservations.url(), /\/rapports\/social\?periode=2026-10/);
  await reservations
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .click();
  await reservations
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await reservations
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await reservations
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .waitFor();
  await reservations.goto(reservationUrl);
  await reservations.waitForResponse((response) =>
    response.url().includes("/reports/reminders"),
  );
  assert.equal(await reminders.count(), 0);
  reservationFixture.state.operations[0].amountCents += 100;
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders.getByText("Écart à examiner", { exact: true }).waitFor();
  assert.equal(
    await reminders.getByRole("button", { name: /^Copier/ }).count(),
    0,
  );
  assert.match(await reminders.innerText(), /Total inclus · à vérifier/);
  reservationFixture.failReminders = true;
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reservations
    .getByText("Les rappels de déclaration sont indisponibles.", {
      exact: true,
    })
    .waitFor();
  reservationFixture.failReminders = false;
  await reservations
    .getByRole("button", { name: "Réessayer", exact: true })
    .click();
  await reminders.waitFor();
  reservationFixture.state.progress = {};
  Object.assign(reservationFixture.state.reports[0], {
    kind: "tourist",
    name: "Nuitées",
    dateBasis: "stay",
    categories: ["accommodation"],
  });
  Object.assign(reservationFixture.state.operations[0], {
    basis: "nights",
    nights: 12,
    stayDate: "2026-10-10",
  });
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders.getByText("12 nuitées", { exact: true }).waitFor();
  await reminders
    .getByRole("button", { name: /^Copier le nombre de nuitées/ })
    .click();
  await reminders.getByText("Copié", { exact: true }).waitFor();
  assert.equal(
    await reservations.evaluate(() => navigator.clipboard.readText()),
    "12",
  );
  for (const options of [{ canViewAmounts: false }, { finances: false }]) {
    const { page: hidden, fixture: hiddenFixture } = await createPage(options);
    await hidden.goto(reservationUrl);
    await hidden.waitForLoadState("networkidle");
    assert.equal(hiddenFixture.reminderReads, 0);
    assert.equal(await hidden.locator(".reservation-declarations").count(), 0);
  }
  const { page: otaPage, fixture: otaFixture } = await createPage();
  otaFixture.otaStoredAmountCents = 8501;
  otaFixture.state.reports = [
    { ...otaFixture.state.reports[0], propertyIds: ["g1"] },
  ];
  await open(otaPage, "/import-airbnb");
  await otaPage
    .getByRole("heading", { name: "Importer un relevé Airbnb", exact: true })
    .waitFor();
  await otaPage.getByLabel("Relevé Airbnb", { exact: true }).setInputFiles({
    name: "airbnb-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(airbnbFixture()),
  });
  await otaPage.getByRole("region", { name: "Aperçu de l’import" }).waitFor();
  assert.equal(
    await otaPage
      .getByRole("button", { name: "Confirmer l’import", exact: true })
      .isDisabled(),
    true,
  );
  await otaPage
    .getByLabel("Catégorie ligne 4", { exact: true })
    .selectOption("linen");
  const roundingOption = otaPage.getByRole("checkbox", {
    name: /^Régulariser automatiquement les écarts de 0,01/,
  });
  assert.equal(await roundingOption.isChecked(), false);
  const importButton = otaPage.getByRole("button", {
    name: "Confirmer l’import",
    exact: true,
  });
  assert.equal(await importButton.isDisabled(), true);
  await otaPage
    .getByLabel("Montant suivi ligne 3", { exact: true })
    .selectOption("net");
  await roundingOption.check();
  assert.equal(
    await otaPage
      .getByLabel("Montant suivi ligne 3", { exact: true })
      .inputValue(),
    "net",
  );
  assert.equal(await otaPage.locator(".ota-rounding-note").count(), 0);
  await otaPage
    .getByLabel("Montant suivi ligne 3", { exact: true })
    .selectOption("");
  assert.equal(await importButton.isDisabled(), false);
  assert.match(
    await otaPage.locator(".ota-rounding-note").innerText(),
    /\+0,01/,
  );
  await roundingOption.uncheck();
  assert.equal(await importButton.isDisabled(), true);
  await roundingOption.check();
  await noOverflow(otaPage);
  await capture(otaPage, "ota-import-desktop.png");
  for (const width of [360, 390, 768]) {
    await otaPage.setViewportSize({ width, height: 844 });
    await noOverflow(otaPage);
    await capture(otaPage, `ota-import-${width}.png`);
  }
  otaFixture.otaFailApply = 1;
  await otaPage
    .getByRole("button", { name: "Confirmer l’import", exact: true })
    .click();
  await otaPage.getByText("Import indisponible", { exact: false }).waitFor();
  assert.equal(
    await otaPage.getByLabel("Catégorie ligne 4", { exact: true }).inputValue(),
    "linen",
  );
  await otaPage
    .getByRole("button", { name: "Confirmer l’import", exact: true })
    .click();
  await otaPage.getByText(/Import enregistré : 3 lignes/).waitFor();
  assert.equal(otaFixture.otaApplies, 2);
  const rounded = otaFixture.otaApplyInputs
    .at(-1)
    .choices.find((choice) => choice.regularizeOneCent);
  assert.equal(rounded.settlementBasis, "reservation");
  assert.equal(rounded.reservationId, "reservation-a");
  await otaPage
    .getByText("1 écart d’arrondi régularisé", { exact: true })
    .click();
  assert.match(await otaPage.locator(".ota-history").innerText(), /85,01/);

  await open(otaPage, "/social");
  assert.match(await total(otaPage), /115,00/);
  await open(otaPage, "/social/modifier");
  await otaPage.getByLabel("Base OTA", { exact: true }).selectOption("net");
  await otaPage.getByRole("button", { name: /Appliquer les règles/ }).click();
  await otaPage
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .waitFor();
  assert.match(await total(otaPage), /100,00/);
  await open(otaPage, "/import-airbnb");
  await otaPage.getByLabel("Relevé Airbnb", { exact: true }).setInputFiles({
    name: "airbnb-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(airbnbFixture()),
  });
  await otaPage
    .getByText("2 règlements à importer.")
    .waitFor({ state: "hidden" });
  await otaPage.getByRole("region", { name: "Aperçu de l’import" }).waitFor();
  assert.equal(
    await otaPage
      .getByRole("button", { name: "Confirmer l’import", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await otaPage.getByText(/Déjà importé/).count(), 2);
  const { page: largerGap, fixture: largerFixture } = await createPage();
  largerFixture.otaStoredAmountCents = 8502;
  await open(largerGap, "/import-airbnb");
  await largerGap
    .getByLabel("Relevé Airbnb", { exact: true })
    .setInputFiles({
      name: "ecart.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(airbnbFixture()),
    });
  await largerGap.getByRole("region", { name: "Aperçu de l’import" }).waitFor();
  assert.equal(
    await largerGap
      .getByRole("checkbox", { name: /^Régulariser automatiquement/ })
      .count(),
    0,
  );
  assert.equal(
    await largerGap
      .getByRole("button", { name: "Confirmer l’import", exact: true })
      .isDisabled(),
    true,
  );

  await otaPage.goto(`${origin}/reservations/reservation-extra/reglements`);
  await otaPage
    .getByRole("heading", { name: "Règlements de la réservation", exact: true })
    .waitFor();
  await otaPage.getByRole("button", { name: /Ajouter un règlement/ }).click();
  await otaPage
    .getByLabel("Moyen", { exact: true })
    .selectOption("Versement plateforme");
  await otaPage
    .getByLabel("Prestation réglée", { exact: true })
    .selectOption("linen");
  await otaPage
    .getByLabel("Commission du règlement", { exact: true })
    .fill("0");
  await otaPage
    .getByRole("button", { name: "Enregistrer le règlement", exact: true })
    .click();
  await otaPage.getByText(/Airbnb · Brut/).waitFor();
  assert.equal(otaFixture.paymentPosts.length, 1);
  await otaPage.goto(`${origin}/parametres/reglements`);
  await otaPage
    .getByRole("heading", { name: "Règlements des réservations", exact: true })
    .waitFor();
  const channelSettings = otaPage.locator(".ota-channel").first();
  await channelSettings
    .getByRole("button", { name: "Ajouter une commission datée", exact: true })
    .click();
  await otaPage
    .getByLabel("Date d’effet Airbnb 1", { exact: true })
    .fill("2026-01-01");
  await otaPage.getByLabel("Commission Airbnb 1", { exact: true }).fill("15");
  await channelSettings
    .getByRole("button", { name: "Ajouter une commission datée", exact: true })
    .click();
  await otaPage
    .getByLabel("Date d’effet Airbnb 2", { exact: true })
    .fill("2026-10-01");
  await otaPage.getByLabel("Commission Airbnb 2", { exact: true }).fill("16");
  await otaPage
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await otaPage.getByText(/Réglage enregistré/).waitFor();
  assert.deepEqual(otaFixture.paymentSettings.platforms[0].rates, [
    { effectiveFrom: "2026-01-01", percent: 15 },
    { effectiveFrom: "2026-10-01", percent: 16 },
  ]);
  await otaPage.setViewportSize({ width: 1440, height: 1050 });
  await noOverflow(otaPage);
  await capture(otaPage, "ota-settings-desktop.png");
  await otaPage.setViewportSize({ width: 390, height: 844 });
  await noOverflow(otaPage);
  await capture(otaPage, "ota-settings-mobile.png");
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(runtimeErrors, []);
  console.log(
    `Rapports réels : API, persistance, conflits, copies figées, sources, ventilation, CSV, droits et responsive validés. Captures : ${screenshots}`,
  );
} finally {
  await browser?.close();
  await vite.close();
}
