import { Router } from "express";
import { getAuthenticatedAppUser } from "../../../services/serverAuth.js";
import { getReportWorkspace, mutateReportWorkspace } from "./service.js";
import { buildReportReminders } from "@contrats/shared";
import { z } from "zod";
import {
  applyOtaImport,
  listOtaImports,
  previewOtaImport,
} from "./otaImport.js";
const router = Router();
const importBody = z
  .object({
    content: z.string().min(1).max(5_000_000),
    fileName: z.string().trim().min(1).max(200),
    fingerprint: z.string().length(64),
    choices: z
      .array(
        z
          .object({
            key: z.string().max(500),
            reservationId: z.string().min(1).max(100),
            settlementBasis: z.enum(["net", "gross", "reservation"]).optional(),
            category: z
              .enum([
                "accommodation",
                "cleaning",
                "linen",
                "extras",
                "tourist_tax",
              ])
              .optional(),
            paymentId: z.string().max(100).optional(),
            regularizeOneCent: z.boolean().optional(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
router.get("/ota/imports", async (_req, res, next) => {
  try {
    res.json(await listOtaImports());
  } catch (error) {
    next(error);
  }
});
router.post("/ota/preview", async (req, res, next) => {
  try {
    const { content } = z
      .object({ content: z.string().min(1).max(5_000_000) })
      .strict()
      .parse(req.body);
    res.json(await previewOtaImport(content));
  } catch (error) {
    next(error);
  }
});
router.post("/ota/apply", async (req, res, next) => {
  try {
    const input = importBody.parse(req.body);
    input.fileName = input.fileName.split(/[\\/]/).pop()!;
    res.json(
      await applyOtaImport(input, (await getAuthenticatedAppUser(req))?.id),
    );
  } catch (error) {
    next(error);
  }
});
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
