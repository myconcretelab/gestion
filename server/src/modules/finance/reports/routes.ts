import { Router } from "express";
import { getAuthenticatedAppUser } from "../../../services/serverAuth.js";
import { getReportWorkspace, mutateReportWorkspace } from "./service.js";
const router = Router();
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
