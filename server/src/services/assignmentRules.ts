import prisma from "../db/prisma.js";
import { fromJsonString } from "../utils/jsonFields.js";

export type AssignmentMode = "unassigned" | "fixed" | "rotation";

export const parseRotationAssignees = (value: string) =>
  [...new Set(fromJsonString<string[]>(value, []).filter((id) => typeof id === "string" && id.length > 0))];

export const validateAssignees = async (ids: string[]) => {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const users = await prisma.appUser.findMany({
    where: { id: { in: unique }, is_active: true, intervenant_id: { not: null } },
    select: { id: true },
  });
  return users.length === unique.length;
};

export const activeRotationAssignees = async (value: string) => {
  const ids = parseRotationAssignees(value);
  if (!ids.length) return [];
  const users = await prisma.appUser.findMany({
    where: { id: { in: ids }, is_active: true, intervenant_id: { not: null } }, select: { id: true },
  });
  const active = new Set(users.map((user) => user.id));
  return ids.filter((id) => active.has(id));
};

export const rotationAssigneeAt = (ids: string[], nextCursor: number) =>
  ids.length ? ids[(nextCursor - 1) % ids.length] : null;
