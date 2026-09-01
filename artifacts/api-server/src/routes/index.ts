import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runtimeRouter from "./runtime";
import memoryRouter from "./memory";
import externalRouter from "./external";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runtimeRouter);
router.use(memoryRouter);
router.use(externalRouter);

export default router;
