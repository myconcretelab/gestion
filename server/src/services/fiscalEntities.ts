import prisma from "../db/prisma.js";

export const fiscalError = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });

export const assertFiscalEstablishment = async (id?: string | null) => {
  if (!id) return;
  if (
    !(await prisma.fiscalEstablishment.findUnique({
      where: { id },
      select: { id: true },
    }))
  ) {
    throw fiscalError("Établissement facturant introuvable.");
  }
};

export const assertSiretMatchesSiren = (
  siret: string | null,
  siren: string | null,
) => {
  if (siret && (!siren || !siret.startsWith(siren))) {
    throw fiscalError(
      "Le SIRET doit commencer par le SIREN de l’entreprise. Renseignez d’abord ce SIREN.",
    );
  }
};

export const fiscalEstablishmentOptions = () =>
  prisma.fiscalEstablishment.findMany({
    orderBy: [{ fiscal_entity: { legal_name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      siret: true,
      fiscal_entity: { select: { id: true, legal_name: true } },
    },
  });
