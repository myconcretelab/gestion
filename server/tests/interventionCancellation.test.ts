import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(path.join(os.tmpdir(), "intervention-cancellation-"));
const org = "org_cancellation_test";
let db: typeof import("../src/db/prisma.js");
let context: typeof import("../src/services/organizationContext.js");
let service: typeof import("../src/services/interventionCancellation.js");
const inOrg = <T>(fn: () => T, organizationId = org) => context.runWithOrganization({ organizationId, source: "test" }, fn);
const checkedAt = new Date("2026-11-01T11:00:00Z");
const actor = { userId: "admin-test", requestId: "request-test" };

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: `file:${temp}/test.db`, DATABASE_URL_SQLITE: `file:${temp}/test.db`, DATA_DIR: temp, BOOTSTRAP_ADMIN_LOGIN: "", BOOTSTRAP_ADMIN_PASSWORD: "", BASIC_AUTH_PASSWORD: "" });
  writeFileSync(`${temp}/test.db`, "");
  const result = spawnSync(process.execPath, ["scripts/prisma.mjs", "migrate", "deploy"], {
    cwd: process.cwd().endsWith("/server") ? process.cwd() : path.join(process.cwd(), "server"), env: process.env, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  db = await import("../src/db/prisma.js");
  context = await import("../src/services/organizationContext.js");
  service = await import("../src/services/interventionCancellation.js");
  await db.systemPrisma.organization.create({ data: { id: org, slug: org, name: "Annulation test" } });
});
after(async () => { await db?.systemPrisma.$disconnect(); rmSync(temp, { recursive: true, force: true }); });

const fixture = async (options: { completedBefore?: boolean; paidCleaning?: boolean; manual?: boolean } = {}) => {
  const gite = await db.default.gite.create({ data: {
    nom: "Tante Phonsine", prefixe_contrat: randomUUID(), adresse_ligne1: "Test", capacite_max: 4,
    proprietaires_noms: "Test", proprietaires_adresse: "Test", telephones: "", taxe_sejour_par_personne_par_nuit: 0,
    iban: "", titulaire: "Test", arrhes_taux_defaut: .2,
  } });
  const stay = (from: string, to: string) => db.default.reservation.create({ data: {
    gite_id: gite.id, hote_nom: "Test", date_entree: new Date(from), date_sortie: new Date(to), nb_nuits: 3,
    nb_adultes: 2, prix_par_nuit: 100, prix_total: 300, source_paiement: "Direct", booking_source: "Direct",
  } });
  const departure = await stay("2026-10-29", "2026-11-01");
  const arrival = await stay("2026-11-02", "2026-11-05");
  await db.default.reservation.update({ where: { id: departure.id }, data: { departure_cleaning_checked_at: checkedAt } });
  await db.default.reservation.update({ where: { id: arrival.id }, data: { arrival_cleaning_checked_at: checkedAt, departure_cleaning_checked_at: new Date("2026-11-05T12:00:00Z") } });
  const task = await db.default.cleaningTask.create({ data: {
    gite_id: gite.id, departure_reservation_id: departure.id, arrival_reservation_id: arrival.id,
    status: "verified", starts_at: new Date("2026-11-01T09:00:00Z"), completed_at: options.completedBefore ? new Date("2026-11-01T10:00:00Z") : checkedAt,
    checked_at: checkedAt, note: "Ne pas perdre cette note",
  } });
  const entryData = { user_name: "Soazig", occurred_on: "2026-11-01", gite_id: gite.id, gite_name: gite.nom, reservation_id: departure.id };
  const check = await db.default.userIntervention.create({ data: { ...entryData, kind: "cleaning_check", source_key: `cleaning-check:${departure.id}`, amount_snapshot: 15 } });
  const cleaning = await db.default.userIntervention.create({ data: {
    ...entryData, kind: "full_cleaning", source_key: `full-cleaning:${departure.id}`, amount_snapshot: 55,
    automatic: !options.manual, paid_at: options.paidCleaning ? checkedAt : null,
  } });
  return { gite, departure, arrival, task, check, cleaning };
};
const cancel = async (entry: { id: string; updatedAt: Date }) => {
  const preview = await service.previewInterventionCancellation(entry.id);
  return service.cancelIntervention(entry.id, { reason: "Clic par erreur", expectedUpdatedAt: entry.updatedAt.toISOString(), fingerprint: preview.fingerprint }, actor);
};

test("un contrôle accidentel retire les forfaits liés et restaure le gîte, l’arrivée et le ménage en une opération journalisée", () => inOrg(async () => {
  const f = await fixture();
  const preview = await service.previewInterventionCancellation(f.check.id);
  assert.equal(preview.amount, 70);
  assert.equal(preview.entries.length, 2);
  const result = await cancel(f.check);
  assert.deepEqual(new Set(result.removed_ids), new Set([f.check.id, f.cleaning.id]));
  const departure = await db.default.reservation.findUniqueOrThrow({ where: { id: f.departure.id } });
  const arrival = await db.default.reservation.findUniqueOrThrow({ where: { id: f.arrival.id } });
  const task = await db.default.cleaningTask.findUniqueOrThrow({ where: { id: f.task.id } });
  assert.equal(departure.departure_cleaning_checked_at, null);
  assert.equal(arrival.arrival_cleaning_checked_at, null);
  assert.equal(arrival.departure_cleaning_checked_at?.toISOString(), "2026-11-05T12:00:00.000Z");
  assert.equal(task.status, "planned");
  assert.equal(task.completed_at, null);
  assert.equal(task.checked_at, null);
  assert.equal(task.note, f.task.note);
  const audit = await db.default.auditLog.findFirstOrThrow({ where: { action: "user_intervention.cancelled", resource_id: f.check.id } });
  const metadata = JSON.parse(audit.metadata_json);
  assert.equal(audit.user_id, actor.userId);
  assert.equal(metadata.reason, "Clic par erreur");
  assert.equal(metadata.before.entries.length, 2);
  assert.equal(metadata.before.cleaning_task.status, "verified");
  await assert.rejects(() => cancel(f.check), { status: 404 });
}));

test("un contrôle annulé conserve un ménage déjà effectué et sa rémunération, même payée", () => inOrg(async () => {
  const f = await fixture({ completedBefore: true, paidCleaning: true });
  assert.equal((await service.previewInterventionCancellation(f.check.id)).amount, 15);
  await cancel(f.check);
  assert.ok(await db.default.userIntervention.findUnique({ where: { id: f.cleaning.id } }));
  const task = await db.default.cleaningTask.findUniqueOrThrow({ where: { id: f.task.id } });
  assert.equal(task.status, "done");
  assert.equal(task.completed_at?.toISOString(), "2026-11-01T10:00:00.000Z");
}));

test("une validation directe nouvelle retrouve précisément le ménage en cours grâce à l’état mémorisé", () => inOrg(async () => {
  const f = await fixture();
  await db.default.reservation.update({ where: { id: f.departure.id }, data: { departure_cleaning_checked_at: null } });
  await db.default.cleaningTask.update({ where: { id: f.task.id }, data: { status: "in_progress", completed_at: null, checked_at: null } });
  const { updateGiteCleaningReadiness } = await import("../src/services/giteCleaningReadiness.js");
  await updateGiteCleaningReadiness({
    gite_id: f.gite.id, gite_name: f.gite.nom, gite_prefix: "TP", gite_order: 1,
    departure_reservation_id: f.departure.id, departure_date: "2026-11-01", next_arrival_reservation_id: f.arrival.id,
    next_arrival_date: "2026-11-02", departure_has_cleaning_option: false, checked_at: null, checked_by_user_id: null, checked_by_name: null,
  }, true, null, checkedAt);
  await db.default.cleaningTask.update({ where: { id: f.task.id }, data: { status: "verified", completed_at: checkedAt, checked_at: checkedAt } });
  await cancel(f.check);
  assert.equal((await db.default.cleaningTask.findUniqueOrThrow({ where: { id: f.task.id } })).status, "in_progress");
  assert.ok(await db.default.userIntervention.findUnique({ where: { id: f.cleaning.id } }));
}));

test("un forfait lié payé bloque l’annulation sans changer le gîte", () => inOrg(async () => {
  const f = await fixture({ paidCleaning: true });
  await assert.rejects(() => cancel(f.check), /intervention liée est déjà payée/);
  assert.ok((await db.default.reservation.findUniqueOrThrow({ where: { id: f.departure.id } })).departure_cleaning_checked_at);
  assert.equal(await db.default.userIntervention.count({ where: { id: { in: [f.check.id, f.cleaning.id] } } }), 2);
}));

test("une modification après l’aperçu bloque l’annulation et préserve toutes les lignes", () => inOrg(async () => {
  const f = await fixture();
  const preview = await service.previewInterventionCancellation(f.check.id);
  await db.default.cleaningTask.update({ where: { id: f.task.id }, data: { note: "Une modification récente" } });
  await assert.rejects(() => service.cancelIntervention(f.check.id, { reason: "Clic par erreur", expectedUpdatedAt: f.check.updatedAt.toISOString(), fingerprint: preview.fingerprint }, actor), { status: 409 });
  assert.equal(await db.default.userIntervention.count({ where: { id: { in: [f.check.id, f.cleaning.id] } } }), 2);
}));

test("un échec du journal annule aussi les suppressions et les changements d’état", () => inOrg(async () => {
  const f = await fixture();
  await db.systemPrisma.$executeRawUnsafe(`CREATE TRIGGER fail_cancellation_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'user_intervention.cancelled' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`);
  try {
    await assert.rejects(() => cancel(f.check));
    assert.equal(await db.default.userIntervention.count({ where: { id: { in: [f.check.id, f.cleaning.id] } } }), 2);
    assert.equal((await db.default.cleaningTask.findUniqueOrThrow({ where: { id: f.task.id } })).status, "verified");
    assert.ok((await db.default.reservation.findUniqueOrThrow({ where: { id: f.departure.id } })).departure_cleaning_checked_at);
  } finally { await db.systemPrisma.$executeRawUnsafe("DROP TRIGGER fail_cancellation_audit"); }
}));

test("le retrait d’un ménage manuel ne modifie pas le contrôle et un ménage automatique rouvre sa tâche", () => inOrg(async () => {
  const manual = await fixture({ manual: true });
  await cancel(manual.cleaning);
  assert.ok((await db.default.reservation.findUniqueOrThrow({ where: { id: manual.departure.id } })).departure_cleaning_checked_at);
  const automatic = await fixture();
  await cancel(automatic.cleaning);
  assert.equal((await db.default.cleaningTask.findUniqueOrThrow({ where: { id: automatic.task.id } })).status, "planned");
  assert.equal(await db.default.userIntervention.count({ where: { id: { in: [automatic.check.id, automatic.cleaning.id] } } }), 0);
}));

test("une correction du type affiché ne perd pas le lien avec le contrôle d’origine", () => inOrg(async () => {
  const f = await fixture();
  const corrected = await db.default.userIntervention.update({ where: { id: f.check.id }, data: { kind: "task" } });
  await cancel(corrected);
  assert.equal((await db.default.reservation.findUniqueOrThrow({ where: { id: f.departure.id } })).departure_cleaning_checked_at, null);
}));

test("une tâche au forfait se rouvre et une autre organisation ne peut pas l’annuler", () => inOrg(async () => {
  const task = await db.default.actionTask.create({ data: { gite_id: "gite-test", title: "Savon", status: "done", starts_at: checkedAt, due_at: checkedAt, completed_at: checkedAt, note: "Garder la note" } });
  const entry = await db.default.userIntervention.create({ data: { user_name: "Test", kind: "task", occurred_on: "2026-11-01", amount_snapshot: 5, source_key: `action-task:${task.id}` } });
  await inOrg(async () => { await assert.rejects(() => service.previewInterventionCancellation(entry.id), { status: 404 }); }, "other-org");
  await cancel(entry);
  const reopened = await db.default.actionTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(reopened.status, "planned");
  assert.equal(reopened.completed_at, null);
  assert.equal(reopened.note, task.note);
  assert.equal(reopened.urgency_level, 0);
}));

test("les routes d’aperçu et d’annulation refusent un intervenant et journalisent l’administrateur", () => inOrg(async () => {
  const f = await fixture();
  const { createServerAuthSession } = await import("../src/services/serverAuth.js");
  const worker = await db.default.appUser.create({ data: { display_name: "Test worker", roles: '["worker"]', status: "worker", is_owner: false } });
  const admin = await db.default.appUser.create({ data: { display_name: "Test admin", roles: '["owner"]', status: "owner", is_owner: true } });
  const workerSession = await createServerAuthSession(worker.id);
  const adminSession = await createServerAuthSession(admin.id);
  const { default: router } = await import("../src/routes/userInterventions.js");
  const call = async (route: string, token: string, body?: unknown) => {
    const handler = (router as any).stack.find((layer: any) => layer.route?.path === route).route.stack[0].handle;
    const res = { body: null as any, json(body: unknown) { this.body = body; return this; }, getHeader() { return "route-request"; } };
    let error: any;
    await handler({ headers: { cookie: `contrats_session=${token}` }, params: { id: f.check.id }, body }, res, (value: any) => { error = value; });
    return { body: res.body, error };
  };
  for (const route of ["/:id/cancellation", "/:id/cancel"]) {
    assert.equal((await call(route, workerSession.id)).error?.status, 403);
  }
  const preview = (await call("/:id/cancellation", adminSession.id)).body;
  assert.equal(preview.amount, 70);
  const payload = { reason: "Clic par erreur", expectedUpdatedAt: f.check.updatedAt.toISOString(), fingerprint: preview.fingerprint };
  assert.ok((await call("/:id/cancel", adminSession.id, { ...payload, reason: "" })).error);
  const saved = await call("/:id/cancel", adminSession.id, payload);
  assert.equal(saved.error, undefined);
  assert.equal(saved.body.removed_ids.length, 2);
  assert.equal((await db.default.auditLog.findFirstOrThrow({ where: { resource_id: f.check.id } })).user_id, admin.id);
}));

test("le raccourci Aujourd’hui annule aussi les forfaits, journalise et refuse un contrôle remplacé", () => inOrg(async () => {
  const f = await fixture();
  await db.default.reservation.update({ where: { id: f.arrival.id }, data: { date_entree: new Date("2030-01-01"), date_sortie: new Date("2030-01-05") } });
  const { default: router } = await import("../src/routes/today.js");
  const handler = (router as any).stack.find((layer: any) => layer.route?.path === "/cleaning-readiness/:giteId" && layer.route.methods.put).route.stack[0].handle;
  const call = async (expectedCheckedAt: string) => {
    const res = { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; }, getHeader() { return "request-today"; } };
    let error: unknown;
    await handler({ params: { giteId: f.gite.id }, body: { checked: false, expected_departure_id: f.departure.id, expected_checked_at: expectedCheckedAt } }, res, (value: unknown) => { error = value; });
    assert.equal(error, undefined);
    return res;
  };
  assert.equal((await call("2026-11-01T09:00:00.000Z")).statusCode, 409);
  const saved = await call(checkedAt.toISOString());
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.checked_at, null);
  assert.equal(saved.body.task_status, "planned");
  assert.equal(await db.default.userIntervention.count({ where: { id: { in: [f.check.id, f.cleaning.id] } } }), 0);
  assert.equal(await db.default.auditLog.count({ where: { action: "user_intervention.cancelled", resource_id: f.check.id } }), 1);
}));
