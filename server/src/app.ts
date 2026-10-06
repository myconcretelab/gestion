import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import authRouter from "./routes/auth.js";
import gitesRouter from "./routes/gites.js";
import publicGitesRouter from "./routes/publicGites.js";
import publicCleaningCheckRouter from "./routes/publicCleaningCheck.js";
import managersRouter from "./routes/managers.js";
import contractsRouter from "./routes/contracts.js";
import invoicesRouter from "./routes/invoices.js";
import reservationsRouter from "./routes/reservations.js";
import bookedRouter from "./routes/booked.js";
import bookingRequestsRouter from "./routes/bookingRequests.js";
import statisticsRouter from "./routes/statistics.js";
import settingsRouter from "./routes/settings.js";
import usersRouter from "./routes/users.js";
import intervenantsRouter from "./routes/intervenants.js";
import intervenantHoursRouter from "./routes/intervenantHours.js";
import professionalExpensesRouter from "./routes/professionalExpenses.js";
import guestNightDeclarationsRouter from "./routes/guestNightDeclarations.js";
import urssafDeclarationsRouter from "./routes/urssafDeclarations.js";
import schoolHolidaysRouter from "./routes/schoolHolidays.js";
import todayRouter from "./routes/today.js";
import personalExpensesRouter from "./routes/personalExpenses.js";
import { planningRelayPeriodsRouter, publicPlanningRelayRouter } from "./routes/planningRelayPeriods.js";
import { hasValidCronTriggerToken, parseBearerToken } from "./utils/cronTriggerAuth.js";
import { isPublicApiPath } from "./utils/publicApiPath.js";
import {
  buildServerAuthRequiredError,
  clearServerAuthCookie,
  getServerAuthSessionFromRequest,
  getAuthenticatedAppUser,
  isServerAuthRequired,
} from "./services/serverAuth.js";
import { containsMonetaryFields, getRequiredPageForApiPath, isAmountsOnlyApiPath, isWriteMethod, redactMonetaryJson } from "./services/accessControl.js";

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

  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(express.json({ limit: "20mb" }));
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

  app.use("/api/auth", authRouter);
  app.use("/api", async (req, res, next) => {
    try {
      if (isPublicApiPath(req.path)) {
        return next();
      }

      if (/^\/gites\/[^/]+\/calendar\.ics$/i.test(req.path)) {
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

      const header = req.headers.authorization ?? "";
      if (env.INTEGRATION_API_TOKEN) {
        const bearer = parseBearerToken(header);
        if (bearer === env.INTEGRATION_API_TOKEN) {
          return next();
        }
      }

      if (!(await isServerAuthRequired())) {
        return next();
      }

      const session = await getServerAuthSessionFromRequest(req);
      const user = session ? await getAuthenticatedAppUser(req) : null;
      if (session && user) {
        const requiredPage = getRequiredPageForApiPath(req.path);
        if (requiredPage && !user.permissions.isOwner && !user.pageAccess.includes(requiredPage)) {
          return res.status(403).json({
            error: "Cet utilisateur n’a pas accès à cette page.",
            code: "PAGE_ACCESS_REQUIRED",
          });
        }
        if (isWriteMethod(req.method) && !user.permissions.canWrite) {
          return res.status(403).json({
            error: "Cet utilisateur dispose d'un accès en lecture seule.",
            code: "WRITE_ACCESS_REQUIRED",
          });
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

  app.use("/api/gites", gitesRouter);
  app.use("/api/public/gites", publicGitesRouter);
  app.use("/api/public/cleaning-check", publicCleaningCheckRouter);
  app.use("/api/public/planning-relay", publicPlanningRelayRouter);
  app.use("/api/managers", managersRouter);
  app.use("/api/contracts", contractsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/booked", bookedRouter);
  app.use("/api/booking-requests", bookingRequestsRouter);
  app.use("/api/statistics", statisticsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/intervenants/hours", intervenantHoursRouter);
  app.use("/api/intervenants", intervenantsRouter);
  app.use("/api/professional-expenses", professionalExpensesRouter);
  app.use("/api/guest-night-declarations", guestNightDeclarationsRouter);
  app.use("/api/urssaf-declarations", urssafDeclarationsRouter);
  app.use("/api/school-holidays", schoolHolidaysRouter);
  app.use("/api/today", todayRouter);
  app.use("/api/personal-expenses", personalExpensesRouter);
  app.use("/api/planning-relay-periods", planningRelayPeriodsRouter);

  const clientDistCandidates = [
    process.env.CLIENT_DIST_DIR ? path.resolve(process.env.CLIENT_DIST_DIR) : null,
    path.join(process.cwd(), "client", "dist"),
    path.join(process.cwd(), "..", "client", "dist"),
  ].filter(Boolean) as string[];

  const clientDist = clientDistCandidates.find((candidate) => fs.existsSync(candidate));

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation", details: err.flatten() });
    }
    if (err instanceof Error) {
      const payload = getHttpErrorPayload(err);
      return res.status(payload.status).json(payload.body);
    }
    return res.status(500).json({ error: "Erreur inconnue" });
  });

  return app;
};
