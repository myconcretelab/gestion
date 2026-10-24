import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { partialInputSchema } from "../src/utils/validation.js";

const createSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  notes: z.string().trim().default(""),
  settings: z.object({ label: z.string().default("standard") }).prefault({}),
});

test("une modification partielle ne réinitialise pas les champs omis à leur valeur par défaut", () => {
  const patch = partialInputSchema(createSchema);
  assert.deepEqual(patch.parse({ name: "Nouveau nom" }), {
    name: "Nouveau nom",
  });
  assert.deepEqual(patch.parse({}), {});
  assert.deepEqual(createSchema.parse({ name: "Création" }), {
    name: "Création",
    enabled: false,
    notes: "",
    settings: { label: "standard" },
  });
});
test("une modification explicite conserve la validation et les valeurs par défaut des objets fournis", () => {
  const patch = partialInputSchema(createSchema);
  assert.deepEqual(patch.parse({ enabled: false, notes: "  ", settings: {} }), {
    enabled: false,
    notes: "",
    settings: { label: "standard" },
  });
  assert.equal(patch.safeParse({ enabled: "false" }).success, false);
  assert.equal(patch.safeParse({ name: "" }).success, false);
  assert.deepEqual(patch.parse({ extra: true }), {});
});
