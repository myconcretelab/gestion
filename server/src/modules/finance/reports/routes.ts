import { Router } from "express";
import { getAuthenticatedAppUser } from "../../../services/serverAuth.js";
import { getReportWorkspace, mutateReportWorkspace } from "./service.js";
import { buildReportReminders } from "@contrats/shared";
import { z } from "zod";
const router = Router();
router.get("/reminders", async (req, res, next) => {
  try {
    const year = z.coerce
      .number()
      .int()
      .min(2000)
      .max(2099)
      .parse(req.query.year);
    res.json({
      reminders: buildReportReminders(await getReportWorkspace(), year),
    });
  } catch (error) {
    next(error);
  }
});
router.get("/", async (_req, res, next) => {
  try {
    res.json(await getReportWorkspace());
  } catch (error) {
    next(error);
  }
});
router.post("/commands", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    res.json(await mutateReportWorkspace(req.body, user?.id));
  } catch (error) {
    next(error);
  }
});
export default router;
