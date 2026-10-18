import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  SuperPdpWorkshop,
  type WorkshopRepository,
} from "../src/modules/superpdp/workshop.js";
import {
  SuperPdpTransport,
  type RemoteInvoice,
  type Validation,
} from "../src/modules/superpdp/transport.js";
import { SuperPdpService } from "../src/modules/superpdp/service.js";
import { checksum } from "../src/modules/superpdp/sandboxRecipe.js";
import { runWithOrganization } from "../src/modules/organizations/context.js";
import { workshopDocument } from "../src/modules/superpdp/workshopDocument.js";
import { buildInvoiceHtml } from "../src/services/pdfService.js";

const actor = { userId: "owner-test", sessionHash: "session-test" };
const within = <T>(work: () => T, org = "org-workshop") =>
  runWithOrganization({ organizationId: org, source: "test" }, work);
const binding = {
  organizationId: "org-workshop",
  sender: {
    entityId: "seller",
    connectionId: "sender-connection",
    companyId: "114214",
    number: "000000002" as const,
    address: "0225:315143296_114214",
  },
  recipient: {
    entityId: "buyer",
    connectionId: "buyer-connection",
    companyId: "114213",
    number: "000000001" as const,
    address: "0225:315143296_114213",
  },
};
class Transport extends SuperPdpTransport {
  sendCount = 0;
  failSend = false;
  badDirectory = false;
  badValidation = false;
  partial = false;
  payloads: string[] = [];
  calls: string[] = [];
  remote = new Map<string, { invoice: RemoteInvoice; pdf: Buffer }>();
  async directory(token: string) {
    this.calls.push("directory");
    return {
      data: [binding.sender, binding.recipient].map((party) => ({
        company: { id: party.companyId },
        identifier: this.badDirectory ? "other:address" : party.address,
        status: "created",
      })),
    };
  }
  async convert(payload: string, _pdf: Buffer) {
    this.calls.push("convert");
    this.payloads.push(payload);
    return Buffer.from(`%PDF-SIMULATED-${checksum(payload)}`);
  }
  async validate(pdf: Buffer): Promise<Validation> {
    this.calls.push("validate");
    return {
      data: [
        {
          file_name: "invoice.pdf",
          file_size: pdf.length,
          is_valid: !this.badValidation,
          format: "factur-x",
          conformance_level: "urn:cen.eu:en16931:2017",
          subreports: [
            {
              validator: "simulated",
              checks_count: 191,
              failures: this.badValidation
                ? [{ message: "test rejection" }]
                : [],
              messages: [],
            },
          ],
        },
      ],
    };
  }
  async send(
    _token: string,
    pdf: Buffer,
    id: string,
    rule: "B2B" | "B2C" = "B2B",
  ) {
    this.sendCount++;
    this.calls.push("send");
    const invoice: RemoteInvoice = {
      id: String(9000 + this.sendCount),
      company_id: binding.sender.companyId,
      direction: "out",
      external_id: id,
      processing_rule: rule,
    };
    this.remote.set(id, { invoice, pdf });
    if (this.failSend) throw new Error("PRIVATE_REMOTE_ERROR");
    return invoice;
  }
  async list(_token: string, _cursor: string | null) {
    return {
      data: [...this.remote.values()].map((row) => row.invoice),
      has_after: this.partial,
    };
  }
  async incomingOriginal(_token: string, id: string) {
    const row = [...this.remote.values()].find((row) => row.invoice.id === id)!;
    return {
      contents: row.pdf,
      contentType: "application/pdf" as const,
      extension: "pdf" as const,
    };
  }
  async events(_token: string, id: string, _cursor: string | null) {
    return {
      data: [
        {
          id: "99000",
          invoice_id: id,
          status_code: "fr:202",
          status_text: "Reçue (simulé)",
          created_at: "2026-10-18T10:00:00Z",
        },
      ],
      has_after: false,
    };
  }
}
function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "contrats-workshop-test-"),
  );
  const transport = new Transport();
  let available = true,
    sourceTotal = 420;
  const repo: WorkshopRepository = {
    async binding() {
      return structuredClone(binding);
    },
    async sources() {
      return [
        {
          reservationId: "source-a",
          label: "Gîte test · séjour test",
          total: sourceTotal,
        },
      ];
    },
    async source(id) {
      if (id !== "source-a") throw new Error("not found");
      return (await this.sources())[0];
    },
  };
  const oauth = {
    async withSandboxAccess(
      entity: string,
      expected: { connectionId: string; companyId: string },
      _actor: unknown,
      work: (token: string) => Promise<unknown>,
    ) {
      const party = [binding.sender, binding.recipient].find(
        (p) => p.entityId === entity,
      )!;
      assert.equal(expected.companyId, party.companyId);
      assert.equal(expected.connectionId, party.connectionId);
      return work("fake-token-never-saved");
    },
  } as unknown as SuperPdpService;
  const render = async () => Buffer.from("%PDF-SIMULATED-NATIVE");
  const service = new SuperPdpWorkshop(
    root,
    repo,
    oauth,
    transport,
    () => available,
    render,
  );
  const recreate = () =>
    new SuperPdpWorkshop(root, repo, oauth, transport, () => available, render);
  const folder = (id: string) =>
    path.join(root, checksum(binding.organizationId), id);
  return {
    service,
    transport,
    root,
    recreate,
    folder,
    setAvailable: (v: boolean) => {
      available = v;
    },
    setTotal: (v: number) => {
      sourceTotal = v;
    },
  };
}
async function draft(f: ReturnType<typeof fixture>) {
  await f.service.activate(actor, { confirm_local_test_data: true });
  return f.service.create(
    { reservation_id: "source-a", confirm_anonymized_copy: true },
    actor,
  );
}
async function issued(f: ReturnType<typeof fixture>) {
  let row = await draft(f);
  row = await f.service.save(
    row.id,
    { revision: row.revision, rates: [20], reviewed: true },
    actor,
  );
  return f.service.issue(row.id, { revision: row.revision }, actor);
}
async function ready(f: ReturnType<typeof fixture>) {
  const row = await issued(f);
  return f.service.prepare(row.id, { revision: row.revision }, actor);
}
const sendBody = (row: Awaited<ReturnType<typeof ready>>) => ({
  revision: row.revision,
  confirm_test_send: true,
  reviewed_sha256: row.artifactSha,
});

test("création explicite et copie anonymisée figée, sans appel fournisseur ni identité client", () =>
  within(async () => {
    const f = fixture();
    assert.equal((await f.service.overview(actor)).active, false);
    await assert.rejects(
      f.service.create(
        { reservation_id: "source-a", confirm_anonymized_copy: true },
        actor,
      ),
    );
    assert.throws(() =>
      f.service.activate(actor, { confirm_local_test_data: false }),
    );
    let row = await draft(f);
    assert.equal(row.source.total, 420);
    assert.equal(row.input.buyer.siren, "000000001");
    assert.equal(row.input.lines[0].vat_category, "unknown");
    assert.equal(row.input.reviewed, false);
    f.setTotal(999);
    assert.equal(f.service.view(row.id).source.total, 420);
    assert.equal(f.transport.calls.length, 0);
    assert.equal("boot" in row, false);
    await assert.rejects(
      f.service.save(
        row.id,
        {
          revision: row.revision,
          rates: [20],
          reviewed: true,
          buyer: { siren: "732829320" },
        },
        actor,
      ),
    );
    assert.equal(
      (await within(() => f.service.overview(actor), "other-org")).runs.length,
      0,
    );
    assert.throws(() => within(() => f.service.view(row.id), "other-org"));
    await assert.rejects(
      f.service.create(
        { reservation_id: "foreign", confirm_anonymized_copy: true },
        actor,
      ),
    );
    f.setAvailable(false);
    await assert.rejects(
      f.service.issue(row.id, { revision: row.revision }, actor),
    );
  }));

test("l’émission exige vérification et révision fraîche ; le PDF et les données sont immuables", () =>
  within(async () => {
    const f = fixture();
    let row = await draft(f);
    await assert.rejects(
      f.service.issue(row.id, { revision: row.revision }, actor),
    );
    const saved = await f.service.save(
      row.id,
      { revision: row.revision, rates: [10], reviewed: false },
      actor,
    );
    await assert.rejects(
      f.service.issue(row.id, { revision: saved.revision }, actor),
    );
    await assert.rejects(
      f.service.save(
        row.id,
        { revision: row.revision, rates: [20], reviewed: true },
        actor,
      ),
    );
    row = await f.service.save(
      row.id,
      { revision: saved.revision, rates: [10], reviewed: true },
      actor,
    );
    row = await f.service.issue(row.id, { revision: row.revision }, actor);
    assert.equal(row.status, "issued");
    assert.equal(
      row.nativeSha,
      checksum(await f.service.artifact(row.id, "native")),
    );
    await assert.rejects(
      f.service.save(
        row.id,
        { revision: row.revision, rates: [20], reviewed: true },
        actor,
      ),
    );
    await assert.rejects(
      f.service.issue(row.id, { revision: row.revision }, actor),
    );
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(f.folder(row.id), "snapshot.json"), "utf8"),
    );
    assert.equal(snapshot.totals.total_with_vat, "420.00");
    assert.equal(snapshot.type_code, 380);
    assert.equal(snapshot.seller.name, "Burger Queen");
    assert.equal(snapshot.buyer.name, "Tricatel");
    assert.equal("identifiers" in snapshot.seller, false);
    assert.equal(f.transport.sendCount, 0);
  }));

test("la préparation bloque les annuaires inattendus, les rapports négatifs et les PDF altérés", () =>
  within(async () => {
    for (const mode of ["badDirectory", "badValidation", "altered"]) {
      const f = fixture();
      const row = await issued(f);
      if (mode === "altered")
        fs.writeFileSync(
          path.join(f.folder(row.id), "native.pdf"),
          "%PDF-ALTERED",
        );
      else f.transport[mode] = true;
      const result = await f.service.prepare(
        row.id,
        { revision: row.revision },
        actor,
      );
      assert.equal(result.status, "prepare_failed");
      assert.equal(result.artifactSha, null);
      assert.equal(f.transport.sendCount, 0);
      await assert.rejects(f.service.send(result.id, sendBody(result), actor));
    }
  }));

test("envoi unique malgré concurrence, contrôles juste avant le POST et suivi sans renvoi", () =>
  within(async () => {
    const f = fixture();
    const row = await ready(f);
    assert.equal(row.validation?.checks, 191);
    await assert.rejects(
      f.service.send(
        row.id,
        { ...sendBody(row), reviewed_sha256: "0".repeat(64) },
        actor,
      ),
    );
    await assert.rejects(
      f.service.send(
        row.id,
        { ...sendBody(row), confirm_test_send: false },
        actor,
      ),
    );
    f.transport.badValidation = true;
    await assert.rejects(f.service.send(row.id, sendBody(row), actor));
    assert.equal(f.transport.sendCount, 0);
    f.transport.badValidation = false;
    const attempts = await Promise.allSettled([
      f.service.send(row.id, sendBody(row), actor),
      f.service.send(row.id, sendBody(row), actor),
    ]);
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(f.transport.sendCount, 1);
    assert.equal(f.service.view(row.id).status, "submitted");
    const sync = await f.service.sync(row.id, actor);
    assert.equal(sync.events[0].code, "fr:202");
    await assert.rejects(f.service.send(row.id, sendBody(sync), actor));
    assert.equal(f.transport.sendCount, 1);
    const files = fs
      .readdirSync(f.folder(row.id))
      .filter((x) => x.endsWith(".json"))
      .map((name) => fs.readFileSync(path.join(f.folder(row.id), name), "utf8"))
      .join("");
    assert.ok(!files.includes("fake-token-never-saved"));
  }));

test("un résultat inconnu est conservé sans fuite, sans renvoi, et réconciliable en lecture seule", () =>
  within(async () => {
    const f = fixture();
    const row = await ready(f);
    f.transport.failSend = true;
    const unknown = await f.service.send(row.id, sendBody(row), actor);
    assert.equal(unknown.status, "send_unknown");
    assert.equal(unknown.hasSendIntent, true);
    await assert.rejects(f.service.send(row.id, sendBody(unknown), actor));
    const restarted = f.recreate();
    await restarted.activate(actor, { confirm_local_test_data: true });
    assert.equal(restarted.view(row.id).writable, false);
    await assert.rejects(restarted.send(row.id, sendBody(unknown), actor));
    const synced = await restarted.sync(row.id, actor);
    assert.equal(synced.status, "submitted");
    assert.equal(synced.writable, false);
    assert.equal(f.transport.sendCount, 1);
    const files = fs
      .readdirSync(f.folder(row.id))
      .filter((x) => x.endsWith(".json"))
      .map((name) => fs.readFileSync(path.join(f.folder(row.id), name), "utf8"))
      .join("");
    assert.ok(!files.includes("PRIVATE_REMOTE_ERROR"));
  }));

test("restauration d’un journal antérieur dans le même processus : aucun réarmement", () =>
  within(async () => {
    const f = fixture();
    const row = await ready(f);
    const directory = f.folder(row.id);
    const prior = new Map(
      fs
        .readdirSync(directory)
        .map((name) => [name, fs.readFileSync(path.join(directory, name))]),
    );
    await f.service.send(row.id, sendBody(row), actor);
    for (const name of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, name));
    for (const [name, bytes] of prior)
      fs.writeFileSync(path.join(directory, name), bytes);
    assert.equal(f.service.view(row.id).writable, false);
    assert.equal(f.service.view(row.id).hasSendIntent, true);
    await assert.rejects(f.service.send(row.id, sendBody(row), actor));
    assert.equal(f.transport.sendCount, 1);
  }));

test("avoir intégral distinct, un seul par source, figé avec référence et mêmes taux/montants", () =>
  within(async () => {
    const f = fixture();
    const original = await ready(f);
    await assert.rejects(
      f.service.credit(original.id, { revision: original.revision }, actor),
    );
    const sent = await f.service.send(original.id, sendBody(original), actor);
    const attempts = await Promise.allSettled([
      f.service.credit(sent.id, { revision: sent.revision }, actor),
      f.service.credit(sent.id, { revision: sent.revision }, actor),
    ]);
    const credits = attempts.filter(
      (x): x is PromiseFulfilledResult<ReturnType<typeof f.service.view>> =>
        x.status === "fulfilled",
    );
    assert.equal(credits.length, 1);
    let credit = credits[0].value;
    assert.equal(credit.original?.number, sent.number);
    assert.equal(credit.kind, "credit_note");
    assert.equal(credit.input.lines[0].vat_rate, 20);
    assert.notEqual(credit.number, sent.number);
    await assert.rejects(
      f.service.save(
        credit.id,
        { revision: credit.revision, rates: [10], reviewed: true },
        actor,
      ),
    );
    credit = await f.service.save(
      credit.id,
      { revision: credit.revision, rates: [20], reviewed: true },
      actor,
    );
    credit = await f.service.issue(
      credit.id,
      { revision: credit.revision },
      actor,
    );
    const payload = JSON.parse(
      fs.readFileSync(path.join(f.folder(credit.id), "snapshot.json"), "utf8"),
    );
    assert.equal(payload.type_code, 381);
    assert.equal(payload.totals.total_with_vat, "420.00");
    assert.equal(
      payload.preceding_invoice_references[0].reference,
      sent.number,
    );
    const full = JSON.parse(
      fs.readFileSync(
        path.join(
          f.folder(credit.id),
          `state-${String(credit.revision).padStart(4, "0")}.json`,
        ),
        "utf8",
      ),
    );
    const html = await buildInvoiceHtml(workshopDocument(full).render);
    assert.ok(html.includes("AVOIR TEST"));
    assert.ok(html.includes("-420,00"));
    credit = await f.service.prepare(
      credit.id,
      { revision: credit.revision },
      actor,
    );
    credit = await f.service.send(credit.id, sendBody(credit), actor);
    assert.equal(credit.status, "submitted");
    assert.equal(f.transport.sendCount, 2);
    assert.equal(f.service.view(sent.id).artifactSha, sent.artifactSha);
    // Even restoring/removing the source marker in the same process must not
    // reserve a second full credit. New processes reject the old boot instead.
    fs.unlinkSync(path.join(f.folder(sent.id), "credit-created.json"));
    assert.equal(f.service.view(sent.id).hasCredit, true);
    await assert.rejects(
      f.service.credit(sent.id, { revision: sent.revision }, actor),
    );
    await assert.rejects(
      f.service.credit(credit.id, { revision: credit.revision }, actor),
    );
  }));
