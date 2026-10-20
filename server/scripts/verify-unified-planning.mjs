// Local visual and interaction checks. APIs are simulated; no user data or messages are touched.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const output = await mkdtemp(join(tmpdir(), "unified-planning-ui-"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "fr-FR", viewport: { width: 1440, height: 1080 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => console.log("UI exception:", error.message));
page.on("console", (message) => { if (message.type() === "error") console.log("UI error:", message.text()); });
const writes = [];
const people = [{ id: "w-a", user_id: "u-a", nom: "Marie", telephone: "+33600000000", message_channel_addresses: { sms: "+33600000000", telegram: "123" }, is_active: true }];
const gites = [{ id: "a", nom: "La Grée" }, { id: "b", nom: "Tante Phonsine" }];
const fixture = { tasks: [], templates: [], gites, assignees: [{ id: "u-a", name: "Marie" }], rules: [], can_manage: true, can_edit_compensation: true, current_user_id: "u-a", shortcuts: [], shortcut_catalog: [] };
let periods = [];
const rows = [
  { id: "inspection", kind: "task", date: "2026-11-05", title: "Vérification des détecteurs", gite_id: "a", gite_name: "La Grée", assignee_id: "u-a", assignee_name: "Marie", worker_id: "w-a", starts_at: "2026-11-05T08:00:00Z", due_at: "2026-11-05T16:00:00Z", status: "planned", note: "Contrôler les piles", amount: 12, guest: "Séjour test", phone: null, comment: null, options: "", nights: 5 },
  { id: "clean", kind: "cleaning", date: "2026-11-05", title: "Ménage", gite_id: "a", gite_name: "La Grée", assignee_id: "u-a", assignee_name: "Marie", worker_id: "w-a", starts_at: "2026-11-05T11:00:00Z", due_at: "2026-11-05T16:00:00Z", status: "planned", note: "", amount: 45, guest: "Séjour test", phone: null, comment: null, options: "", nights: 5 },
];
await page.route("**/api/**", async (route) => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  const body = req.method() === "GET" ? null : req.postDataJSON();
  if (body) writes.push({ path, body });
  let result = {};
  if (path.includes("/action-tasks")) result = fixture;
  else if (path.includes("/cleaning-tasks")) result = { ...fixture, tasks: [] };
  else if (path.endsWith("/workers")) result = people;
  else if (path.endsWith("/message-channels/status")) result = { channels: [{ id: "sms", label: "SMS", available: true }, { id: "telegram", label: "Telegram", available: true }] };
  else if (path.endsWith("/programme-templates")) result = { programme_templates: [{ id: "block", key: "programme_gite", template: "{{gite}} · {{prestation}} : {{horaire}}" }] };
  else if (path.endsWith("/organization-preview")) result = { count: 3, assignments: 0, conflicts: 0, examples: ["5 novembre · La Grée · Vérification des détecteurs"] };
  else if (path.endsWith("/interventions")) result = { period: periods[0], interventions: rows };
  else if (path.includes("/planning-relay-periods")) {
    if (body && req.method() === "POST") { const period = { id: "plan-1", ...body, public_path: "/r/abcdefgh?audience=all&key=test", assignments: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; periods.push(period); result = period; }
    else if (body && req.method() === "PATCH") { periods[0] = { ...periods[0], ...body }; result = periods[0]; }
    else result = periods;
  }
  await route.fulfill({ json: result });
});
await page.route("http://127.0.0.1:5173/", (route) => route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div></body></html>' }));
await page.goto("http://127.0.0.1:5173/");
await page.evaluate(async () => {
  const Refresh = (await import("/@react-refresh")).default; Refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
  const React = (await import("/node_modules/.vite/deps/react.js")).default;
  const DOM = await import("/node_modules/.vite/deps/react-dom_client.js");
  const { createRoot } = DOM.default ?? DOM;
  const { default: TasksPage } = await import("/src/pages/TasksPage.tsx");
  document.getElementById("root").style.display = "none";
  const el = document.createElement("main"); el.id = "planning-test"; el.style.cssText = "padding:28px;max-width:1250px;margin:auto"; document.body.append(el);
  createRoot(el).render(React.createElement(TasksPage));
});
page.on("pageerror", (error) => errors.push(error.message));
const mount = page.locator("#planning-test");
await mount.getByRole("tab", { name: "Automatisations", exact: true }).click();
await mount.getByRole("button", { name: "+ Organiser une période", exact: true }).click();
await page.getByRole("button", { name: /Prévoir une prestation à chaque séjour/ }).click();
const dialog = page.getByRole("dialog");
assert.equal(await dialog.getByLabel("Nom de l’organisation").inputValue(), "");
assert.equal(await dialog.getByLabel("Nom de la prestation").inputValue(), "");
await dialog.getByLabel("Nom de l’organisation").fill("Vérification des détecteurs");
await dialog.getByLabel("Nom de la prestation").fill("Contrôler les détecteurs");
await dialog.getByLabel("Du", { exact: true }).fill("2026-11-01");
await dialog.getByLabel("Au", { exact: true }).fill("2026-11-15");
await dialog.locator(".po-gites").first().getByLabel("La Grée", { exact: true }).check();
await dialog.locator(".po-gites").first().getByLabel("Tante Phonsine", { exact: true }).check();
assert.equal(await dialog.getByLabel("Durée minimale du séjour (nuits)").inputValue(), "");
await dialog.getByLabel("Durée minimale du séjour (nuits)").fill("5");
await dialog.getByLabel("Intervenant pour La Grée", { exact: true }).selectOption("u-a");
await dialog.getByLabel("Forfait pour La Grée", { exact: true }).fill("12");
await dialog.getByRole("button", { name: "Appliquer aux autres gîtes" }).click();
assert.equal(await dialog.getByLabel("Forfait pour Tante Phonsine", { exact: true }).inputValue(), "12");
await dialog.getByLabel("Forfait pour Tante Phonsine", { exact: true }).fill("18");
await dialog.getByLabel("Envoyer des rappels automatiques").check();
await dialog.getByRole("button", { name: "Utiliser les intervenants des prestations" }).click();
await page.screenshot({ path: join(output, "desktop-form.png"), fullPage: true, animations: "disabled" });
await dialog.getByRole("button", { name: "Vérifier les interventions", exact: true }).click();
await dialog.getByText("Prêt à appliquer", { exact: true }).waitFor();
await dialog.getByRole("button", { name: "Appliquer l’organisation", exact: true }).click();
await mount.getByRole("heading", { name: "Vérification des détecteurs", exact: true }).waitFor();
assert.equal(periods.length, 1);
assert.equal(periods[0].organization_config.missions[0].title, "Contrôler les détecteurs");
assert.equal(periods[0].organization_config.missions[0].rates.b, 18);
assert.equal(periods[0].organization_config.missions[0].minimum_nights, 5);
assert.equal(periods[0].sms_configs[0].recipient_channels["w-a"], "telegram");
await mount.getByRole("button", { name: "Voir / PDF", exact: true }).click();
const document = page.getByRole("dialog");
await document.locator(".po-document-row").first().waitFor();
assert.equal(await document.locator(".po-document-row").count(), 2);
await document.getByRole("link", { name: "Télécharger le PDF A4" }).waitFor();
await page.screenshot({ path: join(output, "desktop-document.png"), fullPage: true, animations: "disabled" });
await document.getByRole("button", { name: "Fermer", exact: true }).first().click();
await page.setViewportSize({ width: 390, height: 844 });
await mount.getByRole("button", { name: "Modifier", exact: true }).click();
await page.getByRole("dialog").getByLabel("Nom de l’organisation").waitFor();
await page.screenshot({ path: join(output, "mobile-form.png"), fullPage: true, animations: "disabled" });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Page mobile trop large");
assert.equal(await page.getByRole("dialog").evaluate((el) => el.scrollWidth > el.clientWidth + 1), false, "Formulaire mobile trop large");
assert.deepEqual(errors, []);
assert.ok(writes.every((entry) => !entry.path.includes("send-test") && !entry.path.includes("send-sms")));
console.log(JSON.stringify({ checks: "desktop, mobile, organization creation, per-gite rates, minimum nights, recipients, PDF view, distinct services", output }));
await browser.close();
