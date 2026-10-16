import { Router, type Request } from "express";
import { env } from "../../config/env.js";
import {
  getServerAuthSessionFromRequest,
  getAuthenticatedAppUser,
} from "../../services/serverAuth.js";
import { getOrganizationId } from "../organizations/context.js";
import { SuperPdpService, type OAuthActor } from "./service.js";
import { digest, superPdpError } from "./secrets.js";
import { SuperPdpReadiness } from "./readiness.js";

export const actorFor = async (req: Request): Promise<OAuthActor> => {
  const session = await getServerAuthSessionFromRequest(req);
  const user = session ? await getAuthenticatedAppUser(req) : null;
  if (!session || !user || session.organizationId !== getOrganizationId())
    throw superPdpError(
      "SUPERPDP_AUTH_REQUIRED",
      "Reconnectez-vous à l’application avant de gérer SuperPDP.",
      401,
    );
  if (!user.permissions.isOwner)
    throw superPdpError(
      "SUPERPDP_OWNER_REQUIRED",
      "Seul un administrateur peut gérer les connexions SuperPDP.",
      403,
    );
  if (req.method !== "GET") {
    const allowed = [
      new URL(env.APP_PUBLIC_URL).origin,
      new URL(env.CLIENT_ORIGIN).origin,
    ];
    if (!req.headers.origin || !allowed.includes(req.headers.origin))
      throw superPdpError(
        "SUPERPDP_ORIGIN",
        "Origine de la requête refusée.",
        403,
      );
  }
  return { userId: user.id, sessionHash: digest(session.id) };
};
export const safeErrorResponse = (error: unknown) => {
  const value = error as {
    code?: string;
    message?: string;
    status?: number;
    name?: string;
  };
  if (/^SUPERPDP_[A-Z_]+$/.test(value.code ?? ""))
    return {
      status: value.status ?? 409,
      body: { error: value.message, code: value.code },
    };
  return {
    status: value.name === "ZodError" ? 400 : 503,
    body: {
      error:
        value.name === "ZodError"
          ? "Paramètres de connexion SuperPDP invalides."
          : "L’opération SuperPDP n’a pas été confirmée. Rechargez son état avant de réessayer.",
      code: "SUPERPDP_REQUEST_FAILED",
    },
  };
};

export const createSuperPdpRouter = (
  service = new SuperPdpService(),
  readiness = new SuperPdpReadiness(),
) => {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.get("/superpdp/oauth/callback", async (req, res) => {
    // Never echo the code, state, provider error_description, or token errors into the browser.
    let result = "error";
    let entityId: string | null = null;
    try {
      const actor = await actorFor(req);
      const parameters = new URL(req.originalUrl, "https://local.invalid")
        .searchParams;
      const status = await service.callback(parameters, actor);
      entityId = status.fiscal_entity_id;
      result =
        status.status === "connected"
          ? "connected"
          : status.status === "verification_pending"
            ? "pending"
            : "error";
    } catch {
      /* Error responses and exceptions can contain OAuth material; do not log them. */
    }
    const destination = new URL("/parametres/entreprises", env.APP_PUBLIC_URL);
    destination.searchParams.set("superpdp", result);
    if (entityId) destination.searchParams.set("entreprise", entityId);
    res.redirect(303, destination.href);
  });
  router.get("/:entityId/superpdp", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await service.status(req.params.entityId));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.get("/:entityId/superpdp/readiness", async (req, res) => {
    try {
      await actorFor(req);
      res.json(await readiness.view(req.params.entityId));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.put("/:entityId/superpdp/config", async (req, res) => {
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
  router.post("/:entityId/superpdp/connect", async (req, res) => {
    try {
      res.json(await service.start(req.params.entityId, await actorFor(req)));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.post("/:entityId/superpdp/check", async (req, res) => {
    try {
      res.json(await service.check(req.params.entityId, await actorFor(req)));
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  router.delete("/:entityId/superpdp", async (req, res) => {
    try {
      res.json(
        await service.disconnect(req.params.entityId, await actorFor(req)),
      );
    } catch (error) {
      const safe = safeErrorResponse(error);
      res.status(safe.status).json(safe.body);
    }
  });
  return router;
};
