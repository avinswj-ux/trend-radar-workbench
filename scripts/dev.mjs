import { spawn } from "node:child_process";

const environment = { ...process.env, NODE_USE_ENV_PROXY: "1" };
for (const key of [
  "TEXT_ANALYSIS_PROVIDER",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_BASE_URL",
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_BASE_URL",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
  "DASHSCOPE_VISION_MODEL",
  "YOUTUBE_API_KEY",
]) delete environment[key];

const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--env-file=.env", "--env-file=.env.local", "--import", "tsx", "src/worker/index.ts"], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      stop();
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
}
