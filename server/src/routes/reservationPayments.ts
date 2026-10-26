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
    purpose: z.enum(["deposit", "balance", "payment"]),
    paid_on: dateSchema,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
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
