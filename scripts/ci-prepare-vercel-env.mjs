import fs from "node:fs";
import path from "node:path";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL was not provided by convex deploy");
}

const envFile = path.join(".vercel", ".env.production.local");
fs.mkdirSync(path.dirname(envFile), { recursive: true });

const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
const lines = existing
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("NEXT_PUBLIC_CONVEX_URL="));

lines.push(`NEXT_PUBLIC_CONVEX_URL=${JSON.stringify(convexUrl)}`);
fs.writeFileSync(envFile, `${lines.join("\n")}\n`);

console.log("Prepared Vercel production env with Convex deployment URL.");
