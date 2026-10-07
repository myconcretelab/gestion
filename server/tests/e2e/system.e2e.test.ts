import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { request } from "playwright";
import { createApp } from "../../src/app.js";

let server: Server;
let baseURL = "";

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Serveur E2E indisponible");
  baseURL = `http://127.0.0.1:${address.port}`;
});

after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("le service expose une santé exploitable sans fuite d'information", async () => {
  const api = await request.newContext({ baseURL });
  const response = await api.get("/api/health");
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers()["x-request-id"]);
  const ready = await api.get("/api/ready");
  assert.equal(ready.status(), 200);
  assert.deepEqual(await ready.json(), { ok: true, database: "ready" });
  const platform = await api.get("/api/platform/billing/session");
  assert.equal(platform.status(), 403);
  assert.equal((await platform.json()).code, "PLATFORM_ADMIN_REQUIRED");
  await api.dispose();
});
