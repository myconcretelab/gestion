import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Router } from "express";
import { z } from "zod";
import prisma from "../db/prisma.js";
import { getAuthenticatedAppUser } from "../services/serverAuth.js";

const router = Router();
const publicRouter = Router();
const createSchema = z.object({
  documentType: z.enum(["contract", "invoice"]),
  documentId: z.string().trim().min(1),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
});
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

router.post("/", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!user?.permissions.isOwner) return res.status(403).json({ error: "Le privilège propriétaire est requis.", code: "OWNER_REQUIRED" });
    const payload = createSchema.parse(req.body);
    const exists = payload.documentType === "contract"
      ? await prisma.contrat.count({ where: { id: payload.documentId } })
      : await prisma.facture.count({ where: { id: payload.documentId } });
    if (!exists) return res.status(404).json({ error: "Document introuvable." });
    const token = crypto.randomBytes(32).toString("base64url");
    const share = await prisma.documentShare.create({ data: {
      token_hash: hashToken(token),
      document_type: payload.documentType,
      document_id: payload.documentId,
      expires_at: new Date(Date.now() + payload.expiresInHours * 3_600_000),
      created_by_id: user.id,
    } });
    res.status(201).json({ id: share.id, token, url: `/api/public/documents/${token}`, expiresAt: share.expires_at.toISOString() });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const user = await getAuthenticatedAppUser(req);
    if (!user?.permissions.isOwner) return res.status(403).json({ error: "Le privilège propriétaire est requis.", code: "OWNER_REQUIRED" });
    await prisma.documentShare.updateMany({ where: { id: req.params.id, revoked_at: null }, data: { revoked_at: new Date() } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

publicRouter.get("/:token", async (req, res, next) => {
  try {
    const share = await prisma.documentShare.findUnique({ where: { token_hash: hashToken(req.params.token) } });
    if (!share || share.revoked_at || share.expires_at <= new Date()) return res.status(404).json({ error: "Lien introuvable ou expiré." });
    const record = share.document_type === "contract"
      ? await prisma.contrat.findUnique({ where: { id: share.document_id }, select: { pdf_path: true, pdf_sent_path: true } })
      : await prisma.facture.findUnique({ where: { id: share.document_id }, select: { pdf_path: true } });
    if (!record) return res.status(404).json({ error: "Document introuvable." });
    const relativePath = "pdf_sent_path" in record && record.pdf_sent_path ? record.pdf_sent_path : record.pdf_path;
    const absolutePath = path.resolve(process.cwd(), String(relativePath));
    await fs.access(absolutePath);
    await prisma.documentShare.update({ where: { id: share.id }, data: { access_count: { increment: 1 }, last_access_at: new Date() } });
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    console.info(JSON.stringify({ level: "info", event: "document_share_access", shareId: share.id, requestId: res.getHeader("X-Request-Id") }));
    res.sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
});

export { publicRouter as publicDocumentSharesRouter };
export default router;
