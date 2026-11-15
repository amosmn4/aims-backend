const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const isProduction = process.env.NODE_ENV === "production";
const productionEntry = path.resolve(__dirname, "..", "dist", "main.js");

if (isProduction && !existsSync(productionEntry)) {
  console.error("Production build not found. Run `npm run build` before starting the server.");
  process.exit(1);
}

const commandArgs = isProduction
  ? [productionEntry]
  : [require.resolve("@nestjs/cli/bin/nest.js"), "start"];
const server = spawn(process.execPath, commandArgs, { stdio: "inherit" });

server.on("error", (error) => {
  console.error("Failed to start the backend:", error.message);
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
