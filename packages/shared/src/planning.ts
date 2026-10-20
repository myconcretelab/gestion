import { z } from "zod";

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const planningMissionSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(["cleaning", "task"]),
    title: z.string().trim().min(2).max(120),
    trigger: z.enum(["arrival", "departure"]),
    minimum_nights: z.number().int().min(1).max(365).nullable(),
    starts_offset_days: z.number().int().min(-30).max(30).default(0),
    due_offset_days: z.number().int().min(-30).max(30).default(0),
    start_time: clock.default("09:00"),
    due_time: clock.default("17:00"),
    assignment_mode: z
      .enum(["fixed", "rotation", "unassigned"])
      .default("fixed"),
    rotation_user_ids: z.array(z.string().min(1)).max(50).default([]),
    assignees: z.record(z.string(), z.string().min(1)).default({}),
    compensation_mode: z
      .enum(["none", "flat_rate", "time"])
      .default("flat_rate"),
    rates: z
      .record(z.string(), z.number().finite().min(0).max(100000))
      .default({}),
    default_minutes: z.number().int().min(1).max(1440).nullable().default(null),
    note: z.string().trim().max(2000).default(""),
  })
  .superRefine((mission, ctx) => {
    const minutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if (
      mission.kind === "task" &&
      mission.due_offset_days * 1440 + minutes(mission.due_time) <=
        mission.starts_offset_days * 1440 + minutes(mission.start_time)
    )
      ctx.addIssue({
        code: "custom",
        message: "La fin doit suivre le début de l’intervention.",
        path: ["due_time"],
      });
    if (mission.compensation_mode === "time" && !mission.default_minutes)
      ctx.addIssue({
        code: "custom",
        message: "Indiquez une durée prévue.",
        path: ["default_minutes"],
      });
    if (mission.kind === "cleaning" && mission.compensation_mode === "time")
      ctx.addIssue({
        code: "custom",
        message: "Les ménages sont rémunérés au forfait.",
        path: ["compensation_mode"],
      });
    if (
      mission.assignment_mode === "rotation" &&
      !mission.rotation_user_ids.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Choisissez les personnes du tour de rôle.",
        path: ["rotation_user_ids"],
      });
  });
export const planningOrganizationSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    audience: z.enum(["individual", "shared"]),
    missions: z.array(planningMissionSchema).max(20),
  })
  .superRefine((config, ctx) => {
    if (
      new Set(config.missions.map((mission) => mission.id)).size !==
      config.missions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Chaque prestation doit avoir un identifiant distinct.",
      });
    if (
      config.missions.filter((mission) => mission.kind === "cleaning").length >
      1
    )
      ctx.addIssue({
        code: "custom",
        message: "Une seule organisation de ménage par période.",
      });
  });
export type PlanningMission = z.infer<typeof planningMissionSchema>;
export type PlanningOrganization = z.infer<typeof planningOrganizationSchema>;
export type PlanningIntervention = {
  id: string;
  kind: "cleaning" | "task";
  date: string;
  title: string;
  gite_id: string;
  gite_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  worker_id: string | null;
  starts_at: string;
  due_at: string | null;
  status: string;
  note: string;
  amount: number | null;
  guest: string;
  phone: string | null;
  comment: string | null;
  options: string;
  nights: number;
  stay_from?: string;
  stay_to?: string;
};
