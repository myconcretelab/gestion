import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("contrôle du gîte : persistance, doublons, annulation et échec Telegram", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gite-check-test-"));
  const previousDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const { default: prisma } = await import("../src/db/prisma.ts");
  const { default: router } = await import("../src/routes/gites.ts");
  const telegram = await import("../src/services/telegramNotifications.ts");
  const originalFind = prisma.gite.findUnique;
  const originalUpdate = prisma.gite.updateMany;
  const originalFetch = globalThis.fetch;
  let checkedAt: Date | null = null;
  let messages: any[] = [];
  let fail = false;
  const call = async (method: string, body?: unknown, id = "g1") => {
    const layer = (router as any).stack.find((item: any) => item.route?.path === "/:id/cleaning-check" && item.route.methods[method]);
    const response = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
    let error: unknown;
    await layer.route.stack[0].handle({ params: { id }, body }, response, (err: unknown) => { error = err; });
    return { ...response, error };
  };
  try {
    prisma.gite.findUnique = (async ({ where }: any) => where.id === "g1" ? { nom: "Gîte & Jardin", cleaning_checked_at: checkedAt } : null) as any;
    prisma.gite.updateMany = (async ({ where, data }: any) => {
      if ((where.cleaning_checked_at === null) !== (checkedAt === null)) return { count: 0 };
      checkedAt = data.cleaning_checked_at;
      return { count: 1 };
    }) as any;
    globalThis.fetch = (async (_url: any, options: any) => {
      if (fail) throw new Error("Telegram unavailable");
      messages.push(JSON.parse(options.body));
      return { ok: true } as Response;
    }) as any;
    telegram.writeTelegramNotificationConfig({ ...telegram.buildDefaultTelegramNotificationConfig(), enabled: true, bot_token: "test", chat_ids: ["chat-reservations"], gite_check_mentions: ["@camille"] });
    assert.equal((await call("get")).body.cleaning_checked_at, null);
    const results = await Promise.all([call("put", { checked: true }), call("put", { checked: true })]);
    assert.ok(results.every((result) => !result.error && result.body.cleaning_checked_at));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].chat_id, "chat-reservations");
    assert.match(messages[0].text, /Gîte &amp; Jardin/);
    assert.match(messages[0].text, /@camille/);
    assert.match(messages[0].text, /Le gîte est OK/);
    await call("put", { checked: false });
    assert.equal((await call("get")).body.cleaning_checked_at, null);
    assert.equal(messages.length, 1);
    fail = true;
    const failed = await call("put", { checked: true });
    assert.ok(failed.body.cleaning_checked_at);
    assert.match(failed.body.notification_warning, /échoué/);
    assert.equal((await call("put", { checked: true }, "missing")).statusCode, 404);
    assert.ok((await call("put", { checked: "yes" })).error);
    await call("put", { checked: false });
    telegram.writeTelegramNotificationConfig({ ...telegram.buildDefaultTelegramNotificationConfig(), notify_gite_checked: false });
    assert.match((await call("put", { checked: true })).body.notification_warning, /non envoyée/);
    const message = telegram.buildGiteCheckedMessage("Maison", new Date("2026-09-16T10:45:00Z"));
    assert.match(message, /12:45/);
  } finally {
    prisma.gite.findUnique = originalFind;
    prisma.gite.updateMany = originalUpdate;
    globalThis.fetch = originalFetch;
    if (previousDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  }
});
