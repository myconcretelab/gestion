import { Router } from "express";
import { SuperPdpEmission } from "./emission.js";
import { actorFor, safeErrorResponse } from "./routes.js";

export const createSuperPdpEmissionRouter = (
  service = new SuperPdpEmission(),
) => {
  const router = Router();
  router.use("/:id/electronic", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.get("/:id/electronic", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.view(req.params.id));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id/electronic/factur-x", async (req, res) => {
    try {
      await actorFor(req);
      const pdf = await service.artifact(req.params.id);
      res.type("application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="facture-sandbox-factur-x.pdf"',
      );
      res.send(pdf);
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  for (const action of ["prepare", "send", "sync"] as const)
    router.post(`/:id/electronic/${action}`, async (req, res) => {
      try {
        const actor = await actorFor(req);
        const result =
          action === "sync"
            ? await service.scheduleSync(req.params.id)
            : await service[action](req.params.id, req.body, actor);
        res.status(202).json(result);
      } catch (error) {
        const safe = safeErrorResponse(error);
        res.status(safe.status).json(safe.body);
      }
    });
  return router;
};
