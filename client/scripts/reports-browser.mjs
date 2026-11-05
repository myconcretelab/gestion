import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  taxRemittanceAccounts,
  taxRemittanceSources,
  createReport,
  evaluateReport,
  reportPeriodKey,
  reportMutationSchema,
  buildReportReminders,
  parseAirbnbCsv,
  findOtaRoundingAdjustment,
  DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
  DEFAULT_TOURIST_TAX_COLLECTION,
  BOOKING_SOURCES,
  nightRegisterCsv,
  nightDeclarationCsv,
  summarizeNightRegister,
  reportPaymentAlertSignature,
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
        managerId: "manager-a",
      },
      {
        id: "g2",
        name: "Le Refuge des bois",
        initials: "RB",
        operatorId: null,
        managerId: "manager-b",
      },
    ],
    operators: [{ id: "entity-a", name: "Entreprise Martin", legacy: false }],
    managers: [
      { id: "manager-a", name: "Camille Martin" },
      { id: "manager-b", name: "Alex Durand" },
    ],
    propertyManagers: { g1: "manager-a", g2: "manager-b" },
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
        paymentMethod: "platform",
        channel: "Airbnb",
        stayDate: "2026-10-09",
        paymentDateEstimated: true,
      },
      {
        ...baseOperation,
        id: "c",
        amountCents: 5000,
        category: "cleaning",
        channel: "Gites de France",
      },
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
function registerData() {
  const register = {
    reportId: "nights-a",
    reportName: "Nuitées",
    recipient: "Camille Martin",
    period: { label: "octobre 2026", start: "2026-10-01", end: "2026-11-01" },
    generatedAt: "2026-11-02T12:00:00Z",
    revision: "a".repeat(64),
    sourceRevision: "c".repeat(64),
    reportNights: 19,
    stayCount: 1,
    incompleteCount: 1,
    properties: [
      {
        id: "g1",
        name: "La Maison du verger",
        address: "1 rue du Verger, 35000 Rennes",
        registrationNumber: null,
      },
    ],
    rows: [
      {
        key: "stay:reservation-a",
        reference: "Séjour 1",
        reservationId: "reservation-a",
        propertyId: "g1",
        propertyName: "La Maison du verger",
        address: "1 rue du Verger, 35000 Rennes",
        registrationNumber: null,
        arrival: "2026-10-01",
        departure: "2026-10-20",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-20",
        collectionDate: null,
        collector: "host",
        adults: 1,
        taxableAdults: 1,
        exemptAdults: 0,
        children: 0,
        infants: 0,
        occupants: 1,
        nights: 19,
        personNights: 19,
        classified: true,
        nightlyPriceCents: 5000,
        collectedTaxCents: null,
        observedCollectionCents: null,
        collectedBaseTaxCents: null,
        calculatedStayTaxCents: 1900,
        allocationProposal: {
          collectionDate: "2026-10-20",
          collectedTaxCents: 1900,
          collectedBaseTaxCents: 1900,
          additionalTaxes: "Aucune selon le barème enregistré",
          explanation:
            "Proposition répartie sur les nuits taxables du séjour ; vérifiez les justificatifs avant confirmation.",
        },
        additionalTaxes: "Aucune selon le barème enregistré",
        exemptionReason: "Aucune exonération renseignée",
        source: "Direct",
        issues: [
          "Date et montant de perception à compléter.",
          "Numéro d’enregistrement à compléter s’il s’applique.",
        ],
      },
    ],
  };
  register.summary = summarizeNightRegister(register);
  return register;
}
const runtimeErrors = [];
const unexpectedRequests = [];
try {
  browser = await chromium.launch({ headless: true });
  async function createPage({
    canWrite = true,
    canViewAmounts = true,
    canAccess = true,
    reservationsAccess = true,
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
      commandMonths: [],
      nightRegister: registerData(),
      registerRequests: [],
      registerFailRead: 0,
      registerFailDownload: 0,
      failRead: 0,
      failMutation: 0,
      conflict: false,
      reads: 0,
      reminderReads: 0,
      failReminders: false,
      remindersStale: false,
      remindersEmpty: false,
      remindersCalculatedAt: "2026-11-05T12:00:00.000Z",
      reportRefreshQueries: [],
      nightSummaryReads: 0,
      otaImported: false,
      otaStoredAmountCents: 8500,
      otaApplyInputs: [],
      otaFailApply: 0,
      otaApplies: 0,
      otaHistory: [],
      listingReservationRequests: [],
      showListingReservation: false,
      extraReservationDetailsReads: 0,
      extraReservation: {
        id: "reservation-extra",
        gite_id: "g1",
        nb_nuits: 4,
        nb_adultes: 2,
        nb_enfants_2_17: 0,
        prix_par_nuit: 21.25,
        prix_total: 85,
        remise_montant: 0,
        commission_channel_value: 0,
        frais_optionnels_montant: 15,
        frais_optionnels_declares: false,
        energy_consumption_kwh: 0,
        energy_cost_eur: 0,
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
      },
      paymentPosts: [],
      reservationReads: [],
      failReservationRead: 0,
      failReviewPayment: 0,
      paymentReservation: {
        id: "reservation-a",
        hote_nom: "Camille Martin",
        booking_source: "Direct",
        prix_total: 692.9,
        frais_optionnels_montant: 50,
        date_entree: "2026-10-10",
        date_sortie: "2026-10-12",
        options: {},
        payment_tracking: {
          managed: true,
          total: 742.9,
          deposit: 200,
          received: 692.9,
          remaining: 50,
          overpaid: 0,
          requires_review: false,
          payment_shortcuts: DEFAULT_RESERVATION_PAYMENT_SHORTCUTS,
          entries: [
            {
              id: "receipt-a",
              origin: "manual",
              method: "Virement",
              purpose: "payment",
              amount: 692.9,
              paid_on: "2026-10-10",
              voided_at: null,
            },
          ],
        },
      },
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
              ? [
                  "statistics",
                  ...(reservationsAccess ? ["reservations"] : []),
                  "gites",
                  "settings",
                ]
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
      else if (pathname === "/api/settings/tourist-tax-collection/defaults")
        body = { ...DEFAULT_TOURIST_TAX_COLLECTION, sources: BOOKING_SOURCES };
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
        body = fixture.extraReservation;
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
      } else if (pathname.startsWith("/api/reservations/prefill/")) {
        fixture.reservationReads.push(pathname.split("/").at(-1));
        if (fixture.failReservationRead-- > 0) {
          status = 503;
          body = { error: "Suivi indisponible" };
        } else
          body = {
            ...fixture.paymentReservation,
            id: pathname.split("/").at(-1),
          };
      } else if (
        pathname === "/api/reservations/reservation-a/payments" &&
        method === "POST"
      ) {
        const input = request.postDataJSON();
        fixture.paymentPosts.push(input);
        if (fixture.failReviewPayment-- > 0) {
          status = 503;
          body = { error: "Règlement indisponible" };
        } else {
          assert.equal(input.amount, 50);
          assert.equal(input.method, "Espèces");
          const tracking = fixture.paymentReservation.payment_tracking;
          tracking.received = 742.9;
          tracking.remaining = 0;
          tracking.entries.push({
            ...input,
            origin: "manual",
            voided_at: null,
          });
          fixture.state.operations = fixture.state.operations.map(
            (operation) => ({ ...operation, reviewReason: undefined }),
          );
          fixture.state.factsRevision = "payment-updated";
          body = tracking;
        }
      } else if (pathname === "/api/reports/night-summaries") {
        fixture.nightSummaryReads++;
        body = {
          year: Number(new URL(request.url()).searchParams.get("year")),
          report: {
            id: "night-reference",
            name: "Nuitées",
            guestGroups: ["adults"],
          },
          calculatedAt: "2026-11-02T08:00:00.000Z",
          properties: fixture.state.properties.map((property) => ({
            id: property.id,
            inScope: true,
            months: Array.from({ length: 12 }, (_, i) => ({
              month: i + 1,
              total: 8,
              included: 4,
              reviewCount: 0,
            })),
          })),
        };
      } else if (pathname === "/api/reports/reminders" && method === "GET") {
        fixture.reminderReads++;
        status = fixture.failReminders ? 503 : 200;
        body = fixture.failReminders
          ? { error: "Indisponible" }
          : {
              stale: fixture.remindersStale,
              calculatedAt: fixture.remindersCalculatedAt,
              reminders: fixture.remindersEmpty
                ? []
                : buildReportReminders(
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
      else if (pathname === "/api/reservations/years") body = [2026, 2027];
      else if (pathname === "/api/reservations/reservation-extra") {
        fixture.extraReservationDetailsReads++;
        body = fixture.extraReservation;
      } else if (pathname === "/api/reservations") {
        const requestedYear = new URL(request.url()).searchParams.get("year");
        fixture.listingReservationRequests.push(requestedYear);
        body =
          fixture.showListingReservation &&
          fixture.extraReservation.date_entree.startsWith(requestedYear)
            ? [fixture.extraReservation]
            : [];
      } else if (
        [
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
      else if (/^\/api\/reports\/[^/]+\/night-register$/.test(pathname)) {
        const query = new URL(request.url()).searchParams;
        const format = query.get("format") ?? "json";
        fixture.registerRequests.push({
          format,
          month: query.get("month"),
          revision: query.get("revision"),
        });
        if (
          (format === "json"
            ? fixture.registerFailRead--
            : fixture.registerFailDownload--) > 0
        ) {
          status = 503;
          body = { error: "Registre indisponible" };
        } else if (
          format !== "json" &&
          query.get("revision") !== fixture.nightRegister.revision
        ) {
          status = 409;
          body = {
            error:
              "Les données du registre ont changé. Rechargez son aperçu avant de télécharger.",
          };
        } else if (format === "csv" || format === "summary-csv") {
          return route.fulfill({
            status: 200,
            contentType: "text/csv; charset=utf-8",
            body:
              format === "summary-csv"
                ? nightDeclarationCsv(fixture.nightRegister)
                : nightRegisterCsv(fixture.nightRegister),
          });
        } else if (format === "pdf") {
          return route.fulfill({
            status: 200,
            contentType: "application/pdf",
            body: "%PDF-1.4\nBrowser download fixture",
          });
        } else body = fixture.nightRegister;
      } else if (pathname === "/api/reports" && method === "GET") {
        fixture.reads++;
        fixture.reportRefreshQueries.push(
          new URL(request.url()).searchParams.get("refresh"),
        );
        fixture.remindersStale = false;
        fixture.remindersEmpty = false;
        fixture.remindersCalculatedAt = "2026-11-05T12:00:00.000Z";
        if (fixture.failRead-- > 0) {
          status = 503;
          body = { error: "Rapports indisponibles" };
        } else body = fixture.state;
      } else if (
        ["/api/reports/commands", "/api/reports/receipts"].includes(pathname) &&
        method === "POST"
      ) {
        const payload = reportMutationSchema.parse(request.postDataJSON());
        fixture.commands.push(payload.command);
        fixture.commandMonths.push(payload.month);
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
          if (command.type === "remittance-save") {
            const previous = state.taxRemittances?.find(
              (r) => r.id === command.remittance.id,
            );
            const { sourceKeys, ...input } = command.remittance;
            const account = taxRemittanceAccounts(state).find(
              (a) => a.id === input.accountId,
            );
            const saved = {
              ...input,
              accountName: account.name,
              sources:
                previous?.sources ??
                taxRemittanceSources(state, account).filter((source) =>
                  sourceKeys.includes(source.key),
                ),
              createdAt: "2026-11-04",
              updatedAt: "2026-11-04",
              payments: previous?.payments ?? [],
            };
            state.taxRemittances = previous
              ? state.taxRemittances.map((r) => (r.id === saved.id ? saved : r))
              : [...(state.taxRemittances ?? []), saved];
          } else if (command.type.startsWith("remittance-")) {
            const remittance = state.taxRemittances.find(
              (r) => r.id === command.remittanceId,
            );
            if (command.type === "remittance-payment")
              remittance.payments.push({
                ...command.payment,
                recordedAt: "2026-11-04",
                recordedBy: "browser-user",
              });
            else if (command.type === "remittance-void-payment")
              Object.assign(
                remittance.payments.find((p) => p.id === command.paymentId),
                { voidedAt: "2026-11-04", voidReason: command.reason },
              );
            else if (command.type === "remittance-cancel")
              Object.assign(remittance, {
                cancelledAt: "2026-11-04",
                cancelReason: command.reason,
              });
            else if (command.type === "remittance-receipt") {
              const payment = remittance.payments.find(
                (p) => p.id === command.paymentId,
              );
              payment.receipts = [
                ...(payment.receipts ?? []),
                {
                  id: "receipt-browser",
                  name: command.file.name,
                  contentType: "application/pdf",
                  sizeBytes: 30,
                  checksumSha256: "b".repeat(64),
                  uploadedAt: "2026-11-04",
                },
              ];
            }
          } else if (command.type === "worklist-start") {
            state.worklistStartMonth = command.startMonth;
          } else if (command.type === "save") {
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
            } else if (command.type === "night-register-completion") {
              state.nightRegisterCompletions ??= {};
              state.nightRegisterCompletions[key] = command.completion;
              fixture.nightRegister.completion = command.completion;
              for (const row of fixture.nightRegister.rows) {
                Object.assign(row, command.completion.rows[row.key]);
                row.issues = row.issues.filter(
                  (issue) => !issue.startsWith("Date et montant"),
                );
              }
              fixture.nightRegister.revision = "d".repeat(64);
              fixture.nightRegister.summary = summarizeNightRegister(
                fixture.nightRegister,
              );
            } else if (command.type === "payment-review") {
              const current = evaluateReport(
                report,
                payload.month,
                state.overrides[key],
                state.operations,
                state,
              );
              assert.equal(
                command.signature,
                reportPaymentAlertSignature(current),
              );
              state.paymentReviews ??= {};
              state.paymentReviews[key] = {
                signature: command.signature,
                note: command.note,
                reviewedAt: "2026-11-05T12:00:00Z",
                reviewedBy: "browser-user",
              };
              state.progress[key] = { ...state.progress[key], ready: false };
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
            else if (command.type === "resolve") {
              state.progress[key].resolutions ??= [];
              state.progress[key].resolutions.push({
                resolvedAt: "2026-11-03T12:00:00Z",
                resolvedBy: "browser-user",
                outcome: command.outcome,
                note: command.note,
                definition: structuredClone(report),
                result: evaluateReport(
                  report,
                  payload.month,
                  state.overrides[key],
                  state.operations,
                  state,
                ),
              });
            }
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

  const { page: unpaidPage, fixture: unpaidFixture } = await createPage();
  unpaidFixture.state.operations = [];
  unpaidFixture.state.reports[0].propertyIds = ["g1"];
  unpaidFixture.state.stayPaymentAlerts = [
    {
      reservationId: "reservation-unpaid",
      guest: "Client sans règlement",
      bookingSource: "Direct",
      stays: [
        {
          propertyId: "g1",
          propertyLabel: "La Maison du verger",
          arrival: "2026-10-09",
          departure: "2026-10-11",
        },
      ],
      totalCents: 10000,
      receivedCents: 0,
      remainingCents: 10000,
      reason: "missing",
      sourceRevision: "a".repeat(64),
    },
  ];
  await open(unpaidPage, "/social");
  const unpaidPanel = unpaidPage.getByRole("region", {
    name: "Paiements des séjours terminés",
  });
  await unpaidPanel
    .getByRole("heading", { name: /Séjours terminés/ })
    .waitFor();
  assert.equal(
    await unpaidPage
      .getByRole("button", { name: "Copier le montant sans centimes" })
      .isDisabled(),
    true,
  );
  assert.equal((await total(unpaidPage)).replace(/\s/g, ""), "0,00€");
  assert.equal(
    await unpaidPage
      .getByRole("button", { name: "Marquer comme prêt", exact: true })
      .count(),
    0,
  );
  assert.match(await unpaidPanel.innerText(), /100,00\s*€/);
  assert.match(
    await unpaidPanel
      .getByRole("link", { name: "Voir les règlements" })
      .getAttribute("href"),
    /reservation-unpaid/,
  );
  await noOverflow(unpaidPage);
  await capture(unpaidPage, "reports-ended-stay-unpaid-desktop.png");
  await unpaidPage.setViewportSize({ width: 390, height: 844 });
  await noOverflow(unpaidPage);
  await capture(unpaidPage, "reports-ended-stay-unpaid-mobile.png");
  await unpaidPanel
    .getByLabel("Situation des règlements après vérification")
    .fill("Solde encore impayé, relance envoyée au client.");
  unpaidFixture.failMutation = 1;
  await unpaidPanel
    .getByRole("button", { name: "Confirmer la vérification des règlements" })
    .click();
  await unpaidPanel.getByRole("alert").waitFor();
  assert.equal(
    await unpaidPanel
      .getByLabel("Situation des règlements après vérification")
      .inputValue(),
    "Solde encore impayé, relance envoyée au client.",
  );
  await unpaidPanel
    .getByRole("button", { name: "Confirmer la vérification des règlements" })
    .click();
  await unpaidPanel.getByText(/Situation vérifiée le/).waitFor();
  assert.equal(
    await unpaidPage
      .getByRole("button", { name: "Copier le montant sans centimes" })
      .isDisabled(),
    false,
  );
  assert.equal((await total(unpaidPage)).replace(/\s/g, ""), "0,00€");
  await unpaidPage
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .click();
  await unpaidPage
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .waitFor();
  unpaidFixture.state.stayPaymentAlerts[0] = {
    ...unpaidFixture.state.stayPaymentAlerts[0],
    receivedCents: 3000,
    remainingCents: 7000,
    reason: "partial",
    sourceRevision: "b".repeat(64),
  };
  await unpaidPage
    .getByRole("button", { name: "Actualiser les données" })
    .click();
  await unpaidPanel
    .getByLabel("Situation des règlements après vérification")
    .waitFor();
  assert.match(await unpaidPanel.innerText(), /Règlement partiel/);
  assert.equal(
    await unpaidPage
      .getByRole("button", { name: "Confirmer la transmission", exact: true })
      .count(),
    0,
  );
  unpaidFixture.state.stayPaymentAlerts = [];
  await unpaidPage
    .getByRole("button", { name: "Actualiser les données" })
    .click();
  await unpaidPanel.waitFor({ state: "detached" });
  await unpaidPage.context().close();

  const { page: taxPage, fixture: taxFixture } = await createPage();
  taxFixture.state.managers[0].name = "Sébastien";
  taxFixture.state.managers[1].name = "Soazig";
  taxFixture.state.properties[1].name = "Le Liberté";
  const taxReport = {
    ...createReport("tourist", "tax-confirmed"),
    name: "Déclaration mensuelle",
    nightDeclaration: true,
    propertyIds: ["g1", "g2"],
  };
  taxFixture.state.reports.push(taxReport);
  const confirmedTaxRegister = {
    ...registerData(),
    reportId: taxReport.id,
    reportName: taxReport.name,
    incompleteCount: 0,
    period: { label: "Octobre 2026", start: "2026-10-01", end: "2026-11-01" },
    summary: [
      {
        propertyId: "g1",
        propertyName: "La Maison du verger",
        hostCollectedCents: 500,
        platformCollectedCents: 200,
      },
      {
        propertyId: "g2",
        propertyName: "Le Liberté",
        hostCollectedCents: 210,
        platformCollectedCents: 400,
      },
    ],
  };
  taxFixture.state.progress[reportPeriodKey(taxReport, "2026-10")] = {
    snapshot: {
      confirmedAt: "2026-11-03",
      definition: taxReport,
      result: { total: 0, rows: [] },
      nightRegister: confirmedTaxRegister,
    },
  };
  await open(taxPage, "/reversements");
  await taxPage
    .getByRole("heading", { name: "Reversements de taxe de séjour" })
    .waitFor();
  await taxPage
    .getByLabel("Propriétaire", { exact: true })
    .selectOption("manager-b");
  assert.match(
    await taxPage.locator(".rp-panel").first().innerText(),
    /Le Liberté/,
  );
  await taxPage
    .getByRole("button", { name: "Préparer un reversement", exact: true })
    .click();
  let taxDialog = taxPage.getByRole("dialog", {
    name: "Préparer un reversement",
    exact: true,
  });
  await taxDialog
    .getByLabel("Libellé du reversement", { exact: true })
    .fill("Trimestre Soazig");
  await taxDialog.getByRole("checkbox").check();
  assert.equal(
    await taxDialog
      .getByLabel("Montant à reverser déclaré sur le portail (€)", {
        exact: true,
      })
      .inputValue(),
    "2.10",
  );
  await taxDialog
    .getByLabel("Montant à reverser déclaré sur le portail (€)", {
      exact: true,
    })
    .fill("2,11");
  assert.equal(
    await taxDialog
      .getByRole("button", { name: "Enregistrer le reversement", exact: true })
      .isDisabled(),
    true,
  );
  await taxDialog
    .getByLabel(/Note.*justification/)
    .fill("Arrondi confirmé sur le portail");
  for (const width of [1440, 390]) {
    await taxPage.setViewportSize({ width, height: 1050 });
    await noOverflow(taxPage);
    await capture(taxPage, `remittance-create-${width}.png`);
  }
  taxFixture.failMutation = 1;
  await taxDialog
    .getByRole("button", { name: "Enregistrer le reversement", exact: true })
    .click();
  await taxDialog
    .getByRole("alert")
    .filter({ hasText: "Enregistrement indisponible" })
    .waitFor({ state: "attached" });
  assert.equal(
    await taxDialog
      .getByLabel("Libellé du reversement", { exact: true })
      .inputValue(),
    "Trimestre Soazig",
  );
  await taxDialog
    .getByRole("button", { name: "Enregistrer le reversement", exact: true })
    .click();
  await taxDialog.waitFor({ state: "detached" });
  const taxCard = taxPage.getByRole("region", {
    name: "Reversement · Trimestre Soazig",
    exact: true,
  });
  assert.match(await taxCard.innerText(), /À reverser/);
  await taxCard
    .getByRole("button", {
      name: "Enregistrer un paiement à la collectivité",
      exact: true,
    })
    .click();
  taxDialog = taxPage.getByRole("dialog", {
    name: "Enregistrer un paiement à la collectivité",
    exact: true,
  });
  await taxDialog.getByLabel("Montant versé (€)", { exact: true }).fill("1,00");
  await taxDialog
    .getByLabel("Date réelle du paiement", { exact: true })
    .fill("2026-11-03");
  await taxDialog
    .getByLabel("Référence du paiement", { exact: true })
    .fill("PAYFIP-123");
  taxFixture.failMutation = 1;
  await taxDialog
    .getByRole("button", { name: "Enregistrer le paiement", exact: true })
    .click();
  await taxDialog
    .getByRole("alert")
    .filter({ hasText: "Enregistrement indisponible" })
    .waitFor();
  const firstPaymentAttempt = taxFixture.commands
    .filter((c) => c.type === "remittance-payment")
    .at(-1);
  await taxDialog
    .getByRole("button", { name: "Enregistrer le paiement", exact: true })
    .click();
  await taxDialog.waitFor({ state: "detached" });
  assert.equal(
    taxFixture.commands.filter((c) => c.type === "remittance-payment").at(-1)
      .payment.id,
    firstPaymentAttempt.payment.id,
  );
  assert.match(await taxCard.innerText(), /Partiellement réglé/);
  await taxCard
    .getByLabel("Ajouter un justificatif à ce paiement", { exact: true })
    .setInputFiles({
      name: "Recu-Payfip.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 receipt"),
    });
  await taxCard
    .getByRole("link", { name: "Recu-Payfip.pdf", exact: true })
    .waitFor();
  for (const width of [1440, 390]) {
    await taxPage.setViewportSize({ width, height: 1050 });
    await noOverflow(taxPage);
    await taxPage.evaluate(() => window.scrollTo(0, 0));
    await capture(taxPage, `remittance-partial-${width}.png`);
  }
  await taxPage.reload();
  await taxPage
    .getByLabel("Propriétaire", { exact: true })
    .selectOption("manager-b");
  await taxCard
    .getByRole("link", { name: "Recu-Payfip.pdf", exact: true })
    .waitFor();
  await taxCard
    .getByRole("button", {
      name: "Annuler ce paiement saisi par erreur",
      exact: true,
    })
    .click();
  taxDialog = taxPage.getByRole("dialog", {
    name: "Annuler un paiement saisi par erreur",
    exact: true,
  });
  await taxDialog
    .getByLabel("Motif de l’annulation", { exact: true })
    .fill("Double saisie vérifiée");
  await taxDialog
    .getByRole("button", {
      name: "Confirmer l’annulation du paiement",
      exact: true,
    })
    .click();
  await taxDialog.waitFor({ state: "detached" });
  assert.match(await taxCard.innerText(), /À reverser/);
  assert.match(await taxCard.innerText(), /Double saisie vérifiée/);
  await taxPage
    .getByLabel("Propriétaire", { exact: true })
    .selectOption("manager-a");
  assert.equal(
    await taxPage
      .getByRole("region", {
        name: "Reversement · Trimestre Soazig",
        exact: true,
      })
      .count(),
    0,
  );
  const { page: taxReader, fixture: readerFixture } = await createPage({
    canWrite: false,
  });
  readerFixture.state = structuredClone(taxFixture.state);
  await open(taxReader, "/reversements");
  await taxReader
    .getByLabel("Propriétaire", { exact: true })
    .selectOption("manager-b");
  await taxReader
    .getByRole("link", { name: "Recu-Payfip.pdf", exact: true })
    .waitFor();
  assert.equal(
    await taxReader
      .getByRole("button", {
        name: /Enregistrer un paiement|Préparer un reversement|Modifier le montant/,
      })
      .count(),
    0,
  );

  for (const outcome of ["corrected", "kept"]) {
    const { page: resolutionPage, fixture: resolutionFixture } =
      await createPage();
    await resolutionPage.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
    const state = resolutionFixture.state;
    const report = { ...state.reports[0], propertyIds: ["g1"] };
    state.reports = [report];
    state.legacyDeclarations = [];
    state.operations = [{ ...baseOperation, id: "resolution-payment" }];
    const key = reportPeriodKey(report, "2026-10");
    const original = {
      confirmedAt: "2026-10-31T12:00:00Z",
      definition: structuredClone(report),
      result: evaluateReport(report, "2026-10", {}, state.operations, state),
    };
    state.progress[key] = { snapshot: structuredClone(original) };
    state.operations[0].amountCents += 100;
    state.factsRevision = "resolution-first-change";
    await open(resolutionPage, "/social");
    await resolutionPage
      .getByText("Écart à examiner", { exact: true })
      .waitFor();
    await resolutionPage
      .getByRole("button", {
        name: "Examiner et résoudre l’écart",
        exact: true,
      })
      .click();
    let dialog = resolutionPage.getByRole("dialog", {
      name: "Examiner l’écart",
      exact: true,
    });
    await dialog
      .getByRole("heading", { name: "Opérations modifiées (1)", exact: true })
      .waitFor();
    assert.match(
      await dialog.locator(".rp-discrepancy-totals").innerText(),
      /500,00[\s\S]*501,00[\s\S]*\+1,00/,
    );
    const save = () =>
      dialog.getByRole("button", {
        name: "Enregistrer la résolution",
        exact: true,
      });
    assert.equal(await save().isDisabled(), true);
    const label =
      outcome === "corrected"
        ? "Déclaration rectifiée"
        : "Écart examiné, déclaration conservée";
    await dialog.getByRole("radio", { name: new RegExp(label) }).check();
    assert.equal(await save().isDisabled(), true);
    const note = "Examen effectué, référence de suivi 2026-42.";
    await dialog.getByLabel("Justification de la résolution").fill(note);
    for (const width of [1440, 390]) {
      await resolutionPage.setViewportSize({ width, height: 1050 });
      await noOverflow(resolutionPage);
      assert.equal(
        await dialog.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
        false,
      );
      await capture(
        resolutionPage,
        `reports-resolution-${outcome}-${width}.png`,
      );
    }
    if (outcome === "corrected") {
      resolutionFixture.failMutation = 1;
      await save().click();
      await dialog
        .getByText(
          "La résolution n’a pas été enregistrée. Vérifiez les données et réessayez.",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await dialog.getByLabel("Justification de la résolution").inputValue(),
        note,
      );
      assert.equal(state.progress[key].resolutions, undefined);
    } else {
      resolutionFixture.conflict = true;
      await save().click();
      await dialog
        .getByText(/Les données ont changé pendant l’examen/)
        .waitFor();
      assert.equal(await save().isDisabled(), true);
      await dialog
        .getByRole("button", { name: "Revenir au rapport", exact: true })
        .click();
      await resolutionPage
        .getByRole("button", {
          name: "Examiner et résoudre l’écart",
          exact: true,
        })
        .click();
      dialog = resolutionPage.getByRole("dialog", {
        name: "Examiner l’écart",
        exact: true,
      });
      await dialog.getByRole("radio", { name: new RegExp(label) }).check();
      await dialog.getByLabel("Justification de la résolution").fill(note);
    }
    await save().click();
    await resolutionPage
      .getByText("Écart résolu", { exact: true })
      .first()
      .waitFor();
    assert.deepEqual(state.progress[key].snapshot, original);
    assert.equal(state.progress[key].resolutions.length, 1);
    assert.equal(
      buildReportReminders(state, 2026, new Date("2026-11-03T12:00:00Z")).some(
        (item) => item.id === key,
      ),
      false,
    );
    await resolutionPage.getByRole("button", { name: /^Historique/ }).click();
    await resolutionPage
      .getByRole("dialog")
      .getByRole("button")
      .filter({ hasText: note })
      .click();
    await resolutionPage
      .getByText("Résolution enregistrée", { exact: true })
      .waitFor();
    assert.match(await total(resolutionPage), /501,00/);
    await resolutionPage
      .getByRole("button", { name: "Revenir au calcul courant", exact: true })
      .click();
    await resolutionPage
      .getByRole("button", { name: "Voir la copie confirmée", exact: true })
      .click();
    assert.match(await total(resolutionPage), /500,00/);
    await resolutionPage
      .getByRole("button", { name: "Revenir au calcul courant", exact: true })
      .click();
    await resolutionPage
      .getByRole("link", { name: "Tous les rapports", exact: true })
      .click();
    await resolutionPage
      .getByRole("heading", { name: /Rapports à traiter/ })
      .waitFor();
    assert.equal(await resolutionPage.locator(".rp-report-row").count(), 0);
    await resolutionPage.reload();
    await resolutionPage
      .getByRole("heading", { name: /Rapports à traiter/ })
      .waitFor();
    assert.equal(await resolutionPage.locator(".rp-report-row").count(), 0);
    // A new change with an unchanged total must also reopen the work item.
    state.operations[0].paymentMethod = "card";
    state.factsRevision = "resolution-second-change";
    await resolutionPage
      .getByRole("button", { name: "Actualiser les données", exact: true })
      .click();
    await resolutionPage
      .getByText("Écart à examiner", { exact: true })
      .waitFor();
    assert.equal(await resolutionPage.locator(".rp-report-row").count(), 1);
    await resolutionPage
      .getByRole("link", { name: "Cotisations sociales", exact: true })
      .click();
    await resolutionPage
      .getByRole("button", {
        name: "Consulter la dernière résolution",
        exact: true,
      })
      .click();
    await resolutionPage
      .getByText("Résolution enregistrée", { exact: true })
      .waitFor();
    assert.match(await total(resolutionPage), /501,00/);
    await resolutionPage
      .getByRole("button", { name: "Revenir au calcul courant", exact: true })
      .click();
    await resolutionPage
      .getByRole("button", {
        name: "Examiner et résoudre l’écart",
        exact: true,
      })
      .click();
    dialog = resolutionPage.getByRole("dialog", {
      name: "Examiner l’écart",
      exact: true,
    });
    await dialog.getByText("Dernière résolution", { exact: true }).waitFor();
    await dialog
      .getByRole("heading", { name: "Opérations modifiées (1)", exact: true })
      .waitFor();
    assert.match(
      await dialog.locator(".rp-discrepancy-totals").innerText(),
      /501,00[\s\S]*501,00[\s\S]*0,00/,
    );
    await resolutionPage.context().close();

    const { page: reader, fixture: readerFixture } = await createPage({
      canWrite: false,
    });
    readerFixture.state = structuredClone(state);
    await open(reader, "/social");
    await reader
      .getByRole("button", { name: "Examiner l’écart", exact: true })
      .click();
    assert.equal(
      await reader
        .getByRole("button", { name: "Enregistrer la résolution", exact: true })
        .count(),
      0,
    );
    assert.equal(await reader.getByRole("radio").count(), 0);
    await reader.context().close();
  }

  for (const kind of ["social", "tourist", "owner", "custom"]) {
    const { page: filters, fixture: filterFixture } = await createPage();
    filterFixture.state.reports = [
      {
        ...createReport(kind, "filtered"),
        name: `Rapport ${kind}`,
        recipient: "Gestion interne",
        propertyIds: ["g1", "g2"],
        categories: ["accommodation"],
        operatorId: kind === "social" ? "entity-a" : null,
      },
    ];
    filterFixture.state.operations = [
      {
        ...baseOperation,
        id: "direct",
        stayDate: "2026-10-10",
        nights: 6,
        basis: kind === "tourist" ? "nights" : "payment",
      },
      {
        ...baseOperation,
        id: "airbnb",
        channel: "Airbnb",
        stayDate: "2026-10-10",
        nights: 9,
        basis: kind === "tourist" ? "nights" : "payment",
      },
      {
        ...baseOperation,
        id: "outside",
        propertyId: "g2",
        stayDate: "2026-10-10",
        nights: 20,
        basis: kind === "tourist" ? "nights" : "payment",
      },
    ];
    await open(filters, "/filtered/modifier");
    await filters
      .getByRole("heading", { name: "Réglages", exact: true })
      .waitFor();
    assert.equal(
      await filters
        .getByLabel("Destinataire ou usage", { exact: true })
        .count(),
      kind === "social" ? 0 : 1,
    );
    if (kind === "social") {
      assert.match(
        await filters
          .getByRole("complementary", { name: "Aperçu du rapport" })
          .innerText(),
        /Entreprise Martin/,
      );
      await filters.locator("#rp-report-operator").selectOption("");
      await filters
        .getByRole("button", { name: /Appliquer les règles/ })
        .click();
      await filters.getByText(/Renseignez un nom, un exploitant/).waitFor();
      assert.equal(filterFixture.commands.length, 0);
      await filters.locator("#rp-report-operator").selectOption("entity-a");
    }
    await filters.locator("#rp-report-manager").selectOption("manager-a");
    const properties = filters.getByRole("group", {
      name: "Logements concernés",
      exact: true,
    });
    assert.equal(
      await properties
        .getByLabel("La Maison du verger", { exact: false })
        .isChecked(),
      true,
    );
    assert.equal(
      await properties
        .getByLabel("Le Refuge des bois", { exact: false })
        .isDisabled(),
      true,
    );
    await filters
      .getByRole("button", { name: "Direct uniquement", exact: true })
      .click();
    const sourceChoices = filters.getByRole("group", {
      name: "Sources de réservation",
      exact: true,
    });
    assert.equal(
      await sourceChoices.getByLabel("Direct", { exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await sourceChoices.getByLabel("Airbnb", { exact: true }).isChecked(),
      false,
    );
    await sourceChoices.getByLabel("Airbnb", { exact: true }).check();
    await sourceChoices.getByLabel("Direct", { exact: true }).uncheck();
    await filters.reload();
    assert.equal(
      await filters.locator("#rp-report-manager").inputValue(),
      "manager-a",
    );
    assert.equal(
      await sourceChoices.getByLabel("Airbnb", { exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await sourceChoices.getByLabel("Direct", { exact: true }).isChecked(),
      false,
    );
    await sourceChoices.getByLabel("Airbnb", { exact: true }).uncheck();
    await filters
      .locator(".rp-header-actions")
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await filters
      .getByText(
        kind === "social"
          ? /Renseignez un nom, un exploitant/
          : /Renseignez un nom, un destinataire/,
      )
      .waitFor();
    assert.equal(filterFixture.commands.length, 0);
    await filters.reload();
    assert.equal(
      await sourceChoices.getByRole("checkbox", { checked: true }).count(),
      0,
    );
    await sourceChoices.getByLabel("Airbnb", { exact: true }).check();
    await noOverflow(filters);
    if (kind === "tourist") {
      await capture(filters, "reports-filters-desktop.png");
      await filters.setViewportSize({ width: 390, height: 844 });
      await noOverflow(filters);
      await capture(filters, "reports-filters-mobile.png");
      await filters.setViewportSize({ width: 1440, height: 1050 });
    }
    await filters
      .locator(".rp-header-actions")
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await filters
      .getByRole("heading", { name: `Rapport ${kind}`, exact: true })
      .waitFor();
    assert.equal(
      await total(filters),
      kind === "tourist" ? "9 nuitées" : "500,00 €",
    );
    assert.equal(filterFixture.commands[0].definition.managerId, "manager-a");
    assert.equal(
      await filters.locator(".rp-identity-name").innerText(),
      "Camille Martin",
    );
    assert.equal(
      filterFixture.commands[0].definition.recipient,
      kind === "social" ? "Entreprise Martin" : "Camille Martin",
    );
    assert.deepEqual(filterFixture.commands[0].definition.bookingSources, [
      "Airbnb",
    ]);
    assert.deepEqual(filterFixture.commands[0].definition.propertyIds, ["g1"]);
    await open(filters, "/filtered/modifier");
    await filters
      .getByRole("button", { name: "Toutes les sources", exact: true })
      .click();
    await filters.getByRole("button", { name: /Appliquer les règles/ }).click();
    await filters
      .getByRole("heading", { name: `Rapport ${kind}`, exact: true })
      .waitFor();
    assert.equal(
      filterFixture.commands[1].definition.bookingSources,
      undefined,
    );
    await filters.context().close();
  }
  const reviewOperations = [
    {
      ...baseOperation,
      id: "review-accommodation",
      amountCents: 69290,
      reviewReason: "Règlement à vérifier.",
    },
    {
      ...baseOperation,
      id: "review-extras",
      category: "extras",
      amountCents: 5000,
      reviewReason: "Règlement à vérifier.",
    },
  ];
  const { page: paymentReview, fixture: paymentReviewFixture } =
    await createPage();
  await paymentReview.setViewportSize({ width: 1440, height: 700 });
  paymentReviewFixture.state.operations = reviewOperations;
  await open(paymentReview, "/social");
  await paymentReview
    .getByRole("searchbox", { name: "Rechercher une opération" })
    .fill("introuvable");
  await paymentReview
    .getByRole("button", { name: "Examiner les 2 opérations", exact: true })
    .click();
  await paymentReview.waitForFunction(() => {
    const section = document.querySelector(".rp-operations-panel");
    return (
      section &&
      section.getBoundingClientRect().top >= 0 &&
      section.getBoundingClientRect().top < innerHeight - 200
    );
  });
  assert.equal(
    await paymentReview
      .getByRole("searchbox", { name: "Rechercher une opération" })
      .inputValue(),
    "",
  );
  assert.equal(
    await paymentReview
      .getByRole("button", { name: /^À vérifier/ })
      .getAttribute("aria-pressed"),
    "true",
  );
  const reviewBalance = paymentReview.getByRole("button", {
    name: /^Règlements de Camille Martin/,
  });
  await reviewBalance.first().waitFor();
  assert.equal(await reviewBalance.count(), 2);
  assert.deepEqual(paymentReviewFixture.reservationReads, ["reservation-a"]);
  assert.match(
    await reviewBalance.first().innerText(),
    /692,90.*Reste à payer.*50,00/s,
  );
  assert.equal(
    await reviewBalance
      .first()
      .getByRole("progressbar")
      .getAttribute("aria-valuenow"),
    "93",
  );
  await paymentReview.getByText("692,90 €", { exact: true }).click();
  const reviewPopover = paymentReview.getByRole("dialog", {
    name: "Règlements",
    exact: true,
  });
  await reviewPopover.waitFor();
  assert.equal(
    await paymentReview
      .getByRole("dialog", { name: "Détail de l’opération", exact: true })
      .count(),
    0,
  );
  assert.match(await reviewPopover.innerText(), /742,90/);
  await paymentReview.screenshot({
    path: path.join(screenshots, "reports-review-payments-desktop.png"),
    animations: "disabled",
  });
  await reviewPopover
    .getByRole("button", { name: "Fermer les règlements", exact: true })
    .click();
  await paymentReview.setViewportSize({ width: 390, height: 844 });
  await noOverflow(paymentReview);
  await reviewBalance.first().click();
  await reviewPopover.waitFor();
  const popoverBounds = await reviewPopover.boundingBox();
  assert.ok(
    popoverBounds.x >= 0 && popoverBounds.x + popoverBounds.width <= 390,
  );
  await paymentReview.screenshot({
    path: path.join(screenshots, "reports-review-payments-mobile.png"),
    animations: "disabled",
  });
  await reviewPopover
    .getByRole("button", { name: /Ajouter un règlement/ })
    .click();
  await reviewPopover
    .getByLabel("Moyen", { exact: true })
    .selectOption("Espèces");
  const readsBeforePayment = paymentReviewFixture.reads;
  paymentReviewFixture.failReviewPayment = 1;
  await reviewPopover
    .getByRole("button", { name: "Enregistrer le règlement", exact: true })
    .click();
  await reviewPopover
    .getByText("Règlement indisponible", { exact: true })
    .waitFor();
  assert.equal(paymentReviewFixture.reads, readsBeforePayment);
  await reviewPopover
    .getByRole("button", { name: "Enregistrer le règlement", exact: true })
    .click();
  await paymentReview
    .getByText("Aucune opération à vérifier", { exact: true })
    .waitFor();
  assert.equal(paymentReviewFixture.paymentPosts.length, 2);
  assert.equal(
    paymentReviewFixture.paymentPosts[0].id,
    paymentReviewFixture.paymentPosts[1].id,
  );
  assert.equal(paymentReviewFixture.reads, readsBeforePayment + 1);
  assert.equal(paymentReviewFixture.reportRefreshQueries.at(-1), "1");
  assert.match(await total(paymentReview), /742,90/);

  for (const options of [
    { canWrite: false },
    { reservationsAccess: false },
    {},
  ]) {
    const { page: reviewAccess, fixture: reviewAccessFixture } =
      await createPage(options);
    reviewAccessFixture.state.operations = reviewOperations;
    reviewAccessFixture.failReservationRead = 1;
    await open(reviewAccess, "/social");
    await reviewAccess.getByRole("button", { name: /^À vérifier/ }).click();
    if (options.reservationsAccess === false) {
      await reviewAccess.locator(".rp-operation-row").first().waitFor();
      assert.equal(
        await reviewAccess.locator(".reservation-payment-balance").count(),
        0,
      );
      assert.deepEqual(reviewAccessFixture.reservationReads, []);
    } else {
      await reviewAccess
        .getByRole("button", { name: /Règlements indisponibles · Réessayer/ })
        .first()
        .click();
      await reviewAccess
        .getByRole("button", { name: /^Règlements de Camille Martin/ })
        .first()
        .click();
      const readonlyPopover = reviewAccess.getByRole("dialog", {
        name: "Règlements",
        exact: true,
      });
      await readonlyPopover.waitFor();
      if (options.canWrite === false) {
        assert.equal(
          await readonlyPopover
            .getByRole("button", { name: /Ajouter un règlement|Encaisser/ })
            .count(),
          0,
        );
      }
      assert.equal(reviewAccessFixture.paymentPosts.length, 0);
    }
    await reviewAccess.context().close();
  }
  await paymentReview.context().close();

  const { page: worklist, fixture: worklistFixture } = await createPage();
  await worklist.clock.setFixedTime(new Date("2026-10-31T12:00:00Z"));
  worklistFixture.state.worklistStartMonth = "2026-09";
  worklistFixture.state.legacyDeclarations = [];
  worklistFixture.state.reports[0].propertyIds = ["g1"];
  worklistFixture.state.operations = [
    {
      ...baseOperation,
      id: "september",
      paymentDate: "2026-09-10",
      stayDate: "2026-09-09",
    },
    {
      ...baseOperation,
      id: "old-stay",
      paymentDate: "2017-01-07",
      stayDate: "2017-01-06",
    },
  ];
  await open(worklist);
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 3);
  assert.equal(
    await worklist.locator('.rp-report-row[data-period="2026-09"]').count(),
    3,
  );
  assert.equal(await worklist.locator(".rp-overview-top").count(), 0);
  await capture(worklist, "reports-todo-desktop.png");
  await noOverflow(worklist);
  await worklist.setViewportSize({ width: 390, height: 844 });
  await noOverflow(worklist);
  await capture(worklist, "reports-todo-mobile.png");
  await worklist.setViewportSize({ width: 1440, height: 1050 });
  await worklist
    .getByRole("link", { name: "Relevé propriétaire", exact: true })
    .click();
  assert.match(worklist.url(), /periode=2026-09/);
  await worklist
    .getByRole("button", { name: "Marquer comme prêt", exact: true })
    .click();
  await worklist
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .waitFor();
  await worklist
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .click();
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 3);
  assert.match(
    await worklist.locator('[data-report-id="owner"]').innerText(),
    /Prêt à confirmer/,
  );
  await worklist
    .getByRole("link", { name: "Relevé propriétaire", exact: true })
    .click();
  await worklist
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await worklist
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await worklist
    .getByRole("button", { name: "Voir la copie confirmée", exact: true })
    .waitFor();
  await worklist
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .click();
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 2);
  await worklist.reload();
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 2);
  worklistFixture.state.operations[0].amountCents += 100;
  worklistFixture.state.factsRevision = "facts-v2";
  await worklist
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await worklist
    .locator('[data-report-id="owner"]')
    .getByText("Écart à examiner", { exact: true })
    .waitFor();
  await worklist.clock.setFixedTime(new Date("2026-10-31T23:00:00Z"));
  await worklist.reload();
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 6);
  assert.equal(
    await worklist.locator('.rp-report-row[data-period="2026-10"]').count(),
    3,
  );
  await worklist
    .getByRole("button", { name: "Par période", exact: true })
    .click();
  await worklist.getByLabel("Période de travail").fill("2026-08");
  assert.match(worklist.url(), /vue=periode/);
  assert.equal(await worklist.locator(".rp-report-row").count(), 3);
  assert.equal(
    await worklist.getByText("Déjà traité", { exact: true }).count(),
    3,
  );
  await worklist
    .getByRole("button", { name: "À traiter", exact: true })
    .click();
  await worklist.getByRole("heading", { name: /Rapports à traiter/ }).waitFor();
  assert.equal(await worklist.locator(".rp-report-row").count(), 6);
  await worklist
    .getByLabel("Rapport à traiter", { exact: true })
    .selectOption("owner");
  assert.equal(await worklist.locator(".rp-report-row").count(), 2);
  await worklist
    .getByLabel("Rapport à traiter", { exact: true })
    .selectOption("all");
  await worklist
    .getByRole("searchbox", { name: "Rechercher un rapport à traiter" })
    .fill("septembre");
  assert.equal(await worklist.locator(".rp-report-row").count(), 3);
  await worklist
    .getByRole("searchbox", { name: "Rechercher un rapport à traiter" })
    .fill("");
  worklistFixture.state.reports[2].cadence = "quarterly";
  await worklist
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await worklist
    .locator('[data-report-id="fees"]')
    .getByText("Trimestriel", { exact: true })
    .waitFor();
  assert.equal(await worklist.locator('[data-report-id="fees"]').count(), 1);

  const { page: grouped, fixture: groupedFixture } = await createPage();
  await grouped.clock.setFixedTime(new Date("2026-11-02T12:00:00Z"));
  Object.assign(groupedFixture.state, {
    worklistStartMonth: "2026-09",
    legacyDeclarations: [],
    propertyOperators: { g1: "entity-a", g2: "entity-b" },
    operators: [
      { id: "entity-a", name: "Martin Camille", legacy: false },
      { id: "entity-b", name: "Durand Alex", legacy: false },
    ],
    reports: [
      ...["a", "b"].map((suffix, i) => ({
        ...createReport("social", `social-${suffix}`),
        name: "URSSAF",
        favorite: false,
        recipient: i ? "Durand Alex" : "Martin Camille",
        operatorId: `entity-${suffix}`,
        propertyIds: [`g${i + 1}`],
      })),
      ...["a", "b"].map((suffix, i) => ({
        ...createReport("tourist", `nights-${suffix}`),
        name: "Nuitées",
        recipient: i ? "Alex Durand" : "Camille Martin",
        managerId: `manager-${suffix}`,
        propertyIds: [`g${i + 1}`],
      })),
    ],
    operations: ["09", "10"].flatMap((month) =>
      ["g1", "g2"].flatMap((propertyId, i) => [
        {
          ...baseOperation,
          id: `income-${month}-${propertyId}`,
          propertyId,
          paymentDate: `2026-${month}-10`,
          stayDate: `2026-${month}-10`,
          amountCents: i ? 316947 : 443817,
        },
        {
          ...baseOperation,
          id: `night-${month}-${propertyId}`,
          propertyId,
          basis: "nights",
          stayDate: `2026-${month}-10`,
          nights: i ? 14 : 19,
        },
      ]),
    ),
  });
  await open(grouped);
  await grouped.locator(".rp-month-group").first().waitFor();
  assert.deepEqual(
    await grouped
      .locator(".rp-month-group")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.month)),
    ["2026-09", "2026-10"],
  );
  assert.equal(await grouped.locator(".rp-manager-group").count(), 4);
  assert.equal(await grouped.locator(".rp-report-row").count(), 8);
  for (const month of ["2026-09", "2026-10"]) {
    const monthGroup = grouped.locator(
      `.rp-month-group[data-month="${month}"]`,
    );
    for (const manager of ["a", "b"]) {
      const rows = monthGroup.locator(
        `[data-manager="manager:manager-${manager}"] .rp-report-row`,
      );
      assert.deepEqual(
        await rows.evaluateAll((nodes) =>
          nodes.map((node) => node.dataset.reportId),
        ),
        [`nights-${manager}`, `social-${manager}`],
      );
      assert.equal(
        await monthGroup
          .locator(
            `[data-report-id="social-${manager}"] .rp-report-property-badge`,
          )
          .count(),
        0,
      );
      assert.deepEqual(
        await monthGroup
          .locator(
            `[data-report-id="nights-${manager}"] .rp-report-property-badge`,
          )
          .allTextContents(),
        [manager === "a" ? "La Maison du verger" : "Le Refuge des bois"],
      );
    }
  }
  await capture(grouped, "reports-grouped-desktop.png");
  await noOverflow(grouped);
  const columnsToggle = grouped.getByRole("button", {
    name: "Afficher les gestionnaires sur deux colonnes",
    exact: true,
  });
  assert.equal(await columnsToggle.getAttribute("aria-pressed"), "false");
  await columnsToggle.click();
  await grouped.locator(".rp-grouped-list--columns").waitFor();
  const managerCards = grouped.locator(
    '[data-month="2026-09"] .rp-manager-group',
  );
  const firstCard = await managerCards.nth(0).boundingBox();
  const secondCard = await managerCards.nth(1).boundingBox();
  assert.ok(secondCard.x > firstCard.x + firstCard.width);
  assert.ok(Math.abs(secondCard.y - firstCard.y) < 1);
  await capture(grouped, "reports-grouped-two-columns-desktop.png");
  await noOverflow(grouped);
  await grouped.reload();
  await grouped.locator(".rp-grouped-list--columns").waitFor();
  assert.equal(await columnsToggle.getAttribute("aria-pressed"), "true");
  await columnsToggle.click();
  await grouped
    .locator(".rp-grouped-list:not(.rp-grouped-list--columns)")
    .waitFor();
  assert.equal(await columnsToggle.getAttribute("aria-pressed"), "false");
  await columnsToggle.click();
  await grouped.locator(".rp-grouped-list--columns").waitFor();
  await grouped
    .getByRole("button", { name: "Tout replier", exact: true })
    .click();
  assert.equal(
    await grouped
      .locator('.rp-month-group__toggle[aria-expanded="false"]')
      .count(),
    2,
  );
  assert.equal(await grouped.locator(".rp-report-row:visible").count(), 0);
  await grouped
    .getByRole("button", { name: "Tout déplier", exact: true })
    .click();
  const september = grouped.locator(
    '[data-month="2026-09"] .rp-month-group__toggle',
  );
  await september.focus();
  await grouped.keyboard.press("Enter");
  assert.equal(await september.getAttribute("aria-expanded"), "false");
  await grouped.keyboard.press("Space");
  assert.equal(await september.getAttribute("aria-expanded"), "true");
  await grouped.getByLabel("Mois des rapports").selectOption("2026-10");
  await grouped
    .getByLabel("Gestionnaire des rapports")
    .selectOption("manager:manager-b");
  assert.equal(await grouped.locator(".rp-report-row").count(), 2);
  assert.match(
    await grouped.locator(".rp-manager-group__identity").innerText(),
    /Alex Durand/,
  );
  await grouped
    .getByRole("button", { name: "Effacer les filtres", exact: true })
    .click();
  await grouped.locator('[data-month="2026-09"]').waitFor();
  assert.equal(await grouped.locator(".rp-report-row").count(), 8);
  await grouped
    .getByRole("searchbox", { name: "Rechercher un rapport à traiter" })
    .fill("Camille Martin");
  assert.equal(await grouped.locator(".rp-report-row").count(), 4);
  await grouped
    .getByRole("button", { name: "Effacer les filtres", exact: true })
    .click();
  await grouped.waitForFunction(
    () => document.querySelectorAll(".rp-report-row").length === 8,
  );
  for (const width of [1024, 900, 850, 390, 320]) {
    await grouped.setViewportSize({ width, height: 844 });
    await noOverflow(grouped);
    assert.equal(await columnsToggle.isVisible(), false);
    const first = await managerCards.nth(0).boundingBox();
    const second = await managerCards.nth(1).boundingBox();
    assert.ok(Math.abs(first.x - second.x) < 1);
    assert.ok(second.y > first.y);
    await capture(grouped, `reports-grouped-mobile-${width}.png`);
  }
  await grouped.setViewportSize({ width: 1440, height: 1050 });
  await grouped
    .getByRole("button", { name: "Par période", exact: true })
    .click();
  await grouped
    .getByRole("heading", { name: "Rapports", exact: true })
    .waitFor();
  assert.equal(await grouped.locator(".rp-manager-group").count(), 2);
  assert.equal(await columnsToggle.getAttribute("aria-pressed"), "true");
  await grouped
    .getByRole("button", { name: "Ajouter aux favoris : URSSAF", exact: true })
    .first()
    .click();
  await grouped
    .getByRole("button", { name: "Retirer des favoris : URSSAF", exact: true })
    .waitFor();
  await grouped.getByRole("button", { name: "Favoris", exact: true }).click();
  assert.equal(await grouped.locator(".rp-report-row").count(), 1);
  groupedFixture.state.worklistStartMonth = "2026-04";
  await grouped
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await grouped.getByRole("button", { name: "À traiter", exact: true }).click();
  const moreMonths = grouped.getByRole("button", {
    name: "Afficher le mois suivant",
    exact: true,
  });
  await moreMonths.waitFor();
  assert.equal(await grouped.locator(".rp-month-group").count(), 6);
  assert.equal(await grouped.locator(".rp-report-row").count(), 24);
  await moreMonths.click();
  assert.equal(await grouped.locator(".rp-month-group").count(), 7);
  assert.equal(await grouped.locator(".rp-report-row").count(), 28);
  await grouped.getByLabel("Mois des rapports").selectOption("2026-09");
  const quickNight = grouped.locator(
    '[data-report-id="nights-a"][data-period="2026-09"]',
  );
  const readyAction = quickNight.getByRole("button", {
    name: /^Marquer comme prêt/,
  });
  const confirmAction = quickNight.getByRole("button", {
    name: /^Confirmer la transmission/,
  });
  const nightDefinition = groupedFixture.state.reports.find(
    (report) => report.id === "nights-a",
  );
  const septemberKey = reportPeriodKey(nightDefinition, "2026-09");
  const octoberKey = reportPeriodKey(nightDefinition, "2026-10");
  groupedFixture.failMutation = 1;
  await readyAction.click();
  await grouped
    .getByText("Enregistrement indisponible", { exact: true })
    .waitFor();
  assert.equal(groupedFixture.state.progress[septemberKey], undefined);
  await readyAction.click();
  await confirmAction.waitFor();
  assert.equal(groupedFixture.commandMonths.at(-1), "2026-09");
  assert.equal(groupedFixture.state.progress[septemberKey].ready, true);
  assert.equal(groupedFixture.state.progress[octoberKey], undefined);
  assert.match(grouped.url(), /periode=2026-10/);
  assert.match(await quickNight.innerText(), /Prêt à confirmer/);
  await noOverflow(grouped);
  await capture(grouped, "reports-quick-ready-desktop.png");
  await confirmAction.click();
  const confirmation = grouped.getByRole("dialog", {
    name: "Conserver une copie confirmée",
    exact: true,
  });
  await confirmation.waitFor();
  assert.match(await confirmation.innerText(), /La Maison du verger/);
  assert.match(await confirmation.innerText(), /septembre 2026/);
  await capture(grouped, "reports-quick-confirmation.png");
  await confirmation
    .getByRole("button", { name: "Revenir aux rapports", exact: true })
    .click();
  assert.equal(groupedFixture.state.progress[septemberKey].snapshot, undefined);
  await confirmAction.click();
  groupedFixture.failMutation = 1;
  await confirmation
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await confirmation.getByRole("alert").waitFor();
  assert.equal(groupedFixture.state.progress[septemberKey].snapshot, undefined);
  await confirmation
    .getByRole("button", { name: "Confirmer la transmission", exact: true })
    .click();
  await quickNight.waitFor({ state: "detached" });
  assert.equal(groupedFixture.commandMonths.at(-1), "2026-09");
  assert.ok(groupedFixture.state.progress[septemberKey].snapshot);
  assert.equal(groupedFixture.state.progress[octoberKey], undefined);
  assert.equal(await grouped.locator(".rp-report-row").count(), 3);
  groupedFixture.state.operations.find(
    (row) => row.id === "night-09-g1",
  ).nights += 1;
  groupedFixture.state.operations.find(
    (row) => row.id === "night-09-g2",
  ).reviewReason = "Occupants à vérifier";
  groupedFixture.state.factsRevision = "night-review";
  await grouped
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await quickNight.getByText("Écart à examiner", { exact: true }).waitFor();
  assert.equal(await quickNight.locator(".rp-progress-button").count(), 0);
  const reviewNight = grouped.locator(
    '[data-report-id="nights-b"][data-period="2026-09"]',
  );
  await reviewNight.getByText("1 à vérifier", { exact: true }).waitFor();
  assert.equal(await reviewNight.locator(".rp-progress-button").count(), 0);
  const sharedNight = groupedFixture.state.reports.find(
    (report) => report.id === "nights-b",
  );
  sharedNight.propertyIds = ["g1", "g2"];
  sharedNight.managerId = null;
  groupedFixture.state.factsRevision = "night-multi-property";
  await grouped
    .getByRole("button", { name: "Actualiser les données", exact: true })
    .click();
  await grouped.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-report-id="nights-b"] .rp-report-property-badge',
      ).length === 2,
  );
  assert.deepEqual(
    await reviewNight.locator(".rp-report-property-badge").allTextContents(),
    ["La Maison du verger", "Le Refuge des bois"],
  );
  await grouped.setViewportSize({ width: 390, height: 844 });
  await noOverflow(grouped);
  await capture(grouped, "reports-quick-actions-properties-mobile.png");
  const { page: quickReader, fixture: quickReaderFixture } = await createPage({
    canWrite: false,
  });
  quickReaderFixture.state = structuredClone(groupedFixture.state);
  await quickReader.clock.setFixedTime(new Date("2026-11-02T12:00:00Z"));
  await open(quickReader);
  await quickReader.locator(".rp-month-group").first().waitFor();
  assert.equal(await quickReader.locator(".rp-progress-button").count(), 0);
  await quickReader.context().close();
  await grouped.setViewportSize({ width: 1440, height: 1050 });
  await open(grouped, "/nights-a");
  await grouped
    .getByRole("button", { name: "Télécharger le registre", exact: true })
    .click();
  const registerDialog = grouped.getByRole("dialog", {
    name: "Registre des séjours",
    exact: true,
  });
  await registerDialog
    .getByRole("button", { name: "Télécharger le PDF", exact: true })
    .waitFor();
  await registerDialog
    .getByText("La Maison du verger", { exact: true })
    .first()
    .waitFor();
  assert.match(await registerDialog.innerText(), /informations à compléter/);
  assert.equal(groupedFixture.registerRequests.at(-1).month, "2026-10");
  await capture(grouped, "night-register-preview-desktop.png");
  groupedFixture.nightRegister.revision = "b".repeat(64);
  await registerDialog
    .getByRole("button", { name: "Télécharger le PDF", exact: true })
    .click();
  await registerDialog.getByRole("alert").waitFor();
  assert.equal(
    await registerDialog
      .getByRole("button", { name: "Télécharger le PDF", exact: true })
      .isDisabled(),
    true,
  );
  await registerDialog
    .getByRole("button", { name: "Recharger l’aperçu", exact: true })
    .click();
  await registerDialog
    .getByText("La Maison du verger", { exact: true })
    .first()
    .waitFor();
  const csvDownload = grouped.waitForEvent("download");
  await registerDialog
    .getByRole("button", { name: "Télécharger le tableau CSV", exact: true })
    .click();
  assert.match(
    (await csvDownload).suggestedFilename(),
    /registre-sejours-.*2026-10-01\.csv$/,
  );
  groupedFixture.registerFailDownload = 1;
  await registerDialog
    .getByRole("button", { name: "Télécharger le PDF", exact: true })
    .click();
  await registerDialog.getByRole("alert").waitFor();
  const pdfDownload = grouped.waitForEvent("download");
  await registerDialog
    .getByRole("button", { name: "Télécharger le PDF", exact: true })
    .click();
  assert.match(
    (await pdfDownload).suggestedFilename(),
    /registre-sejours-.*2026-10-01\.pdf$/,
  );
  await registerDialog
    .getByRole("button", {
      name: "Compléter les perceptions et leur ventilation",
      exact: true,
    })
    .click();
  await registerDialog.locator(".rp-register-completion-row summary").click();
  const commandsBeforeProposal = groupedFixture.commands.length;
  await registerDialog
    .getByRole("button", {
      name: "Préremplir les ventilations proposées",
      exact: true,
    })
    .click();
  assert.equal(
    groupedFixture.commands.length,
    commandsBeforeProposal,
    "Préremplir ne confirme pas la ventilation",
  );
  assert.equal(
    await registerDialog
      .getByLabel("Taxe collectée affectée à cette période (€)", {
        exact: true,
      })
      .inputValue(),
    "19.00",
  );
  assert.equal(
    await registerDialog
      .getByLabel("Part hors taxes additionnelles (€)", { exact: true })
      .inputValue(),
    "19.00",
  );
  assert.equal(
    await registerDialog
      .getByLabel("Date réelle de perception", { exact: true })
      .inputValue(),
    "2026-10-20",
  );
  assert.equal(
    await registerDialog
      .getByLabel("Justification et références des pièces vérifiées", {
        exact: true,
      })
      .inputValue(),
    "",
  );
  const review = registerDialog.getByRole("checkbox", {
    name: /Ventilation entre périodes, hébergements et remboursements/,
  });
  assert.equal(await review.isChecked(), false);
  await review.check();
  await registerDialog
    .getByRole("button", { name: "Utiliser cette proposition", exact: true })
    .click();
  assert.equal(
    await review.isChecked(),
    false,
    "Une nouvelle proposition attend une nouvelle vérification",
  );
  await review.check();
  await registerDialog
    .getByLabel("Date réelle de perception", { exact: true })
    .fill("2026-10-20");
  await registerDialog
    .getByLabel("Taxe collectée affectée à cette période (€)", { exact: true })
    .fill("19.00");
  await registerDialog
    .getByLabel("Part hors taxes additionnelles (€)", { exact: true })
    .fill("19.00");
  await registerDialog
    .getByLabel("Justification et références des pièces vérifiées", {
      exact: true,
    })
    .fill("Reçu de collecte du 20 octobre vérifié");
  await capture(grouped, "night-register-completion-desktop.png");
  await grouped.setViewportSize({ width: 390, height: 844 });
  await noOverflow(grouped);
  await capture(grouped, "night-register-completion-mobile.png");
  await grouped.setViewportSize({ width: 1440, height: 1050 });
  await registerDialog
    .getByRole("button", { name: "Enregistrer les compléments", exact: true })
    .click();
  await registerDialog
    .getByRole("button", {
      name: "Compléter les perceptions et leur ventilation",
      exact: true,
    })
    .waitFor();
  const completionCommand = groupedFixture.commands
    .filter((command) => command.type === "night-register-completion")
    .at(-1);
  assert.equal(
    completionCommand.completion.rows["stay:reservation-a"].collectedTaxCents,
    1900,
  );
  assert.equal(
    completionCommand.completion.rows["stay:reservation-a"].collectionDate,
    "2026-10-20",
  );
  await registerDialog
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  const summaryDownload = grouped.waitForEvent("download");
  await grouped
    .getByRole("button", { name: "Exporter la synthèse CSV", exact: true })
    .click();
  assert.match(
    (await summaryDownload).suggestedFilename(),
    /synthese-nuitees-.*2026-10-01\.csv$/,
  );
  await grouped
    .getByRole("button", { name: "Télécharger le registre", exact: true })
    .click();
  await grouped.setViewportSize({ width: 390, height: 844 });
  await noOverflow(grouped);
  await capture(grouped, "night-register-preview-mobile.png");
  await registerDialog
    .getByRole("button", { name: "Fermer", exact: true })
    .click();
  await grouped.setViewportSize({ width: 1440, height: 1050 });
  groupedFixture.state.properties[0].declaration = {
    registration: { number: "NER-FICHE", notApplicable: false },
    portalReference: "PMM-PORTAIL",
    receiptReference: "RCP-MAIRIE",
  };
  groupedFixture.state.propertyNightDeclarations = {
    g1: groupedFixture.state.properties[0].declaration,
  };
  await open(grouped, "/nights-a/modifier");
  await grouped
    .getByRole("checkbox", {
      name: "Déclaration de taxe de séjour",
      exact: true,
    })
    .check();
  await grouped.getByText("NER-FICHE", { exact: true }).waitFor();
  await grouped
    .getByText("Référence du portail : PMM-PORTAIL", { exact: true })
    .waitFor();
  groupedFixture.state.properties[0].declaration.registration.number =
    "NER-FICHE-2";
  await grouped
    .getByRole("button", {
      name: "Actualiser les informations des gîtes",
      exact: true,
    })
    .click();
  await grouped.getByText("NER-FICHE-2", { exact: true }).waitFor();
  assert.equal(
    await grouped
      .getByRole("checkbox", {
        name: "Déclaration de taxe de séjour",
        exact: true,
      })
      .isChecked(),
    true,
  );
  await grouped
    .getByRole("button", {
      name: "Utiliser une valeur propre à ce rapport · La Maison du verger",
      exact: true,
    })
    .click();
  await grouped
    .getByLabel("Numéro d’enregistrement · La Maison du verger", {
      exact: true,
    })
    .fill("ANCIEN-RAPPORT");
  await grouped
    .getByRole("button", {
      name: "Utiliser les informations de la fiche · La Maison du verger",
      exact: true,
    })
    .click();
  await grouped.getByText("NER-FICHE-2", { exact: true }).waitFor();
  await grouped.setViewportSize({ width: 390, height: 844 });
  await noOverflow(grouped);
  await capture(grouped, "night-declaration-inherited-settings-mobile.png");
  await grouped.setViewportSize({ width: 1440, height: 1050 });
  await grouped
    .getByRole("button", {
      name: "Utiliser une valeur propre à ce rapport · La Maison du verger",
      exact: true,
    })
    .click();
  await grouped
    .getByLabel("Numéro d’enregistrement · La Maison du verger", {
      exact: true,
    })
    .fill("3500012345678");
  await grouped.getByLabel("Périodicité").selectOption("broceliande");
  await capture(grouped, "night-declaration-settings-desktop.png");
  await grouped
    .getByRole("button", { name: "Appliquer les règles", exact: true })
    .click();
  await grouped
    .getByText("Total des nuitées taxables incluses", { exact: true })
    .waitFor();
  const declarationRules = groupedFixture.commands
    .filter((command) => command.type === "save")
    .at(-1).definition;
  assert.equal(declarationRules.nightDeclaration, true);
  assert.equal(declarationRules.cadence, "broceliande");
  assert.equal(declarationRules.nightRegistrations.g1.number, "3500012345678");
  await grouped.context().close();

  // Copy the displayed amount, rounded to whole euros; this remains available in read-only mode.
  const { page: copyPage, fixture: copyFixture } = await createPage({
    canWrite: false,
  });
  await copyPage
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const [amountCents, expected] of [
    [336437, "3364"],
    [336450, "3365"],
    [336499, "3365"],
    [0, "0"],
  ]) {
    copyFixture.state.operations = [
      { ...baseOperation, id: "copy-amount", amountCents },
    ];
    copyFixture.state.factsRevision = "copy-" + amountCents;
    await open(copyPage, "/social");
    const copyButton = copyPage.getByRole("button", {
      name: "Copier le montant sans centimes",
      exact: true,
    });
    await copyButton.click();
    assert.equal(
      await copyPage.evaluate(() => navigator.clipboard.readText()),
      expected,
    );
  }
  await copyPage.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard refused")),
      },
    }),
  );
  await copyPage
    .getByRole("button", {
      name: "Copier le montant sans centimes",
      exact: true,
    })
    .click();
  await copyPage
    .getByText("Copie impossible. Sélectionnez le montant pour le copier.", {
      exact: true,
    })
    .waitFor();

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
  await page.getByRole("button", { name: "Par période", exact: true }).click();
  await page.getByLabel("Période de travail").waitFor();
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
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", {
      name: "Copier le montant sans centimes",
      exact: true,
    })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "770",
  );
  assert.match(
    await page.locator(".rp-total-card > .rp-overline").innerText(),
    /commissions non renseignées/i,
  );
  assert.match(
    await page.locator(".rp-platform-amounts__undetailed").innerText(),
    /200,00.*1 opération incluse telle quelle/s,
  );
  assert.match(
    await page.locator(".rp-platform-basis").innerText(),
    /Brut \/ net non déterminé/,
  );
  const header = page.locator(".rp-page-header");
  assert.ok((await header.boundingBox()).height < 220);
  assert.match(
    await header.locator(".rp-identity-name").innerText(),
    /Entreprise Martin/,
  );
  assert.ok(
    await header
      .locator(".rp-identity-name")
      .evaluate((name) => parseFloat(getComputedStyle(name).fontSize) >= 20),
  );
  assert.equal(
    await page
      .getByRole("region", { name: "Problèmes à corriger", exact: true })
      .count(),
    0,
  );
  assert.ok(
    await header
      .getByRole("link", { name: "Réglages", exact: true })
      .isVisible(),
  );
  const back = await header
    .getByRole("link", { name: "Tous les rapports", exact: true })
    .boundingBox();
  assert.ok(back.width >= 44 && back.height >= 44);
  assert.equal(
    await page
      .getByRole("button", { name: "Marquer comme prêt", exact: true })
      .count(),
    0,
  );
  assert.ok(
    await page
      .locator(".rp-operation-head")
      .getByText("Source de réservation", { exact: true })
      .isVisible(),
  );
  const operationSearch = page.getByRole("searchbox", {
    name: "Rechercher une opération",
  });
  for (const channel of ["Direct", "Airbnb", "Gites de France"]) {
    await operationSearch.fill(channel.toLowerCase());
    const sources = await page
      .locator(".rp-operation-source")
      .allTextContents();
    assert.ok(sources.length > 0);
    assert.ok(
      sources.every((source) => source.trim() === `Source : ${channel}`),
    );
  }
  await operationSearch.fill("Camille");
  assert.equal(await page.locator(".rp-operation-row").count(), 4);
  assert.ok(
    await page
      .locator(".rp-operation-date")
      .getByText("Date estimée", { exact: true })
      .isVisible(),
  );
  await operationSearch.fill("");
  await capture(page, "reports-detail-desktop.png");
  for (const width of [1024, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    assert.ok(await page.locator(".rp-operation-source").first().isVisible());
    assert.ok(
      await page
        .locator(".rp-operation-date")
        .getByText("Date estimée", { exact: true })
        .isVisible(),
    );
    assert.equal(
      await page
        .locator(".rp-operation-row")
        .evaluateAll((rows) =>
          rows.some((row) => row.scrollWidth > row.clientWidth),
        ),
      false,
    );
    await capture(page, `reports-detail-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: /Camille Martin/ })
    .first()
    .click();
  assert.equal(await page.getByLabel("Traitement", { exact: true }).count(), 0);
  assert.ok(
    await page
      .getByRole("link", { name: /Voir les règlements dans le listing/ })
      .isVisible(),
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
  assert.ok(
    await page
      .locator(".rp-operation-date")
      .getByText("Date estimée", { exact: true })
      .isVisible(),
  );
  assert.ok(await page.locator(".rp-operation-source").first().isVisible());
  assert.ok(
    await page.locator(".rp-operation-source-label").first().isVisible(),
  );
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
  await page
    .getByRole("button", {
      name: "Copier le montant sans centimes",
      exact: true,
    })
    .click();
  const frozenRounded = String(
    Math.round(Number(frozenTotal.replace(/[^0-9,.-]/g, "").replace(",", "."))),
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    frozenRounded,
  );
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
  await page.getByRole("button", { name: /Examiner l’opération/ }).click();
  await page.locator(".rp-operation-open").first().click();
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
  await page
    .locator(".rp-header-actions")
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Suivi annuel", exact: true })
    .waitFor();
  assert.equal(
    fixture.commands.filter((command) => command.type === "save").at(-1)
      .definition.name,
    "Suivi annuel",
  );

  const { page: nightsEditor, fixture: nightsFixture } = await createPage();
  await open(nightsEditor, "/nouveau");
  await nightsEditor.getByRole("button", { name: /^Nuitées/ }).click();
  const occupants = nightsEditor.getByRole("group", {
    name: "Occupants à compter",
    exact: true,
  });
  assert.equal(
    await occupants.getByLabel("Adultes", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await occupants.getByLabel("Enfants", { exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await occupants.getByLabel("Bébés", { exact: true }).isChecked(),
    false,
  );
  await occupants.getByLabel("Enfants", { exact: true }).check();
  await nightsEditor.reload();
  assert.equal(
    await occupants.getByLabel("Enfants", { exact: true }).isChecked(),
    true,
  );
  await occupants.getByLabel("Enfants", { exact: true }).uncheck();
  const nightsDate = nightsEditor.getByRole("group", {
    name: "Date de référence",
    exact: true,
  });
  assert.equal(await nightsDate.getByRole("radio").count(), 0);
  assert.ok(
    await nightsDate.getByText("Date des nuitées", { exact: true }).isVisible(),
  );
  await nightsEditor
    .getByLabel("Rapport de référence dans Réservations", { exact: true })
    .check();
  await nightsEditor.setViewportSize({ width: 390, height: 844 });
  await noOverflow(nightsEditor);
  await capture(nightsEditor, "reports-night-guests-mobile.png");
  await nightsEditor
    .locator(".rp-header-actions")
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await nightsEditor
    .getByRole("heading", { name: "Nuitées", exact: true })
    .waitFor();
  const savedNights = nightsFixture.commands.find(
    (command) => command.type === "save",
  ).definition;
  assert.deepEqual(savedNights.nightGuests, ["adults"]);
  assert.equal(savedNights.nightReference, true);
  await nightsEditor.goto(`${origin}/parametres/nuitees`);
  await nightsEditor
    .getByRole("heading", { name: "Rapports et déclarations", exact: true })
    .waitFor();

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
  await reservations
    .getByRole("link", { name: "8 à déclarer", exact: true })
    .first()
    .waitFor();
  assert.match(
    await reservations
      .getByRole("link", { name: "8 à déclarer", exact: true })
      .first()
      .getAttribute("href"),
    /night-reference\?periode=2026-/,
  );
  assert.equal(reservationFixture.reads, 0);
  assert.ok(reservationFixture.nightSummaryReads > 0);
  const reminders = reservations.getByRole("region", {
    name: /Déclarations à traiter/,
  });
  await reservations.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await reminders.waitFor();
  assert.equal(reservationFixture.reminderReads, 1);
  assert.equal(reservationFixture.reads, 0);
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
  reservationFixture.remindersStale = true;
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders.getByText("À actualiser.", { exact: true }).waitFor();
  assert.equal(
    await reminders.getByRole("button", { name: /^Copier/ }).count(),
    0,
  );
  assert.equal(reservationFixture.reads, 0);
  await reservations.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await reminders.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
    true,
  );
  await reservations.locator(".app-sync-notice").waitFor({ state: "hidden" });
  await reminders.screenshot({
    path: path.join(screenshots, "reservations-reminder-stale-mobile.png"),
  });
  await reservations.setViewportSize({ width: 1440, height: 1050 });
  reservationFixture.remindersStale = false;
  await reservations.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reminders
    .locator(".reservation-declarations__stale")
    .waitFor({ state: "hidden" });
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
  const { page: missingCalculation, fixture: missingFixture } =
    await createPage();
  missingFixture.remindersStale = true;
  missingFixture.remindersEmpty = true;
  missingFixture.remindersCalculatedAt = null;
  await missingCalculation.goto(reservationUrl);
  await missingCalculation
    .getByText(/Les déclarations n’ont pas encore été calculées/)
    .waitFor();
  assert.equal(
    await missingCalculation
      .locator(".reservation-declarations__count")
      .count(),
    0,
  );
  assert.equal(missingFixture.reads, 0);
  assert.equal(
    await missingCalculation.getByRole("button", { name: /^Copier/ }).count(),
    0,
  );
  await capture(missingCalculation, "reservations-reminder-not-calculated.png");
  await missingCalculation
    .getByRole("link", {
      name: "Ouvrir les rapports pour actualiser",
      exact: true,
    })
    .click();
  await missingCalculation
    .getByRole("heading", { name: "Rapports et déclarations", exact: true })
    .waitFor();
  assert.ok(missingFixture.reportRefreshQueries.length > 0);
  assert.ok(
    missingFixture.reportRefreshQueries.every((query) => query === null),
  );
  await Promise.all([
    missingCalculation.waitForResponse((response) =>
      response.url().includes("/api/reports?refresh=1"),
    ),
    missingCalculation
      .getByRole("button", { name: "Actualiser les données", exact: true })
      .click(),
  ]);
  assert.equal(missingFixture.reportRefreshQueries.at(-1), "1");
  assert.equal(
    missingFixture.reportRefreshQueries.filter((query) => query === "1").length,
    1,
  );
  await missingCalculation.goto(reservationUrl);
  await missingCalculation
    .getByRole("region", { name: /Déclarations à traiter/ })
    .waitFor();
  assert.equal(
    await missingCalculation
      .locator(".reservation-declarations__stale")
      .count(),
    0,
  );
  await missingCalculation.context().close();
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

  await otaPage.setViewportSize({ width: 1440, height: 1050 });
  await open(otaPage, "/social");
  assert.match(await total(otaPage), /115,00/);
  assert.match(
    await otaPage.locator(".rp-total-card > .rp-overline").innerText(),
    /Total brut avant commissions/i,
  );
  const platformAmounts = otaPage.getByRole("region", {
    name: "Brut, commissions et net des plateformes",
    exact: true,
  });
  assert.match(
    await platformAmounts.locator(".is-selected").innerText(),
    /Brut avant commissions.*115,00/s,
  );
  assert.match(
    await platformAmounts.innerText(),
    /Commissions prélevées.*15,00.*Net après commissions.*100,00/s,
  );
  await capture(otaPage, "reports-basis-gross-desktop.png");
  await open(otaPage, "/social/modifier");
  await otaPage.getByLabel("Base OTA", { exact: true }).selectOption("net");
  assert.match(
    await otaPage.locator(".rp-preview-value").innerText(),
    /Total net après commissions.*100,00/is,
  );
  assert.match(
    await otaPage.locator(".rp-basis-pending").innerText(),
    /Actuellement enregistré : Brut avant commissions/,
  );
  await otaPage
    .getByRole("link", { name: "Fermer le brouillon", exact: true })
    .click();
  await otaPage.locator(".rp-basis-draft").waitFor();
  assert.match(await total(otaPage), /115,00/);
  assert.match(
    await otaPage.locator(".rp-basis-draft").innerText(),
    /Net après commissions.*n’est pas encore appliqué/s,
  );
  await otaPage.getByRole("link", { name: /Reprendre les réglages/ }).click();
  assert.equal(
    await otaPage.getByLabel("Base OTA", { exact: true }).inputValue(),
    "net",
  );
  await otaPage.getByRole("button", { name: /Appliquer les règles/ }).click();
  await otaPage
    .getByRole("heading", { name: "Cotisations sociales", exact: true })
    .waitFor();
  assert.match(await total(otaPage), /100,00/);
  assert.match(
    await otaPage.locator(".rp-total-card > .rp-overline").innerText(),
    /Total net après commissions/i,
  );
  assert.match(
    await platformAmounts.locator(".is-selected").innerText(),
    /Net après commissions.*100,00/s,
  );
  assert.equal(await otaPage.locator(".rp-basis-draft").count(), 0);
  await capture(otaPage, "reports-basis-net-desktop.png");
  await otaPage.setViewportSize({ width: 390, height: 844 });
  await noOverflow(otaPage);
  assert.ok(await platformAmounts.isVisible());
  await capture(otaPage, "reports-basis-net-mobile.png");
  await otaPage.setViewportSize({ width: 1440, height: 1050 });
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
  await largerGap.getByLabel("Relevé Airbnb", { exact: true }).setInputFiles({
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

  otaFixture.showListingReservation = true;
  otaFixture.extraReservation.date_entree = "2027-04-29";
  otaFixture.extraReservation.date_sortie = "2027-05-02";
  await otaPage.goto(
    `${origin}/reservations?focus=reservation-extra&payments=1&tab=all-gites&month=0`,
  );
  await otaPage
    .getByRole("dialog", { name: "Règlements", exact: true })
    .waitFor();
  assert.ok(otaFixture.extraReservationDetailsReads > 0);
  assert.ok(otaFixture.listingReservationRequests.includes("2027"));
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
