import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import gitesRouter from "./routes/gites.js";
import managersRouter from "./routes/managers.js";
import contractsRouter from "./routes/contracts.js";
import invoicesRouter from "./routes/invoices.js";
import reservationsRouter from "./routes/reservations.js";
import statisticsRouter from "./routes/statistics.js";
import settingsRouter from "./routes/settings.js";
import urssafDeclarationsRouter from "./routes/urssafDeclarations.js";
import schoolHolidaysRouter from "./routes/schoolHolidays.js";
import todayRouter from "./routes/today.js";
import { hasValidCronTriggerToken, parseBearerToken } from "./utils/cronTriggerAuth.js";

export const createApp = () => {
  const app = express();

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

  if (env.BASIC_AUTH_PASSWORD) {
    app.use((req, res, next) => {
      if (/^\/api\/gites\/[^/]+\/calendar\.ics$/i.test(req.path)) {
        return next();
      }

      if (/^\/api\/settings\/ical\/cron\/run$/i.test(req.path) && hasValidCronTriggerToken(req)) {
        return next();
      }

      const header = req.headers.authorization ?? "";
      if (env.INTEGRATION_API_TOKEN) {
        const bearer = parseBearerToken(header);
        if (bearer === env.INTEGRATION_API_TOKEN) {
          return next();
        }
      }

      const [type, encoded] = header.split(" ");
      if (type !== "Basic" || !encoded) {
        res.setHeader("WWW-Authenticate", "Basic");
        return res.status(401).json({ error: "Authentification requise" });
      }
      const decoded = Buffer.from(encoded, "base64").toString("utf-8");
      const [, password] = decoded.split(":");
      if (password !== env.BASIC_AUTH_PASSWORD) {
        res.setHeader("WWW-Authenticate", "Basic");
        return res.status(401).json({ error: "Mot de passe invalide" });
      }
      return next();
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/gites", gitesRouter);
  app.use("/api/managers", managersRouter);
  app.use("/api/contracts", contractsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/statistics", statisticsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/urssaf-declarations", urssafDeclarationsRouter);
  app.use("/api/school-holidays", schoolHolidaysRouter);
  app.use("/api/today", todayRouter);

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
      return res.status(500).json({ error: err.message });
    }
    return res.status(500).json({ error: "Erreur inconnue" });
  });

  return app;
};
