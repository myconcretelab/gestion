import { Router, type ErrorRequestHandler } from "express";
import {
  fiscalEntitySchema,
  fiscalEstablishmentSchema,
  fiscalEntityMissingFields,
} from "@contrats/shared";
import prisma from "../../db/prisma.js";
import {
  assertSiretMatchesSiren,
  fiscalError,
} from "../../services/fiscalEntities.js";

const router = Router();
const entityInclude = {
  gestionnaire: { select: { id: true, prenom: true, nom: true } },
  establishments: {
    orderBy: { name: "asc" as const },
    include: { gites: { select: { id: true, nom: true } } },
  },
};

router.get("/", async (_req, res, next) => {
  try {
    const entities = await prisma.fiscalEntity.findMany({
      orderBy: { legal_name: "asc" },
      include: entityInclude,
    });
    res.json(
      entities.map((entity) => ({
        ...entity,
        missing_fields: fiscalEntityMissingFields(entity),
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/inventory", async (_req, res, next) => {
  try {
    const [managers, gites] = await Promise.all([
      prisma.gestionnaire.findMany({
        orderBy: [{ nom: "asc" }, { prenom: "asc" }],
        select: {
          id: true,
          prenom: true,
          nom: true,
          _count: { select: { fiscal_entities: true, gites: true } },
        },
      }),
      prisma.gite.findMany({
        orderBy: [{ ordre: "asc" }, { nom: "asc" }],
        select: {
          id: true,
          nom: true,
          gestionnaire_id: true,
          fiscal_establishment_id: true,
          fiscal_establishment: {
            select: {
              name: true,
              siret: true,
              fiscal_entity: {
                select: {
                  legal_name: true,
                  siren: true,
                  vat_regime: true,
                  vat_number: true,
                  address_line1: true,
                  postal_code: true,
                  city: true,
                },
              },
            },
          },
        },
      }),
    ]);
    res.json({
      managers,
      gites: gites.map((gite) => {
        const establishment = gite.fiscal_establishment;
        const missing = establishment
          ? [
              ...fiscalEntityMissingFields(establishment.fiscal_entity),
              ...(!establishment.siret ? ["SIRET de l’établissement"] : []),
            ]
          : ["Établissement facturant"];
        return { ...gite, missing_fields: missing };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = fiscalEntitySchema.parse(req.body);
    if (
      data.gestionnaire_id &&
      !(await prisma.gestionnaire.findUnique({
        where: { id: data.gestionnaire_id },
      }))
    ) {
      throw fiscalError("Gestionnaire introuvable.");
    }
    res
      .status(201)
      .json(await prisma.fiscalEntity.create({ data, include: entityInclude }));
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = fiscalEntitySchema.parse(req.body);
    const saved = await prisma.$transaction(
      async (tx) => {
        const entity = await tx.fiscalEntity.findUnique({
          where: { id: req.params.id },
          include: { establishments: true },
        });
        if (!entity) throw fiscalError("Entreprise introuvable.", 404);
        if (
          data.gestionnaire_id &&
          !(await tx.gestionnaire.findUnique({
            where: { id: data.gestionnaire_id },
          }))
        ) {
          throw fiscalError("Gestionnaire introuvable.");
        }
        // Identity changes require a new record once an establishment has a SIRET.
        if (
          data.siren !== entity.siren &&
          entity.establishments.some((item) => item.siret)
        ) {
          throw fiscalError(
            "Le SIREN est lié aux SIRET existants. Créez une autre entreprise pour une nouvelle identité légale.",
            409,
          );
        }
        return tx.fiscalEntity.update({
          where: { id: entity.id },
          data,
          include: entityInclude,
        });
      },
      { isolationLevel: "Serializable" },
    );
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/establishments", async (req, res, next) => {
  try {
    const data = fiscalEstablishmentSchema.parse(req.body);
    const saved = await prisma.$transaction(
      async (tx) => {
        const entity = await tx.fiscalEntity.findUnique({
          where: { id: req.params.id },
        });
        if (!entity) throw fiscalError("Entreprise introuvable.", 404);
        assertSiretMatchesSiren(data.siret, entity.siren);
        return tx.fiscalEstablishment.create({
          data: { ...data, fiscal_entity_id: entity.id },
        });
      },
      { isolationLevel: "Serializable" },
    );
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

router.put("/:id/establishments/:establishmentId", async (req, res, next) => {
  try {
    const data = fiscalEstablishmentSchema.parse(req.body);
    const saved = await prisma.$transaction(
      async (tx) => {
        const establishment = await tx.fiscalEstablishment.findFirst({
          where: {
            id: req.params.establishmentId,
            fiscal_entity_id: req.params.id,
          },
          include: { fiscal_entity: true },
        });
        if (!establishment)
          throw fiscalError("Établissement introuvable.", 404);
        assertSiretMatchesSiren(data.siret, establishment.fiscal_entity.siren);
        return tx.fiscalEstablishment.update({
          where: { id: establishment.id },
          data,
        });
      },
      { isolationLevel: "Serializable" },
    );
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

// Return useful conflicts, including concurrent duplicate creations, without leaking another tenant.
const handleFiscalError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.code === "P2002") {
    res
      .status(409)
      .json({
        error: "Ce SIREN ou SIRET est déjà enregistré dans votre organisation.",
      });
    return;
  }
  if (error?.code === "P2003" || error?.code === "P2034") {
    res
      .status(409)
      .json({
        error:
          "Ce rattachement fiscal a changé. Rechargez la page puis réessayez.",
      });
    return;
  }
  next(error);
};
router.use(handleFiscalError);

export default router;
