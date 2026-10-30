import { Router } from "express";
import { z } from "zod";
import { RESERVATION_PAYMENT_METHODS } from "@contrats/shared";
import {
  addReservationPayment,
  getReservationPaymentTracking,
  voidReservationPayment,
} from "../modules/reservationPayments/ledger.js";

const router = Router({ mergeParams: true });
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }, "Date de paiement invalide.");
const paymentSchema = z
  .object({
    id: z.string().uuid(),
    amount: z
      .number()
      .positive()
      .max(10_000_000)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
        "Utilisez au plus deux décimales.",
      ),
    method: z.enum(RESERVATION_PAYMENT_METHODS),
    purpose: z.enum(["deposit", "balance", "payment", "full", "extras"]),
    channel: z.string().trim().min(1).max(60).optional(),
    category: z
      .enum(["accommodation", "cleaning", "linen", "extras", "tourist_tax"])
      .optional(),
    fee_amount: z
      .number()
      .min(0)
      .max(10000000)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
        "Utilisez au plus deux décimales.",
      )
      .optional(),
    paid_on: dateSchema,
    note: z.string().trim().max(500).nullable().optional(),
    shortcut_id: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.category || value.fee_amount !== undefined) && !value.channel)
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: "Précisez le canal de distribution.",
      });
    if (value.channel && value.method !== "Versement plateforme")
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: "Choisissez Versement plateforme pour ce canal.",
      });
  });
router.get<{ id: string }>("/", async (req, res, next) => {
  try {
    res.json(await getReservationPaymentTracking(req.params.id));
  } catch (error) {
    next(error);
  }
});
router.post<{ id: string }>("/", async (req, res, next) => {
  try {
    res
      .status(201)
      .json(
        await addReservationPayment(
          req.params.id,
          paymentSchema.parse(req.body),
        ),
      );
  } catch (error) {
    next(error);
  }
});
router.post<{ id: string; paymentId: string }>(
  "/:paymentId/void",
  async (req, res, next) => {
    try {
      res.json(
        await voidReservationPayment(req.params.id, req.params.paymentId),
      );
    } catch (error) {
      next(error);
    }
  },
);
export default router;
