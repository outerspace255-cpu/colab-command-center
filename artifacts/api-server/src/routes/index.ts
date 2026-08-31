import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runtimeRouter from "./runtime";
import memoryRouter from "./memory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runtimeRouter);
router.use(memoryRouter);

export default router;
