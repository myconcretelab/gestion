import prisma from "../db/prisma.js";

export const generateInvoiceNumber = async (giteId: string, prefix: string, year: number) => {
  const counter = await prisma.factureCounter.upsert({
    where: { giteId_year: { giteId, year } },
    update: { lastNumber: { increment: 1 } },
    create: { giteId, year, lastNumber: 1 },
  });

  const padded = String(counter.lastNumber).padStart(2, "0");
  return `${prefix}-${year}-${padded}`;
};
