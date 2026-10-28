#!/usr/bin/env node
// Local-only controller for a PR checkout and the Vite process it starts.
import { spawn, execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const token = process.env.PR_CONTROL_TOKEN || "";
const branch =
  process.env.PR_CONTROL_BRANCH || "fix/domain-filter-and-fault-injection";
const controlPort = Number(process.env.PR_CONTROL_PORT || 5174);
const appPort = Number(process.env.PR_APP_PORT || 5173);
const appHost = process.env.PR_APP_HOST || "127.0.0.1";
const childEnv = { ...process.env };
delete childEnv.PR_CONTROL_TOKEN;
if (
  Buffer.byteLength(token) < 32 ||
  !/^[A-Za-z0-9._/-]+$/.test(branch) ||
  branch.startsWith("-") ||
  !Number.isInteger(controlPort) ||
  controlPort < 1 ||
  controlPort > 65535 ||
  !Number.isInteger(appPort) ||
  appPort < 1 ||
  appPort > 65535 ||
  controlPort === appPort ||
  !["127.0.0.1", "0.0.0.0"].includes(appHost)
) {
  throw new Error(
    "Set a PR_CONTROL_TOKEN of at least 32 bytes and valid branch, port, and app host settings.",
  );
}
const root = (
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
  })
).stdout.trim();
let app = null;
let busy = false;

async function git(...args) {
  const result = await execFileAsync("git", args, {
    cwd: root,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
    env: { ...childEnv, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}

async function stopApp() {
  const child = app;
  if (
    !child ||
    !child.pid ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    app = null;
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const timeout = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 5000);
  await exited;
  clearTimeout(timeout);
  // npm can exit before a descendant; ensure its isolated process group is gone.
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  if (app === child) app = null;
}

async function startApp() {
  if (app && app.exitCode === null && app.signalCode === null) return;
  const child = spawn(
    "npm",
    [
      "run",
      "dev",
      "--",
      "--host",
      appHost,
      "--port",
      String(appPort),
      "--strictPort",
    ],
    {
      cwd: root,
      env: childEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  app = child;
  child.once("exit", () => {
    if (app === child) app = null;
  });
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () =>
        finish(
          new Error("Application did not become ready within 30 seconds."),
        ),
      30000,
    );
    const finish = (error) => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdout.off("data", onOutput);
      if (error) reject(error);
      else resolve();
    };
    const onError = () =>
      finish(new Error("Unable to launch the application."));
    const onExit = () =>
      finish(
        new Error(
          "Application exited before becoming ready; check whether the port is already in use.",
        ),
      );
    const onOutput = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      if (/VITE\s+v[^\s]+\s+ready in/.test(output)) finish();
    };
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdout.on("data", onOutput);
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
  }).catch(async (error) => {
    await stopApp();
    throw error;
  });
}

async function syncAndRestart() {
  if ((await git("branch", "--show-current")) !== branch)
    throw new Error("Checkout is not on the configured PR branch.");
  if (await git("status", "--porcelain", "--untracked-files=no"))
    throw new Error("Tracked files have local changes; sync was refused.");
  const oldHead = await git("rev-parse", "HEAD");
  try {
    await git("fetch", "--no-tags", "origin", branch);
    await git("merge", "--ff-only", "FETCH_HEAD");
  } catch {
    throw new Error(
      "Git fetch or fast-forward failed; check origin, authentication, and branch history.",
    );
  }
  const newHead = await git("rev-parse", "HEAD");
  const dependenciesChanged =
    (await git(
      "diff",
      "--name-only",
      oldHead,
      newHead,
      "--",
      "package.json",
      "package-lock.json",
    )) !== "";
  const dependenciesInstalled =
    dependenciesChanged || !existsSync(`${root}/node_modules`);
  if (dependenciesInstalled) {
    await stopApp();
    try {
      await execFileAsync("npm", ["ci"], {
        cwd: root,
        env: childEnv,
        timeout: 600000,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      throw new Error(
        "Dependency installation failed; the application is stopped.",
      );
    }
  }
  await stopApp();
  await startApp();
  return { previousCommit: oldHead, commit: newHead, dependenciesInstalled };
}

function authorized(req) {
  const supplied = req.headers.authorization || "";
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function respond(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return respond(res, 401, { error: "Unauthorized" });
  if (
    req.headers.origin ||
    !["127.0.0.1", "localhost"].includes((req.headers.host || "").split(":")[0])
  )
    return respond(res, 403, { error: "Local non-browser requests only" });
  if (req.method === "GET" && req.url === "/status") {
    try {
      return respond(res, 200, {
        branch,
        commit: await git("rev-parse", "HEAD"),
        running: !!app,
        pid: app?.pid ?? null,
        busy,
        appHost,
        appPort,
      });
    } catch {
      return respond(res, 500, { error: "Unable to read checkout status" });
    }
  }
  if (req.method !== "POST" || !["/start", "/stop", "/sync"].includes(req.url))
    return respond(res, 404, { error: "Not found" });
  if (
    req.headers["transfer-encoding"] ||
    Number(req.headers["content-length"] || 0) !== 0
  )
    return respond(res, 400, { error: "Request body is not supported" });
  if (busy)
    return respond(res, 409, { error: "Another operation is in progress" });
  busy = true;
  try {
    let result = {};
    if (req.url === "/start") await startApp();
    if (req.url === "/stop") await stopApp();
    if (req.url === "/sync") result = await syncAndRestart();
    respond(res, 200, { ok: true, running: !!app, ...result });
  } catch (error) {
    // Do not expose git/npm output, which can contain repository credentials.
    const message =
      error instanceof Error &&
      /^(Checkout|Tracked files|Dependency|Application|Git fetch)/.test(
        error.message,
      )
        ? error.message
        : "Operation failed; inspect the controller log.";
    console.error("Control operation failed:", message);
    respond(res, 500, { error: message });
  } finally {
    busy = false;
  }
});
if ((await git("branch", "--show-current")) !== branch) {
  throw new Error("Checkout is not on the configured PR branch.");
}
server.listen(controlPort, "127.0.0.1", () => {
  console.log(`PR controller listening on 127.0.0.1:${controlPort}`);
  busy = true;
  startApp()
    .catch((error) => console.error(error.message))
    .finally(() => {
      busy = false;
    });
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    server.close();
    await stopApp();
    process.exit(0);
  });
