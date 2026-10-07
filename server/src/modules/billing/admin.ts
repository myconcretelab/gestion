import { systemPrisma } from "../../db/prisma.js";

export const isPlatformAdministrator = async (userId: string) =>
  Boolean(
    await systemPrisma.platformAdministrator.findFirst({
      where: { user_id: userId, status: "active" },
    }),
  );

export const listPlatformAdministrators = () =>
  systemPrisma.platformAdministrator.findMany({
    where: { status: "active" },
    include: { user: { select: { id: true, login_id: true } } },
    orderBy: { createdAt: "asc" },
  });

export const changePlatformAdministrator = async (input: {
  userId: string;
  actorUserId: string;
  reason: string;
  status: "active" | "revoked";
}) => {
  if (input.reason.trim().length < 3) throw new Error("Un motif d’au moins trois caractères est requis.");
  const user = await systemPrisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new Error("Utilisateur existant introuvable. Aucune promotion par adresse e-mail n’est autorisée.");
  const current = await systemPrisma.platformAdministrator.findUnique({ where: { user_id: input.userId } });
  if (current?.status === input.status) {
    return { changed: false as const, idempotent: true as const, userId: input.userId, status: input.status };
  }
  await systemPrisma.$transaction(async (tx) => {
    await tx.platformAdministrator.upsert({
      where: { user_id: input.userId },
      update: { status: input.status, role: "billing_admin" },
      create: { user_id: input.userId, status: input.status, role: "billing_admin" },
    });
    await tx.platformAdministratorEvent.create({
      data: {
        user_id: input.userId,
        actor_user_id: input.actorUserId,
        action: input.status === "active" ? "platform_admin.granted" : "platform_admin.revoked",
        reason: input.reason.trim(),
      },
    });
  });
  return { changed: true as const, idempotent: false as const, userId: input.userId, status: input.status };
};
