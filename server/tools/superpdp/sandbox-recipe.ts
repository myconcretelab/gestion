/** Deliberately not an HTTP route or worker. See docs/superpdp-sandbox-recipe.md. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { env } from "../../src/config/env.js";
import { systemPrisma as db } from "../../src/db/prisma.js";
import { runWithOrganization } from "../../src/modules/organizations/context.js";
import { SuperPdpService } from "../../src/modules/superpdp/service.js";
import { SuperPdpTransport } from "../../src/modules/superpdp/transport.js";
import {
  buildSandboxRecipe,
  checksum,
  recipeBindingSchema,
  requireLocalSandboxRecipe,
  requirePositiveRecipeValidation,
  SandboxRecipeLedger,
} from "../../src/modules/superpdp/sandboxRecipe.js";
import {
  closeBrowser,
  generateInvoicePdf,
} from "../../src/services/pdfService.js";
import { resolveDataDir } from "../../src/utils/paths.js";

const [phase, ...args] = process.argv.slice(2);
let stage = "local-guards";
const service = new SuperPdpService();
const transport = new SuperPdpTransport();
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().uuid(),
    date: z.string().date(),
    binding: recipeBindingSchema,
    fixtureSha: shaSchema,
    originalSha: shaSchema,
    facturXSha: shaSchema,
    databasePath: z.string(),
  })
  .strict();
const root = path.join(resolveDataDir(), "superpdp-recette", "native-v1");
const serverRoot = fileURLToPath(new URL("../../", import.meta.url));
const localDatabase = fs.realpathSync(path.join(serverRoot, "prisma/dev.db"));
const readJson = (ledger: SandboxRecipeLedger, name: string) =>
  JSON.parse(ledger.read(name).toString("utf8"));

async function main() {
  // Hard fail on deployments, PostgreSQL, workers, ordinary send activation or dummy PDFs.
  requireLocalSandboxRecipe({
    mode: env.NODE_ENV,
    confirmed: process.env.SUPERPDP_LOCAL_RECIPE_CONFIRMED === "1",
    database: process.env.DATABASE_URL,
    expectedDatabase: localDatabase,
    sandboxEnabled: env.SUPERPDP_SANDBOX_ENABLED,
    pdfDisabled: process.env.SKIP_PDF_GENERATION === "1",
    automatedOrOrdinaryFlows: [
      env.SUPERPDP_SANDBOX_EMISSION_ENABLED,
      env.SUPERPDP_SANDBOX_RECEPTION_ENABLED,
      env.SUPERPDP_SANDBOX_B2C_ENABLED,
      env.ORGANIZATION_JOB_WORKER_ENABLED,
      env.MULTITENANT_AUTOMATION_ENABLED,
    ],
  });
  assert.ok(["prepare", "review", "send", "observe"].includes(phase));

  let ledger: SandboxRecipeLedger;
  let organizationId: string;
  let sellerId: string;
  let buyerId: string;
  let manifest: z.infer<typeof manifestSchema> | undefined;
  if (phase === "prepare") {
    assert.equal(args.length, 3);
    [organizationId, sellerId, buyerId] = args;
    for (const value of args) z.string().min(1).max(100).parse(value);
    ledger = new SandboxRecipeLedger(root, crypto.randomUUID(), true);
  } else {
    assert.equal(args.length, phase === "observe" ? 1 : 2);
    ledger = new SandboxRecipeLedger(root, args[0]);
    manifest = manifestSchema.parse(readJson(ledger, "manifest.json"));
    assert.equal(manifest.runId, args[0]);
    assert.equal(manifest.databasePath, localDatabase);
    organizationId = manifest.binding.organizationId;
    sellerId = manifest.binding.sender.entityId;
    buyerId = manifest.binding.recipient.entityId;
  }
  const owner = await db.authSession.findFirstOrThrow({
    where: {
      organization_id: organizationId,
      revoked_at: null,
      expires_at: { gt: new Date() },
      user: {
        organization_id: organizationId,
        is_owner: true,
        is_active: true,
      },
    },
    orderBy: { last_seen_at: "desc" },
    select: { id: true, user_id: true },
  });
  const actor = { userId: owner.user_id, sessionHash: checksum(owner.id) };
  await runWithOrganization({ organizationId, source: "session" }, async () => {
    stage = "connection-binding";
    const connection = async (
      entityId: string,
      number: "000000002" | "000000001",
    ) => {
      const entity = await db.fiscalEntity.findFirstOrThrow({
        where: { organization_id: organizationId, id: entityId },
      });
      assert.equal(entity.siren, null); // Never borrow real legal entities for this recipe.
      const row = await db.superPdpConnection.findFirstOrThrow({
        where: {
          organization_id: organizationId,
          fiscal_entity_id: entityId,
          environment: "sandbox",
        },
      });
      assert.equal(row.status, "connected");
      assert.equal(row.verification_status, "verified");
      assert.equal(row.expected_number, number);
      assert.equal(row.local_siren, null);
      assert.ok(row.remote_company_id);
      return {
        entityId,
        connectionId: row.id,
        companyId: row.remote_company_id,
        number,
        address: `0225:315143296_${row.remote_company_id}`,
      };
    };
    const binding = recipeBindingSchema.parse({
      organizationId,
      sender: await connection(sellerId, "000000002"),
      recipient: await connection(buyerId, "000000001"),
    });
    if (manifest) assert.deepEqual(binding, manifest.binding);
    const access = <T>(
      party: typeof binding.sender,
      work: (token: string) => Promise<T>,
    ) =>
      service.withSandboxAccess(
        party.entityId,
        { connectionId: party.connectionId, companyId: party.companyId },
        actor,
        work,
      );
    const directory = async (party: typeof binding.sender, token: string) => {
      const result = await transport.directory(token);
      assert.ok(
        result.data.some(
          (entry) =>
            entry.company.id === party.companyId &&
            entry.status === "created" &&
            entry.identifier === party.address,
        ),
      );
    };
    const verifyDirectories = async () => {
      await access(binding.recipient, (token) =>
        directory(binding.recipient, token),
      );
      await access(binding.sender, (token) => directory(binding.sender, token));
    };
    if (phase === "prepare") {
      stage = "directory-verification";
      await verifyDirectories();
      const runId = path.basename(ledger.directory);
      const date = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Paris",
      }).format(new Date());
      const fixture = buildSandboxRecipe(binding, runId, date);
      ledger.json("fixture.json", fixture);
      const original = path.join(ledger.directory, "native.pdf");
      stage = "native-pdf";
      await generateInvoicePdf({ ...fixture.render, outputPath: original });
      fs.chmodSync(original, 0o600);
      const originalBytes = fs.readFileSync(original);
      assert.ok(originalBytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
      stage = "conversion";
      const converted = await transport.convert(
        JSON.stringify(fixture.payload),
        originalBytes,
      );
      ledger.write("factur-x.pdf", converted);
      stage = "validation";
      const validation = await transport.validate(converted);
      // Transport binds the report to the file; this recipe separately requires success.
      ledger.json("validation.json", validation);
      requirePositiveRecipeValidation(validation);
      manifest = {
        version: 1,
        runId,
        date,
        binding,
        databasePath: localDatabase,
        fixtureSha: checksum(ledger.read("fixture.json")),
        originalSha: checksum(originalBytes),
        facturXSha: checksum(converted),
      };
      ledger.json("manifest.json", manifest);
      console.log(
        JSON.stringify({
          phase,
          runId,
          number: fixture.number,
          total: fixture.payload.totals.total_with_vat,
          checks: validation.data[0].subreports.reduce(
            (n, report) => n + report.checks_count,
            0,
          ),
          facturXSha: manifest.facturXSha,
          directory: ledger.directory,
          sent: false,
        }),
      );
      return;
    }
    assert.ok(manifest);
    stage = "frozen-evidence";
    const fixture = buildSandboxRecipe(binding, manifest.runId, manifest.date);
    assert.equal(
      checksum(JSON.stringify(fixture, null, 2)),
      manifest.fixtureSha,
    );
    assert.equal(checksum(ledger.read("fixture.json")), manifest.fixtureSha);
    assert.equal(checksum(ledger.read("native.pdf")), manifest.originalSha);
    const pdf = ledger.read("factur-x.pdf");
    assert.equal(checksum(pdf), manifest.facturXSha);
    const manifestSha = checksum(ledger.read("manifest.json"));
    if (phase === "review") {
      // Explicit operator attestation after rendering/inspecting the final PDF, not auto-review.
      assert.equal(args[1], `--reviewed-sha256=${manifest.facturXSha}`);
      ledger.json("review.json", {
        manifestSha,
        facturXSha: manifest.facturXSha,
        at: new Date().toISOString(),
        operatorId: actor.userId,
      });
      console.log(JSON.stringify({ phase, reviewed: true, sent: false }));
    } else if (phase === "send") {
      assert.equal(args[1], "--confirm-sandbox-once");
      const review = readJson(ledger, "review.json");
      assert.equal(review.manifestSha, manifestSha);
      assert.equal(review.facturXSha, manifest.facturXSha);
      assert.ok(
        !fs.existsSync(path.join(ledger.directory, "send-intent.json")),
      );
      await verifyDirectories();
      // Fresh validation, no disabled pre-check and no retry, including uncertain outcomes.
      requirePositiveRecipeValidation(await transport.validate(pdf));
      const result = await access(binding.sender, async (token) => {
        await directory(binding.sender, token);
        return ledger.sendOnce(
          {
            runId: manifest!.runId,
            manifestSha,
            binding,
            facturXSha: manifest!.facturXSha,
          },
          async () => {
            const response = await transport.send(
              token,
              pdf,
              manifest!.runId,
              "B2B",
            );
            // Store even a surprising response before classifying it as unconfirmed.
            ledger.json("provider-response.json", response);
            assert.equal(response.company_id, binding.sender.companyId);
            assert.equal(response.direction, "out");
            assert.equal(response.external_id, manifest!.runId);
            assert.equal(response.processing_rule, "B2B");
            return response;
          },
        );
      });
      console.log(
        JSON.stringify({
          phase,
          submitted: true,
          id: result.id,
          externalId: manifest.runId,
        }),
      );
    } else {
      // Read-only, bounded reconciliation. Absence never means permission to resend.
      ledger.read("send-intent.json");
      const outgoing = await access(binding.sender, async (token) => {
        let cursor: string | null = null;
        const matches = [];
        let more = false;
        for (let page = 0; page < 10; page++) {
          const result = await transport.list(token, cursor);
          assert.ok(
            result.data.every(
              (row) =>
                row.direction === "out" &&
                row.company_id === binding.sender.companyId,
            ),
          );
          matches.push(
            ...result.data.filter((row) => row.external_id === manifest!.runId),
          );
          more = result.has_after;
          if (!more) break;
          const next = result.data.at(-1)?.id;
          assert.ok(next && next !== cursor);
          cursor = next;
        }
        assert.ok(matches.length <= 1);
        return {
          matches,
          incomplete: more,
          events: matches[0]
            ? await transport.events(token, matches[0].id, null)
            : null,
        };
      });
      const received = await access(binding.recipient, async (token) => {
        let cursor: string | null = null;
        const matches = [];
        let more = false;
        for (let page = 0; page < 25; page++) {
          const result = await transport.incoming(token, cursor);
          more = result.has_after;
          for (const row of result.data) {
            assert.equal(row.company_id, binding.recipient.companyId);
            assert.equal(row.direction, "in");
            const detail = await transport.incomingDetail(token, row.id);
            if (detail.en_invoice?.number !== fixture.number) continue;
            const original = await transport.incomingOriginal(token, row.id);
            assert.equal(checksum(original.contents), manifest!.facturXSha);
            matches.push({
              invoice: row,
              sha256: checksum(original.contents),
              events: await transport.events(token, row.id, null),
            });
          }
          if (!more) break;
          const next = result.data.at(-1)?.id;
          assert.ok(next && next !== cursor);
          cursor = next;
        }
        assert.ok(matches.length <= 1);
        return { matches, incomplete: more };
      });
      ledger.json(`observation-${Date.now()}.json`, {
        at: new Date().toISOString(),
        outgoing,
        received,
      });
      console.log(
        JSON.stringify({
          phase,
          outgoing: outgoing.matches.map((row) => row.id),
          received: received.matches.map((row) => row.invoice.id),
          statuses: outgoing.events?.data.map((event) => event.status_code),
          incomplete: outgoing.incomplete || received.incomplete,
          sent: false,
        }),
      );
    }
  });
}

try {
  await main();
} catch (error) {
  // No arbitrary exception, provider body, token, secret, session or environment dump.
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z_0-9]+$/.test(error.code)
      ? error.code
      : "RECIPE_STOPPED";
  console.error(
    JSON.stringify({
      phase,
      stage,
      code,
      message:
        "Recette arrêtée. Examiner les preuves privées ; ne jamais rejouer un envoi commencé.",
    }),
  );
  process.exitCode = 1;
} finally {
  await closeBrowser();
  await db.$disconnect();
}
