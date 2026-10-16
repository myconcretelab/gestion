import { Router } from "express";
import { actorFor, safeErrorResponse } from "./routes.js";
import { SuperPdpInbox } from "./inbox.js";

export const createSuperPdpInboxRouter = (service = new SuperPdpInbox()) => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.get("/", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.list(req.query));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.detail(req.params.id));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id/original", async (req, res) => {
    try {
      await actorFor(req);
      const file = await service.original(req.params.id);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="facture-achat-originale.${file.format === "pdf" ? "pdf" : "xml"}"`,
      );
      res.send(file.contents);
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id/structured", async (req, res) => {
    try {
      await actorFor(req);
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="facture-achat-structuree.json"',
      );
      res.json(await service.structured(req.params.id));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:id/expense-candidates", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.candidates(req.params.id));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.put("/:id/match", async (req, res) => {
    try {
      res.json(
        await service.match(req.params.id, req.body, await actorFor(req)),
      );
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.delete("/:id/match", async (req, res) => {
    try {
      res.json(
        await service.unmatch(req.params.id, req.body, await actorFor(req)),
      );
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  return router;
};

export const createInboxConfigRouter = (service = new SuperPdpInbox()) => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.get("/:entityId/superpdp/inbox", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.state(req.params.entityId));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.put("/:entityId/superpdp/inbox", async (req, res) => {
    try {
      res.json(
        await service.configure(
          req.params.entityId,
          req.body,
          await actorFor(req),
        ),
      );
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.post("/:entityId/superpdp/inbox/sync", async (req, res) => {
    try {
      await actorFor(req);
      res.status(202).json(await service.schedule(req.params.entityId));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  return router;
};
