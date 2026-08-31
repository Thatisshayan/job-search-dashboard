import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerTelegramWebhook } from "../telegramWebhook";
import { startDailyScheduler } from "../scheduler";
import { assertRequiredEnv } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertRequiredEnv();

  const app = express();
  // Every real deployment target (Railway, Vercel, Manus, a Cloudflare tunnel for
  // local testing) sits behind exactly one reverse proxy hop, which sets
  // X-Forwarded-For/X-Forwarded-Proto. Without this, Express ignores those headers
  // (req.ip stays the proxy's own address) and express-rate-limit logs a
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR warning on every request instead of actually
  // rate-limiting per client.
  app.set("trust proxy", 1);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // Neither endpoint sees legitimate high-frequency traffic (a single-owner dashboard
  // and a Telegram webhook), so generous limits still stop abuse without affecting
  // normal use.
  const telegramWebhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const trpcLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api/telegram/webhook", telegramWebhookLimiter);
  registerTelegramWebhook(app);
  // tRPC API
  app.use(
    "/api/trpc",
    trpcLimiter,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  startDailyScheduler();
}

startServer().catch(console.error);
