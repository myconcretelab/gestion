import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FiscalSettingsNavigation, {
  fiscalSettingsSections,
  type FiscalSettingsSection,
} from "../src/pages/settings/FiscalSettingsNavigation.tsx";
import FiscalUnsavedChangesNotice from "../src/pages/settings/FiscalUnsavedChangesNotice.tsx";
import {
  isFiscalDraftDirty,
  nextFiscalSettingsSection,
} from "../src/pages/settings/fiscalSettingsState.ts";

const props = {
  active: "company" as FiscalSettingsSection,
  hasCompany: true,
  canManageIntegrations: true,
  disabled: false,
  onChange: (_section: FiscalSettingsSection) => {},
};
const nativeElements = (node: ReactNode, type: string): any[] => {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [
    ...(node.type === type ? [node] : []),
    ...Children.toArray(node.props.children).flatMap((child) =>
      nativeElements(child, type),
    ),
  ];
};

test("le parcours avance entreprise → établissements → gîtes → SuperPDP, sans boucler", () => {
  assert.equal(nextFiscalSettingsSection("company", true), "establishments");
  assert.equal(nextFiscalSettingsSection("establishments", true), "gites");
  assert.equal(nextFiscalSettingsSection("gites", true), "superpdp");
  assert.equal(nextFiscalSettingsSection("superpdp", true), null);
});

test("le parcours sans droit d’intégration s’arrête aux gîtes", () => {
  assert.equal(nextFiscalSettingsSection("company", false), "establishments");
  assert.equal(nextFiscalSettingsSection("establishments", false), "gites");
  assert.equal(nextFiscalSettingsSection("gites", false), null);
  assert.equal(nextFiscalSettingsSection("superpdp", false), null);
});

test("quatre volets identifiés, une sélection et un seul point d’entrée clavier", () => {
  for (const section of fiscalSettingsSections) {
    const html = renderToStaticMarkup(
      createElement(FiscalSettingsNavigation, { ...props, active: section.id }),
    );
    assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
    assert.ok(html.includes(`aria-controls="fiscal-panel-${section.id}"`));
    assert.ok(html.includes(`id="fiscal-tab-${section.id}"`));
    for (const { label } of fiscalSettingsSections)
      assert.ok(html.includes(label));
  }
});

test("une nouvelle entreprise doit être enregistrée avant les autres volets", () => {
  const tree = FiscalSettingsNavigation({ ...props, hasCompany: false });
  const tabs = nativeElements(tree, "button");
  assert.equal(tabs[0].props.disabled, false);
  for (const tab of tabs.slice(1)) assert.equal(tab.props.disabled, true);
});

test("les droits d’intégration restent respectés et une sauvegarde verrouille la navigation", () => {
  const html = renderToStaticMarkup(
    createElement(FiscalSettingsNavigation, {
      ...props,
      canManageIntegrations: false,
    }),
  );
  assert.ok(!html.includes("SuperPDP"));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  for (const tab of nativeElements(
    FiscalSettingsNavigation({ ...props, disabled: true }),
    "button",
  ))
    assert.equal(tab.props.disabled, true);
});

test("flèches, Début et Fin changent le volet et déplacent le focus sans soumettre un formulaire", () => {
  for (const [active, key, expected] of [
    ["company", "ArrowRight", "establishments"],
    ["company", "ArrowLeft", "superpdp"],
    ["gites", "Home", "company"],
    ["company", "End", "superpdp"],
  ] as const) {
    const selected: string[] = [];
    const focused: string[] = [];
    let prevented = false;
    const tree = FiscalSettingsNavigation({
      ...props,
      active,
      onChange: (value) => selected.push(value),
    });
    const button = nativeElements(tree, "button").find(
      (button) => button.props["aria-selected"],
    );
    button.props.onKeyDown({
      key,
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: {
        parentElement: {
          querySelector: (selector: string) => ({
            focus: () => focused.push(selector),
          }),
        },
      },
    });
    assert.equal(button.props.type, "button");
    assert.ok(prevented);
    assert.deepEqual(selected, [expected]);
    assert.deepEqual(focused, [`#fiscal-tab-${expected}`]);
  }
});

test("la navigation clavier ignore les volets non autorisés", () => {
  const selected: string[] = [];
  const tree = FiscalSettingsNavigation({
    ...props,
    hasCompany: false,
    onChange: (value) => selected.push(value),
  });
  nativeElements(tree, "button")[0].props.onKeyDown({
    key: "End",
    preventDefault() {},
    currentTarget: {},
  });
  assert.deepEqual(selected, ["company"]);
});

test("la confirmation distingue entreprise et établissement et n’abandonne jamais une saisie à son ouverture", () => {
  for (const target of ["company", "establishment"] as const) {
    const actions: string[] = [];
    const tree = FiscalUnsavedChangesNotice({
      target,
      onCancel: () => actions.push("cancel"),
      onDiscard: () => actions.push("discard"),
    });
    const html = renderToStaticMarkup(tree);
    assert.match(html, /role="alert"/);
    assert.match(html, /Rester et conserver mes saisies/);
    assert.match(html, /Abandonner et changer/);
    assert.deepEqual(actions, []);
    const buttons = nativeElements(tree, "button");
    assert.equal(buttons[0].props.autoFocus, true);
    buttons[0].props.onClick();
    assert.deepEqual(actions, ["cancel"]);
    buttons[1].props.onClick();
    assert.deepEqual(actions, ["cancel", "discard"]);
    assert.equal(html.includes("accès SuperPDP"), target === "company");
  }
});

test("les brouillons sont comparés sans faux changement lié à l’ordre des clés", () => {
  assert.equal(
    isFiscalDraftDirty(
      { name: "Exemple", siren: "" },
      { siren: "", name: "Exemple" },
    ),
    false,
  );
  assert.equal(isFiscalDraftDirty({}, {}), false);
  assert.equal(
    isFiscalDraftDirty({ name: "Autre" }, { name: "Exemple" }),
    true,
  );
  assert.equal(
    isFiscalDraftDirty({ name: "Exemple" }, { name: "Exemple", siren: "" }),
    true,
  );
  assert.equal(
    isFiscalDraftDirty({ name: "Exemple", siren: "" }, { name: "Exemple" }),
    true,
  );
});
