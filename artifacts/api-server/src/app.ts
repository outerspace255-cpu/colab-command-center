import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  BUSY_MESSAGE,
  claimSeat,
  getClientId,
  isSeatBusy,
} from "./lib/occupancy";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (req, res, next): void => {
  // Health checks must remain public so platform monitors never claim the seat.
  if (req.path === "/healthz" || req.path === "/occupancy") {
    next();
    return;
  }
  // Let the occupancy handshake establish the browser cookie first. This
  // prevents concurrent first-load requests from generating different client
  // ids and blocking the very first visitor.
  if (!req.headers.cookie?.includes("ccc_client_id=") && !isSeatBusy()) {
    next();
    return;
  }
  const clientId = getClientId(req, res);
  if (!claimSeat(clientId)) {
    res.status(503).json({ error: BUSY_MESSAGE });
    return;
  }
  next();
});

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const frontendDir = path.resolve(
    import.meta.dirname,
    "../../colab-command-center/dist/public",
  );
  app.use(express.static(frontendDir));
  app.get("/{*splat}", (req, res, next): void => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

export default app;
