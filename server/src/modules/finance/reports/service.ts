import { createHash } from "node:crypto";
import {
  isNightCollectionKey,
  evaluateReport,
  reportDefinitionSchema,
  reportPeriodKey,
  reportMutationSchema,
  operationSourceSignature,
  reportHasPendingChanges,
  reportPaymentAlertSignature,
  reportPaymentReviewRequired,
  type ReportDefinition,
  type ReportWorkspaceData,
  type ReportResult,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";
import {
  readReportConfiguration as read,
  type ReportConfiguration as Configuration,
} from "./configuration.js";
import { loadReportFacts, reportFactsFromWorkspace } from "./facts.js";
import { readReportCalculation, storeReportCalculation } from "./cache.js";
import {
  applyRemittanceCommand,
  removeUncommittedReceipt,
  type RemittanceCommand,
} from "./remittances.js";
import type { TaxRemittanceReceipt } from "@contrats/shared";
import { buildNightRegister } from "./nightRegister.js";

type Facts = Awaited<ReturnType<typeof loadReportFacts>>;
const fail = (message: string, status = 409) =>
  Object.assign(new Error(message), { status, statusCode: status });
const requirePaymentReview = (result: ReportResult) => {
  if (reportPaymentReviewRequired(result))
    throw fail(
      "Des séjours terminés ont un règlement absent, incomplet ou à vérifier. Enregistrez les paiements reçus ou justifiez leur situation avant de finaliser le rapport.",
      400,
    );
};
const fingerprint = (definition: ReportDefinition, result: ReportResult) => {
  const { favorite: _favorite, ...rules } = definition;
  return createHash("sha256")
    .update(JSON.stringify({ definition: rules, result }))
    .digest("hex");
};

const evaluate = (
  config: Configuration,
  facts: Facts,
  report: ReportDefinition,
  month: string,
) =>
  evaluateReport(
    report,
    month,
    config.overrides[reportPeriodKey(report, month)],
    facts.operations,
    {
      propertyNightDeclarations: facts.propertyNightDeclarations,
      propertyOperators: facts.propertyOperators,
      propertyManagers: facts.propertyManagers,
      operatorIssues: facts.operatorIssues,
      socialIssues: facts.socialIssues,
      stayPaymentAlerts: facts.stayPaymentAlerts,
      paymentReviews: config.paymentReviews,
      operationEdits: {},
      nightRegisterCompletions: config.nightRegisterCompletions,
      nightRegisterCompletionRevisions: config.nightRegisterCompletionRevisions,
    },
  );

function response(
  config: Configuration,
  facts: Facts,
  revision: number,
): ReportWorkspaceData {
  // A change in source data invalidates preparation, while the confirmed copy stays frozen.
  const progress = Object.fromEntries(
    Object.entries(config.progress).map(([key, value]) => {
      const report = config.reports.find((row) => key.startsWith(`${row.id}:`));
      if (!report || !value.ready || value.snapshot) return [key, value];
      const month = key.slice(report.id.length + 1, report.id.length + 8);
      const result = evaluate(config, facts, report, month);
      return [
        key,
        {
          ...value,
          ready:
            value.readyFingerprint === fingerprint(report, result) &&
            (!report.nightDeclaration ||
              value.readyFactsRevision === facts.factsRevision),
        },
      ];
    }),
  );
  return {
    version: 3,
    ...facts,
    ...config,
    progress,
    revision,
    organizationId: getOrganizationId(),
    drafts: {},
    operationEdits: {},
  };
}
// The database holds completed calculations. Share concurrent refreshes within a tenant too.
const workspaceReads = new Map<
  string,
  { promise: Promise<ReportWorkspaceData>; forced: boolean }
>();
export function getReportWorkspace(
  options: { force?: boolean; now?: Date } = {},
): Promise<ReportWorkspaceData> {
  const organizationId = getOrganizationId();
  const pending = workspaceReads.get(organizationId);
  if (pending) {
    if (options.force && !pending.forced)
      return pending.promise.then(() => getReportWorkspace(options));
    return pending.promise;
  }
  const calculate = () =>
    prisma.$transaction(
      async (db) => {
        const now = options.now ?? new Date();
        const { workspace } = await readReportCalculation(db, now);
        if (!options.force && workspace) return workspace;
        const facts = await loadReportFacts(db, now);
        const { store, config } = await read(db, facts);
        return storeReportCalculation(
          db,
          response(config, facts, store?.revision ?? 0),
          now,
        );
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await calculate();
      } catch (error) {
        if (
          attempt >= 2 ||
          !["P2002", "P2034", "P1008", "P2028"].includes(
            (error as { code?: string })?.code ?? "",
          )
        )
          throw error;
      }
    }
  };
  const request = run().finally(() => {
    if (workspaceReads.get(organizationId)?.promise === request)
      workspaceReads.delete(organizationId);
  });
  workspaceReads.set(organizationId, {
    promise: request,
    forced: Boolean(options.force),
  });
  return request;
}
export async function mutateReportWorkspace(input: unknown, userId?: string) {
  const payload = reportMutationSchema.parse(input);
  let uploadedReceipt: TaxRemittanceReceipt | undefined;
  try {
    const result = await prisma.$transaction(
      async (db) => {
        const now = new Date();
        const calculation = await readReportCalculation(db, now);
        const cached =
          calculation.workspace?.revision === payload.revision
            ? calculation.workspace
            : null;
        // Serializable transactions and database source revisions protect cached facts
        // against concurrent edits; changed sources always take the full calculation path.
        const facts = cached
          ? reportFactsFromWorkspace(cached)
          : await loadReportFacts(db, now);
        const { store, config } = await read(db, facts);
        if (
          (store?.revision ?? 0) !== payload.revision ||
          facts.factsRevision !== payload.factsRevision
        )
          throw fail(
            "Les données ont changé. Actualisez les rapports avant de réessayer. Votre brouillon est conservé.",
          );
        const { command, month } = payload;
        if (command.type.startsWith("remittance-")) {
          uploadedReceipt = await applyRemittanceCommand(
            config,
            facts.properties,
            facts.managers,
            command as RemittanceCommand,
            userId,
          );
        } else if (command.type === "worklist-start") {
          config.worklistStartMonth = command.startMonth;
        } else if (command.type === "save") {
          const definition = command.definition;
          if (definition.kind === "tourist" && definition.nightReference) {
            config.reports = config.reports.map((report) =>
              report.kind === "tourist" && report.id !== definition.id
                ? { ...report, nightReference: false }
                : report,
            );
          }
          if (
            definition.kind === "tourist" &&
            !definition.nightReference &&
            !config.reports.some(
              (report) =>
                report.kind === "tourist" &&
                report.id !== definition.id &&
                report.nightReference,
            )
          ) {
            definition.nightReference = true;
          }
          if (
            definition.propertyIds.some(
              (id) => !facts.properties.some((row) => row.id === id),
            )
          )
            throw fail("Un logement sélectionné n’existe plus.", 400);
          if (
            definition.managerId &&
            !facts.managers.some((row) => row.id === definition.managerId)
          )
            throw fail("Gestionnaire introuvable.", 400);
          if (
            definition.managerId &&
            definition.propertyIds.some(
              (id) => facts.propertyManagers[id] !== definition.managerId,
            )
          )
            throw fail(
              "Les logements sélectionnés doivent dépendre du gestionnaire choisi.",
              400,
            );
          if (
            definition.operatorId &&
            !facts.operators.some((row) => row.id === definition.operatorId)
          )
            throw fail("Exploitant introuvable.", 400);
          if (
            definition.kind === "social" &&
            definition.operatorId &&
            definition.propertyIds.some(
              (id) =>
                facts.propertyOperators[id] &&
                facts.propertyOperators[id] !== definition.operatorId,
            )
          )
            throw fail(
              "Les logements d’un rapport social doivent dépendre du même exploitant.",
              400,
            );
          if (config.reports.some((row) => row.id === definition.id))
            config.reports = config.reports.map((row) =>
              row.id === definition.id ? definition : row,
            );
          else {
            if (config.reports.length >= 100)
              throw fail("La limite de 100 rapports est atteinte.", 400);
            config.reports.push(definition);
          }
          for (const [key, progress] of Object.entries(config.progress))
            if (key.startsWith(`${definition.id}:`))
              config.progress[key] = { ...progress, ready: false };
        } else {
          if (!("reportId" in command))
            throw fail("Commande de rapport invalide.", 400);
          const report = config.reports.find(
            (row) => row.id === command.reportId,
          );
          if (!report) throw fail("Rapport introuvable.", 404);
          const key = reportPeriodKey(report, month);
          const result = evaluate(config, facts, report, month);
          if (command.type === "payment-review") {
            if (!result.paymentAlerts?.length)
              throw fail("Aucun paiement de séjour terminé à vérifier.", 400);
            if (command.signature !== reportPaymentAlertSignature(result))
              throw fail(
                "Les règlements ont changé. Rechargez les séjours à vérifier.",
              );
            config.paymentReviews = {
              ...config.paymentReviews,
              [key]: {
                signature: command.signature,
                note: command.note,
                reviewedAt: new Date().toISOString(),
                reviewedBy: userId ?? null,
              },
            };
            config.progress[key] = { ...config.progress[key], ready: false };
          } else if (command.type === "night-register-completion") {
            if (report.kind !== "tourist")
              throw fail(
                "Ce complément concerne les rapports de nuitées.",
                400,
              );
            const register = await buildNightRegister(
              db,
              report,
              month,
              {
                ...config,
                nightRegisterCompletions: Object.fromEntries(
                  Object.entries(config.nightRegisterCompletions ?? {}).filter(
                    ([period]) => period !== key,
                  ),
                ),
              },
              facts,
            );
            if (register.sourceRevision !== command.completion.sourceRevision)
              throw fail(
                "Les sources du registre ont changé. Rechargez son aperçu avant d’enregistrer les compléments.",
              );
            if (
              Object.keys(command.completion.rows).some(
                (id) => !register.rows.some((row) => row.key === id),
              )
            )
              throw fail(
                "Un séjour ou une perception ne fait pas partie de ce registre.",
                400,
              );
            const checkedCollections = new Set<string>();
            for (const row of register.rows) {
              const collectionId = row.collectionId ?? row.key;
              if (
                row.observedCollectionCents === null ||
                checkedCollections.has(collectionId)
              )
                continue;
              checkedCollections.add(collectionId);
              const amount = register.rows
                .filter(
                  (candidate) =>
                    (candidate.collectionId ?? candidate.key) === collectionId,
                )
                .reduce(
                  (total, candidate) =>
                    total +
                    (Object.hasOwn(command.completion.rows, candidate.key)
                      ? (command.completion.rows[candidate.key]
                          .collectedTaxCents ?? 0)
                      : (candidate.collectedTaxCents ?? 0)),
                  0,
                );
              if (amount === 0) continue;
              if (
                row.collectionId &&
                Object.entries(config.nightRegisterCompletions ?? {}).some(
                  ([period, completion]) =>
                    period !== key &&
                    period.startsWith(`${report.id}:`) &&
                    period.endsWith(`:${report.cadence}`) &&
                    row.collectionReservationIds?.some(
                      (id) =>
                        (completion.rows[`stay:${id}`]?.collectedTaxCents ??
                          0) > 0,
                    ),
                )
              )
                throw fail(
                  "Une ancienne ventilation du séjour existe sur une autre période sans rattachement aux perceptions. Retirez d’abord les anciennes affectations à remplacer, puis rattachez les montants aux règlements.",
                  400,
                );
              const elsewhere = Object.entries(
                config.nightRegisterCompletions ?? {},
              )
                .filter(
                  ([period]) =>
                    period !== key &&
                    period.startsWith(`${report.id}:`) &&
                    period.endsWith(`:${report.cadence}`),
                )
                .reduce(
                  (total, [, completion]) =>
                    total +
                    Object.entries(completion.rows)
                      .filter(([key]) =>
                        isNightCollectionKey(key, collectionId),
                      )
                      .reduce(
                        (subtotal, [, edit]) =>
                          subtotal + (edit.collectedTaxCents ?? 0),
                        0,
                      ),
                  0,
                );
              if (amount + elsewhere > row.observedCollectionCents)
                throw fail(
                  "La somme affectée aux périodes dépasse la perception enregistrée. Vérifiez la ventilation pour éviter de compter la taxe plusieurs fois.",
                  400,
                );
            }
            config.nightRegisterCompletions = {
              ...config.nightRegisterCompletions,
              [key]: command.completion,
            };
            config.nightRegisterCompletionRevisions = {
              ...config.nightRegisterCompletionRevisions,
              [key]: createHash("sha256")
                .update(JSON.stringify(command.completion))
                .digest("hex"),
            };
            config.progress[key] = { ...config.progress[key], ready: false };
          } else if (command.type === "favorite")
            report.favorite = command.favorite;
          else if (command.type === "override") {
            if (report.kind === "social" || report.kind === "tourist")
              throw fail(
                "Corrigez les données de la réservation pour ce rapport.",
                400,
              );
            if (!result.rows.some((row) => row.id === command.operationId))
              throw fail("Opération introuvable dans cette période.", 404);
            config.overrides[key] = { ...config.overrides[key] };
            if (command.override)
              config.overrides[key][command.operationId] = {
                ...command.override,
                sourceSignature: operationSourceSignature(
                  facts.operations.find(
                    (row) => row.id === command.operationId,
                  )!,
                ),
              };
            else delete config.overrides[key][command.operationId];
            config.progress[key] = { ...config.progress[key], ready: false };
          } else {
            reportDefinitionSchema.parse(report);
            if (
              report.propertyIds.some(
                (id) =>
                  !facts.properties.some((property) => property.id === id),
              )
            )
              throw fail(
                "Un logement du rapport n’existe plus. Modifiez son périmètre.",
                400,
              );
            if (
              report.managerId &&
              (!facts.managers.some(
                (manager) => manager.id === report.managerId,
              ) ||
                report.propertyIds.some(
                  (id) => facts.propertyManagers[id] !== report.managerId,
                ))
            )
              throw fail(
                "Le rattachement au gestionnaire a changé. Modifiez le périmètre du rapport.",
                400,
              );
            if (
              report.kind === "social" &&
              !facts.operators.some(
                (operator) => operator.id === report.operatorId,
              )
            )
              throw fail(
                "L’exploitant du rapport n’existe plus. Modifiez son périmètre.",
                400,
              );
            if (
              report.kind === "social" &&
              facts.operators.find((row) => row.id === report.operatorId)
                ?.legacy
            )
              throw fail(
                "Rattachez les logements à un établissement facturant avant de finaliser le rapport social.",
                400,
              );
            if (result.reviewCount)
              throw fail(
                "Vérifiez les opérations avant de finaliser le rapport.",
                400,
              );
            const register =
              report.kind === "tourist" &&
              (report.nightDeclaration || command.type !== "ready")
                ? await buildNightRegister(db, report, month, config, facts)
                : undefined;
            if (report.nightDeclaration && register?.incompleteCount)
              throw fail(
                `${register.incompleteCount} séjour(s) comportent encore des informations à compléter dans le registre. Vérifiez la synthèse et le registre avant de finaliser la déclaration.`,
                400,
              );
            if (register) register.archivedAt = new Date().toISOString();
            const current = config.progress[key];
            if (command.type === "resolve") {
              if (
                !current?.snapshot ||
                !reportHasPendingChanges(current, result)
              )
                throw fail("Aucun écart à résoudre pour cette période.");
              requirePaymentReview(result);
              config.progress[key] = {
                ...current,
                resolutions: [
                  ...(current.resolutions ?? []),
                  {
                    resolvedAt: new Date().toISOString(),
                    resolvedBy: userId ?? null,
                    outcome: command.outcome,
                    note: command.note,
                    definition: structuredClone(report),
                    result: structuredClone(result),
                    ...(register
                      ? { nightRegister: structuredClone(register) }
                      : {}),
                  },
                ],
              };
            } else {
              if (current?.snapshot)
                throw fail(
                  "Une copie confirmée existe déjà pour cette période. Elle est conservée.",
                );
              const readyFingerprint = fingerprint(report, result);
              if (
                command.type === "confirm" &&
                (!current?.ready ||
                  (report.nightDeclaration &&
                    current.readyFactsRevision !== facts.factsRevision) ||
                  current.readyFingerprint !== readyFingerprint)
              )
                throw fail(
                  "Le rapport doit être vérifié et marqué comme prêt après la dernière modification.",
                );
              requirePaymentReview(result);
              config.progress[key] =
                command.type === "ready"
                  ? {
                      ready: true,
                      readyFingerprint,
                      ...(report.nightDeclaration
                        ? { readyFactsRevision: facts.factsRevision }
                        : {}),
                    }
                  : {
                      ready: true,
                      readyFingerprint,
                      snapshot: {
                        confirmedAt: new Date().toISOString(),
                        confirmedBy: userId ?? null,
                        definition: structuredClone(report),
                        result: structuredClone(result),
                        ...(register
                          ? { nightRegister: structuredClone(register) }
                          : {}),
                      },
                    };
            }
          }
        }
        const revision = (store?.revision ?? 0) + 1;
        if (store) {
          const updated = await db.financeReportStore.updateMany({
            where: { id: store.id, revision: payload.revision },
            data: { data_json: JSON.stringify(config), revision },
          });
          if (updated.count !== 1)
            throw fail(
              "Les réglages ont été modifiés en parallèle. Actualisez les rapports.",
            );
        } else
          await db.financeReportStore.create({
            data: {
              organization_id: getOrganizationId(),
              data_json: JSON.stringify(config),
              revision,
            },
          });
        await db.auditLog.create({
          data: {
            organization_id: getOrganizationId(),
            user_id: userId,
            action: `report.${command.type}`,
            resource_type: "finance_report",
            resource_id:
              "remittanceId" in command
                ? command.remittanceId
                : command.type === "remittance-save"
                  ? command.remittance.id
                  : command.type === "worklist-start"
                    ? "worklist"
                    : command.type === "save"
                      ? command.definition.id
                      : command.reportId,
            metadata_json: JSON.stringify({
              month,
              revision,
              command:
                command.type === "remittance-receipt"
                  ? { ...command, file: uploadedReceipt }
                  : command,
            }),
          },
        });
        return storeReportCalculation(
          db,
          response(config, facts, revision),
          now,
          cached &&
            calculation.cache?.reminders_json &&
            command.type !== "save" &&
            command.type !== "worklist-start"
            ? {
                remindersJson: calculation.cache.reminders_json,
                reportIds: "reportId" in command ? [command.reportId] : [],
              }
            : undefined,
        );
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
    workspaceReads.delete(getOrganizationId());
    return result;
  } catch (error) {
    if (uploadedReceipt)
      await removeUncommittedReceipt(uploadedReceipt).catch(() => {});
    if (
      ["P2002", "P2034", "P1008", "P2028"].includes(
        (error as { code?: string })?.code ?? "",
      )
    )
      throw fail(
        "Les rapports ont été modifiés en parallèle. Actualisez les données avant de réessayer.",
      );
    throw error;
  }
}
