import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runtimeRouter from "./runtime";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runtimeRouter);

export default router;
