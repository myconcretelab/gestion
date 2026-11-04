import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { DEFAULT_TOURIST_TAX_COLLECTION } from "@contrats/shared";
const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(root, "__tourist_tax_test.html");
const screenshots = await mkdtemp(path.join(tmpdir(), "tourist-tax-browser-"));
await writeFile(
  fixture,
  `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Taxe de séjour</title><body><div id="root"></div><script type="module">
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Shell from "/src/pages/settings/SettingsShell.tsx";
import Settings from "/src/pages/settings/TouristTaxCollectionSettings.tsx";
import Editor from "/src/pages/shared/TouristTaxStayEditor.tsx";
import GiteSettings from "/src/pages/shared/TouristTaxSettingsEditor.tsx";
import { setCurrentAuthUser } from "/src/utils/auth.ts";
import "/src/styles.css";
if (location.search.includes("readonly")) setCurrentAuthUser({permissions:{canWrite:false,canViewAmounts:true,isOwner:false},pageAccess:["settings","gites","reservations"]});
history.replaceState(null, "", "/parametres/taxe-sejour" + location.search);
function App() {
 const [source,setSource] = useState("Direct"), [value,setValue] = useState();
 const [giteTax,setGiteTax] = useState({version:1,classified:true,stars:1,included:true,fixed_rate:.8,percentage:0,cap:0,additional_percentage:0,accommodation_vat_rate:0,authority:"Collectivité de test",effective_from:"2026-01-01",portal_reference:"PMM-PORTAIL",classification_valid_until:"2031-04-30"});
 if (location.search.includes("gite-settings")) return React.createElement("main",{style:{maxWidth:760,margin:"24px auto",padding:16}},React.createElement(GiteSettings,{value:giteTax,onChange:setGiteTax}));
 if (location.search.includes("editor")) return React.createElement("main", {style:{maxWidth:760,margin:"24px auto",padding:16}},
 React.createElement("label", null, "Origine test", React.createElement("select",{value:source,onChange:e=>setSource(e.target.value)},["Direct","Airbnb"].map(x=>React.createElement("option",{key:x},x)))),
 React.createElement(Editor, {source,value,onChange:setValue,initialize:true,settings:{version:1,classified:true,stars:1,included:true,fixed_rate:.8,percentage:4,cap:4,additional_percentage:0,accommodation_vat_rate:0,authority:"Ploërmel",effective_from:"2026-01-01"},nights:2,adults:2,children:0,accommodation:100,start:"2026-09-10"}));
 return React.createElement(Shell,null,React.createElement(Settings));
}
createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(App)));
</script></body></html>`,
);
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
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let rules = structuredClone(DEFAULT_TOURIST_TAX_COLLECTION.rules),
    saves = 0,
    applies = 0;
  const amount = {
    collector: "unknown",
    platform: "",
    included: null,
    tax: null,
    total: 100,
    accommodation: 100,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method();
    let response = {};
    if (url.pathname === "/api/gites")
      response = [
        { id: "g1", nom: "Tante Phonsine" },
        { id: "g2", nom: "Oncle Edmond" },
      ];
    else if (url.pathname.endsWith("/preview")) {
      const input = route.request().postDataJSON();
      assert.equal(input.from, "2026-09-01");
      response = {
        fingerprint: "preview-v1",
        eligible: 1,
        excluded: 0,
        rows: [
          {
            id: "r1",
            guest: "TEST Voyageur",
            gite: "Tante Phonsine",
            start: "2026-09-10",
            source: "Direct",
            before: amount,
            after: {
              ...amount,
              collector: "host",
              tax: 3.2,
              accommodation: 96.8,
              included: true,
            },
            eligible: true,
            reason: null,
          },
        ],
      };
    } else if (url.pathname.endsWith("/apply")) {
      assert.equal(route.request().postDataJSON().fingerprint, "preview-v1");
      applies++;
      response = { updated: 1 };
    } else if (url.pathname.includes("tourist-tax-collection")) {
      if (method === "PUT") {
        rules = route.request().postDataJSON().rules;
        saves++;
      }
      response = {
        rules,
        sources: [
          "Direct",
          "Airbnb",
          "Abritel",
          "Booking.com",
          "Gites de France",
          "Nouveau canal",
        ],
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.goto(origin + "/__tourist_tax_test.html");
  await page
    .getByRole("heading", { name: "Collecte selon l’origine" })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Collecteur pour Direct", { exact: true })
      .inputValue(),
    "host",
  );
  assert.equal(
    await page
      .getByLabel("Collecteur pour Airbnb", { exact: true })
      .inputValue(),
    "platform",
  );
  assert.equal(
    await page
      .getByLabel("Collecteur pour Nouveau canal", { exact: true })
      .inputValue(),
    "unknown",
  );
  await page
    .getByLabel("Collecteur pour Nouveau canal", { exact: true })
    .selectOption("host");
  assert.equal(
    await page
      .getByRole("button", { name: "Prévisualiser les changements" })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Enregistrer les règles" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Règles enregistrées" })
    .waitFor();
  assert.equal(saves, 1);
  await page.getByLabel("Arrivée à partir du").fill("2026-09-01");
  await page.getByLabel("Jusqu’au").fill("2026-09-30");
  await page
    .getByRole("button", { name: "Prévisualiser les changements" })
    .click();
  await page.getByRole("cell", { name: /100,00.*96,80/ }).waitFor();
  assert.equal(applies, 0);
  await page.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Appliquer aux 1 séjour(s)" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "1 séjour(s) mis à jour" })
    .waitFor();
  assert.equal(applies, 1);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(screenshots, "mobile.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "La page ne doit pas déborder horizontalement sur mobile",
  );
  await page.goto(origin + "/__tourist_tax_test.html?editor");
  await page.getByLabel("Qui collecte la taxe ?").waitFor();
  assert.equal(
    await page.getByLabel("Qui collecte la taxe ?").inputValue(),
    "host",
  );
  await page.getByLabel("Origine test").selectOption("Airbnb");
  await page.waitForFunction(
    () =>
      document.querySelector('input[placeholder="Airbnb, Booking…"]')?.value ===
      "Airbnb",
  );
  assert.equal(
    await page.getByLabel("Qui collecte la taxe ?").inputValue(),
    "platform",
  );
  assert.equal(
    await page
      .getByRole("switch", { name: /Taxe comprise dans le prix de ce séjour/ })
      .isChecked(),
    false,
  );
  await page.getByLabel("Qui collecte la taxe ?").selectOption("host");
  await page.getByLabel("Origine test").selectOption("Direct");
  await page.getByLabel("Origine test").selectOption("Airbnb");
  assert.equal(
    await page.getByLabel("Qui collecte la taxe ?").inputValue(),
    "host",
  );
  await page
    .getByRole("button", { name: "Utiliser les règles de cette origine" })
    .click();
  assert.equal(
    await page.getByLabel("Qui collecte la taxe ?").inputValue(),
    "platform",
  );
  await page.screenshot({
    path: path.join(screenshots, "reservation.png"),
    fullPage: true,
  });
  await page.goto(origin + "/__tourist_tax_test.html?readonly");
  await page.getByLabel("Collecteur pour Direct", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Collecteur pour Direct", { exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Prévisualiser les changements" })
      .isDisabled(),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(origin + "/__tourist_tax_test.html?gite-settings");
  const official = page.getByLabel("Numéro d’enregistrement officiel", {
    exact: true,
  });
  const receipt = page.getByLabel(
    "Référence du récépissé de déclaration en mairie",
    { exact: true },
  );
  const portal = page.getByLabel("Référence du portail de déclaration", {
    exact: true,
  });
  await official.fill("NER-GITE");
  await receipt.fill("RCP-MAIRIE");
  const notApplicable = page.getByRole("checkbox", {
    name: "Enregistrement non applicable à ce gîte",
    exact: true,
  });
  await notApplicable.check();
  assert.equal(await official.inputValue(), "");
  assert.equal(await official.isDisabled(), true);
  assert.equal(await receipt.inputValue(), "RCP-MAIRIE");
  assert.equal(await portal.inputValue(), "PMM-PORTAIL");
  await notApplicable.uncheck();
  assert.equal(await official.isDisabled(), false);
  assert.equal(await official.inputValue(), "");
  await official.fill("NER-GITE");
  assert.equal(
    await page
      .getByLabel("Tarif de base / personne / nuit (€)", { exact: true })
      .inputValue(),
    "0.8",
  );
  await page.screenshot({
    path: path.join(screenshots, "gite-declaration-settings-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: path.join(screenshots, "gite-declaration-settings-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    `Taxe de séjour : parcours et captures vérifiés dans ${screenshots}`,
  );
} finally {
  await browser?.close();
  await vite.close();
  await unlink(fixture);
}
