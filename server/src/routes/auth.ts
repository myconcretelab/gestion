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
  findUserForLogin,
  getServerAuthSessionIdFromRequest,
  isPasswordRecoveryAvailable,
  requestPasswordReset,
  resetPasswordWithToken,
} from "../services/serverAuth.js";
import {
  checkRequestThrottle,
  clearRequestThrottleFailures,
  LOGIN_THROTTLE_CONFIG,
  PASSWORD_RESET_CONFIRM_THROTTLE_CONFIG,
  PASSWORD_RESET_THROTTLE_CONFIG,
  recordRequestThrottleFailure,
  sendThrottleResponse,
} from "../services/requestThrottle.js";

const router = Router();

const loginSchema = z.object({
  loginId: z.string().trim().min(1, "L’identifiant ou l’adresse e-mail est requis.").max(180),
  password: z.string().min(1, "Le mot de passe est requis."),
});

const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(180),
});

const passwordResetSchema = z.object({
  token: z.string().min(32).max(512),
  password: z.string().min(12).max(512),
});

router.get("/users", (_req, res) => {
  res.status(404).json({ error: "Endpoint introuvable.", code: "NOT_FOUND" });
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

router.get("/password-recovery", (_req, res) => {
  res.json({ available: isPasswordRecoveryAvailable() });
});

router.post("/password-reset/request", async (req, res, next) => {
  try {
    const payload = passwordResetRequestSchema.parse(req.body);
    const throttleState = await checkRequestThrottle(req, res, PASSWORD_RESET_THROTTLE_CONFIG);
    if (throttleState.blocked) return sendThrottleResponse(res, throttleState);
    const nextThrottleState = await recordRequestThrottleFailure(req, res, PASSWORD_RESET_THROTTLE_CONFIG);
    if (nextThrottleState.blocked) return sendThrottleResponse(res, nextThrottleState);
    await requestPasswordReset(payload.identifier);
    res.status(202).json({ message: "Si un compte actif correspond et possède une adresse e-mail, un lien vient d’être envoyé." });
  } catch (error) {
    next(error);
  }
});

router.post("/password-reset/confirm", async (req, res, next) => {
  try {
    const payload = passwordResetSchema.parse(req.body);
    const throttleState = await checkRequestThrottle(req, res, PASSWORD_RESET_CONFIRM_THROTTLE_CONFIG);
    if (throttleState.blocked) return sendThrottleResponse(res, throttleState);
    await resetPasswordWithToken(payload.token, payload.password);
    await clearRequestThrottleFailures(req, res, PASSWORD_RESET_CONFIRM_THROTTLE_CONFIG);
    clearServerAuthCookie(req, res);
    res.json({ reset: true });
  } catch (error) {
    const failureState = await recordRequestThrottleFailure(req, res, PASSWORD_RESET_CONFIRM_THROTTLE_CONFIG);
    if (failureState.blocked) return sendThrottleResponse(res, failureState);
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    if (!(await isServerAuthRequired())) {
      return res.status(503).json({ error: "Authentification serveur non configurée." });
    }

    const throttleState = await checkRequestThrottle(req, res, LOGIN_THROTTLE_CONFIG);
    if (throttleState.blocked) return sendThrottleResponse(res, throttleState);

    const user = await findUserForLogin(payload.loginId);
    const isValid = user ? await verifyServerPassword(payload.password, user.id) : false;
    if (!user || !isValid) {
      clearServerAuthCookie(req, res);
      const failureState = await recordRequestThrottleFailure(req, res, LOGIN_THROTTLE_CONFIG);
      if (failureState.blocked) return sendThrottleResponse(res, failureState);
      return res.status(401).json({ error: "Identifiant ou mot de passe invalide.", code: "AUTH_REQUIRED" });
    }

    await clearRequestThrottleFailures(req, res, LOGIN_THROTTLE_CONFIG);

    const previousSessionId = getServerAuthSessionIdFromRequest(req);
    if (previousSessionId) {
      await deleteServerAuthSession(previousSessionId);
    }

    const session = await createServerAuthSession(user.id);
    const settings = await readServerAuthSettings();
    setServerAuthCookie(req, res, session);
    res.json({
      required: true,
      authenticated: true,
      passwordConfigured: true,
      sessionDurationHours: settings.sessionDurationHours,
      sessionExpiresAt: session.expiresAt,
      user,
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
