import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("Node natif charge le JavaScript partagé compilé, sans chargeur TypeScript", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const resolved = import.meta.resolve('@contrats/shared');
    if (!resolved.endsWith('/dist/src/index.js')) process.exit(2);
    const shared = await import('@contrats/shared');
    if (typeof shared.computeInvoiceFiscal !== 'function') process.exit(3);
  `], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
