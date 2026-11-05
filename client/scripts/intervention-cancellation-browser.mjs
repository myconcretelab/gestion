import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";

const { chromium } = createRequire(new URL("../../server/package.json", import.meta.url))("playwright");
const screenshots = await mkdtemp(path.join(tmpdir(), "intervention-cancellation-browser-"));
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "error", server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "intervention-cancellation-fixture", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith("/__intervention-cancellation-test")) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, `<!doctype html><html lang="fr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;padding:24px"><div id="root"></div><script type="module">
import React from "react"; import {createRoot} from "react-dom/client"; import {BrowserRouter} from "react-router-dom";
import Page from "/src/pages/IntervenantsPage.tsx"; import "/src/styles.css";
createRoot(document.getElementById("root")).render(React.createElement(BrowserRouter,null,React.createElement(Page,{currentUser:location.search.includes("readonly")?{permissions:{isOwner:false}}:null})));
</script></body></html>`));
    });
  } }],
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const updated = "2026-11-01T10:00:00.000Z";
const base = { user_id: "u1", user_name: "Soazig Molinier", occurred_on: "2026-11-01", gite_id: "g1", gite_name: "Tante Phonsine", updated_at: updated, paid_at: null };
let entries = [{ ...base, id: "check", kind: "cleaning_check", amount: 15 }, { ...base, id: "cleaning", kind: "full_cleaning", amount: 55 }, { ...base, id: "paid", kind: "task", amount: 10, paid_at: updated }];
let saves = 0, rejectNext = false;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data = {};
    if (url.pathname === "/api/intervenants") data = [{ id: "w1", nom: "Soazig Molinier", user_id: "u1", is_active: true, hourly_rate: 20 }];
    else if (url.pathname === "/api/gites") data = [{ id: "g1", nom: "Tante Phonsine" }];
    else if (url.pathname.includes("/hours/history")) data = { entries: [] };
    else if (url.pathname.endsWith("/cancellation")) data = {
      fingerprint: "a".repeat(64), amount: 70, entries: entries.filter((entry) => !entry.paid_at),
      effects: ["Le gîte repasse à contrôler ; la validation de l’arrivée liée est retirée.", "Le ménage revient dans les tâches à faire."],
    };
    else if (url.pathname.endsWith("/cancel")) {
      const payload = route.request().postDataJSON();
      assert.equal(payload.fingerprint, "a".repeat(64));
      assert.equal(payload.expectedUpdatedAt, updated);
      if (rejectNext) {
        rejectNext = false;
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Cette intervention a changé. Fermez puis rouvrez l’annulation." }) });
      }
      assert.equal(payload.reason, "Clic par erreur — Test tactile");
      saves++;
      entries = entries.filter((entry) => entry.paid_at);
      data = { removed_ids: ["check", "cleaning"], effects: ["Le gîte repasse à contrôler."] };
    }
    else if (url.pathname === "/api/interventions") data = { entries: entries.filter((entry) => url.searchParams.get("status") !== "unpaid" || !entry.paid_at) };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto(origin + "/__intervention-cancellation-test");
  const row = page.getByRole("row").filter({ hasText: "Contrôle ménage" });
  await row.getByRole("button", { name: /^Annuler/ }).click();
  const dialog = page.getByRole("dialog", { name: "Un clic de trop ?" });
  await dialog.getByText("−70,00").waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Clic par erreur", exact: true }).getAttribute("aria-pressed"), "true");
  assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)));
  await page.screenshot({ path: path.join(screenshots, "desktop.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(saves, 0);
  await row.getByRole("button", { name: /^Annuler/ }).click();
  await dialog.getByRole("button", { name: "Annuler l’intervention", exact: true }).waitFor();
  rejectNext = true;
  await dialog.getByRole("button", { name: "Annuler l’intervention", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Cette intervention a changé" }).waitFor();
  assert.equal(saves, 0);
  await dialog.getByRole("button", { name: "Conserver l’intervention" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await row.getByRole("button", { name: /^Annuler/ }).click();
  await dialog.getByText("−70,00").waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.ok(box.y >= 0 && box.height <= 844);
  await page.screenshot({ path: path.join(screenshots, "mobile.png"), animations: "disabled" });
  await dialog.getByText("Ajouter une précision (facultatif)").click();
  await dialog.getByLabel(/Un mot en plus/).fill("Test tactile");
  await dialog.getByRole("button", { name: "Annuler l’intervention", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "C’est remis en place" }).waitFor();
  assert.equal(saves, 1);
  assert.equal(await page.getByRole("row").filter({ hasText: "Contrôle ménage" }).count(), 0);
  await page.getByLabel(/^État/).selectOption("all");
  await page.getByRole("row").filter({ hasText: "Tâche au forfait" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Annuler l’intervention de/ }).count(), 0);
  entries = [{ ...base, id: "check", kind: "cleaning_check", amount: 15 }];
  await page.goto(origin + "/__intervention-cancellation-test?readonly");
  await page.getByRole("row").filter({ hasText: "Contrôle ménage" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Annuler l’intervention de/ }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "ok", screenshots, saves }));
} finally { await browser.close(); await vite.close(); }
