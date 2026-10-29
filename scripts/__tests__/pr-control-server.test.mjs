import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const controller = fileURLToPath(
  new URL("../pr-control-server.mjs", import.meta.url),
);
const branch = "fix/domain-filter-and-fault-injection";
const token = "test-token-which-is-longer-than-32-bytes";
function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
async function freePort() {
  return await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}
async function until(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
    await delay(50);
  }
  throw new Error("Timed out waiting for controller");
}

test("controls only its child, securely syncs a clean PR branch and rejects unsafe requests", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "dclab-control-"));
  const bare = join(base, "remote.git"),
    checkout = join(base, "checkout"),
    writer = join(base, "writer"),
    bin = join(base, "bin");
  mkdirSync(bin);
  git(base, "init", "--bare", bare);
  git(base, "clone", bare, checkout);
  git(checkout, "config", "user.email", "test@example.invalid");
  git(checkout, "config", "user.name", "Test");
  git(checkout, "checkout", "-b", branch);
  writeFileSync(join(checkout, "version.txt"), "first\n");
  git(checkout, "add", "version.txt");
  git(checkout, "commit", "-m", "first");
  git(checkout, "push", "-u", "origin", branch);
  mkdirSync(join(checkout, "node_modules"));
  const fakeNpm = join(bin, "npm");
  writeFileSync(
    fakeNpm,
    `#!/usr/bin/env node\nconst http = require('node:http');\nconst p = Number(process.argv[process.argv.indexOf('--port') + 1]);\nhttp.createServer((req,res) => res.end(JSON.stringify({hasToken: !!process.env.PR_CONTROL_TOKEN}))).listen(p, '127.0.0.1', () => console.log('VITE v1.0 ready in 1ms'));\n`,
  );
  chmodSync(fakeNpm, 0o755);
  const controlPort = await freePort();
  let appPort = await freePort();
  while (appPort === controlPort) appPort = await freePort();
  const child = spawn(process.execPath, [controller], {
    cwd: checkout,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      PR_CONTROL_TOKEN: token,
      PR_CONTROL_PORT: String(controlPort),
      PR_CONTROL_BIND_HOST: "0.0.0.0",
      PR_CONTROL_ALLOWED_HOSTS: "preview.example.test",
      PR_APP_PORT: String(appPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${controlPort}`;
  const call = (path, options = {}) =>
    fetch(url + path, {
      ...options,
      headers: { authorization: `Bearer ${token}`, ...options.headers },
    });
  await until(async () => {
    const response = await call("/status");
    const status = await response.json();
    return status.running && !status.busy;
  });

  assert.equal((await fetch(`${url}/status`)).status, 401);
  const statusWithHost = (host) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            hostname: "127.0.0.1",
            port: controlPort,
            path: "/status",
            headers: { Host: host, Authorization: `Bearer ${token}` },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        )
        .on("error", reject);
    });
  assert.equal(await statusWithHost("preview.example.test"), 200);
  assert.equal(await statusWithHost("other.example.test"), 403);
  assert.equal((await (await call("/status")).json()).controlHost, "0.0.0.0");
  assert.equal(
    (
      await call("/stop", {
        method: "POST",
        headers: { origin: "https://example.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/stop", { method: "POST", body: "unexpected" })).status,
    400,
  );
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${appPort}`)).json(), {
    hasToken: false,
  });

  assert.equal((await call("/stop", { method: "POST" })).status, 200);
  assert.equal((await (await call("/status")).json()).running, false);
  assert.equal((await call("/start", { method: "POST" })).status, 200);
  const before = await (await call("/status")).json();
  writeFileSync(join(checkout, "version.txt"), "local changes\n");
  const refused = await call("/sync", { method: "POST" });
  assert.equal(refused.status, 500);
  assert.match((await refused.json()).error, /local changes/);
  assert.equal(
    readFileSync(join(checkout, "version.txt"), "utf8"),
    "local changes\n",
  );
  assert.equal((await (await call("/status")).json()).running, true);
  git(checkout, "checkout", "--", "version.txt");

  git(base, "clone", "--branch", branch, bare, writer);
  git(writer, "config", "user.email", "test@example.invalid");
  git(writer, "config", "user.name", "Test");
  writeFileSync(join(writer, "version.txt"), "second\n");
  git(writer, "add", "version.txt");
  git(writer, "commit", "-m", "second");
  const expected = git(writer, "rev-parse", "HEAD");
  git(writer, "push", "origin", branch);
  const synced = await call("/sync", { method: "POST" });
  assert.equal(synced.status, 200, logs);
  assert.equal((await synced.json()).commit, expected);
  assert.equal(readFileSync(join(checkout, "version.txt"), "utf8"), "second\n");
  const after = await (await call("/status")).json();
  assert.equal(after.running, true);
  assert.notEqual(after.pid, before.pid);
  assert.equal(logs.includes(token), false);

  writeFileSync(join(checkout, "version.txt"), "local commit\n");
  git(checkout, "add", "version.txt");
  git(checkout, "commit", "-m", "local commit");
  const localHead = git(checkout, "rev-parse", "HEAD");
  writeFileSync(join(writer, "version.txt"), "remote commit\n");
  git(writer, "add", "version.txt");
  git(writer, "commit", "-m", "remote commit");
  git(writer, "push", "origin", branch);
  const divergent = await call("/sync", { method: "POST" });
  assert.equal(divergent.status, 500);
  assert.equal(git(checkout, "rev-parse", "HEAD"), localHead);
  assert.equal(
    readFileSync(join(checkout, "version.txt"), "utf8"),
    "local commit\n",
  );
  assert.equal((await (await call("/status")).json()).running, true);
});

test("starts and stops the real Vite server in the sandbox", async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const controlPort = await freePort();
  let appPort = await freePort();
  while (appPort === controlPort) appPort = await freePort();
  const child = spawn(process.execPath, [controller], {
    cwd: root,
    env: {
      ...process.env,
      PR_CONTROL_TOKEN: token,
      PR_CONTROL_PORT: String(controlPort),
      PR_APP_PORT: String(appPort),
      PR_APP_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });
  const control = `http://127.0.0.1:${controlPort}`;
  const headers = { authorization: `Bearer ${token}` };
  await until(async () => {
    const response = await fetch(`${control}/status`, { headers });
    const status = await response.json();
    return status.running && !status.busy;
  }, 30000);
  const page = await fetch(`http://127.0.0.1:${appPort}/`);
  assert.equal(page.status, 200, logs);
  assert.match(await page.text(), /<html/i);
  assert.equal(
    (await fetch(`${control}/stop`, { method: "POST", headers })).status,
    200,
  );
  await assert.rejects(fetch(`http://127.0.0.1:${appPort}/`));
});
