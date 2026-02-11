import prisma from "../db/prisma.js";

export const generateContractNumber = async (giteId: string, prefix: string, year: number) => {
  const counter = await prisma.contratCounter.upsert({
    where: { giteId_year: { giteId, year } },
    update: { lastNumber: { increment: 1 } },
    create: { giteId, year, lastNumber: 1 },
  });

  const padded = String(counter.lastNumber).padStart(6, "0");
  return `${prefix}-${year}-${padded}`;
};
