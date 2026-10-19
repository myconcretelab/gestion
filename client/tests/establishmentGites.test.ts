import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  establishmentGiteChanges,
  prefillEstablishmentFromGite,
  type FiscalInventoryGite,
} from "../src/pages/settings/establishmentGites.ts";
import EstablishmentGitePicker from "../src/pages/settings/EstablishmentGitePicker.tsx";
import GiteBillingSiret from "../src/pages/shared/GiteBillingSiret.tsx";

const gite = (
  id: string,
  establishment: string | null,
): FiscalInventoryGite => ({
  id,
  nom: `Gîte ${id}`,
  adresse_ligne1: "1 rue Exemple",
  adresse_ligne2: "35000 Rennes",
  fiscal_establishment_id: establishment,
  gestionnaire_id: null,
  missing_fields: [],
  fiscal_establishment: establishment
    ? {
        name: "Établissement",
        siret: "73282932000074",
        fiscal_entity: { legal_name: "Entreprise" },
      }
    : null,
});

test("seules les différences explicites de sélection changent les rattachements", () => {
  const gites = [
    gite("a", "target"),
    gite("b", null),
    gite("c", "other"),
    gite("d", "target"),
  ];
  assert.deepEqual(
    establishmentGiteChanges(gites, "target", ["a", "b"], false),
    [
      {
        gite_id: "b",
        expected_establishment_id: null,
        attach: true,
        confirm_reassignment: false,
      },
      {
        gite_id: "d",
        expected_establishment_id: "target",
        attach: false,
        confirm_reassignment: false,
      },
    ],
  );
  assert.deepEqual(establishmentGiteChanges(gites, "", ["c"], true), [
    {
      gite_id: "c",
      expected_establishment_id: "other",
      attach: true,
      confirm_reassignment: true,
    },
  ]);
});

test("le préremplissage ne devine ni identité fiscale ni adresse structurée et conserve les saisies", () => {
  const draft = {
    name: "",
    siret: "",
    address_line1: "",
    address_line2: "",
    postal_code: "",
    city: "",
    country_code: "FR",
  };
  const result = prefillEstablishmentFromGite(draft, gite("a", null));
  assert.equal(result.name, "Gîte a");
  assert.equal(result.address_line2, "35000 Rennes");
  assert.equal(result.postal_code, "");
  assert.equal(result.siret, "");
  assert.equal(draft.name, "");
  const filled = {
    ...draft,
    name: "Siège",
    address_line1: "Adresse officielle",
    siret: "73282932000074",
  };
  assert.deepEqual(prefillEstablishmentFromGite(filled, gite("b", null)), {
    ...filled,
    address_line2: "35000 Rennes",
  });
});

test("la sélection montre les noms existants, adresses et SIRET et respecte les droits", () => {
  const html = renderToStaticMarkup(
    createElement(EstablishmentGitePicker, {
      gites: [gite("a", null), gite("b", "other")],
      selectedIds: ["a"],
      establishmentId: "target",
      disabled: true,
      onToggle() {},
    }),
  );
  assert.match(html, /Gîte a/);
  assert.match(html, /SIRET 73282932000074/);
  assert.match(html, /changement demandera confirmation/);
  assert.match(html, /fieldset[^>]*disabled/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
});

test("le SIRET de la fiche gîte est repris de son établissement, sans seconde saisie", () => {
  const html = renderToStaticMarkup(
    createElement(GiteBillingSiret, {
      giteId: "gite & test",
      establishment: {
        id: "est",
        name: "Siège",
        siret: "73282932000074",
        fiscal_entity: { id: "entity", legal_name: "Entreprise" },
      },
    }),
  );
  assert.match(html, /value="73282932000074"/);
  assert.match(html, /readonly/);
  assert.match(html, /gite=gite%20%26%20test/);
  assert.match(html, /une seule valeur/);
});
