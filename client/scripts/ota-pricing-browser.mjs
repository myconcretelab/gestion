import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { calculateOtaPrice } from "@contrats/shared";
const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const screenshots = await mkdtemp(path.join(tmpdir(), "ota-pricing-browser-"));
const root = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.join(root, "__ota_pricing_test.html");
const html = `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Montants plateforme</title><body><div class="reservation-payment-popover" style="position:relative;width:calc(100% - 24px);max-width:420px;margin:12px auto;max-height:none"><div id="root"></div></div><script type="module">
import React from "react";
import { createRoot } from "react-dom/client";
import Editor from "/src/pages/shared/ReservationPaymentsEditor.tsx";
import { setCurrentAuthUser } from "/src/utils/auth.ts";
import "/src/styles.css";
if (location.search.includes("readonly")) setCurrentAuthUser({ permissions:{canWrite:false,canViewAmounts:true,isOwner:false},pageAccess:["reservations"] });
createRoot(document.getElementById("root")).render(React.createElement(Editor, {
reservation: { id:"test", booking_source:"Gites de France", options:{menage:{enabled:true}, draps:{enabled:true,nb_lits:9}} },
tracking: { managed:false, total:2005,received:1750,remaining:255,overpaid:0,deposit:0,requires_review:false,entries:[],platform:{source:"Gites de France",automatic:true,accommodation:1750,expected:0,extras_remaining:255}},
onUpdated: () => {window.saved = (window.saved || 0) + 1}
}));
</script></body></html>`;
await writeFile(fixturePath, html);
const vite = await createServer({
  root,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const runtimeErrors = [],
    commands = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
    console.error(error.message);
  });
  let pricing = {
    revision: "1",
    source: "Gites de France",
    amountCents: 175000,
    rule: { percent: 10, rounding: "euro", scope: "accommodation" },
    options: [
      {
        key: "menage",
        label: "Ménage",
        enabled: true,
        included: false,
        amountCents: 12000,
      },
      {
        key: "draps",
        label: "Draps",
        enabled: true,
        included: false,
        amountCents: 13500,
      },
      ...["linge_toilette", "depart_tardif", "chiens"].map((key) => ({
        key,
        label: key,
        enabled: false,
        included: false,
        amountCents: 0,
      })),
    ],
  };
  let fail = true;
  await page.route(
    "**/api/reservations/test/payments/pricing",
    async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: pricing });
      const input = route.request().postDataJSON();
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 409,
          json: { error: "La réservation a changé. Rechargez ses montants." },
        });
      }
      commands.push(input);
      const { revision, ...value } = input;
      const saved = calculateOtaPrice(value, pricing.rule);
      pricing = {
        ...pricing,
        revision: String(Number(revision) + 1),
        amountCents: saved.grossCents,
        saved,
        options: pricing.options.map((option) => ({
          ...option,
          included: input.included[option.key] > 0,
          amountCents: input.included[option.key] || option.amountCents,
        })),
      };
      await route.fulfill({
        json: {
          pricing,
          tracking: {
            managed: false,
            total: saved.grossCents / 100,
            received: saved.grossCents / 100,
            remaining: 0,
            overpaid: 0,
            deposit: 0,
            requires_review: false,
            entries: [],
            platform: {
              source: "Gites de France",
              automatic: true,
              accommodation: saved.grossCents / 100,
              expected: 0,
              extras_remaining: 0,
            },
          },
        },
      });
    },
  );
  await page.goto(origin + "/__ota_pricing_test.html");
  await page
    .getByRole("button", { name: "Saisir un prix brut ou un net propriétaire" })
    .click();
  await page.getByLabel("Base du montant plateforme").selectOption("net");
  await page.getByLabel("Montant plateforme", { exact: true }).fill("1830");
  await page
    .getByRole("checkbox", { name: "Ménage inclus", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Draps inclus", exact: true })
    .check();

  assert.match(
    await page.getByLabel("Calcul de la plateforme").innerText(),
    /1\s?750,00.*255,00.*2\s?005,00.*175,00.*1\s?830,00/s,
  );
  await page
    .getByRole("button", { name: "Enregistrer les montants", exact: true })
    .click();
  await page
    .getByRole("alert")
    .getByText(/La réservation a changé/)
    .waitFor();
  assert.equal(
    await page.getByLabel("Montant plateforme", { exact: true }).inputValue(),
    "1830",
  );
  await page
    .getByRole("button", { name: "Enregistrer les montants", exact: true })
    .click();
  await page
    .getByRole("status")
    .getByText(/Montants enregistrés/)
    .waitFor();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].basis, "net");
  assert.deepEqual(commands[0].included, {
    menage: 12000,
    draps: 13500,
    linge_toilette: 0,
    depart_tardif: 0,
    chiens: 0,
  });
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(screenshots, `pricing-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel("Montant plateforme", { exact: true }).fill("4.5");
  await page
    .getByLabel("Commission réelle plateforme", { exact: true })
    .fill("");
  await page
    .getByRole("checkbox", { name: "Ménage inclus", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Draps inclus", exact: true })
    .uncheck();
  await page
    .getByRole("status")
    .getByText(/Plusieurs prix bruts/)
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Enregistrer les montants", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Commission réelle plateforme", { exact: true })
    .fill("1");
  assert.match(
    await page.getByLabel("Calcul de la plateforme").innerText(),
    /5,50/,
  );
  await page.goto(origin + "/__ota_pricing_test.html?readonly");
  await page.getByLabel("Détail du règlement").waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Saisir un prix brut ou un net propriétaire",
      })
      .count(),
    0,
  );
  assert.deepEqual(runtimeErrors, []);
  console.log(
    "Parcours brut/net, inclusion des options, erreur/retry, net ambigu, droits et écrans 360/390/1280 px : OK",
  );
  console.log(screenshots);
} finally {
  await browser?.close();
  await vite.close();
  await unlink(fixturePath);
}
