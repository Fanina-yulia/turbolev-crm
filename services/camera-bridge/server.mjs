import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 8787);
const BRIDGE_TOKEN = process.env.CAMERA_BRIDGE_TOKEN?.trim() || "";
const NEOLINK_BINARY = process.env.NEOLINK_BINARY?.trim() || "/usr/local/bin/neolink";
const FFMPEG_BINARY = process.env.FFMPEG_BINARY?.trim() || "ffmpeg";
const TEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.CAMERA_TEST_TIMEOUT_MS || 20000), 5000), 26000);
const MAX_BODY_BYTES = 64 * 1024;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function authorized(req) {
  if (!BRIDGE_TOKEN) return true;
  return req.headers.authorization === `Bearer ${BRIDGE_TOKEN}`;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function clean(value, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

function validateProbe(body) {
  const uid = clean(body.uid, 40).replace(/\s+/g, "").toUpperCase();
  const username = clean(body.username, 80) || "admin";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!/^[A-Z0-9]{12,40}$/.test(uid)) throw new Error("INVALID_UID");
  if (!username) throw new Error("INVALID_USERNAME");
  if (!password) throw new Error("PASSWORD_REQUIRED");
  return { uid, username, password };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runWithTimeout(command, args, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (target, chunk) => `${target}${chunk.toString("utf8")}`.slice(-24000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: -2, signal: "SIGKILL", stdout, stderr: `${stderr}\nprocess timeout` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("exit", (code, signal) => finish({ code: code ?? -1, signal, stdout, stderr }));
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(1200),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function captureSnapshot(rtspPort, outputPath, deadline) {
  const urls = [
    `rtsp://127.0.0.1:${rtspPort}/probe/subStream`,
    `rtsp://127.0.0.1:${rtspPort}/probe/mainStream`,
    `rtsp://127.0.0.1:${rtspPort}/probe`,
  ];

  let lastError = "RTSP stream not ready";
  while (Date.now() < deadline) {
    for (const url of urls) {
      const remaining = deadline - Date.now();
      if (remaining < 1000) break;
      const result = await runWithTimeout(FFMPEG_BINARY, [
        "-hide_banner", "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-i", url,
        "-frames:v", "1",
        "-q:v", "3",
        "-y", outputPath,
      ], Math.min(4500, remaining));
      if (result.code === 0) return { ok: true, url };
      lastError = result.stderr || result.stdout || lastError;
    }
    await sleep(500);
  }
  return { ok: false, error: lastError.slice(-1200) };
}

function safeNeolinkMessage(logs) {
  const text = logs
    .replace(/password\s*=\s*[^\s]+/gi, "password=[redacted]")
    .replace(/[A-Z0-9]{16}/g, "[uid]");
  const useful = text.split(/\r?\n/).filter((line) => /error|warn|connect|relay|login|auth|camera|uid/i.test(line));
  return useful.slice(-8).join(" | ").slice(-1600);
}

async function probeReolink(body) {
  const credentials = validateProbe(body);
  const dir = await mkdtemp(join(tmpdir(), "turbolev-camera-"));
  const configPath = join(dir, "neolink.toml");
  const snapshotPath = join(dir, "snapshot.jpg");
  const rtspPort = await getFreePort();
  const config = [
    'bind = "127.0.0.1"',
    `bind_port = ${rtspPort}`,
    "",
    "[[cameras]]",
    'name = "probe"',
    `username = ${tomlString(credentials.username)}`,
    `password = ${tomlString(credentials.password)}`,
    `uid = ${tomlString(credentials.uid)}`,
    'discovery = "relay"',
    "",
  ].join("\n");

  await writeFile(configPath, config, { mode: 0o600 });
  const logs = [];
  const child = spawn(NEOLINK_BINARY, ["rtsp", `--config=${configPath}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "info" },
  });
  const pushLog = (chunk) => {
    logs.push(chunk.toString("utf8"));
    if (logs.length > 120) logs.splice(0, logs.length - 120);
  };
  child.stdout?.on("data", pushLog);
  child.stderr?.on("data", pushLog);

  try {
    const deadline = Date.now() + TEST_TIMEOUT_MS;
    const capture = await captureSnapshot(rtspPort, snapshotPath, deadline);
    if (!capture.ok) {
      const detail = safeNeolinkMessage(logs.join("\n"));
      return {
        ok: false,
        message: detail || capture.error || "Не вдалося отримати відеопотік через Reolink UID/P2P.",
        connection: "relay",
      };
    }

    const image = await readFile(snapshotPath);
    return {
      ok: true,
      message: "UID/P2P relay працює, snapshot отримано.",
      connection: "relay",
      snapshotDataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
    };
  } finally {
    await stopProcess(child);
    await rm(dir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "turbolev-camera-bridge", neolink: NEOLINK_BINARY });
  }

  if (req.method === "POST" && req.url === "/v1/reolink/test") {
    if (!authorized(req)) return json(res, 401, { ok: false, message: "Unauthorized" });
    try {
      const body = await readJson(req);
      const result = await probeReolink(body);
      return json(res, result.ok ? 200 : 502, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      const message = code === "INVALID_UID" ? "Некоректний Reolink UID."
        : code === "PASSWORD_REQUIRED" ? "Потрібен пароль камери."
        : code === "BODY_TOO_LARGE" ? "Запит завеликий."
        : "Camera Bridge не зміг виконати P2P-тест.";
      console.error("camera probe failed", { code });
      return json(res, code === "BODY_TOO_LARGE" ? 413 : 400, { ok: false, message });
    }
  }

  return json(res, 404, { ok: false, message: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Turbo LEV Camera Bridge listening on :${PORT}`);
});
