import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleOpenRouterChat } from "./openrouter.js";
import { handleRetrievalRequest } from "./retrieval.js";
import { handleGetSessions, handleSaveSessions } from "./sessions.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");
const clientDist = path.join(projectRoot, "dist");

dotenv.config({ path: path.join(workspaceRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env"), override: true });

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8787);

app.disable("x-powered-by");
app.use(express.json({ limit: "24mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", handleOpenRouterChat);
app.post("/api/retrieve", handleRetrievalRequest);
app.get("/api/sessions", handleGetSessions);
app.put("/api/sessions", handleSaveSessions);

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`StreamUI proxy listening on http://${host}:${port}`);
});
