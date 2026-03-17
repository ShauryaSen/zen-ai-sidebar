#!/usr/bin/env node

// Zen AI Sidebar — Native Messaging Host
// Bridges the browser extension to the Gemini CLI

"use strict";

const { spawn, execSync } = require("child_process");
const path = require("path");
const os = require("os");

// ===== Native Messaging Protocol =====
// Messages are length-prefixed: 4-byte little-endian uint32 + JSON payload

function readMessage() {
  return new Promise((resolve, reject) => {
    let headerBuf = Buffer.alloc(4);
    let headerBytesRead = 0;

    function onReadable() {
      // Phase 1: read the 4-byte header
      while (headerBytesRead < 4) {
        const remaining = 4 - headerBytesRead;
        const chunk = process.stdin.read(remaining);
        if (!chunk) {
          process.stdin.once("readable", onReadable);
          return;
        }
        chunk.copy(headerBuf, headerBytesRead);
        headerBytesRead += chunk.length;
      }

      const messageLength = headerBuf.readUInt32LE(0);
      if (messageLength === 0) {
        resolve(null);
        return;
      }

      // Phase 2: read the message body
      readBody(messageLength);
    }

    function readBody(length) {
      let body = Buffer.alloc(0);

      function onBodyReadable() {
        while (body.length < length) {
          const remaining = length - body.length;
          const chunk = process.stdin.read(remaining);
          if (!chunk) {
            process.stdin.once("readable", onBodyReadable);
            return;
          }
          body = Buffer.concat([body, chunk]);
        }

        try {
          resolve(JSON.parse(body.toString("utf-8")));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${e.message}`));
        }
      }
      onBodyReadable();
    }

    process.stdin.once("readable", onReadable);
  });
}

function sendMessage(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// ===== Find Gemini CLI =====
function findGeminiPath() {
  try {
    // Ensure common PATH locations are included (native messaging hosts
    // inherit a minimal PATH that may not include npm global bin)
    const extraPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".nvm/versions/node"),
      path.join(os.homedir(), ".npm-global/bin"),
      path.join(os.homedir(), ".volta/bin"),
    ];
    const envPath = (process.env.PATH || "") + ":" + extraPaths.join(":");
    const result = execSync("which gemini", {
      encoding: "utf-8",
      env: { ...process.env, PATH: envPath },
    }).trim();
    if (result) return result;
  } catch (e) {
    // Not found via which
  }
  return null;
}

// Build a full PATH that includes common node/npm locations
function getEnhancedEnv() {
  const extraPaths = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(os.homedir(), ".nvm/versions/node"),
    path.join(os.homedir(), ".npm-global/bin"),
    path.join(os.homedir(), ".volta/bin"),
  ];

  // Try to get the user's shell PATH
  let shellPath = "";
  try {
    shellPath = execSync("echo $PATH", {
      shell: "/bin/zsh",
      encoding: "utf-8",
    }).trim();
  } catch (e) {
    try {
      shellPath = execSync("echo $PATH", {
        shell: "/bin/bash",
        encoding: "utf-8",
      }).trim();
    } catch (e2) {
      // ignore
    }
  }

  const combinedPath = [
    shellPath,
    process.env.PATH || "",
    ...extraPaths,
  ].filter(Boolean).join(":");

  return {
    ...process.env,
    PATH: combinedPath,
    TERM: "dumb",
    NO_COLOR: "1",
  };
}

// ===== Handle Chat Request =====
async function handleRequest(message) {
  const { prompt, model, requestId } = message;

  // Handle ping
  if (message.type === "ping") {
    sendMessage({ requestId, pong: true });
    return;
  }

  if (!prompt) {
    sendMessage({ requestId, error: "NO_PROMPT", message: "No prompt provided." });
    return;
  }

  const enhancedEnv = getEnhancedEnv();
  const geminiPath = findGeminiPath();

  // Use a persistent workspace folder at ~/.zen-ai/brain/
  const fs = require("fs");
  const workspaceDir = path.join(os.homedir(), ".zen-ai", "brain");
  try {
    fs.mkdirSync(workspaceDir, { recursive: true });
  } catch (e) {
    // ignore — directory likely already exists
  }
  const cwd = workspaceDir;

  // Build the command arguments — use stream-json for structured output
  const args = [
    "--prompt", prompt,
    "--sandbox=false",
    "--yolo",
    "--output-format", "stream-json",
  ];

  if (model) {
    args.push("--model", model);
  }

  let command, spawnArgs;
  if (geminiPath) {
    command = geminiPath;
    spawnArgs = args;
  } else {
    // Fallback to npx
    command = "npx";
    spawnArgs = ["-y", "@google/gemini-cli", ...args];
  }

  try {
    const child = spawn(command, spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: enhancedEnv,
      cwd: cwd,
    });

    let hasError = false;
    let hasContent = false;
    let lineBuffer = "";

    // Notify the sidebar that the model is thinking
    sendMessage({ requestId, thinking: true });

    child.stdout.on("data", (data) => {
      lineBuffer += data.toString("utf-8");

      // Process complete JSON lines
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);

          if (json.type === "message" && json.role === "assistant" && json.delta) {
            // Send content chunk
            if (!hasContent) {
              hasContent = true;
              // Signal end of thinking, start of content
              sendMessage({ requestId, thinking: false });
            }
            sendMessage({ requestId, chunk: json.content, done: false });
          } else if (json.type === "result") {
            // CLI finished
            if (!hasContent && !hasError) {
              sendMessage({ requestId, thinking: false });
            }
            sendMessage({ requestId, done: true });
          }
        } catch (e) {
          // Not valid JSON — could be a non-JSON informational line, ignore
        }
      }
    });

    child.stderr.on("data", (data) => {
      const errText = data.toString("utf-8").trim();
      if (!errText) return;
      // Only report actual errors
      const isError = /error|fatal|exception|ENOENT|not found|auth/i.test(errText);
      if (isError && !hasError) {
        hasError = true;
        sendMessage({
          requestId,
          error: "CLI_ERROR",
          message: errText,
        });
      }
    });

    child.on("close", (code) => {

      if (code !== 0 && !hasContent && !hasError) {
        sendMessage({
          requestId,
          error: "CLI_EXIT",
          message: `Gemini CLI exited with code ${code}. Make sure it's installed and authenticated:\n1. npm install -g @google/gemini-cli\n2. Run 'gemini' in terminal to authenticate`,
        });
      } else if (!hasError && !hasContent) {
        sendMessage({ requestId, done: true });
      }
    });

    child.on("error", (err) => {
      hasError = true;
      sendMessage({
        requestId,
        error: "SPAWN_ERROR",
        message: `Failed to start Gemini CLI: ${err.message}.\n\n1. Install: npm install -g @google/gemini-cli\n2. Run install_host.sh again`,
      });
    });

    // Close stdin — we don't send interactive input
    child.stdin.end();
  } catch (err) {
    sendMessage({
      requestId,
      error: "SPAWN_ERROR",
      message: `Failed to start Gemini CLI: ${err.message}`,
    });
  }
}

// ===== Main Loop =====
async function main() {
  process.stdin.resume();

  while (true) {
    try {
      const message = await readMessage();
      if (message === null) break;
      handleRequest(message);
    } catch (e) {
      sendMessage({ error: "HOST_ERROR", message: e.message });
      break;
    }
  }
}

main().catch((e) => {
  sendMessage({ error: "HOST_ERROR", message: e.message });
  process.exit(1);
});
