import { Router } from "express";
import { z } from "zod";
import { actorFor, safeErrorResponse } from "./routes.js";
import { SuperPdpWorkshop } from "./workshop.js";

export function createSuperPdpWorkshopRouter(
  service = new SuperPdpWorkshop(),
  actor = actorFor,
) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname)) {
      res.status(403).json({
        error: "Atelier accessible uniquement depuis une adresse locale.",
        code: "SUPERPDP_WORKSHOP_LOCAL_ONLY",
      });
      return;
    }
    next();
  });
  router.get("/", async (req, res) => {
    try {
      res.json(await service.overview(await actor(req)));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.post("/activate", async (req, res) => {
    try {
      res.json(await service.activate(await actor(req), req.body));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.post("/", async (req, res) => {
    try {
      res.status(201).json(await service.create(req.body, await actor(req)));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id", async (req, res) => {
    try {
      await actor(req);
      res.json(service.view(req.params.id));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id/pdf/:kind", async (req, res) => {
    try {
      await actor(req);
      const kind = z.enum(["native", "factur-x"]).parse(req.params.kind);
      const bytes = await service.artifact(req.params.id, kind);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="test-superpdp-${kind}.pdf"`,
      );
      res.type("application/pdf").send(bytes);
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  for (const action of [
    "save",
    "issue",
    "prepare",
    "send",
    "credit",
    "recordPayment",
    "sendPayment",
  ] as const) {
    router.post(`/:id/${action}`, async (req, res) => {
      try {
        res.json(
          await service[action](req.params.id, req.body, await actor(req)),
        );
      } catch (error) {
        const safe = safeErrorResponse(error);
        res.status(safe.status).json(safe.body);
      }
    });
  }
  router.post("/:id/sync", async (req, res) => {
    try {
      const user = await actor(req);
      z.object({}).strict().parse(req.body);
      res.json(await service.sync(req.params.id, user));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  return router;
}
