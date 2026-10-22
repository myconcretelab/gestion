import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS_CATEGORIES } from "../src/pages/settings/SettingsShell.tsx";

test("les rubriques de paramètres ouvrent directement un réglage utile", () => {
  const entryPaths = Object.fromEntries(
    SETTINGS_CATEGORIES.map(({ id, path }) => [id, path]),
  );

  assert.deepEqual(entryPaths, {
    organisation: "organisation",
    personnalisation: "widgets",
    hebergements: "nuitees",
    canaux: "emails",
    taches: "taches",
    connexions: "connexions",
    "equipe-acces": "utilisateurs",
    donnees: "journal-imports",
    systeme: "systeme",
  });

  for (const category of SETTINGS_CATEGORIES) {
    assert.ok(category.tabs.some(({ path }) => path === category.path));
    assert.ok(category.tabs.every(({ label }) => label !== "Vue d’ensemble"));
  }
});

test("la configuration des modules reste accessible dans Connexions", () => {
  const connections = SETTINGS_CATEGORIES.find(({ id }) => id === "connexions");

  assert.ok(connections);
  assert.deepEqual(connections.tabs[0], {
    label: "Modules",
    path: "connexions",
  });
});

test("les widgets disposent d'une rubrique de personnalisation dédiée", () => {
  const personalization = SETTINGS_CATEGORIES.find(({ id }) => id === "personnalisation");

  assert.ok(personalization);
  assert.deepEqual(personalization.tabs, [
    { label: "Widgets", path: "widgets", navId: "nav-settings-widgets" },
    { label: "Apparence", path: "apparence", navId: "nav-settings-appearance" },
  ]);
});
