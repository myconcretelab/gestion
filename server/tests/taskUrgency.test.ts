import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "task-urgency-"));
const org = "org_urgency_test";
const otherOrg = "org_urgency_other";
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/services/organizationContext.js");
let urgency: typeof import("../src/services/taskUrgency.js");
let settings: typeof import("../src/services/taskReminderSettings.js");
let server: Server;
let origin = "";
let cookie = "";
const inOrg = <T>(fn: () => T, organizationId = org) =>
  context.runWithOrganization(
    { organizationId, source: "test" },
    async () => await fn(),
  );
const at = (value: string) => new Date(value);

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${temp}/test.db`,
    DATABASE_URL_SQLITE: `file:${temp}/test.db`,
    DATA_DIR: `${temp}/data`,
    CLIENT_ORIGIN: "http://localhost:5173",
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
  urgency = await import("../src/services/taskUrgency.js");
  settings = await import("../src/services/taskReminderSettings.js");
  const telegram = await import("../src/services/telegramNotifications.js");
  for (const organizationId of [org, otherOrg]) {
    await db.systemPrisma.organization.create({
      data: { id: organizationId, slug: organizationId, name: organizationId },
    });
    await inOrg(async () => {
      await db.default.organizationSettings.create({
        data: {
          organization_id: organizationId,
          setup_completed: true,
          modules_json: JSON.stringify({
            worker_planning: true,
            telegram: true,
          }),
        },
      });
      await db.default.gite.create({
        data: {
          id: `${organizationId}-gite`,
          nom: "Gîte <Forêt>",
          prefixe_contrat: organizationId,
          adresse_ligne1: "Test",
          capacite_max: 2,
          proprietaires_noms: "Test",
          proprietaires_adresse: "Test",
          telephones: "",
          taxe_sejour_par_personne_par_nuit: 0,
          iban: "",
          titulaire: "Test",
          heure_depart_defaut: "12:00",
        },
      });
      telegram.writeTelegramNotificationConfig({
        ...telegram.buildDefaultTelegramNotificationConfig(),
        enabled: true,
        bot_token: `${organizationId}-fake-secret`,
      });
      await db.default.appUser.create({
        data: {
          id: `${organizationId}-creator`,
          display_name: "Créateur",
          telegram_chat_id: "creator-chat",
          is_owner: true,
          status: "owner",
        },
      });
    }, organizationId);
  }
  await inOrg(async () => {
    await db.default.gestionnaire.create({
      data: { id: "manager-profile", prenom: "Gestion", nom: "Test" },
    });
    await db.default.gite.update({
      where: { id: `${org}-gite` },
      data: { gestionnaire_id: "manager-profile" },
    });
    await db.default.planningRelayWorker.create({
      data: {
        id: "worker-profile",
        nom: "Intervenant",
        telephone: "+33600000000",
      },
    });
    await db.default.appUser.create({
      data: {
        id: "worker",
        display_name: "Intervenant",
        intervenant_id: "worker-profile",
        telegram_chat_id: "worker-chat",
        status: "worker",
        roles: '["worker"]',
        page_access: '["planning_relay"]',
      },
    });
    await db.default.appUser.create({
      data: {
        id: "manager",
        display_name: "Gestionnaire",
        gestionnaire_id: "manager-profile",
        telegram_chat_id: "manager-chat",
      },
    });
  });
  const auth = await import("../src/services/serverAuth.js");
  const session = await auth.createServerAuthSession(`${org}-creator`, 24, org);
  cookie = `contrats_session=${session.id}`;
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  for (const organizationId of [org, otherOrg])
    await inOrg(async () => {
      await db.default.actionTask.deleteMany();
      await db.default.reservation.deleteMany();
      await settings.saveTaskReminderSettings({});
    }, organizationId);
  await inOrg(() =>
    db.default.appUser.update({
      where: { id: `${org}-creator` },
      data: { is_active: true, telegram_chat_id: "creator-chat" },
    }),
  );
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await db?.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("le planificateur dédié fonctionne avec le planificateur général désactivé et conserve son verrou par organisation", async () => {
  const { env } = await import("../src/config/env.js");
  const { runTaskUrgencyAutomationTick } = await import("../src/services/taskUrgencyAutomation.js");
  const previous = env.MULTITENANT_AUTOMATION_ENABLED;
  try {
    env.MULTITENANT_AUTOMATION_ENABLED = false;
    const now = new Date();
    const first = await runTaskUrgencyAutomationTick(now);
    assert.equal(first.find((row) => row.organizationId === org)?.status, "succeeded");
    assert.equal(first.find((row) => row.organizationId === otherOrg)?.status, "succeeded");
    const repeated = await runTaskUrgencyAutomationTick(now);
    assert.equal(repeated.find((row) => row.organizationId === org)?.status, "skipped_interval");
    assert.equal(repeated.find((row) => row.organizationId === otherOrg)?.status, "skipped_interval");
  } finally { env.MULTITENANT_AUTOMATION_ENABLED = previous; }
});

async function makeTask(
  id: string,
  level = 1,
  extra: Record<string, unknown> = {},
) {
  return db.default.actionTask.create({
    data: {
      id,
      title: `Tâche ${id}`,
      gite_id: `${context.getOrganizationId()}-gite`,
      starts_at: at("2030-07-01T08:00:00Z"),
      due_at: at("2030-07-02T10:00:00Z"),
      created_by_id: `${context.getOrganizationId()}-creator`,
      assignee_id: "worker",
      ...urgency.taskUrgencyData(level, at("2030-07-01T08:00:00Z")),
      ...extra,
    },
  });
}
async function reservation(id = "departure", day = "2030-07-02") {
  return db.default.reservation.create({
    data: {
      id,
      gite_id: `${org}-gite`,
      hote_nom: "Client",
      date_entree: at("2030-06-29T00:00:00Z"),
      date_sortie: at(`${day}T00:00:00Z`),
      nb_nuits: 3,
      nb_adultes: 2,
      prix_par_nuit: 100,
      prix_total: 300,
    },
  });
}

test("configuration : créateur prioritaire, fréquence horaire, validation et isolation des paramètres", async () => {
  await inOrg(async () => {
    const defaults = await settings.readTaskReminderSettings();
    assert.equal(defaults.recipient_policy, "creator_first");
    assert.equal(defaults.repeat_interval_minutes, 60);
    for (const value of [0, 14, 1441, 1.5])
      assert.equal(
        settings.taskReminderSettingsSchema.safeParse({
          repeat_interval_minutes: value,
        }).success,
        false,
      );
    await settings.saveTaskReminderSettings({ repeat_interval_minutes: 120 });
    assert.equal(
      (await settings.readTaskReminderSettings()).repeat_interval_minutes,
      120,
    );
  });
  assert.equal(
    await inOrg(
      async () =>
        (await settings.readTaskReminderSettings()).repeat_interval_minutes,
      otherOrg,
    ),
    60,
  );
});

test("destinataire : créateur puis intervenant puis gestionnaire, sans sélectionner un compte inactif", async () => {
  await inOrg(async () => {
    const config = await settings.readTaskReminderSettings();
    const gite = { gestionnaire_id: "manager-profile" };
    const users = await db.default.appUser.findMany();
    const task = { created_by_id: `${org}-creator`, assignee_id: "worker" };
    assert.equal(
      urgency.resolveTaskReminderRecipient(task, gite, users, config)?.id,
      task.created_by_id,
    );
    const missingTelegram = users.map((user) =>
      user.id === task.created_by_id
        ? { ...user, telegram_chat_id: " " }
        : user,
    );
    assert.equal(
      urgency.resolveTaskReminderRecipient(task, gite, missingTelegram, config)
        ?.id,
      "worker",
    );
    const inactiveWorker = missingTelegram.map((user) =>
      user.id === "worker" ? { ...user, is_active: false } : user,
    );
    assert.equal(
      urgency.resolveTaskReminderRecipient(task, gite, inactiveWorker, config)
        ?.id,
      "manager",
    );
    assert.equal(
      urgency.resolveTaskReminderRecipient(task, gite, users, {
        ...config,
        recipient_policy: "manager_only",
      })?.id,
      "manager",
    );
    assert.equal(
      urgency.resolveTaskReminderRecipient(
        { assignee_id: "worker" },
        gite,
        users,
        config,
      )?.id,
      "worker",
    );
  });
});

test("les deux niveaux attendent le prochain départ, sont regroupés, puis seul le niveau 2 revient à l’heure", async () => {
  await inOrg(async () => {
    await reservation();
    await makeTask("one", 1);
    await makeTask("two", 2);
    await makeTask("normal", 0);
    const messages: any[] = [];
    const deliver = async (_channel: string, request: any) => {
      messages.push(request);
      return {
        channel: "telegram",
        sent_count: 1,
        skipped_reason: null,
        deliveries: [],
      };
    };
    await urgency.runTaskUrgencyReminders(at("2030-07-02T09:59:59Z"), deliver);
    assert.equal(messages.length, 0);
    await urgency.runTaskUrgencyReminders(at("2030-07-02T10:00:00Z"), deliver);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].recipients, ["creator-chat"]);
    assert.match(messages[0].message, /Tâche one/);
    assert.match(messages[0].message, /Tâche two/);
    assert.doesNotMatch(messages[0].message, /Tâche normal/);
    assert.match(messages[0].message, /Gîte &lt;Forêt&gt;/);
    assert.deepEqual(
      messages[0].options.reply_markup.inline_keyboard.map(
        (row: unknown[]) => row.length,
      ),
      [1, 2],
    );
    await urgency.runTaskUrgencyReminders(at("2030-07-02T10:59:59Z"), deliver);
    assert.equal(messages.length, 1);
    await urgency.runTaskUrgencyReminders(at("2030-07-02T11:00:00Z"), deliver);
    assert.equal(messages.length, 2);
    assert.match(messages[1].message, /Tâche two/);
    assert.doesNotMatch(messages[1].message, /Tâche one/);
    await db.default.actionTask.update({
      where: { id: "two" },
      data: { urgency_stopped_at: at("2030-07-02T11:01:00Z") },
    });
    await urgency.runTaskUrgencyReminders(at("2030-07-02T12:00:00Z"), deliver);
    assert.equal(messages.length, 2);
  });
});

test("départ reporté ou annulé, heure du contrat et changement d’heure sont respectés", async () => {
  await inOrg(async () => {
    const requested = at("2026-10-24T08:00:00Z");
    const rows = [{ id: "first", date_sortie: at("2026-10-25T00:00:00Z") }];
    assert.equal(
      urgency
        .findTaskUrgencyDeparture(requested, rows, new Map(), "12:00")
        ?.at.toISOString(),
      "2026-10-25T11:00:00.000Z",
    );
    assert.equal(
      urgency
        .findTaskUrgencyDeparture(
          requested,
          rows,
          new Map([["first", "16:30"]]),
          "12:00",
        )
        ?.at.toISOString(),
      "2026-10-25T15:30:00.000Z",
    );
    await reservation();
    await makeTask("waiting", 2);
    const messages: any[] = [];
    const deliver = async (_channel: string, request: any) => {
      messages.push(request);
      return {
        channel: "telegram",
        sent_count: 1,
        skipped_reason: null,
        deliveries: [],
      };
    };
    await urgency.runTaskUrgencyReminders(at("2030-07-01T09:00:00Z"), deliver);
    await db.default.reservation.update({
      where: { id: "departure" },
      data: { date_sortie: at("2030-07-03T00:00:00Z") },
    });
    await urgency.runTaskUrgencyReminders(at("2030-07-02T10:00:00Z"), deliver);
    assert.equal(messages.length, 0);
    await db.default.reservation.delete({ where: { id: "departure" } });
    await urgency.runTaskUrgencyReminders(at("2030-07-03T10:00:00Z"), deliver);
    assert.equal(messages.length, 0);
    assert.equal(
      (
        await db.default.actionTask.findUniqueOrThrow({
          where: { id: "waiting" },
        })
      ).urgency_starts_at,
      null,
    );
    await reservation("replacement", "2030-07-04");
    await urgency.runTaskUrgencyReminders(at("2030-07-05T10:00:00Z"), deliver);
    assert.equal(messages.length, 1); // a missed tick is caught up once, not once per missed hour
    await urgency.runTaskUrgencyReminders(at("2030-07-05T10:00:00Z"), deliver);
    assert.equal(messages.length, 1);
  });
});

test("échec ou envoi ignoré : aucun rappel n’est consommé ; les tâches terminées ne sont pas envoyées", async () => {
  await inOrg(async () => {
    await reservation();
    await makeTask("retry", 1);
    await makeTask("done", 2, { status: "done" });
    const quiet = await urgency.runTaskUrgencyReminders(
      at("2030-07-02T10:00:00Z"),
    );
    assert.equal(quiet.sent_count, 0); // test transport cannot contact Telegram
    assert.equal(
      (
        await db.default.actionTask.findUniqueOrThrow({
          where: { id: "retry" },
        })
      ).urgency_first_sent_at,
      null,
    );
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(
        (
          await urgency.runTaskUrgencyReminders(
            at("2030-07-02T10:00:00Z"),
            async () => {
              throw new Error("provider secret");
            },
          )
        ).failed_count,
        1,
      );
    } finally {
      console.error = original;
    }
    const messages: any[] = [];
    await urgency.runTaskUrgencyReminders(
      at("2030-07-02T10:01:00Z"),
      async (_channel, request) => {
        messages.push(request);
        return {
          channel: "telegram",
          sent_count: 1,
          skipped_reason: null,
          deliveries: [],
        };
      },
    );
    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages[0].message, /Tâche done/);
  });
});

test("les tâches d’une autre organisation ne sont jamais incluses dans le message", async () => {
  await inOrg(async () => {
    await reservation();
    await makeTask("local");
  });
  await inOrg(() => makeTask("foreign"), otherOrg);
  await inOrg(async () => {
    const messages: any[] = [];
    await urgency.runTaskUrgencyReminders(
      at("2030-07-02T10:00:00Z"),
      async (_channel, request) => {
        messages.push(request);
        return {
          channel: "telegram",
          sent_count: 1,
          skipped_reason: null,
          deliveries: [],
        };
      },
    );
    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages[0].message, /foreign/);
  });
});

function tokenFor(
  task: { id: string; urgency_version: string },
  action: "done" | "stop",
  overrides = {},
) {
  return urgency.buildTaskReminderToken(
    {
      organization_id: org,
      task_id: task.id,
      gite_id: `${org}-gite`,
      recipient_id: `${org}-creator`,
      version: task.urgency_version,
      action,
      issued_at: Date.now() - 1000,
      expires_at: Date.now() + 86_400_000,
      ...overrides,
    },
    `${org}-fake-secret`,
  );
}

test("la cloche modifie seulement l’urgence de la tâche choisie, avec contrôle des droits et des conflits", async () => {
  const [task, other] = await inOrg(async () => Promise.all([makeTask("bell-a", 0), makeTask("bell-b", 0)]));
  const headers = { Cookie: cookie, Origin: "http://localhost:5173", "Content-Type": "application/json" };
  const change = (id: string, level: number, updatedAt: string, requestHeaders = headers) => fetch(`${origin}/api/action-tasks/tasks/${id}/urgency`, { method: "PATCH", headers: requestHeaders, body: JSON.stringify({ urgency_level: level, expected_updated_at: updatedAt, title: "Ne doit pas changer", assignee_id: "manager" }) });
  let current = task;
  for (const level of [1, 2, 0]) {
    const response = await change(task.id, level, current.updatedAt.toISOString());
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json() as any;
    assert.equal(saved.urgency_level, level);
    assert.equal(saved.title, task.title);
    assert.equal(saved.assignee_id, task.assignee_id);
    assert.equal(saved.created_by_id, task.created_by_id);
    current = await inOrg(() => db.default.actionTask.findUniqueOrThrow({ where: { id: task.id } }));
    await inOrg(async () => assert.equal((await db.default.actionTask.findUniqueOrThrow({ where: { id: other.id } })).urgency_level, 0));
  }
  assert.equal((await change(task.id, 1, "2000-01-01T00:00:00.000Z")).status, 409);
  await inOrg(() => db.default.actionTask.update({ where: { id: task.id }, data: { status: "done" } }));
  assert.equal((await change(task.id, 1, current.updatedAt.toISOString())).status, 409);
  const long = await inOrg(() => makeTask("bell-long", 0, { category: "long" }));
  assert.equal((await change(long.id, 1, long.updatedAt.toISOString())).status, 400);
  const foreign = await inOrg(() => makeTask("bell-foreign", 0), otherOrg);
  assert.equal((await change(foreign.id, 1, foreign.updatedAt.toISOString())).status, 404);
  await inOrg(() => db.default.actionTask.update({ where: { id: other.id }, data: { assignee_id: "manager" } }));
  const { createServerAuthSession } = await import("../src/services/serverAuth.js");
  const workerSession = await createServerAuthSession("worker", 24, org);
  assert.equal((await change(other.id, 1, other.updatedAt.toISOString(), { ...headers, Cookie: `contrats_session=${workerSession.id}` })).status, 403);
});
const publicGet = (token: string) =>
  fetch(
    `${origin}/api/public/task-reminders/action?token=${encodeURIComponent(token)}`,
  );
const publicPost = (token: string, extra = {}) =>
  fetch(`${origin}/api/public/task-reminders/action`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, ...extra }),
  });

test("boutons publics : GET sans effet, arrêt sans validation, puis validation idempotente sans connexion", async () => {
  const task = await inOrg(() => makeTask("public", 2));
  const stop = tokenFor(task, "stop");
  const done = tokenFor(task, "done");
  const preview = await publicGet(done);
  assert.equal(preview.status, 200, await preview.text());
  assert.equal(preview.headers.get("cache-control"), "no-store, private");
  await inOrg(async () =>
    assert.equal(
      (
        await db.default.actionTask.findUniqueOrThrow({
          where: { id: task.id },
        })
      ).status,
      "planned",
    ),
  );
  assert.equal((await publicPost(stop)).status, 200);
  await inOrg(async () => {
    const saved = await db.default.actionTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(saved.status, "planned");
    assert.ok(saved.urgency_stopped_at);
  });
  assert.equal((await publicPost(done)).status, 200);
  assert.equal((await publicPost(done)).status, 200);
  await inOrg(async () => {
    const saved = await db.default.actionTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(saved.status, "done");
    assert.equal(saved.completed_by_id, `${org}-creator`);
  });
});

test("liens altérés, expirés, révoqués, mauvais destinataire ou autre organisation : aucune validation", async () => {
  const task = await inOrg(() => makeTask("guard", 2));
  const good = tokenFor(task, "done");
  const [encoded] = good.split(".");
  for (const token of [
    `${good}x`,
    `${encoded}.${"é".repeat(43)}`,
    tokenFor(task, "done", { expires_at: Date.now() - 1 }),
    tokenFor(task, "done", { recipient_id: "worker" }),
    tokenFor(task, "done", { version: "revoked" }),
  ]) {
    assert.equal((await publicPost(token)).status, 410);
  }
  assert.equal(urgency.parseTaskReminderToken(good, "wrong-secret"), null);
  const foreign = urgency.buildTaskReminderToken(
    { ...urgency.decodeTaskReminderToken(good)!, organization_id: otherOrg },
    `${otherOrg}-fake-secret`,
  );
  assert.equal((await publicPost(foreign)).status, 410);
  await inOrg(async () =>
    assert.equal(
      (
        await db.default.actionTask.findUniqueOrThrow({
          where: { id: task.id },
        })
      ).status,
      "planned",
    ),
  );
});

test("la création authentifiée enregistre l’auteur réel et ignore un auteur fourni par le client", async () => {
  const headers = {
    Cookie: cookie,
    Origin: "http://localhost:5173",
    "Content-Type": "application/json",
  };
  const response = await fetch(`${origin}/api/action-tasks/tasks/quick`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      gite_id: `${org}-gite`,
      title: "Apporter du savon",
      urgency_level: 1,
      created_by_id: "worker",
    }),
  });
  assert.equal(response.status, 201);
  const task = (await response.json()) as any;
  assert.equal(task.created_by_id, `${org}-creator`);
  assert.equal(task.created_by_name, "Créateur");
  const manual = await fetch(`${origin}/api/action-tasks/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      gite_id: `${org}-gite`,
      title: "Vérifier la lampe",
      start_day: "2030-07-01",
      start_time: "09:00",
      due_day: "2030-07-02",
      due_time: "12:00",
      assignee_id: null,
      created_by_id: "worker",
    }),
  });
  assert.equal(manual.status, 201);
  assert.equal(((await manual.json()) as any).created_by_id, `${org}-creator`);
  const long = await fetch(`${origin}/api/action-tasks/tasks/quick`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      gite_id: `${org}-gite`,
      title: "Rénover",
      category: "long",
      urgency_level: 2,
    }),
  });
  assert.equal(long.status, 400);
});

test("validation publique rémunérée : minutes requises et aucune double rémunération", async () => {
  const task = await inOrg(() =>
    makeTask("paid", 2, { compensation_mode: "time" }),
  );
  const token = tokenFor(task, "done");
  assert.equal((await publicPost(token)).status, 409);
  await inOrg(async () =>
    assert.equal(
      (
        await db.default.actionTask.findUniqueOrThrow({
          where: { id: task.id },
        })
      ).status,
      "planned",
    ),
  );
  assert.equal((await publicPost(token, { spent_minutes: "35" })).status, 200);
  assert.equal((await publicPost(token, { spent_minutes: "35" })).status, 200);
  await inOrg(async () => {
    const entries = await db.default.intervenantHourEntry.findMany({
      where: { id: `action-task:${task.id}` },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].minutes, 35);
  });
});
