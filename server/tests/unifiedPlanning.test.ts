import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "unified-planning-"));
const org = "org_planning_test";
let db: typeof import("../src/db/prisma.js");
let plans: typeof import("../src/services/planningOrganizations.js");
let tasks: typeof import("../src/services/actionTasks.js");
let cleaning: typeof import("../src/services/cleaningTasks.js");
let projection: typeof import("../src/services/planningInterventions.js");
let context: typeof import("../src/services/organizationContext.js");
let period: any;
let config: any;
const scoped = (fn: () => Promise<void>) =>
  context.runWithOrganization({ organizationId: org, source: "test" }, fn);
const at = (day: string) => new Date(day + "T00:00:00Z");

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `file:${temp}/test.db`,
    DATABASE_URL_SQLITE: `file:${temp}/test.db`,
    DATA_DIR: `${temp}/data`,
  });
  const root = process.cwd().endsWith("/server")
    ? process.cwd()
    : path.join(process.cwd(), "server");
  fs.writeFileSync(path.join(temp, "test.db"), "");
  const migrated = spawnSync(
    process.execPath,
    ["scripts/prisma.mjs", "migrate", "deploy"],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  db = await import("../src/db/prisma.js");
  plans = await import("../src/services/planningOrganizations.js");
  tasks = await import("../src/services/actionTasks.js");
  cleaning = await import("../src/services/cleaningTasks.js");
  projection = await import("../src/services/planningInterventions.js");
  context = await import("../src/services/organizationContext.js");
  await db.systemPrisma.organization.create({
    data: { id: org, slug: org, name: "Planning test" },
  });
  await scoped(async () => {
    for (const id of ["a", "b"]) {
      await db.default.gite.create({
        data: {
          id,
          nom: `Gîte ${id}`,
          prefixe_contrat: id,
          adresse_ligne1: "Adresse",
          capacite_max: 2,
          proprietaires_noms: "Test",
          proprietaires_adresse: "Adresse",
          telephones: "",
          taxe_sejour_par_personne_par_nuit: 0,
          iban: "",
          titulaire: "Test",
          options_menage_forfait: 45,
        },
      });
      await db.default.planningRelayWorker.create({
        data: { id: `w-${id}`, nom: id, telephone: "+33600000000" },
      });
      await db.default.appUser.create({
        data: {
          id: `u-${id}`,
          display_name: id,
          intervenant_id: `w-${id}`,
          status: "worker",
        },
      });
    }
    for (const [id, gite, entry, exit, nights] of [
      ["r1", "a", "2027-05-04", "2027-05-10", 6],
      ["r2", "a", "2027-05-10", "2027-05-15", 5],
      ["r3", "b", "2027-05-06", "2027-05-09", 3],
      ["r4", "b", "2027-05-11", "2027-05-18", 7],
    ] as const)
      await db.default.reservation.create({
        data: {
          id,
          gite_id: gite,
          hote_nom: "Client " + id,
          telephone: "secret-phone",
          commentaire: "secret-comment",
          date_entree: at(entry),
          date_sortie: at(exit),
          nb_nuits: nights,
          nb_adultes: 2,
          prix_par_nuit: 100,
          prix_total: nights * 100,
        },
      });
    const { planningOrganizationSchema } = await import("@contrats/shared");
    config = planningOrganizationSchema.parse({
      version: 1,
      enabled: true,
      audience: "individual",
      missions: [
        {
          id: "basket",
          kind: "task",
          title: "Panier",
          trigger: "arrival",
          minimum_nights: 5,
          assignees: { a: "u-a", b: "u-b" },
          rates: { a: 12, b: 18 },
        },
        {
          id: "clean",
          kind: "cleaning",
          title: "Ménage",
          trigger: "departure",
          minimum_nights: null,
          assignees: { a: "u-b", b: "u-b" },
          rates: { a: 50, b: 55 },
        },
      ],
    });
    period = await db.default.planningRelayPeriod.create({
      data: {
        id: "period-a",
        label: "Paniers et relais",
        date_debut: at("2027-05-01"),
        date_fin: at("2027-05-20"),
        gite_ids: '["a","b"]',
        organization_config: JSON.stringify(config),
        share_nonce: "test-nonce",
        show_intervention_prices: true,
      },
    });
    await plans.syncPlanningTemplates(period);
  });
});
after(async () => {
  if (db) await db.systemPrisma.$disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
});

test("un panier par séjour éligible, tarifs par gîte, ménage distinct et liens individuels", () =>
  scoped(async () => {
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    const occurrences = await db.default.actionTask.findMany({
      orderBy: { starts_at: "asc" },
    });
    assert.equal(occurrences.length, 3);
    assert.deepEqual(
      occurrences.map((row) => Number(row.compensation_amount)),
      [12, 12, 18],
    );
    await cleaning.syncCleaningTasks("2027-05-01", "2027-05-20");
    const rows = await projection.loadPlanningInterventions(period);
    assert.equal(
      rows.filter((row) => row.date === "2027-05-10" && row.gite_id === "a")
        .length,
      2,
    );
    assert.ok(rows.every((row) => row.phone === null && row.comment === null));
    const own = await projection.loadPlanningInterventions(period, "w-a");
    assert.equal(own.length, 2);
    assert.ok(
      own.every((row) => row.kind === "task" && row.worker_id === "w-a"),
    );
    const url = new URL(
      projection.planningPublicPath(period, "w-a"),
      "https://example.test",
    );
    assert.ok(
      projection.planningAudienceIsValid(
        period.share_nonce,
        "w-a",
        url.searchParams.get("key"),
      ),
    );
    assert.equal(
      projection.planningAudienceIsValid(
        period.share_nonce,
        "all",
        url.searchParams.get("key"),
      ),
      false,
    );
    assert.equal(
      projection.planningAudienceIsValid(
        "rotated",
        "w-a",
        url.searchParams.get("key"),
      ),
      false,
    );
    const html = projection.planningDocumentHtml(
      "<script>test</script>",
      "2027-05-01",
      "2027-05-20",
      rows,
      url.toString(),
      true,
    );
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("Total prévisionnel"));
  }));

test("déplacer, rendre inéligible ou annuler un séjour ajuste les occurrences sans doublons", () =>
  scoped(async () => {
    await db.default.reservation.update({
      where: { id: "r1" },
      data: { date_entree: at("2027-05-05") },
    });
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    const moved = await db.default.actionTask.findFirstOrThrow({
      where: { reservation_id: "r1" },
    });
    assert.equal(moved.starts_at.toISOString().slice(0, 10), "2027-05-05");
    await db.default.reservation.update({
      where: { id: "r1" },
      data: { nb_nuits: 4 },
    });
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    assert.equal(
      await db.default.actionTask.count({ where: { reservation_id: "r1" } }),
      0,
    );
    await db.default.reservation.delete({ where: { id: "r4" } });
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    assert.equal(
      await db.default.actionTask.count({ where: { reservation_id: "r4" } }),
      0,
    );
    const retained = await db.default.actionTask.findFirstOrThrow({
      where: { reservation_id: "r2" },
    });
    await db.default.actionTask.update({
      where: { id: retained.id },
      data: { status: "done" },
    });
    config.missions[0].rates.a = 99;
    period = await db.default.planningRelayPeriod.update({
      where: { id: period.id },
      data: { organization_config: JSON.stringify(config) },
    });
    await plans.syncPlanningTemplates(period);
    await tasks.syncActionTasks("2027-05-01", "2027-05-20");
    assert.equal(
      Number(
        (
          await db.default.actionTask.findUniqueOrThrow({
            where: { id: retained.id },
          })
        ).compensation_amount,
      ),
      12,
    );
  }));

test("un remplacement respecte les corrections manuelles, conserve le tarif et rend l’attribution habituelle à la pause", () =>
  scoped(async () => {
    const rows = await db.default.cleaningTask.findMany();
    const manual = rows.find((row) => row.gite_id === "a")!;
    const regular = rows.find((row) => row.gite_id === "b")!;
    await db.default.cleaningTask.update({
      where: { id: manual.id },
      data: {
        assignee_id: "u-a",
        assignment_source: "manual",
        amount_snapshot: null,
      },
    });
    await cleaning.syncCleaningTasks("2027-05-01", "2027-05-20");
    assert.equal(
      (
        await db.default.cleaningTask.findUniqueOrThrow({
          where: { id: manual.id },
        })
      ).assignee_id,
      "u-a",
    );
    assert.equal(
      (
        await db.default.cleaningTask.findUniqueOrThrow({
          where: { id: regular.id },
        })
      ).amount_snapshot,
      55,
    );
    await assert.rejects(
      plans.validatePlanningOrganization(
        config,
        ["a"],
        "2027-05-02",
        "2027-05-10",
        "other-period",
      ),
    );
    config.enabled = false;
    await db.default.planningRelayPeriod.update({
      where: { id: period.id },
      data: { organization_config: JSON.stringify(config) },
    });
    await plans.applyPlanningCleaningAssignments("2027-05-01", "2027-05-20");
    assert.equal(
      (
        await db.default.cleaningTask.findUniqueOrThrow({
          where: { id: regular.id },
        })
      ).assignee_id,
      null,
    );
    assert.equal(
      (
        await db.default.cleaningTask.findUniqueOrThrow({
          where: { id: manual.id },
        })
      ).assignee_id,
      "u-a",
    );
  }));

test("le lien public ne permet pas de retirer ou changer le destinataire ; le PDF est réellement généré", () =>
  scoped(async () => {
    const express = (await import("express")).default;
    const { publicPlanningRelayRouter } =
      await import("../src/routes/planningRelayPeriods.js");
    const { buildPlanningRelayShortCode, hashPlanningRelayShortCode } =
      await import("../src/services/planningRelayShare.js");
    const code = buildPlanningRelayShortCode(period.share_nonce);
    period = await db.default.planningRelayPeriod.update({
      where: { id: period.id },
      data: { public_code_hash: hashPlanningRelayShortCode(code) },
    });
    const app = express();
    app.use((_req, _res, next) =>
      context.runWithOrganization(
        { organizationId: org, source: "test" },
        next,
      ),
    );
    app.use("/api/public/planning-relay", publicPlanningRelayRouter);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.on("listening", resolve));
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const path = projection
        .planningPublicPath(period, "w-a")
        .replace("/r/", "/api/public/planning-relay/");
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      const json = (await response.json()) as any;
      assert.ok(
        json.interventions.every((row: any) => row.worker_id === "w-a"),
      );
      assert.equal(
        (await fetch(origin + `/api/public/planning-relay/${code}`)).status,
        404,
      );
      assert.equal(
        (await fetch(origin + path.replace("audience=w-a", "audience=all")))
          .status,
        404,
      );
      const { generatePlanningPdf, closeBrowser } =
        await import("../src/services/pdfService.js");
      try {
        const html = projection.planningDocumentHtml(
          "Planning test",
          "2027-05-01",
          "2027-05-20",
          json.interventions,
          origin + path,
          true,
        );
        const buffer = await generatePlanningPdf(html);
        assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
        assert.ok(buffer.length > 5000);
      } finally {
        await closeBrowser();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }));

test("les rappels reprennent seulement le destinataire en échec et restent distincts de l’activation du lien", () =>
  scoped(async () => {
    const { runPlanningRelaySmsSchedule } =
      await import("../src/services/planningRelaySms.js");
    const { smsMessageChannel } =
      await import("../src/services/messageChannels/sms.js");
    await (
      await import("../src/services/installationConfig.js")
    ).saveModuleSettings({ sms: true, worker_planning: true });
    const originalSend = smsMessageChannel.send;
    const sent: string[] = [];
    let failing = true;
    try {
      await db.default.reservation.create({
        data: {
          id: "r5",
          gite_id: "b",
          hote_nom: "Autre client",
          date_entree: at("2027-05-10"),
          date_sortie: at("2027-05-17"),
          nb_nuits: 7,
          nb_adultes: 2,
          prix_par_nuit: 100,
          prix_total: 700,
        },
      });
      await db.default.planningRelayWorker.update({
        where: { id: "w-b" },
        data: { telephone: "+33600000001" },
      });
      config.enabled = true;
      period = await db.default.planningRelayPeriod.update({
        where: { id: period.id },
        data: {
          organization_config: JSON.stringify(config),
          is_active: false,
          public_origin: "https://example.test",
          sms_configs: JSON.stringify([
            {
              id: "schedule",
              worker_ids: ["w-a", "w-b"],
              worker_id: "w-a",
              channel: "sms",
              enabled: true,
              send_time: "18:00",
              send_day: "previous_day",
              template: "{{programme}} {{lien}}",
            },
          ]),
        },
      });
      await plans.syncPlanningTemplates(period);
      smsMessageChannel.send = async (request) => {
        const recipient = request.recipients![0];
        if (recipient.endsWith("1") && failing) throw new Error("Échec simulé");
        sent.push(recipient);
        return {
          channel: "sms",
          sent_count: 1,
          skipped_reason: null,
          deliveries: [{ recipient, provider: "test" }],
        };
      };
      await runPlanningRelaySmsSchedule(new Date("2027-05-09T16:00:00Z"));
      assert.equal(sent.length, 1);
      failing = false;
      await runPlanningRelaySmsSchedule(new Date("2027-05-09T16:02:00Z"));
      assert.equal(sent.length, 1);
      await runPlanningRelaySmsSchedule(new Date("2027-05-09T16:06:00Z"));
      assert.equal(sent.length, 2);
      await runPlanningRelaySmsSchedule(new Date("2027-05-09T16:10:00Z"));
      assert.equal(sent.length, 2);
      const stored = await db.default.planningRelayPeriod.findUniqueOrThrow({
        where: { id: period.id },
      });
      const state = JSON.parse(stored.sms_configs)[0].delivery_state;
      assert.equal(state["w-a"].attempts, 1);
      assert.equal(state["w-b"].attempts, 2);
      assert.equal(state["w-a"].status, "sent");
      assert.equal(state["w-b"].status, "sent");
    } finally {
      smsMessageChannel.send = originalSend;
    }
  }));
