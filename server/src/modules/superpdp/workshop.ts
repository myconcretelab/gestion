import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import prisma from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getOrganizationId } from "../organizations/context.js";
import { resolveDataDir } from "../../utils/paths.js";
import { generateInvoicePdf } from "../../services/pdfService.js";
import {
  buildSandboxRecipe,
  checksum,
  recipeBindingSchema,
  requireLocalSandboxRecipe,
  requirePositiveRecipeValidation,
  SandboxRecipeLedger,
  type RecipeBinding,
} from "./sandboxRecipe.js";
import { SuperPdpService, type OAuthActor } from "./service.js";
import { superPdpError } from "./secrets.js";
import { SuperPdpTransport } from "./transport.js";
import {
  workshopDocument,
  workshopIssues,
  workshopStateSchema,
  type WorkshopState,
} from "./workshopDocument.js";

type Source = WorkshopState["source"];
export type WorkshopRepository = {
  binding(): Promise<RecipeBinding>;
  sources(): Promise<Source[]>;
  source(id: string): Promise<Source>;
};
const fail = (message: string, status = 409) =>
  superPdpError("SUPERPDP_WORKSHOP", message, status);
const revisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
const localDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );

export const localWorkshopAvailable = () => {
  try {
    const serverRoot = fileURLToPath(new URL("../../../", import.meta.url));
    requireLocalSandboxRecipe({
      mode: env.NODE_ENV,
      confirmed: true,
      database: process.env.DATABASE_URL,
      expectedDatabase: fs.realpathSync(path.join(serverRoot, "prisma/dev.db")),
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
    return true;
  } catch {
    return false;
  }
};

/** No new table, ordinary invoice, sequence, reservation link or automatic job.
 * Local operator journal, with process-memory fences in addition to durable exclusive intents.
 * A restart/copy/restore makes old runs read-only. No resume or retry-send API exists.
 */
export class SuperPdpWorkshop {
  private readonly boot = crypto.randomUUID();
  private readonly active = new Set<string>();
  private readonly checkpoints = new Map<string, string>();
  private readonly locks = new Set<string>();
  private readonly attempted = new Set<string>();
  private readonly credited = new Set<string>();
  constructor(
    private readonly root = path.join(
      resolveDataDir(),
      "superpdp-recette",
      "web-v1",
    ),
    private readonly repository: WorkshopRepository = liveWorkshopRepository,
    private readonly oauth = new SuperPdpService(),
    private readonly transport = new SuperPdpTransport(),
    private readonly available = localWorkshopAvailable,
    private readonly render: (
      document: ReturnType<typeof workshopDocument>,
      directory: string,
    ) => Promise<Buffer> = renderNative,
  ) {}
  private gate(actor?: OAuthActor) {
    if (!this.available())
      throw fail(
        "Atelier réservé à localhost en développement, base de test et automatismes arrêtés.",
        403,
      );
    if (
      actor &&
      !this.active.has(`${getOrganizationId()}:${actor.sessionHash}`)
    )
      throw fail(
        "Activez explicitement l’atelier pour cette session avant de continuer.",
      );
  }
  private folder() {
    return path.join(this.root, checksum(getOrganizationId()));
  }
  private ledger(id: string, create = false) {
    z.string().uuid().parse(id);
    if (!create && !fs.existsSync(path.join(this.folder(), id)))
      throw fail("Document de test introuvable.", 404);
    return new SandboxRecipeLedger(this.folder(), id, create);
  }
  private key(id: string) {
    return `${getOrganizationId()}:${id}`;
  }
  private load(id: string) {
    const ledger = this.ledger(id);
    const files = fs
      .readdirSync(ledger.directory)
      .filter((name) => /^state-\d{4}\.json$/.test(name))
      .sort();
    if (!files.length || files.length > 1001)
      throw fail("Journal de recette inexploitable.");
    const bytes = ledger.read(files.at(-1)!);
    const state = workshopStateSchema.parse(JSON.parse(bytes.toString()));
    if (
      state.id !== id ||
      state.binding.organizationId !== getOrganizationId() ||
      files.at(-1) !== `state-${String(state.revision).padStart(4, "0")}.json`
    )
      throw fail("Journal de recette incohérent.");
    return { ledger, state, sha: checksum(bytes) };
  }
  private current(id: string, revision: number, actor: OAuthActor) {
    this.gate(actor);
    const loaded = this.load(id);
    if (loaded.state.revision !== revision)
      throw fail("Ce document a changé. Actualisez avant de continuer.");
    if (
      loaded.state.boot !== this.boot ||
      this.checkpoints.get(this.key(id)) !== loaded.sha
    )
      throw fail(
        "Document en lecture seule après redémarrage, copie ou restauration. Aucun renvoi autorisé.",
      );
    loaded.state.lastActor = actor.userId;
    return loaded;
  }
  private persist(ledger: SandboxRecipeLedger, state: WorkshopState) {
    const parsed = workshopStateSchema.parse(state);
    const bytes = JSON.stringify(parsed, null, 2);
    ledger.write(
      `state-${String(state.revision).padStart(4, "0")}.json`,
      bytes,
    );
    if (state.boot === this.boot)
      this.checkpoints.set(this.key(state.id), checksum(bytes));
    return parsed;
  }
  private async locked<T>(id: string, work: () => Promise<T>) {
    const key = this.key(id);
    if (this.locks.has(key))
      throw fail("Une opération est déjà en cours sur ce document.");
    this.locks.add(key);
    try {
      return await work();
    } finally {
      this.locks.delete(key);
    }
  }
  private access<T>(
    binding: RecipeBinding,
    actor: OAuthActor,
    work: (token: string) => Promise<T>,
  ) {
    const party = binding.sender;
    return this.oauth.withSandboxAccess(
      party.entityId,
      { connectionId: party.connectionId, companyId: party.companyId },
      actor,
      work,
    );
  }
  private async verify(state: WorkshopState, actor: OAuthActor) {
    assert.deepEqual(await this.repository.binding(), state.binding);
    for (const party of [state.binding.recipient, state.binding.sender]) {
      await this.oauth.withSandboxAccess(
        party.entityId,
        { connectionId: party.connectionId, companyId: party.companyId },
        actor,
        async (token) => {
          const entries = await this.transport.directory(token);
          if (
            !entries.data.some(
              (entry) =>
                entry.company.id === party.companyId &&
                entry.status === "created" &&
                entry.identifier === party.address,
            )
          )
            throw fail(
              "Adresse sandbox attendue absente de l’annuaire. Arrêtez la recette.",
            );
        },
      );
    }
  }
  async overview(actor: OAuthActor) {
    if (!this.available())
      return {
        available: false,
        active: false,
        sources: [],
        runs: [],
        reason:
          "Atelier disponible uniquement sur la base locale de développement, sans automatismes.",
      };
    const active = this.active.has(
      `${getOrganizationId()}:${actor.sessionHash}`,
    );
    let ids: string[] = [];
    if (fs.existsSync(this.folder()))
      ids = fs
        .readdirSync(this.folder())
        .filter((id) => z.string().uuid().safeParse(id).success)
        .slice(-100);
    const runs = ids
      .map((id) => this.view(id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      available: true,
      active,
      sources: active ? await this.repository.sources() : [],
      runs,
      reason: null,
    };
  }
  activate(actor: OAuthActor, body: unknown) {
    this.gate();
    z.object({ confirm_local_test_data: z.literal(true) })
      .strict()
      .parse(body);
    this.active.add(`${getOrganizationId()}:${actor.sessionHash}`);
    return this.overview(actor);
  }
  view(id: string) {
    this.gate();
    const { state, sha, ledger } = this.load(id);
    const writable =
      state.boot === this.boot && this.checkpoints.get(this.key(id)) === sha;
    const { boot: _boot, ...publicState } = state;
    return {
      ...publicState,
      writable,
      issues: workshopIssues(state),
      hasSendIntent:
        this.attempted.has(this.key(id)) ||
        fs.existsSync(path.join(ledger.directory, "send-intent.json")),
      hasCredit:
        this.credited.has(this.key(id)) ||
        fs.existsSync(path.join(ledger.directory, "credit-created.json")),
    };
  }
  private createState(
    binding: RecipeBinding,
    source: Source,
    actor: OAuthActor,
    original: WorkshopState | null = null,
  ) {
    const id = crypto.randomUUID(),
      date = localDate();
    const seed = buildSandboxRecipe(binding, id, date);
    // Only one anonymous amount: raw source fees/guest text, contact and bank data never copied.
    const input = original ? structuredClone(original.input) : seed.input;
    input.reviewed = false;
    if (!original)
      input.lines = [
        {
          id: "test-reservation",
          label: "Prestation fictive de recette (montant du séjour)",
          quantity: 1,
          unit: "C62",
          unit_price_ttc: source.total,
          vat_category: "unknown",
          vat_rate: 0,
          exemption_reason: "",
        },
      ];
    const state: WorkshopState = {
      version: 1,
      id,
      boot: this.boot,
      revision: 0,
      createdAt: new Date().toISOString(),
      createdBy: actor.userId,
      lastActor: actor.userId,
      date,
      number: `TEST-${original ? "AV" : "FA"}-${date.replaceAll("-", "")}-${id.replaceAll("-", "").slice(0, 12)}`,
      binding,
      source,
      kind: original ? "credit_note" : "invoice",
      original: original
        ? { id: original.id, number: original.number, date: original.date }
        : null,
      input,
      status: "draft",
      nativeSha: null,
      artifactSha: null,
      snapshotSha: null,
      remoteId: null,
      error: null,
      validation: null,
      events: [],
    };
    return state;
  }
  async create(body: unknown, actor: OAuthActor) {
    this.gate(actor);
    const parsed = z
      .object({
        reservation_id: z.string().min(1).max(100),
        confirm_anonymized_copy: z.literal(true),
      })
      .strict()
      .parse(body);
    const binding = recipeBindingSchema.parse(await this.repository.binding());
    const source = await this.repository.source(parsed.reservation_id);
    const state = this.createState(binding, source, actor);
    this.persist(this.ledger(state.id, true), state);
    return this.view(state.id);
  }
  async save(id: string, body: unknown, actor: OAuthActor) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        rates: z
          .array(z.union([z.literal(10), z.literal(20)]))
          .min(1)
          .max(100),
        reviewed: z.boolean(),
      })
      .strict()
      .parse(body);
    return this.locked(id, async () => {
      const { ledger, state } = this.current(id, parsed.revision, actor);
      if (state.status !== "draft") throw fail("Le document émis est figé.");
      if (parsed.rates.length !== state.input.lines.length)
        throw fail("Ventilation de test incohérente.");
      if (
        state.kind === "credit_note" &&
        parsed.rates.some((rate, i) => rate !== state.input.lines[i].vat_rate)
      )
        throw fail(
          "L’avoir intégral doit reprendre exactement les taux et montants d’origine.",
        );
      state.input.lines.forEach((line, i) => {
        line.vat_category = "S";
        line.vat_rate = parsed.rates[i];
      });
      state.input.reviewed = parsed.reviewed;
      state.revision++;
      this.persist(ledger, state);
      return this.view(id);
    });
  }
  async issue(id: string, body: unknown, actor: OAuthActor) {
    const parsed = revisionSchema.parse(body);
    return this.locked(id, async () => {
      const { ledger, state } = this.current(id, parsed.revision, actor);
      if (state.status !== "draft")
        throw fail("Seul un brouillon peut être émis.");
      const issues = workshopIssues(state);
      if (issues.length) throw fail(issues.join("\n"));
      assert.deepEqual(await this.repository.binding(), state.binding);
      state.status = "issuing";
      state.revision++;
      this.persist(ledger, state);
      try {
        const document = workshopDocument(state);
        const snapshot = JSON.stringify(document.payload, null, 2);
        const bytes = await this.render(document, ledger.directory);
        if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
          throw fail("Le générateur n’a pas produit de PDF.");
        ledger.write("native.pdf", bytes);
        ledger.write("snapshot.json", snapshot);
        state.nativeSha = checksum(bytes);
        state.snapshotSha = checksum(snapshot);
        state.status = "issued";
      } catch {
        state.status = "issue_failed";
        state.error =
          "Émission locale non confirmée. Ne pas modifier ce document.";
      }
      state.revision++;
      this.persist(ledger, state);
      return this.view(id);
    });
  }
  async prepare(id: string, body: unknown, actor: OAuthActor) {
    const parsed = revisionSchema.parse(body);
    return this.locked(id, async () => {
      const { ledger, state } = this.current(id, parsed.revision, actor);
      if (state.status !== "issued")
        throw fail("Émettez le document avant sa préparation électronique.");
      state.status = "preparing";
      state.revision++;
      this.persist(ledger, state);
      try {
        await this.verify(state, actor);
        const pdf = ledger.read("native.pdf"),
          snapshot = ledger.read("snapshot.json");
        assert.equal(checksum(pdf), state.nativeSha);
        assert.equal(checksum(snapshot), state.snapshotSha);
        const converted = await this.transport.convert(
          snapshot.toString(),
          pdf,
        );
        ledger.write("factur-x.pdf", converted);
        const report = await this.transport.validate(converted);
        ledger.json("validation.json", report);
        state.validation = {
          valid: report.data[0].is_valid,
          checks: report.data[0].subreports.reduce(
            (n, r) => n + r.checks_count,
            0,
          ),
          failures: report.data[0].subreports
            .flatMap((r) => r.failures.map((f) => f.message))
            .slice(0, 100),
        };
        requirePositiveRecipeValidation(report);
        state.artifactSha = checksum(converted);
        state.status = "ready";
      } catch {
        state.status = "prepare_failed";
        state.error =
          "Conversion/validation non confirmée. Aucun dépôt n’a été demandé.";
      }
      state.revision++;
      this.persist(ledger, state);
      return this.view(id);
    });
  }
  async artifact(id: string, kind: "native" | "factur-x") {
    this.gate();
    const { state, ledger } = this.load(id);
    const expected = kind === "native" ? state.nativeSha : state.artifactSha;
    if (!expected) throw fail("Document non disponible.", 404);
    const bytes = ledger.read(
      kind === "native" ? "native.pdf" : "factur-x.pdf",
    );
    if (checksum(bytes) !== expected)
      throw fail("Empreinte du document incohérente. Opération bloquée.");
    return bytes;
  }
  async send(id: string, body: unknown, actor: OAuthActor) {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        confirm_test_send: z.literal(true),
        reviewed_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .parse(body);
    return this.locked(id, async () => {
      const { ledger, state } = this.current(id, parsed.revision, actor);
      if (
        state.status !== "ready" ||
        this.attempted.has(this.key(id)) ||
        fs.existsSync(path.join(ledger.directory, "send-intent.json"))
      )
        throw fail("Ce document ne peut pas être envoyé ou renvoyé.");
      if (parsed.reviewed_sha256 !== state.artifactSha)
        throw fail("Relisez le Factur-X préparé avant de confirmer.");
      const pdf = await this.artifact(id, "factur-x");
      await this.verify(state, actor);
      requirePositiveRecipeValidation(await this.transport.validate(pdf));
      // Fence in memory BEFORE disk intent and POST. Rollback of files in this process
      // cannot erase it; after process restart boot mismatch blocks all old sends.
      this.attempted.add(this.key(id));
      state.status = "sending";
      state.revision++;
      this.persist(ledger, state);
      try {
        await this.access(state.binding, actor, (token) =>
          ledger.sendOnce(
            { id, artifactSha: state.artifactSha, binding: state.binding },
            async () => {
              const response = await this.transport.send(token, pdf, id, "B2B");
              ledger.json("provider-response.json", response);
              assert.equal(response.external_id, id);
              assert.equal(response.direction, "out");
              assert.equal(response.company_id, state.binding.sender.companyId);
              assert.equal(response.processing_rule, "B2B");
              return response;
            },
          ),
        ).then((response) => {
          state.remoteId = response.id;
          state.status = "submitted";
        });
      } catch {
        state.status = "send_unknown";
        state.error =
          "Résultat non confirmé : ne jamais renvoyer ni créer un autre test pour retenter ce dépôt.";
      }
      state.revision++;
      this.persist(ledger, state);
      return this.view(id);
    });
  }
  async sync(id: string, actor: OAuthActor) {
    this.gate(actor);
    return this.locked(id, async () => {
      const { ledger, state } = this.load(id);
      state.lastActor = actor.userId;
      // Reconciliation must never re-arm a run paused by a copy/rollback/restart.
      if (
        state.boot === this.boot &&
        this.checkpoints.get(this.key(id)) !==
          checksum(
            ledger.read(
              `state-${String(state.revision).padStart(4, "0")}.json`,
            ),
          )
      )
        state.boot = crypto.randomUUID();
      if (!["submitted", "send_unknown", "sending"].includes(state.status))
        throw fail("Aucun dépôt à suivre.");
      await this.verify(state, actor);
      await this.access(state.binding, actor, async (token) => {
        let cursor: string | null = null;
        let more = true;
        const matches = [];
        for (let page = 0; page < 10 && more; page++) {
          const result = await this.transport.list(token, cursor);
          assert.ok(
            result.data.every(
              (row) =>
                row.company_id === state.binding.sender.companyId &&
                row.direction === "out",
            ),
          );
          matches.push(...result.data.filter((row) => row.external_id === id));
          more = result.has_after;
          if (more) {
            const next = result.data.at(-1)?.id;
            assert.ok(next && next !== cursor);
            cursor = next;
          }
        }
        if (matches.length !== 1 || more)
          throw fail(
            "Recherche non concluante ou incomplète. Aucun renvoi autorisé.",
          );
        const original = await this.transport.incomingOriginal(
          token,
          matches[0].id,
        );
        assert.equal(checksum(original.contents), state.artifactSha);
        const events = await this.transport.events(token, matches[0].id, null);
        ledger.json(`observation-${crypto.randomUUID()}.json`, {
          invoice: matches[0],
          events,
        });
        state.remoteId = matches[0].id;
        state.status = "submitted";
        state.error = null;
        state.events = events.data.slice(0, 100).map((event) => ({
          id: event.id,
          code: event.status_code,
          text: event.status_text,
          at: event.created_at,
        }));
      });
      state.revision++;
      this.persist(ledger, state);
      return this.view(id);
    });
  }
  async credit(id: string, body: unknown, actor: OAuthActor) {
    const parsed = revisionSchema.parse(body);
    return this.locked(id, async () => {
      const { ledger, state } = this.current(id, parsed.revision, actor);
      if (state.kind !== "invoice" || state.status !== "submitted")
        throw fail("Un avoir exige une facture de test déposée et confirmée.");
      if (
        this.credited.has(this.key(id)) ||
        fs.existsSync(path.join(ledger.directory, "credit-created.json"))
      )
        throw fail("Un avoir intégral est déjà réservé pour ce document.");
      const document = workshopDocument(state);
      assert.equal(
        checksum(JSON.stringify(document.payload, null, 2)),
        state.snapshotSha,
      );
      const credit = this.createState(
        state.binding,
        state.source,
        actor,
        state,
      );
      this.credited.add(this.key(id));
      // One full credit per source, retained even if creation is interrupted.
      ledger.json("credit-created.json", { id: credit.id, source: id });
      this.persist(this.ledger(credit.id, true), credit);
      return this.view(credit.id);
    });
  }
}

const renderNative = async (
  document: ReturnType<typeof workshopDocument>,
  directory: string,
) => {
  const temp = await fsp.mkdtemp(path.join(directory, "render-"));
  try {
    const outputPath = path.join(temp, "native.pdf");
    await generateInvoicePdf({ ...document.render, outputPath });
    return await fsp.readFile(outputPath);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
};
export const liveWorkshopRepository: WorkshopRepository = {
  async binding() {
    const organizationId = getOrganizationId();
    const parties = [];
    for (const number of ["000000002", "000000001"] as const) {
      const rows = await prisma.superPdpConnection.findMany({
        where: {
          environment: "sandbox",
          expected_number: number,
          status: "connected",
          verification_status: "verified",
        },
      });
      if (rows.length !== 1)
        throw fail(
          "Connectez et vérifiez séparément Burger Queen et Tricatel dans Entreprises.",
        );
      const row = rows[0];
      const entity = await prisma.fiscalEntity.findUnique({
        where: { id: row.fiscal_entity_id },
      });
      if (
        !entity ||
        entity.siren !== null ||
        row.local_siren !== null ||
        !row.remote_company_id
      )
        throw fail(
          "La recette exige les deux entreprises fictives sans SIREN légal local.",
        );
      parties.push({
        entityId: entity.id,
        connectionId: row.id,
        companyId: row.remote_company_id,
        number,
        address: `0225:315143296_${row.remote_company_id}`,
      });
    }
    return recipeBindingSchema.parse({
      organizationId,
      sender: parties[0],
      recipient: parties[1],
    });
  },
  async sources() {
    const binding = await this.binding();
    const rows = await prisma.reservation.findMany({
      where: {
        gite: {
          organization_id: getOrganizationId(),
          fiscal_establishment: { fiscal_entity_id: binding.sender.entityId },
        },
      },
      orderBy: { date_entree: "desc" },
      take: 100,
      select: {
        id: true,
        date_entree: true,
        date_sortie: true,
        prix_total: true,
        gite: { select: { nom: true } },
      },
    });
    return rows
      .filter(
        (row) =>
          Number.isFinite(row.prix_total) &&
          row.prix_total >= 0 &&
          row.prix_total <= 1000000,
      )
      .map((row) => ({
        reservationId: row.id,
        label: `${row.gite!.nom} · ${row.date_entree.toISOString().slice(0, 10)} au ${row.date_sortie.toISOString().slice(0, 10)}`,
        total: row.prix_total,
      }));
  },
  async source(id) {
    const source = (await this.sources()).find(
      (row) => row.reservationId === id,
    );
    if (!source)
      throw fail(
        "Réservation indisponible dans le périmètre Burger Queen (100 dernières).",
        404,
      );
    return source;
  },
};
