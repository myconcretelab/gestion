import { systemPrisma } from "../../db/prisma.js";

export const isPlatformAdministrator = async (userId: string) =>
  Boolean(
    await systemPrisma.platformAdministrator.findFirst({
      where: { user_id: userId, status: "active" },
    }),
  );
