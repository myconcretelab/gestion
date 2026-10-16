import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, isValidElement, Children, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvoiceOperationEditor from "../src/pages/shared/InvoiceOperationEditor.tsx";

test("le choix B2B est explicite, contrôlé et ne sélectionne aucune nature à la place de l’utilisateur", () => {
  for (const value of ["unknown", "goods", "services", "mixed"] as const) {
    const html = renderToStaticMarkup(
      createElement(InvoiceOperationEditor, { value, onChange: () => {} }),
    );
    assert.match(html, /Nature de l’opération facturée/);
    assert.ok(html.includes(`value="${value}" selected=""`));
    assert.equal((html.match(/selected=""/g) ?? []).length, 1);
    for (const kind of ["unknown", "goods", "services", "mixed"])
      assert.ok(html.includes(`value="${kind}"`));
    assert.match(html, /aucun choix automatique/);
    assert.match(html, /Les paiements partiels/);
    assert.match(html, /non plusieurs taux de TVA/);
  }
});

test("changer le sélecteur transmet le choix sans activer de parcours ni choisir à l’ouverture", () => {
  const selections: string[] = [];
  const tree = InvoiceOperationEditor({
    value: "unknown",
    onChange: (value) => selections.push(value),
  });
  const findSelect = (node: ReactNode): any => {
    if (!isValidElement<{ children?: ReactNode }>(node)) return null;
    if (node.type === "select") return node;
    return Children.toArray(node.props.children).map(findSelect).find(Boolean);
  };
  const select = findSelect(tree);
  assert.ok(select);
  assert.deepEqual(selections, []);
  for (const value of ["goods", "services", "mixed", "unknown"])
    select.props.onChange({ target: { value } });
  assert.deepEqual(selections, ["goods", "services", "mixed", "unknown"]);
});
