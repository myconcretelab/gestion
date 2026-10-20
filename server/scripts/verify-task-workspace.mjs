// Run against the local Vite server; all task APIs are mocked. No user data is changed.
// node server/scripts/verify-task-workspace.mjs
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = process.env.TASK_UI_ORIGIN || "http://localhost:5173";
const screenshots = await mkdtemp(join(tmpdir(), "task-workspace-"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const writes = [];
const baseTask = {
  gite_id: "g1",
  gite_name: "La Grée",
  assignee_id: null,
  assignee_name: null,
  status: "planned",
  starts_at: "2026-10-19T07:00:00Z",
  due_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-10-19T07:00:00Z",
  note: "",
  template_id: null,
  category: "short",
  compensation_mode: "none",
  compensation_amount: 0,
  spent_minutes: null,
};
const preset = {
  key: "soap",
  title: "Apporter du savon à main",
  category: "short",
  note: "Le stock est dans le placard.",
  enabled: true,
};
const fixture = {
  tasks: [
    {
      ...baseTask,
      id: "t-long",
      title: "Repeindre le volet",
      category: "long",
      compensation_mode: "time",
    },
    {
      ...baseTask,
      id: "t-short",
      title: "Apporter du savon à main",
      note: preset.note,
    },
    {
      ...baseTask,
      id: "t-other",
      title: "Vérifier le joint",
      gite_id: "g2",
      gite_name: "Tante Phonsine",
      assignee_id: "u1",
      assignee_name: "Sébastien",
      status: "in_progress",
    },
    { ...baseTask, id: "t-done", title: "Ranger le linge", status: "done" },
  ],
  templates: [
    {
      id: "auto-1",
      gite_id: "g1",
      title: "Préparer le linge",
      category: "short",
      compensation_mode: "flat_rate",
      compensation_amount: 12,
      default_minutes: null,
      trigger_event: "departure",
      starts_offset_days: 0,
      due_offset_days: 1,
      start_time: "09:00",
      due_time: "17:00",
      assignment_mode: "unassigned",
      default_assignee_id: null,
      rotation_assignee_ids: [],
      enabled: true,
    },
  ],
  gites: [
    { id: "g1", nom: "La Grée" },
    { id: "g2", nom: "Tante Phonsine" },
  ],
  assignees: [{ id: "u1", name: "Sébastien" }],
  can_manage: true,
  current_user_id: "u1",
  can_edit_compensation: true,
  shortcuts: [preset],
  shortcut_catalog: [preset],
};
let failPresetSave = false;
await page.route("**/api/action-tasks**", async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const json = request.method() === "GET" ? null : request.postDataJSON();
  if (json) writes.push({ path, json });
  if (path.endsWith("/shortcuts")) {
    if (failPresetSave)
      return route.fulfill({
        status: 409,
        json: { error: "La bibliothèque a changé. Rechargez-la." },
      });
    fixture.shortcut_catalog = json.shortcuts;
    fixture.shortcuts = json.shortcuts.filter((item) => item.enabled);
    return route.fulfill({ json: { shortcuts: fixture.shortcut_catalog } });
  } else if (path.endsWith("/tasks") && json) {
    fixture.tasks.push({
      ...baseTask,
      ...json,
      id: `new-${writes.length}`,
      due_at: `${json.due_day}T12:00:00Z`,
      gite_name: fixture.gites.find((item) => item.id === json.gite_id).nom,
    });
  } else if (path.endsWith("/assignment") && json) {
    const task = fixture.tasks.find((item) => path.includes(`/${item.id}/`));
    task.assignee_id = json.assignee_id;
  } else if (path.endsWith("/status") && json) {
    const task = fixture.tasks.find((item) => path.includes(`/${item.id}/`));
    task.status = json.status;
  }
  return route.fulfill({ json: fixture });
});
async function mount() {
  await page.evaluate(async () => {
    const R = await import("/node_modules/.vite/deps/react.js");
    const D = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: Component } = await import("/src/pages/ActionsPanel.tsx");
    window.taskTestRoot?.unmount();
    document.getElementById("root").style.display = "none";
    let el = document.getElementById("task-test-mount");
    if (!el) {
      el = document.createElement("main");
      el.id = "task-test-mount";
      document.body.append(el);
    }
    el.style.cssText = `padding:${innerWidth < 700 ? 16 : 40}px;max-width:1240px;margin:auto`;
    window.taskTestRoot = (D.default ?? D).createRoot(el);
    window.taskTestRoot.render((R.default ?? R).createElement(Component, { from: "2026-10-01", to: "2027-09-30" }));
  });
  await page
    .getByRole("button", {
      name: "Modifier Apporter du savon à main",
      exact: true,
    })
    .waitFor();
}
async function screenshot(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.screenshot({
    path: join(screenshots, `${name}.png`),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    `Overflow: ${name}`,
  );
}
try {
  await page.goto(`${origin}/aujourdhui`, { waitUntil: "domcontentloaded" });
  await mount();
  const headings = await page.locator(".tw-group h2").allTextContents();
  assert.match(headings[0], /rapides/i);
  assert.match(headings[1], /long terme/i);
  await page
    .getByRole("searchbox", { name: "Rechercher une tâche" })
    .fill("gree");
  assert.equal(await page.locator(".tw-task").count(), 2);
  await page
    .getByRole("button", { name: "Réinitialiser", exact: true })
    .click();
  await page.getByLabel("Filtrer par gîte", { exact: true }).selectOption("g2");
  assert.equal(await page.locator(".tw-task").count(), 1);
  await page
    .getByRole("button", { name: "Réinitialiser", exact: true })
    .click();
  await screenshot("desktop-tasks");

  await page
    .getByRole("button", { name: "Terminer Repeindre le volet", exact: true })
    .click();
  assert.equal(
    await page.getByRole("dialog").getByRole("combobox").inputValue(),
    "u1",
  );
  await page.getByLabel("Temps réellement passé (minutes)").fill("35");
  await page.getByRole("button", { name: "Confirmer", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(writes.at(-1).json.spent_minutes, 35);
  assert.equal(writes.at(-2).json.assignee_id, "u1");

  await page.getByRole("tab", { name: "Préenregistrées" }).click();
  await page
    .getByRole("button", { name: `Modifier le raccourci ${preset.title}` })
    .click();
  await page
    .getByLabel("Nom de la tâche")
    .fill("Apporter du savon et une recharge");
  await page.getByLabel(/Consignes/).fill("Prévoir deux recharges.");
  await page.getByRole("button", { name: "Long terme", exact: true }).click();
  failPresetSave = true;
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").waitFor();
  assert.equal(
    await page.getByLabel("Nom de la tâche").inputValue(),
    "Apporter du savon et une recharge",
  );
  failPresetSave = false;
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(fixture.shortcut_catalog[0].category, "long");
  await page.getByRole("button", { name: "Dupliquer", exact: true }).click();
  await page.getByLabel("Nom de la tâche").fill("Raccourci de test");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(fixture.shortcut_catalog.length, 2);
  await page
    .getByRole("button", { name: "Monter Raccourci de test", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".tw-preset h3")?.textContent ===
      "Raccourci de test",
  );
  const testPreset = page.locator(".tw-preset").filter({
    has: page.getByRole("heading", {
      name: "Raccourci de test",
      exact: true,
    }),
  });
  await testPreset
    .getByRole("button", { name: "Masquer", exact: true })
    .click();
  await testPreset.getByText("Masqué", { exact: true }).waitFor();
  assert.equal(fixture.shortcuts.length, 1);
  await page
    .getByRole("button", {
      name: "Modifier le raccourci Raccourci de test",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Supprimer ce raccourci", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmer la suppression", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(fixture.shortcut_catalog.length, 1);
  await screenshot("desktop-presets");
  await page.getByRole("tab", { name: "À faire", exact: true }).click();
  await page
    .getByRole("button", { name: "Nouvelle tâche", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Apporter du savon et une recharge",
      exact: true,
    })
    .click();
  assert.equal(
    await page.getByLabel("Que faut-il faire ?").inputValue(),
    "Apporter du savon et une recharge",
  );
  assert.equal(
    await page.getByLabel(/Consignes/).inputValue(),
    "Prévoir deux recharges.",
  );
  await page
    .getByRole("button", { name: "Créer la tâche", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(writes.at(-1).json.assignee_id, null);
  assert.equal(writes.at(-1).json.category, "long");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(
      () => (document.getElementById("task-test-mount").style.padding = "16px"),
    );
    await page.getByRole("button", { name: "Filtres", exact: true }).click();
    await page
      .getByLabel("Filtrer par gîte", { exact: true })
      .selectOption("g1");
    await page
      .getByRole("button", { name: "Réinitialiser", exact: true })
      .click();
    await page.getByRole("button", { name: "Filtres", exact: true }).click();
    await screenshot(`mobile-${width}-tasks`);
    await page.getByRole("tab", { name: "Préenregistrées" }).click();
    await screenshot(`mobile-${width}-presets`);
    await page.getByRole("button", { name: "Nouveau raccourci" }).click();
    await screenshot(`mobile-${width}-preset-editor`);
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await page.getByRole("tab", { name: "Automatisations" }).click();
    await page
      .getByRole("button", {
        name: "Modifier l’automatisation Préparer le linge",
      })
      .click();
    await screenshot(`mobile-${width}-automation-editor`);
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await page.getByRole("tab", { name: "À faire", exact: true }).click();
  }
  fixture.can_edit_compensation = false;
  await mount();
  await page.getByRole("tab", { name: "Automatisations" }).click();
  await page
    .getByRole("button", {
      name: "Modifier l’automatisation Préparer le linge",
    })
    .click();
  assert.equal(
    await page.getByText("Rémunération", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal("compensation_amount" in writes.at(-1).json, false);
  fixture.can_manage = false;
  fixture.gites = [];
  fixture.assignees = [];
  fixture.templates = [];
  fixture.shortcut_catalog = [];
  await mount();
  assert.equal(await page.getByRole("tab").count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "Nouvelle tâche", exact: true })
      .count(),
    0,
  );
  fixture.can_manage = true;
  delete fixture.shortcut_catalog;
  delete fixture.can_edit_compensation;
  await mount();
  await page.getByRole("tab", { name: "Préenregistrées" }).click();
  assert.equal(
    await page.locator(".tw-preset").count(),
    fixture.shortcuts.length,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks:
        "tri, recherche, filtres, validation, édition, droits, mobile 320/390 et desktop",
      screenshots,
    }),
  );
} finally {
  await browser.close();
}
