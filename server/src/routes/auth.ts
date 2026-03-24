import { Router } from "express";
import { z } from "zod";
import {
  buildServerAuthSessionState,
  clearServerAuthCookie,
  createServerAuthSession,
  deleteServerAuthSession,
  isServerAuthRequired,
  readServerAuthSettings,
  setServerAuthCookie,
  verifyServerPassword,
  getServerAuthSessionIdFromRequest,
} from "../services/serverAuth.js";

const router = Router();

const loginSchema = z.object({
  password: z.string().min(1, "Le mot de passe est requis."),
});

router.get("/session", async (req, res, next) => {
  try {
    const payload = await buildServerAuthSessionState(req);
    if (payload.required && !payload.authenticated && getServerAuthSessionIdFromRequest(req)) {
      clearServerAuthCookie(req, res);
    }
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    if (!(await isServerAuthRequired())) {
      return res.status(503).json({ error: "Authentification serveur non configurée." });
    }

    const isValid = await verifyServerPassword(payload.password);
    if (!isValid) {
      clearServerAuthCookie(req, res);
      return res.status(401).json({ error: "Mot de passe invalide.", code: "AUTH_REQUIRED" });
    }

    const previousSessionId = getServerAuthSessionIdFromRequest(req);
    if (previousSessionId) {
      await deleteServerAuthSession(previousSessionId);
    }

    const session = await createServerAuthSession();
    const settings = await readServerAuthSettings();
    setServerAuthCookie(req, res, session);
    res.json({
      required: true,
      authenticated: true,
      passwordConfigured: true,
      sessionDurationHours: settings.sessionDurationHours,
      sessionExpiresAt: session.expiresAt,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await deleteServerAuthSession(getServerAuthSessionIdFromRequest(req));
    clearServerAuthCookie(req, res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
