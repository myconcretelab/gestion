import { Router } from "express";
import { getAuthenticatedAppUser } from "../../../services/serverAuth.js";
import { getReportWorkspace, mutateReportWorkspace } from "./service.js";
import { getStoredReportReminders } from "./cache.js";
import { getNightSummaries } from "./nightSummaries.js";
import { z } from "zod";
import {
  nightRegisterCsv,
  nightDeclarationCsv,
  reportMonthSchema,
  reportMutationSchema,
} from "@contrats/shared";
import { getNightRegister } from "./nightRegister.js";
import { renderNightRegisterHtml } from "./nightRegisterRender.js";
import { generatePlanningPdf } from "../../../services/pdfService.js";
import {
  applyOtaImport,
  listOtaImports,
  previewOtaImport,
} from "./otaImport.js";
import { readRemittanceReceipt } from "./remittances.js";
const router = Router();
router.post("/receipts", async (req, res, next) => {
  try {
    const input = reportMutationSchema.parse(req.body);
    if (input.command.type !== "remittance-receipt")
      return res.status(400).json({ error: "Justificatif attendu." });
    res.json(
      await mutateReportWorkspace(
        input,
        (await getAuthenticatedAppUser(req))?.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});
router.get(
  "/remittances/:remittanceId/payments/:paymentId/receipts/:receiptId",
  async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const state = await getReportWorkspace();
      const receipt = state.taxRemittances
        ?.find((r) => r.id === req.params.remittanceId)
        ?.payments.find((p) => p.id === req.params.paymentId)
        ?.receipts?.find((r) => r.id === req.params.receiptId);
      if (!receipt)
        return res.status(404).json({ error: "Justificatif introuvable." });
      const content = await readRemittanceReceipt(receipt);
      res.attachment(receipt.name).type(receipt.contentType).send(content);
    } catch (error) {
      next(error);
    }
  },
);
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
    res.json(await getStoredReportReminders(year));
  } catch (error) {
    next(error);
  }
});
router.get("/night-summaries", async (req, res, next) => {
  try {
    const year = z.coerce
      .number()
      .int()
      .min(2000)
      .max(2099)
      .parse(req.query.year);
    res.json(await getNightSummaries(year));
  } catch (error) {
    next(error);
  }
});
router.get("/", async (req, res, next) => {
  try {
    const { refresh } = z
      .object({ refresh: z.literal("1").optional() })
      .parse(req.query);
    res.json(await getReportWorkspace({ force: refresh === "1" }));
  } catch (error) {
    next(error);
  }
});
router.get("/:reportId/night-register", async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { month, format, revision, source, resolution, archiveKey } = z
      .object({
        month: reportMonthSchema,
        format: z.enum(["json", "csv", "summary-csv", "pdf"]).default("json"),
        source: z.enum(["current", "confirmed"]).default("current"),
        resolution: z.coerce.number().int().min(0).max(10000).optional(),
        archiveKey: z.string().min(1).max(250).optional(),
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .parse(req.query);
    if ((resolution !== undefined || archiveKey) && source !== "confirmed")
      return res.status(400).json({
        error: "Choisissez une copie confirmée pour consulter une résolution.",
      });
    const register = await getNightRegister(
      req.params.reportId,
      month,
      source === "confirmed" ? { resolution, key: archiveKey } : undefined,
    );
    if (revision && revision !== register.revision)
      return res.status(409).json({
        error:
          "Les données du registre ont changé. Rechargez son aperçu avant de télécharger.",
      });
    if (format === "json") return res.json(register);
    res.attachment(
      `${format === "summary-csv" ? "synthese-nuitees" : "registre-sejours"}-${month}.${format === "summary-csv" ? "csv" : format}`,
    );
    if (format === "csv" || format === "summary-csv")
      return res
        .type("text/csv; charset=utf-8")
        .send(
          format === "summary-csv"
            ? nightDeclarationCsv(register)
            : nightRegisterCsv(register),
        );
    res.type("application/pdf").send(
      await generatePlanningPdf(renderNightRegisterHtml(register), {
        landscape: true,
        pageNumbers: true,
      }),
    );
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
