import { createHash } from "node:crypto";
import {
  createReport,
  evaluateReport,
  reportDefinitionSchema,
  reportPeriodKey,
  reportMutationSchema,
  operationSourceSignature,
  type ReportState,
  type ReportDefinition,
  type ReportWorkspaceData,
  type ReportResult,
} from "@contrats/shared";
import prisma, { type TenantTransactionClient } from "../../../db/prisma.js";
import { getOrganizationId } from "../../organizations/context.js";
import { loadReportFacts } from "./facts.js";

type Configuration = Pick<
  ReportState,
  "reports" | "overrides" | "progress" | "worklistStartMonth"
>;
type Facts = Awaited<ReturnType<typeof loadReportFacts>>;
const fail = (message: string, status = 409) =>
  Object.assign(new Error(message), { status, statusCode: status });
const fingerprint = (definition: ReportDefinition, result: ReportResult) => {
  const { favorite: _favorite, ...rules } = definition;
  return createHash("sha256")
    .update(JSON.stringify({ definition: rules, result }))
    .digest("hex");
};
function initialConfiguration(facts: Facts): Configuration {
  const reports: ReportDefinition[] = [];
  for (const operatorId of [
    ...new Set(facts.properties.map((property) => property.operatorId)),
  ]) {
    const operator = facts.operators.find((row) => row.id === operatorId);
    reports.push({
      ...createReport("social", `social-${operatorId ?? "unassigned"}`),
      name: operator ? "Cotisations sociales" : "Recettes sans exploitant",
      recipient: operator?.name ?? "Exploitant à renseigner",
      operatorId,
      propertyIds: facts.properties
        .filter((property) => property.operatorId === operatorId)
        .map((row) => row.id),
    });
  }
  if (facts.properties.length)
    reports.push({
      ...createReport("tourist", "guest-nights"),
      recipient: "Gestion interne",
      propertyIds: facts.properties.map((row) => row.id),
    });
  return { reports, overrides: {}, progress: {} };
}
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
      propertyOperators: facts.propertyOperators,
      operatorIssues: facts.operatorIssues,
      socialIssues: facts.socialIssues,
      operationEdits: {},
    },
  );
async function read(db: TenantTransactionClient, facts: Facts) {
  const store = await db.financeReportStore.findFirst();
  const config: Configuration = store
    ? JSON.parse(store.data_json)
    : initialConfiguration(facts);
  return { store, config };
}
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
          ready: value.readyFingerprint === fingerprint(report, result),
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
export async function getReportWorkspace() {
  return prisma.$transaction(
    async (db) => {
      const facts = await loadReportFacts(db);
      const { store, config } = await read(db, facts);
      return response(config, facts, store?.revision ?? 0);
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
export async function mutateReportWorkspace(input: unknown, userId?: string) {
  const payload = reportMutationSchema.parse(input);
  try {
    return await prisma.$transaction(
      async (db) => {
        const facts = await loadReportFacts(db);
        const { store, config } = await read(db, facts);
        if (
          (store?.revision ?? 0) !== payload.revision ||
          facts.factsRevision !== payload.factsRevision
        )
          throw fail(
            "Les données ont changé. Actualisez les rapports avant de réessayer. Votre brouillon est conservé.",
          );
        const { command, month } = payload;
        if (command.type === "worklist-start") {
          config.worklistStartMonth = command.startMonth;
        } else if (command.type === "save") {
          const definition = command.definition;
          if (
            definition.propertyIds.some(
              (id) => !facts.properties.some((row) => row.id === id),
            )
          )
            throw fail("Un logement sélectionné n’existe plus.", 400);
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
          const report = config.reports.find(
            (row) => row.id === command.reportId,
          );
          if (!report) throw fail("Rapport introuvable.", 404);
          const key = reportPeriodKey(report, month);
          const result = evaluate(config, facts, report, month);
          if (command.type === "favorite") report.favorite = command.favorite;
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
            const current = config.progress[key];
            if (current?.snapshot)
              throw fail(
                "Une copie confirmée existe déjà pour cette période. Elle est conservée.",
              );
            const readyFingerprint = fingerprint(report, result);
            if (
              command.type === "confirm" &&
              (!current?.ready || current.readyFingerprint !== readyFingerprint)
            )
              throw fail(
                "Le rapport doit être vérifié et marqué comme prêt après la dernière modification.",
              );
            config.progress[key] =
              command.type === "ready"
                ? { ready: true, readyFingerprint }
                : {
                    ready: true,
                    readyFingerprint,
                    snapshot: {
                      confirmedAt: new Date().toISOString(),
                      confirmedBy: userId ?? null,
                      definition: structuredClone(report),
                      result: structuredClone(result),
                    },
                  };
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
              command.type === "worklist-start"
                ? "worklist"
                : command.type === "save"
                  ? command.definition.id
                  : command.reportId,
            metadata_json: JSON.stringify({ month, revision, command }),
          },
        });
        return response(config, facts, revision);
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  } catch (error) {
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
