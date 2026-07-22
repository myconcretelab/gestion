import assert from "node:assert/strict";
import test from "node:test";
import { mergePlanningRelayProgrammeTemplates } from "../src/services/planningRelayProgrammeTemplateSettings.ts";

test("fusionne les variables dynamiques présentes dans plusieurs périodes", () => {
  const templates = mergePlanningRelayProgrammeTemplates(
    [{ id: "programme-gite", key: "programme_gite", template: "{{gite}}" }],
    [
      { id: "programme-gite", key: "programme_gite", template: "doublon ignoré" },
      { id: "programme-light", key: "programme_gite_light", template: "{{gite}} {{options}}" },
    ],
  );

  assert.deepEqual(templates, [
    { id: "programme-gite", key: "programme_gite", template: "{{gite}}" },
    { id: "programme-light", key: "programme_gite_light", template: "{{gite}} {{options}}" },
  ]);
});
