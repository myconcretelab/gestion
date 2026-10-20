import crypto from "node:crypto";
import {
  planningOrganizationSchema,
  type PlanningOrganization,
} from "@contrats/shared";
import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";
import { toParisIsoDate } from "./userInterventions.js";

export const readPlanningOrganization = (
  value: unknown,
): PlanningOrganization | null => {
  const result = planningOrganizationSchema.safeParse(
    fromJsonString(value, null),
  );
  return result.success ? result.data : null;
};
export const organizationTemplateId = (
  periodId: string,
  missionId: string,
  giteId: string,
) =>
  `planning-${crypto
    .createHash("sha256")
    .update(JSON.stringify([periodId, missionId, giteId]))
    .digest("hex")
    .slice(0, 40)}`;

export async function validatePlanningOrganization(
  config: PlanningOrganization,
  giteIds: string[],
  from: string,
  to: string,
  periodId?: string,
) {
  const userIds = [
    ...new Set(
      config.missions.flatMap((mission) => [
        ...Object.values(mission.assignees),
        ...mission.rotation_user_ids,
      ]),
    ),
  ];
  const users = await prisma.appUser.findMany({
    where: {
      id: { in: userIds },
      is_active: true,
      intervenant_id: { not: null },
    },
  });
  if (users.length !== userIds.length)
    throw Object.assign(new Error("Choisissez des intervenants actifs."), {
      status: 400,
    });
  for (const mission of config.missions) {
    if (
      Object.keys(mission.assignees).some((id) => !giteIds.includes(id)) ||
      Object.keys(mission.rates).some((id) => !giteIds.includes(id))
    )
      throw Object.assign(
        new Error(
          "Les tarifs et intervenants doivent correspondre aux gîtes sélectionnés.",
        ),
        { status: 400 },
      );
    if (
      mission.assignment_mode === "fixed" &&
      giteIds.some((id) => !mission.assignees[id])
    )
      throw Object.assign(
        new Error("Choisissez un intervenant pour chaque gîte."),
        { status: 400 },
      );
    if (
      mission.compensation_mode === "flat_rate" &&
      giteIds.some((id) => !(mission.rates[id] > 0))
    )
      throw Object.assign(new Error("Indiquez le forfait de chaque gîte."), {
        status: 400,
      });
  }
  if (
    !config.enabled ||
    !config.missions.some((mission) => mission.kind === "cleaning")
  )
    return;
  const overlapping = await prisma.planningRelayPeriod.findMany({
    where: {
      ...(periodId ? { id: { not: periodId } } : {}),
      date_debut: { lte: new Date(`${to}T00:00:00Z`) },
      date_fin: { gte: new Date(`${from}T00:00:00Z`) },
      organization_config: { not: null },
    },
  });
  if (
    overlapping.some((period) => {
      const other = readPlanningOrganization(period.organization_config);
      return (
        other?.enabled &&
        other.missions.some((mission) => mission.kind === "cleaning") &&
        fromJsonString<string[]>(period.gite_ids, []).some((id) =>
          giteIds.includes(id),
        )
      );
    })
  )
    throw Object.assign(
      new Error(
        "Une autre organisation de ménage couvre déjà ces gîtes pendant cette période. Ajustez les dates ou les gîtes.",
      ),
      { status: 409 },
    );
}

export async function syncPlanningTemplates(period: {
  id: string;
  gite_ids: unknown;
  date_debut: Date;
  date_fin: Date;
  organization_config: unknown;
}) {
  const config = readPlanningOrganization(period.organization_config);
  if (!config) return;
  const giteIds = fromJsonString<string[]>(period.gite_ids, []);
  const ids = config.missions
    .filter((mission) => mission.kind === "task")
    .flatMap((mission) =>
      giteIds.map((id) => organizationTemplateId(period.id, mission.id, id)),
    );
  await prisma.$transaction(async (tx) => {
    // Removed missions stop generating and lose only untouched future occurrences.
    const removed = await tx.actionTemplate.findMany({
      where: { planning_period_id: period.id, id: { notIn: ids } },
      select: { id: true },
    });
    if (removed.length) {
      await tx.actionTask.deleteMany({
        where: {
          template_id: { in: removed.map((row) => row.id) },
          status: "planned",
          source_type: "automatic",
          starts_at: { gte: new Date() },
        },
      });
      await tx.actionTemplate.updateMany({
        where: { id: { in: removed.map((row) => row.id) } },
        data: { enabled: false },
      });
    }
    for (const mission of config.missions.filter(
      (item) => item.kind === "task",
    ))
      for (const giteId of giteIds) {
        const id = organizationTemplateId(period.id, mission.id, giteId);
        const data = {
          planning_period_id: period.id,
          planning_mission_id: mission.id,
          gite_id: giteId,
          title: mission.title,
          trigger_event: mission.trigger,
          active_from: period.date_debut.toISOString().slice(0, 10),
          active_to: period.date_fin.toISOString().slice(0, 10),
          minimum_nights: mission.minimum_nights,
          enabled: config.enabled,
          starts_offset_days: mission.starts_offset_days,
          due_offset_days: mission.due_offset_days,
          start_time: mission.start_time,
          due_time: mission.due_time,
          assignment_mode: mission.assignment_mode,
          default_assignee_id: mission.assignees[giteId] ?? null,
          rotation_assignee_ids: JSON.stringify(mission.rotation_user_ids),
          compensation_mode: mission.compensation_mode,
          compensation_amount: mission.rates[giteId] ?? 0,
          default_minutes: mission.default_minutes,
          note: mission.note,
        };
        await tx.actionTemplate.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        });
      }
  });
}

export function applicableCleaningOrganization(
  periods: Array<{
    id: string;
    date_debut: Date;
    date_fin: Date;
    gite_ids: unknown;
    organization_config: unknown;
  }>,
  task: { gite_id: string; starts_at: Date },
) {
  const day = toParisIsoDate(task.starts_at);
  for (const period of periods) {
    const config = readPlanningOrganization(period.organization_config);
    if (
      !config?.enabled ||
      day < period.date_debut.toISOString().slice(0, 10) ||
      day > period.date_fin.toISOString().slice(0, 10) ||
      !fromJsonString<string[]>(period.gite_ids, []).includes(task.gite_id)
    )
      continue;
    const mission = config.missions.find((item) => item.kind === "cleaning");
    if (mission) return { period, mission };
  }
  return null;
}

export async function applyPlanningCleaningAssignments(
  from: string,
  to: string,
) {
  const periods = await prisma.planningRelayPeriod.findMany({
    where: { organization_config: { not: null } },
  });
  const tasks = await prisma.cleaningTask.findMany({
    where: {
      OR: [
        {
          starts_at: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T23:59:59Z`),
          },
        },
        { assignment_period_id: { not: null } },
      ],
    },
    orderBy: [{ starts_at: "asc" }, { id: "asc" }],
  });
  const rotationCounts = new Map<string, number>();
  for (const task of tasks) {
    const match = applicableCleaningOrganization(periods, task);
    if (task.status !== "planned" || task.assignment_source === "manual") {
      if (match)
        rotationCounts.set(
          match.period.id,
          (rotationCounts.get(match.period.id) ?? 0) + 1,
        );
      continue;
    }
    if (match) {
      const { mission, period } = match;
      // Rotation is tied to all occurrences in date order, not to how often a view is opened.
      const index = rotationCounts.get(period.id) ?? 0;
      rotationCounts.set(period.id, index + 1);
      const assignee =
        mission.assignment_mode === "rotation" &&
        task.assignment_source === "period" &&
        task.assignment_period_id === period.id
          ? task.assignee_id
          : mission.assignment_mode === "rotation"
            ? mission.rotation_user_ids[
                index % mission.rotation_user_ids.length
              ]
            : mission.assignment_mode === "fixed"
              ? (mission.assignees[task.gite_id] ?? null)
              : null;
      await prisma.cleaningTask.update({
        where: { id: task.id },
        data: {
          assignee_id: assignee,
          assignment_source: "period",
          assignment_period_id: period.id,
          previous_assignee_id:
            task.assignment_source === "period"
              ? task.previous_assignee_id
              : task.assignee_id,
          amount_snapshot:
            mission.compensation_mode === "flat_rate"
              ? (mission.rates[task.gite_id] ?? null)
              : 0,
        },
      });
    } else if (task.assignment_source === "period") {
      await prisma.cleaningTask.update({
        where: { id: task.id },
        data: {
          assignee_id: task.previous_assignee_id,
          assignment_source: "rule",
          assignment_period_id: null,
          previous_assignee_id: null,
          amount_snapshot: null,
        },
      });
    }
  }
}
