import { Router } from "express";
import { getAuthenticatedAppUser } from "../../../services/serverAuth.js";
import { getReportAllocation, saveReportAllocation } from "./allocation.js";
const router = Router({ mergeParams: true });
router.get<{ id: string }>("/", async (req, res, next) => {
  try {
    res.json(await getReportAllocation(req.params.id));
  } catch (error) {
    next(error);
  }
});
router.put<{ id: string }>("/", async (req, res, next) => {
  try {
    res.json(
      await saveReportAllocation(
        req.params.id,
        req.body,
        (await getAuthenticatedAppUser(req))?.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});
export default router;
