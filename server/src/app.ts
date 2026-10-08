import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import authRouter from "./routes/auth.js";
import gitesRouter from "./modules/properties/routes.js";
import publicGitesRouter from "./routes/publicGites.js";
import publicCleaningCheckRouter from "./routes/publicCleaningCheck.js";
import managersRouter from "./routes/managers.js";
import contractsRouter from "./routes/contracts.js";
import invoicesRouter from "./routes/invoices.js";
import reservationsRouter from "./modules/reservations/routes.js";
import bookedRouter from "./routes/booked.js";
import bookingRequestsRouter from "./routes/bookingRequests.js";
import statisticsRouter from "./routes/statistics.js";
import settingsRouter from "./modules/settings/routes.js";
import usersRouter from "./routes/users.js";
import intervenantsRouter from "./routes/intervenants.js";
import intervenantHoursRouter from "./routes/intervenantHours.js";
import userInterventionsRouter from "./routes/userInterventions.js";
import professionalExpensesRouter from "./routes/professionalExpenses.js";
import guestNightDeclarationsRouter from "./routes/guestNightDeclarations.js";
import urssafDeclarationsRouter from "./routes/urssafDeclarations.js";
import schoolHolidaysRouter from "./routes/schoolHolidays.js";
import todayRouter from "./routes/today.js";
import personalExpensesRouter from "./routes/personalExpenses.js";
import { planningRelayPeriodsRouter, publicPlanningRelayRouter } from "./routes/planningRelayPeriods.js";
import cleaningTasksRouter from "./modules/operations/cleaningTasks.js";
import actionTasksRouter from "./modules/operations/actionTasks.js";
import documentSharesRouter, { publicDocumentSharesRouter } from "./routes/documentShares.js";
import installationRouter from "./routes/installation.js";
import productSettingsRouter from "./routes/productSettings.js";
import { hasValidCronTriggerToken } from "./utils/cronTriggerAuth.js";
import { isPublicApiPath } from "./utils/publicApiPath.js";
import { enforceRequestRateLimit, PUBLIC_API_THROTTLE_CONFIG, sendThrottleResponse } from "./services/requestThrottle.js";
import {
  buildServerAuthRequiredError,
  clearServerAuthCookie,
  getServerAuthSessionFromRequest,
  getAuthenticatedAppUser,
  isServerAuthRequired,
} from "./services/serverAuth.js";
import { canActAsRequestedUser, containsMonetaryFields, getRequiredBusinessPermission, hasBusinessPermission, isAmountsOnlyApiPath, isWriteMethod, redactMonetaryJson } from "./services/accessControl.js";
import { getModuleForApiPath, isModuleEnabled } from "./services/installationConfig.js";
import { assertRequestedOrganization, HISTORICAL_ORGANIZATION_ID, runWithOrganization } from "./services/organizationContext.js";
import { systemPrisma } from "./db/prisma.js";
import billingRouter from "./modules/billing/routes.js";
import platformBillingRouter from "./modules/billing/platformRoutes.js";
import { assertCreationQuota, assertSubscriptionWriteAllowed, quotaMetricForRequest } from "./modules/billing/service.js";
import { stripeWebhookHandler } from "./modules/billing/webhookRoutes.js";
import { verifyScopedApiToken } from "./services/apiTokens.js";

const getHttpErrorPayload = (err: Error) => {
  const maybeHttpError = err as Error & {
    statusCode?: unknown;
    status?: unknown;
    code?: unknown;
    details?: unknown;
  };
  const rawStatus = typeof maybeHttpError.statusCode === "number"
    ? maybeHttpError.statusCode
    : typeof maybeHttpError.status === "number"
      ? maybeHttpError.status
      : 500;
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

  return {
    status,
    body: {
      error: err.message,
      ...(typeof maybeHttpError.code === "string" ? { code: maybeHttpError.code } : {}),
      ...(maybeHttpError.details !== undefined ? { details: maybeHttpError.details } : {}),
    },
  };
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  // Express' simple parser avoids the optional qs parser and rejects nested query-object tricks.
  app.set("query parser", "simple");

  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const requestId = String(req.headers["x-request-id"] ?? "").trim().slice(0, 128) || crypto.randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'");
    if (env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.post("/api/billing/webhook/stripe", express.raw({ type: "application/json", limit: "2mb" }), stripeWebhookHandler);
  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
      exposedHeaders: [
        "X-Contract-Overflow",
        "X-Contract-Overflow-After",
        "X-Contract-Compact",
        "X-Invoice-Overflow",
        "X-Invoice-Overflow-After",
        "X-Invoice-Compact",
      ],
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/ready", async (_req, res) => {
    try {
      await systemPrisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, database: "ready" });
    } catch {
      res.status(503).json({ ok: false, database: "unavailable" });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/platform/billing", platformBillingRouter);
  app.use("/api", async (req, _res, next) => {
    try {
      const session = await getServerAuthSessionFromRequest(req);
      const organizationId = session?.organizationId ?? HISTORICAL_ORGANIZATION_ID;
      runWithOrganization({
        organizationId,
        source: session ? "session" : "historical-compatibility",
      }, () => {
        const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
        assertRequestedOrganization(body.organization_id ?? body.organizationId);
        assertRequestedOrganization(req.query.organization_id ?? req.query.organizationId);
        next();
      });
    } catch (error) {
      next(error);
    }
  });
  app.use("/api/installation", installationRouter);
  app.use("/api", async (req, res, next) => {
    try {
      const requiredModule = getModuleForApiPath(req.path);
      if (isPublicApiPath(req.path)) {
        if (requiredModule && !(await isModuleEnabled(requiredModule))) {
          return res.status(404).json({ error: "Fonctionnalité désactivée.", code: "MODULE_DISABLED", module: requiredModule });
        }
        const throttle = await enforceRequestRateLimit(req, res, PUBLIC_API_THROTTLE_CONFIG);
        if (throttle.blocked) return sendThrottleResponse(res, throttle);
        return next();
      }

      if (/^\/gites\/[^/]+\/calendar\.ics$/i.test(req.path)) {
        return next();
      }

      if (/^\/reservations\/integrations\/what-today$/i.test(req.path)) {
        return next();
      }

      if (
        (
          /^\/settings\/ical\/cron\/run$/i.test(req.path) ||
          /^\/settings\/pump\/cron\/run$/i.test(req.path) ||
          /^\/settings\/daily-reservation-email\/run$/i.test(req.path) ||
          /^\/settings\/smartlife\/run$/i.test(req.path)
        ) &&
        hasValidCronTriggerToken(req)
      ) {
        return next();
      }

      if (
        /^\/booked(?:\/|$)/i.test(req.path) &&
        await verifyScopedApiToken(req, "booked:access")
      ) {
        if (requiredModule && !(await isModuleEnabled(requiredModule))) {
          return res.status(404).json({ error: "Fonctionnalité désactivée.", code: "MODULE_DISABLED", module: requiredModule });
        }
        return next();
      }

      if (!(await isServerAuthRequired())) {
        if (requiredModule && !(await isModuleEnabled(requiredModule))) {
          return res.status(404).json({ error: "Fonctionnalité désactivée.", code: "MODULE_DISABLED", module: requiredModule });
        }
        return next();
      }

      const session = await getServerAuthSessionFromRequest(req);
      const user = session ? await getAuthenticatedAppUser(req) : null;
      if (session && user) {
        if (isWriteMethod(req.method) && !req.path.startsWith("/billing/portal") && !req.path.startsWith("/billing/checkout")) {
          await assertSubscriptionWriteAllowed(session.organizationId);
          const quotaMetric = quotaMetricForRequest(req.method, req.path, req.body);
          if (quotaMetric) await assertCreationQuota(session.organizationId, quotaMetric);
        }
        const requiredPermission = getRequiredBusinessPermission(req.method, req.path);
        if (requiredPermission && !hasBusinessPermission(user, requiredPermission)) {
          return res.status(403).json({
            error: "Permission métier insuffisante.",
            code: "BUSINESS_PERMISSION_REQUIRED",
            permission: requiredPermission,
          });
        }
        if (!canActAsRequestedUser(user, req.path, req.body)) {
          return res.status(403).json({
            error: "Vous ne pouvez pas agir sous l’identité d’un autre utilisateur.",
            code: "SUBJECT_ACCESS_REQUIRED",
          });
        }
        if (requiredModule && !(await isModuleEnabled(requiredModule))) {
          return res.status(404).json({ error: "Fonctionnalité désactivée.", code: "MODULE_DISABLED", module: requiredModule });
        }
        if (!user.permissions.canViewAmounts) {
          if (isWriteMethod(req.method) && containsMonetaryFields(req.body)) {
            return res.status(403).json({
              error: "Le privilège d'accès aux montants est requis pour modifier ces données.",
              code: "AMOUNTS_ACCESS_REQUIRED",
            });
          }
          if (isAmountsOnlyApiPath(req.path)) {
            return res.status(403).json({
              error: "Le privilège d'accès aux montants est requis.",
              code: "AMOUNTS_ACCESS_REQUIRED",
            });
          }
          return redactMonetaryJson(req, res, next);
        }
        return next();
      }

      if (req.headers.cookie) {
        clearServerAuthCookie(req, res);
      }

      const unauthorized = buildServerAuthRequiredError();
      return res.status(unauthorized.status).json(unauthorized.body);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/metrics", (_req, res) => {
    const memory = process.memoryUsage();
    res.json({ uptimeSeconds: Math.round(process.uptime()), memoryRssBytes: memory.rss, heapUsedBytes: memory.heapUsed });
  });

  app.use("/api/billing", billingRouter);

  app.use("/api/gites", gitesRouter);
  app.use("/api/public/gites", publicGitesRouter);
  app.use("/api/public/cleaning-check", publicCleaningCheckRouter);
  app.use("/api/public/planning-relay", publicPlanningRelayRouter);
  app.use("/api/public/documents", publicDocumentSharesRouter);
  app.use("/api/managers", managersRouter);
  app.use("/api/contracts", contractsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/booked", bookedRouter);
  app.use("/api/booking-requests", bookingRequestsRouter);
  app.use("/api/statistics", statisticsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/settings", productSettingsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/intervenants/hours", intervenantHoursRouter);
  app.use("/api/intervenants", intervenantsRouter);
  app.use("/api/interventions", userInterventionsRouter);
  app.use("/api/professional-expenses", professionalExpensesRouter);
  app.use("/api/guest-night-declarations", guestNightDeclarationsRouter);
  app.use("/api/urssaf-declarations", urssafDeclarationsRouter);
  app.use("/api/school-holidays", schoolHolidaysRouter);
  app.use("/api/today", todayRouter);
  app.use("/api/personal-expenses", personalExpensesRouter);
  app.use("/api/planning-relay-periods", planningRelayPeriodsRouter);
  app.use("/api/cleaning-tasks", cleaningTasksRouter);
  app.use("/api/action-tasks", actionTasksRouter);
  app.use("/api/document-shares", documentSharesRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint introuvable.", code: "NOT_FOUND" });
  });

  const clientDistCandidates = [
    process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : null,
    path.join(process.cwd(), "client", "dist"),
    path.join(process.cwd(), "..", "client", "dist"),
  ].filter(Boolean) as string[];

  const clientDist = clientDistCandidates.find((candidate) => fs.existsSync(candidate));

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId = String(res.getHeader("X-Request-Id") ?? "");
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation", details: err.flatten(), requestId });
    }
    if (err instanceof Error) {
      const payload = getHttpErrorPayload(err);
      if (payload.status >= 500) {
        console.error(JSON.stringify({ level: "error", requestId, method: req.method, path: req.path, error: err.message }));
        return res.status(payload.status).json({ error: "Erreur interne", code: "INTERNAL_ERROR", requestId });
      }
      return res.status(payload.status).json({ ...payload.body, requestId });
    }
    console.error(JSON.stringify({ level: "error", requestId, method: req.method, path: req.path, error: "unknown" }));
    return res.status(500).json({ error: "Erreur interne", code: "INTERNAL_ERROR", requestId });
  });

  return app;
};
