import prisma from "../../db/prisma.js";

export const getManagerDeletionDependencies = (id: string) =>
  prisma.gestionnaire.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          gites: true,
          expense_recurring_rules: true,
          expense_entries: true,
          fiscal_entities: true,
        },
      },
    },
  });

export const deleteManager = (id: string) =>
  prisma.gestionnaire.delete({ where: { id } });
