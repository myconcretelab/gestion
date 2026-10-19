import { z } from "zod";
import { fiscalEstablishmentSchema } from "@contrats/shared";
import type { TenantTransactionClient } from "../../db/prisma.js";
import { fiscalError } from "../../services/fiscalEntities.js";

export const establishmentSaveSchema = fiscalEstablishmentSchema.extend({
  expected_updated_at: z.string().datetime().optional(),
  gite_links: z
    .array(
      z
        .object({
          gite_id: z.string().min(1).max(160),
          expected_establishment_id: z.string().min(1).nullable(),
          attach: z.boolean(),
          confirm_reassignment: z.boolean().default(false),
        })
        .strict(),
    )
    .max(500)
    .default([]),
});

/** Only explicit changes are applied. An unchecked, unrelated gîte is never detached. */
export async function applyEstablishmentLinks(
  tx: TenantTransactionClient,
  establishmentId: string,
  links: z.infer<typeof establishmentSaveSchema>["gite_links"],
) {
  if (new Set(links.map((link) => link.gite_id)).size !== links.length)
    throw fiscalError(
      "Un gîte ne peut apparaître qu’une fois dans la sélection.",
    );
  for (const link of links) {
    const gite = await tx.gite.findUnique({
      where: { id: link.gite_id },
      select: { id: true, fiscal_establishment_id: true },
    });
    if (!gite)
      throw fiscalError("Un gîte sélectionné n’est plus accessible.", 404);
    if (gite.fiscal_establishment_id !== link.expected_establishment_id)
      throw fiscalError(
        "Le rattachement d’un gîte a changé. Rechargez la page avant de réessayer.",
        409,
      );
    if (!link.attach && gite.fiscal_establishment_id !== establishmentId)
      throw fiscalError(
        "Vous pouvez uniquement retirer un gîte de cet établissement.",
        409,
      );
    if (
      link.attach &&
      gite.fiscal_establishment_id &&
      gite.fiscal_establishment_id !== establishmentId &&
      !link.confirm_reassignment
    )
      throw fiscalError(
        "Confirmez le changement d’établissement des gîtes déjà rattachés.",
        409,
      );
    const result = await tx.gite.updateMany({
      where: {
        id: gite.id,
        fiscal_establishment_id: link.expected_establishment_id,
      },
      data: { fiscal_establishment_id: link.attach ? establishmentId : null },
    });
    if (result.count !== 1)
      throw fiscalError(
        "Le rattachement d’un gîte a changé. Rechargez la page avant de réessayer.",
        409,
      );
  }
}
