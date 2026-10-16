import prisma from "../../db/prisma.js";
import { invoiceError } from "../documents/invoiceLifecycle.js";

export const deleteGitePreservingInvoices = (id: string) =>
  prisma.$transaction(
    async (tx) => {
      const gite = await tx.gite.findUnique({ where: { id } });
      if (!gite) throw invoiceError("Gîte introuvable.", 404);
      const invoices = await tx.facture.findMany({
        where: { gite_id: id },
        select: { id: true, pdf_path: true, lifecycle_status: true },
      });
      if (invoices.some((invoice) => invoice.lifecycle_status !== "draft")) {
        throw invoiceError(
          "Ce gîte possède des factures émises ou historiques. Leur conservation empêche sa suppression.",
        );
      }
      const contracts = await tx.contrat.findMany({
        where: { gite_id: id },
        select: { id: true, pdf_path: true },
      });
      await tx.reservation.deleteMany({ where: { gite_id: id } });
      await tx.contrat.deleteMany({ where: { gite_id: id } });
      await tx.facture.deleteMany({ where: { gite_id: id } });
      await tx.contratCounter.deleteMany({ where: { giteId: id } });
      await tx.factureCounter.deleteMany({ where: { giteId: id } });
      await tx.gite.delete({ where: { id } });
      return [...contracts, ...invoices];
    },
    { isolationLevel: "Serializable" },
  );
