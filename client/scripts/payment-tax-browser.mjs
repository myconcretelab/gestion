import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
const { chromium } = createRequire(
  new URL("../../server/package.json", import.meta.url),
)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(root, "__payment_tax_test.html");
const screenshots = await mkdtemp(path.join(tmpdir(), "payment-tax-browser-"));
await writeFile(
  fixture,
  `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Règlement et taxe</title><body><div id="root"></div><script type="module">
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Editor from "/src/pages/shared/ReservationPaymentsEditor.tsx";
import { setCurrentAuthUser } from "/src/utils/auth.ts";
import "/src/styles.css";
if (location.search.includes("readonly")) setCurrentAuthUser({permissions:{canWrite:false,canViewAmounts:true,isOwner:false},pageAccess:["reservations"]});
function App() {
 const [tracking, setTracking] = useState();
 useEffect(()=>{fetch("/api/test-tracking").then(r=>r.json()).then(setTracking)},[]);
 return tracking ? React.createElement("main", {className:"reservation-payment-popover", style:{position:"relative",inset:"auto",margin:"24px auto",width:"min(640px, calc(100vw - 32px))",maxHeight:"none"}}, React.createElement(Editor,{reservation:{id:"r1",booking_source:"Direct",source_paiement:null,options:"{}"},tracking,onUpdated:setTracking})) : null;
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
const sourceRevision = "a".repeat(64),
  metadataRevision = "b".repeat(64);
const initial = () => ({
  managed: true,
  total: 106,
  deposit: 20,
  received: 0,
  remaining: 106,
  overpaid: 0,
  requires_review: false,
  entries: [],
  first_payment_default: "full",
  tourist_tax: {
    available: true,
    reason: null,
    expectedCents: 600,
    allocatedCents: 0,
    remainingCents: 600,
    sourceRevision,
    needsReview: false,
    hasUnassignedPayments: false,
  },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const errors = [],
    posts = [],
    patches = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let state,
    failNext = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === "/api/test-tracking")
      return route.fulfill({ json: state });
    if (request.method() === "POST") {
      const input = request.postDataJSON();
      posts.push(input);
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 409,
          json: { error: "Le barème a changé. Rechargez les règlements." },
        });
      }
      state.received += input.amount;
      state.remaining = state.total - state.received;
      const entry = {
        id: input.id,
        amount: input.amount,
        method: input.method,
        purpose: input.purpose,
        paid_on: input.paid_on + "T12:00:00.000Z",
        note: input.note,
        origin: "manual",
        voided_at: null,
      };
      if (input.tourist_tax) {
        entry.tourist_tax = {
          version: 1,
          amountCents: input.tourist_tax.amount_cents,
          sourceRevision: input.tourist_tax.source_revision,
        };
        entry.tourist_tax_revision = metadataRevision;
        state.tourist_tax.allocatedCents += input.tourist_tax.amount_cents;
        state.tourist_tax.remainingCents -= input.tourist_tax.amount_cents;
      }
      state.entries.push(entry);
    } else if (request.method() === "PATCH") {
      assert.ok(url.pathname.endsWith("/tourist-tax"));
      const input = request.postDataJSON();
      patches.push(input);
      const entry = state.entries[0];
      if (input.tourist_tax) {
        entry.tourist_tax = {
          version: 1,
          amountCents: input.tourist_tax.amount_cents,
          sourceRevision: input.tourist_tax.source_revision,
        };
        entry.tourist_tax_revision = metadataRevision;
      } else {
        delete entry.tourist_tax;
        delete entry.tourist_tax_revision;
      }
      state.tourist_tax.allocatedCents = entry.tourist_tax?.amountCents ?? 0;
      state.tourist_tax.remainingCents = 600 - state.tourist_tax.allocatedCents;
    }
    return route.fulfill({ json: state });
  });
  const load = async (data = initial(), query = "") => {
    state = data;
    await page.goto(origin + "/__payment_tax_test.html" + query);
    await page.getByText("Reste à payer", { exact: true }).waitFor();
  };
  const add = () =>
    page.getByRole("button", { name: "＋ Ajouter un règlement" }).click();
  const checked = () =>
    page.getByRole("checkbox", {
      name: "Ce règlement comprend de la taxe de séjour",
    });
  const save = () =>
    page
      .getByRole("button", { name: "Enregistrer le règlement", exact: true })
      .click();
  await load();
  await add();
  assert.equal(
    await page.getByLabel("Montant (€)", { exact: true }).inputValue(),
    "106",
  );
  assert.equal(await checked().isChecked(), true);
  assert.equal(
    await page.getByLabel("Dont taxe de séjour (€)").inputValue(),
    "6.00",
  );
  await page.getByLabel("Reçu le").fill("2026-09-12");
  failNext = true;
  await save();
  await page
    .getByRole("alert")
    .filter({ hasText: "Le barème a changé" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Dont taxe de séjour (€)").inputValue(),
    "6.00",
  );
  await save();
  await page.getByText("Dont taxe de séjour :").waitFor();
  assert.equal(
    posts[0].id,
    posts[1].id,
    "Une nouvelle tentative garde le même identifiant",
  );
  assert.equal(
    state.entries.length,
    1,
    "La taxe reste dans le règlement global",
  );
  assert.deepEqual(posts[1].tourist_tax, {
    amount_cents: 600,
    source_revision: sourceRevision,
  });
  assert.equal(posts[1].paid_on, "2026-09-12");
  assert.equal(state.received, 106);
  await page
    .getByRole("button", { name: "Vérifier ou modifier la part de taxe" })
    .click();
  await page.getByLabel("Dont taxe de séjour (€)").fill("5");
  await page.getByRole("button", { name: "Confirmer la part de taxe" }).click();
  await page
    .getByRole("form", { name: "Part de taxe du règlement" })
    .waitFor({ state: "hidden" });
  assert.deepEqual(patches[0], {
    tourist_tax: { amount_cents: 500, source_revision: sourceRevision },
    expected_revision: metadataRevision,
  });
  assert.equal(state.received, 106);
  const recorded = structuredClone(state);
  await page
    .getByRole("button", { name: "Vérifier ou modifier la part de taxe" })
    .click();
  await page.getByRole("button", { name: "Retirer cette affectation" }).click();
  await page
    .getByRole("form", { name: "Part de taxe du règlement" })
    .waitFor({ state: "hidden" });
  assert.equal(patches[1].tourist_tax, null);
  assert.equal(state.entries.length, 1);
  await load();
  const beforeShortcut = posts.length;
  await page
    .getByRole("button", { name: /Encaisser tout le reste à payer.*virement/ })
    .click();
  assert.equal(
    posts.length,
    beforeShortcut,
    "Le raccourci présente la part de taxe avant confirmation",
  );
  assert.equal(await checked().isChecked(), true);
  await save();
  await page.getByText("Dont taxe de séjour :").waitFor();
  assert.equal(posts.at(-1).shortcut_id, "balance-transfer");
  await load({ ...initial(), first_payment_default: "deposit" });
  await add();
  assert.equal(
    await page.getByLabel("Montant (€)", { exact: true }).inputValue(),
    "20",
  );
  assert.equal(await checked().isChecked(), false);
  await save();
  await page
    .getByRole("form", { name: "Ajouter un règlement" })
    .waitFor({ state: "hidden" });
  assert.equal(
    posts.at(-1).tourist_tax,
    undefined,
    "Les arrhes n’affirment pas une collecte automatique",
  );
  const old = initial();
  old.received = 20;
  old.remaining = 86;
  old.tourist_tax.hasUnassignedPayments = true;
  old.entries = [
    {
      id: "old",
      amount: 20,
      method: "Chèque",
      purpose: "deposit",
      paid_on: "2026-09-01T12:00:00.000Z",
      origin: "manual",
      voided_at: null,
      note: null,
    },
  ];
  await load(old);
  await add();
  assert.equal(await checked().isChecked(), false);
  await page
    .getByText(
      "Des paiements précédents n’ont pas de part de taxe identifiée.",
      { exact: false },
    )
    .waitFor();
  await checked().check();
  await page.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(screenshots, "mobile.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Pas de débordement horizontal sur mobile",
  );
  state = recorded;
  await page.goto(origin + "/__payment_tax_test.html?readonly");
  await page.getByText("Dont taxe de séjour :").waitFor();
  assert.equal(
    await page.getByRole("button", { name: /part de taxe/ }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "＋ Ajouter un règlement" }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    `Règlement et taxe : parcours et captures vérifiés dans ${screenshots}`,
  );
} finally {
  await browser?.close();
  await vite.close();
  await unlink(fixture);
}
