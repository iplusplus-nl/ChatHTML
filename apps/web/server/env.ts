import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");

let loaded = false;

export function loadEnv(): void {
  if (loaded) {
    return;
  }

  dotenv.config({ path: path.join(workspaceRoot, ".env") });
  dotenv.config({ path: path.join(projectRoot, ".env"), override: true });
  loaded = true;
}

loadEnv();
