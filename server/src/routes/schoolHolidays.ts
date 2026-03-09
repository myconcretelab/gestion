import { Router } from "express";
import { z } from "zod";
import { getSchoolHolidaysForRange } from "../services/schoolHolidays.js";

const router = Router();

const schoolHolidayQuerySchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  zone: z.string().trim().min(1).max(8).optional().default("B"),
});

router.get("/", async (req, res, next) => {
  try {
    const query = schoolHolidayQuerySchema.parse({
      from: req.query.from,
      to: req.query.to,
      zone: req.query.zone,
    });

    const holidays = await getSchoolHolidaysForRange(query);
    res.json(holidays);
  } catch (error) {
    next(error);
  }
});

export default router;
