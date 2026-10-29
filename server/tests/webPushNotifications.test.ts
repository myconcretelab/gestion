import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import webPush from "web-push";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owner-push-"));
const org = "org_push_test";
const otherOrg = "org_push_other";
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/services/organizationContext.js");
let push: typeof import("../src/services/webPushNotifications.js");
let telegram: typeof import("../src/services/telegramNotifications.js");
let server: Server;
let origin: string;
const cookies: Record<string, string> = {};
const inOrg = <T>(fn: () => T, organizationId = org) =>
  context.runWithOrganization(
    { organizationId, source: "test" },
    async () => await fn(),
  );
const subscription = (suffix: string) => {
  const key = crypto.createECDH("prime256v1");
  key.generateKeys();
  return {
    endpoint: `https://web.push.apple.com/${suffix}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: crypto.randomBytes(16).toString("base64url"),
    },
  };
};

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${temp}/test.db`,
    DATABASE_URL_SQLITE: `file:${temp}/test.db`,
    DATA_DIR: `${temp}/data`,
    CLIENT_ORIGIN: "https://app.example.test",
    APP_PUBLIC_URL: "https://app.example.test",
  });
  fs.writeFileSync(`${temp}/test.db`, "");
  const root = process.cwd().endsWith("/server")
    ? process.cwd()
    : path.join(process.cwd(), "server");
  const migrated = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  db = await import("../src/db/prisma.js");
  context = await import("../src/services/organizationContext.js");
  push = await import("../src/services/webPushNotifications.js");
  telegram = await import("../src/services/telegramNotifications.js");
  const auth = await import("../src/services/serverAuth.js");
  for (const organizationId of [org, otherOrg]) {
    await db.systemPrisma.organization.create({
      data: { id: organizationId, slug: organizationId, name: organizationId },
    });
    await inOrg(async () => {
      await db.default.organizationSettings.create({
        data: { organization_id: organizationId, setup_completed: true },
      });
      for (const role of ["owner", "second", "worker"]) {
        const id = `${organizationId}-${role}`;
        await db.default.appUser.create({
          data: {
            id,
            display_name: role,
            roles: JSON.stringify([role === "worker" ? "worker" : "owner"]),
            is_owner: role !== "worker",
            status: role === "worker" ? "worker" : "owner",
            page_access: '["settings"]',
            password_hash: "test-hash",
            password_salt: "test-salt",
          },
        });
        const session = await auth.createServerAuthSession(
          id,
          24,
          organizationId,
        );
        cookies[id] = `contrats_session=${session.id}`;
      }
    }, organizationId);
  }
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  mock.restoreAll();
  await db.systemPrisma.organizationRuntimeSetting.deleteMany({
    where: { key: { startsWith: "web-push." } },
  });
  await db.systemPrisma.appUser.updateMany({ data: { is_active: true } });
});

after(async () => {
  mock.restoreAll();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("les clés VAPID restent stables, privées et propres à chaque organisation", async () => {
  const [first, again] = await inOrg(() =>
    Promise.all([push.getPushPublicKey(), push.getPushPublicKey()]),
  );
  assert.equal(first, again);
  assert.notEqual(first, await inOrg(() => push.getPushPublicKey(), otherOrg));
  const row = await inOrg(() =>
    db.default.organizationRuntimeSetting.findFirstOrThrow({
      where: { key: "web-push.vapid" },
    }),
  );
  assert.equal(row.is_secret, true);
  const response = await fetch(`${origin}/api/notifications`, {
    headers: { Cookie: cookies[`${org}-owner`] },
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /publicKey/);
  assert.doesNotMatch(body, /privateKey/);
});

test("les abonnements rejettent les destinations internes et les clés invalides", () => {
  const valid = subscription("valid");
  assert.ok(push.pushSubscriptionSchema.safeParse(valid).success);
  for (const endpoint of [
    "https://127.0.0.1/private",
    "https://localhost/",
    "http://web.push.apple.com/test",
    "https://web.push.apple.com.evil.test/",
    "https://web.push.apple.com:8443/x",
    "https://user:secret@web.push.apple.com/x",
  ]) {
    assert.equal(
      push.pushSubscriptionSchema.safeParse({ ...valid, endpoint }).success,
      false,
      endpoint,
    );
  }
  assert.equal(
    push.pushSubscriptionSchema.safeParse({
      ...valid,
      keys: { p256dh: "invalid", auth: "invalid" },
    }).success,
    false,
  );
});

test("le contenu enlève le HTML et ouvre uniquement une page authentifiée de l'application", () => {
  const payload = push.buildOwnerPushPayload(
    '<b>Réservation confirmée</b>\n<b>Gîte</b>: Forêt &amp; Spa\n<a href="https://app.example.test/reservations?focus=one&amp;month=2">Voir</a>',
  );
  assert.equal(payload.title, "Réservation confirmée");
  assert.equal(payload.body, "Forêt & Spa");
  assert.equal(payload.url, "/reservations?focus=one&month=2");
  assert.equal(
    push.buildOwnerPushPayload("Test", { url: "https://evil.test/" }).url,
    "/aujourdhui",
  );
  assert.equal(
    push.buildOwnerPushPayload("Test", {
      url: "/api/public/task-reminders/action?token=secret",
    }).url,
    "/aujourdhui",
  );
  assert.equal(
    push.buildOwnerPushPayload("Test", { url: "//evil.test/" }).url,
    "/aujourdhui",
  );
});

test("les notifications atteignent seulement les propriétaires actifs de la bonne organisation, sur tous leurs appareils", async () => {
  const owner = subscription("owner-phone"),
    desktop = subscription("owner-desktop"),
    worker = subscription("worker"),
    other = subscription("other");
  await inOrg(async () => {
    await push.savePushSubscription(`${org}-owner`, owner, "iPhone");
    await push.savePushSubscription(`${org}-owner`, desktop, "Ordinateur");
    await push.savePushSubscription(`${org}-worker`, worker, "Intervenant");
  });
  await inOrg(
    () =>
      push.savePushSubscription(
        `${otherOrg}-owner`,
        other,
        "Autre organisation",
      ),
    otherOrg,
  );
  const endpoints: string[] = [];
  const send = async (sub: { endpoint: string }) => {
    endpoints.push(sub.endpoint);
  };
  const result = await inOrg(() =>
    push.sendOwnerPushNotification(
      "<b>Nouvelle réservation</b>\nGîte Test",
      {},
      send,
    ),
  );
  assert.equal(result.sent_count, 2);
  assert.deepEqual(endpoints.sort(), [owner.endpoint, desktop.endpoint].sort());
  await inOrg(() =>
    db.default.appUser.update({
      where: { id: `${org}-owner` },
      data: { is_active: false },
    }),
  );
  assert.equal(
    (
      await inOrg(() =>
        push.sendOwnerPushNotification("Autre événement", {}, send),
      )
    ).sent_count,
    0,
  );
});

test("les rappels personnels ne sont pas diffusés aux autres propriétaires", async () => {
  const first = subscription("first"),
    second = subscription("second");
  await inOrg(async () => {
    await push.savePushSubscription(`${org}-owner`, first, "Premier");
    await push.savePushSubscription(`${org}-second`, second, "Deuxième");
  });
  const endpoints: string[] = [];
  await inOrg(() =>
    push.sendOwnerPushNotification(
      "Rappel privé",
      { userIds: [`${org}-owner`] },
      async (sub) => {
        endpoints.push(sub.endpoint);
      },
    ),
  );
  assert.deepEqual(endpoints, [first.endpoint]);
});

test("une nouvelle tentative Telegram ne renvoie pas le même événement, les prochains rappels restent possibles", async () => {
  await inOrg(() =>
    push.savePushSubscription(`${org}-owner`, subscription("retry"), "iPhone"),
  );
  let sent = 0;
  const send = async () => {
    sent++;
  };
  await inOrg(async () => {
    await push.sendOwnerPushNotification(
      "Rappel",
      { key: "task:version:first" },
      send,
    );
    await push.sendOwnerPushNotification(
      "Rappel",
      { key: "task:version:first" },
      send,
    );
    await push.sendOwnerPushNotification(
      "Rappel",
      { key: "task:version:next" },
      send,
    );
  });
  assert.equal(sent, 2);
});

test("un appareil expiré est supprimé et une panne temporaire ne supprime pas les autres", async () => {
  await inOrg(async () => {
    await push.savePushSubscription(
      `${org}-owner`,
      subscription("expired"),
      "Expiré",
    );
    await push.savePushSubscription(
      `${org}-owner`,
      subscription("temporary"),
      "Temporaire",
    );
    await push.savePushSubscription(
      `${org}-owner`,
      subscription("healthy"),
      "Valide",
    );
  });
  const result = await inOrg(() =>
    push.sendOwnerPushNotification("Alerte", {}, async (sub) => {
      if (sub.endpoint.endsWith("expired")) throw { statusCode: 410 };
      if (sub.endpoint.endsWith("temporary")) throw { statusCode: 503 };
    }),
  );
  assert.equal(result.sent_count, 1);
  assert.equal(result.failed_count, 1);
  const devices = await inOrg(() => push.listPushDevices(`${org}-owner`));
  assert.deepEqual(devices.map((device) => device.label).sort(), [
    "Temporaire",
    "Valide",
  ]);
});

test("les API exigent un propriétaire connecté et ne permettent pas de retirer l'appareil d'un autre", async () => {
  assert.equal((await fetch(`${origin}/api/notifications`)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/notifications`, {
        headers: { Cookie: cookies[`${org}-worker`] },
      })
    ).status,
    403,
  );
  const sub = subscription("api");
  const response = await fetch(`${origin}/api/notifications/subscriptions`, {
    method: "POST",
    headers: {
      Cookie: cookies[`${org}-owner`],
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscription: sub, label: "iPhone" }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const { devices } = await response.json();
  assert.equal(devices.length, 1);
  assert.doesNotMatch(JSON.stringify(devices), /p256dh|privateKey|auth"/);
  for (const account of [`${org}-second`, `${otherOrg}-owner`]) {
    assert.equal(
      (
        await fetch(
          `${origin}/api/notifications/subscriptions/${devices[0].id}`,
          { method: "DELETE", headers: { Cookie: cookies[account] } },
        )
      ).status,
      204,
    );
    assert.equal(
      (await inOrg(() => push.listPushDevices(`${org}-owner`))).length,
      1,
    );
  }
  assert.equal(
    (
      await fetch(
        `${origin}/api/notifications/subscriptions/${devices[0].id}`,
        { method: "DELETE", headers: { Cookie: cookies[`${org}-owner`] } },
      )
    ).status,
    204,
  );
  assert.equal(
    (await inOrg(() => push.listPushDevices(`${org}-owner`))).length,
    0,
  );
});

test("les appareils prennent la priorité, les retries sont acquittés sans doublon et Telegram reprend en cas d’échec", async () => {
  await inOrg(() =>
    push.savePushSubscription(
      `${org}-owner`,
      subscription("priority"),
      "iPhone",
    ),
  );
  const channel = (await import("../src/services/messageChannels/telegram.js"))
    .telegramMessageChannel;
  let pushCount = 0;
  const pushMock = mock.method(webPush, "sendNotification", async () => {
    pushCount++;
  });
  const chats: string[] = [];
  mock.method(globalThis, "fetch", async (_url, init) => {
    chats.push(JSON.parse(String(init?.body)).chat_id);
    return new Response("{}", { status: 200 });
  });
  const options = {
    ...telegram.buildDefaultTelegramNotificationConfig(),
    enabled: true,
    bot_token: "fake-token",
    chat_ids: ["owner-chat"],
    owner_push: { key: "priority" },
  };
  process.env.NODE_ENV = "development";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await inOrg(() =>
        channel.send({ message: "Réservation confirmée", options }),
      );
      assert.equal(result.channel, "web-push");
      assert.equal(result.sent_count, 1);
      assert.equal(result.skipped_reason, null);
    }
    assert.equal(pushCount, 1);
    assert.deepEqual(chats, []);
    pushMock.mock.mockImplementation(async () => {
      throw { statusCode: 503 };
    });
    const fallback = await inOrg(() =>
      channel.send({
        message: "Autre réservation",
        options: { ...options, owner_push: { key: "other" } },
      }),
    );
    assert.equal(fallback.channel, "telegram");
    assert.equal(fallback.sent_count, 1);
    assert.deepEqual(chats, ["owner-chat"]);
    pushMock.mock.mockImplementation(async () => {
      throw { statusCode: 410 };
    });
    await inOrg(() =>
      channel.send({
        message: "Appareil expiré",
        options: { ...options, owner_push: { key: "expired" } },
      }),
    );
    assert.equal(
      (await inOrg(() => push.listPushDevices(`${org}-owner`))).length,
      0,
    );
    await inOrg(() => channel.send({ message: "Plus d’appareil", options }));
    assert.deepEqual(chats, ["owner-chat", "owner-chat", "owner-chat"]);
  } finally {
    process.env.NODE_ENV = "test";
  }
});

test("la priorité est personnelle et conserve Telegram pour les autres propriétaires et les intervenants", async () => {
  await inOrg(async () => {
    await push.savePushSubscription(
      `${org}-owner`,
      subscription("owner-only"),
      "iPhone",
    );
    await db.default.appUser.update({
      where: { id: `${org}-owner` },
      data: { telegram_chat_id: "owner-chat" },
    });
    await db.default.appUser.update({
      where: { id: `${org}-second` },
      data: { telegram_chat_id: "second-chat" },
    });
    await db.default.appUser.update({
      where: { id: `${org}-worker` },
      data: { telegram_chat_id: "worker-chat" },
    });
    assert.deepEqual(
      await push.telegramRecipientsAfterPush(
        ["owner-chat", "second-chat", "worker-chat"],
        [`${org}-owner`],
      ),
      ["second-chat", "worker-chat"],
    );
    assert.deepEqual(
      await push.telegramRecipientsAfterPush(
        ["shared"],
        [`${org}-owner`],
        undefined,
        [`${org}-owner`, `${org}-second`],
      ),
      ["shared"],
    );
    assert.deepEqual(
      await push.telegramRecipientsAfterPush(
        ["legacy-owner-chat"],
        [`${org}-owner`],
      ),
      [],
    );
    assert.deepEqual(
      await push.telegramRecipientsAfterPush(
        ["legacy-owner-chat"],
        [`${org}-owner`],
        undefined,
        [],
        [`${org}-second`],
      ),
      ["legacy-owner-chat"],
    );
    assert.deepEqual(
      await push.telegramRecipientsAfterPush(
        ["worker-chat"],
        [`${org}-owner`],
        [`${org}-worker`],
      ),
      ["worker-chat"],
    );
  });
});

test("les deux réglages voient la même priorité et Telegram redevient actif au retrait du dernier appareil", async () => {
  await inOrg(async () => {
    telegram.writeTelegramNotificationConfig({
      ...telegram.buildDefaultTelegramNotificationConfig(),
      enabled: true,
      bot_token: "test-token",
      chat_ids: ["owner-chat"],
    });
    await db.default.organizationSettings.update({
      where: { organization_id: org },
      data: { modules_json: JSON.stringify({ telegram: true }) },
    });
  });
  const status = async () =>
    (
      await fetch(`${origin}/api/notifications/status`, {
        headers: { Cookie: cookies[`${org}-owner`] },
      })
    ).json();
  assert.equal((await status()).telegram_state, "active");
  await inOrg(() =>
    push.savePushSubscription(`${org}-owner`, subscription("status"), "iPhone"),
  );
  assert.deepEqual(await status(), {
    push_active: true,
    device_count: 1,
    telegram_state: "standby",
  });
  const [device] = await inOrg(() => push.listPushDevices(`${org}-owner`));
  await inOrg(() => push.removePushDevice(`${org}-owner`, device.id));
  assert.deepEqual(await status(), {
    push_active: false,
    device_count: 0,
    telegram_state: "active",
  });
});

test("le test d'envoi vise seulement les appareils du propriétaire connecté", async () => {
  const headers = { Cookie: cookies[`${org}-owner`] };
  assert.equal(
    (
      await fetch(`${origin}/api/notifications/test`, {
        method: "POST",
        headers,
      })
    ).status,
    409,
  );
  await inOrg(async () => {
    await push.savePushSubscription(
      `${org}-owner`,
      subscription("test-owner"),
      "iPhone",
    );
    await push.savePushSubscription(
      `${org}-second`,
      subscription("test-second"),
      "Autre propriétaire",
    );
  });
  const endpoints: string[] = [];
  mock.method(
    webPush,
    "sendNotification",
    async (sub: { endpoint: string }) => {
      endpoints.push(sub.endpoint);
    },
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${origin}/api/notifications/test`, {
      method: "POST",
      headers,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent_count, 1);
  }
  assert.deepEqual(endpoints, [
    "https://web.push.apple.com/test-owner",
    "https://web.push.apple.com/test-owner",
  ]);
});

test("la bibliothèque chiffre réellement le contenu avec les clés du navigateur et signe la requête VAPID", () => {
  const sub = subscription("encrypted");
  const payload = JSON.stringify(
    push.buildOwnerPushPayload("Réservation confidentielle\nClient Test"),
  );
  const request = webPush.generateRequestDetails(sub, payload, {
    vapidDetails: {
      ...webPush.generateVAPIDKeys(),
      subject: "https://app.example.test",
    },
  });
  assert.equal(request.headers["Content-Encoding"], "aes128gcm");
  assert.match(String(request.headers.Authorization), /^vapid /);
  assert.ok(Buffer.isBuffer(request.body));
  assert.equal(request.body.includes(Buffer.from("Client Test")), false);
});

test("les aperçus gardent des titres courts et l'information utile avant les détails secondaires", () => {
  const booking = push.buildOwnerPushPayload(
    "✅ <b>Réservation confirmée après paiement en ligne</b>\nGîte: Merlin\nSéjour: du 2027-02-10 au 2027-02-14 (4 nuit(s))\nVoyageurs: 2 adultes\nClient: Camille\nTéléphone: 0600000000\nArrhes reçues: 90,00 € (Stripe)\nAucune approbation manuelle n’est nécessaire.",
  );
  assert.equal(booking.title, "Réservation confirmée");
  assert.equal(
    booking.body,
    "Merlin · Camille · 10/02–14/02 · 90,00 € d’arrhes",
  );
  const reminders = push.buildOwnerPushPayload(
    "🔔 <b>Réservations à préparer</b>\n<b>Merlin</b>\n" +
      Array.from({ length: 8 }, (_, i) => `${i + 1}. 🚨 Tâche ${i + 1}`).join(
        "\n",
      ) +
      "\nLes locataires sont partis : vous pouvez intervenir.\n🚨 Rappel toutes les 60 minutes, jusqu’à validation.",
  );
  assert.equal(reminders.title, "8 tâches à faire");
  assert.match(reminders.body, /^Merlin · Tâche 1 ; Tâche 2/);
  assert.doesNotMatch(reminders.body, /locataires|minutes|🔔|🚨/);
  const cleaning = push.buildOwnerPushPayload(
    "🧹 Rappel : contrôle ménage à valider\nGîte: Merlin\nLocataire: Camille\nArrivée: 17:00\nLe contrôle n'a pas encore été validé.",
  );
  assert.equal(cleaning.title, "Contrôle à faire");
  assert.equal(cleaning.body, "Merlin · Arrivée à 17:00 · Camille");
  const overdue = push.buildOwnerPushPayload(
    "<b>Facture impayée après l'échéance</b>\nFacture: F-2026-001\nClient: Camille\nGîte: Merlin\nDate limite: 30 juin 2026\nOuvrir la facture",
  );
  assert.equal(overdue.title, "Facture impayée");
  assert.match(overdue.body, /^Merlin · Camille · F-2026-001/);
  for (const payload of [booking, reminders, cleaning, overdue]) {
    assert.ok(payload.title.length <= 24);
    assert.doesNotMatch(
      payload.title + payload.body,
      /\p{Extended_Pictographic}|<b>|https?:|Telegram|from /u,
    );
  }
});
