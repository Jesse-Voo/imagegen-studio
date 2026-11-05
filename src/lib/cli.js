// Prompt refiners that run a coding-agent CLI headlessly (Claude Code, Codex, agy) using the user's own sign-in.
// Each runs in an empty temp folder with tools/sandbox restricted: it only has to return text.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { findAgy } = require("./agy");

function findExe(names, extra = []) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return extra.find((p) => p && fs.existsSync(p)) || null;
}

const findClaude = () => findExe(["claude.exe", "claude.cmd"], [path.join(os.homedir(), ".local", "bin", "claude.exe")]);
const findCodex = () => findExe(["codex.exe", "codex.cmd"], [path.join(process.env.LOCALAPPDATA || "", "Programs", "OpenAI", "Codex", "bin", "codex.exe")]);

function run(exe, args, cwd, signal, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: /\.cmd$/i.test(exe) });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      p.kill();
      reject(new Error("The CLI took too long (over 2 minutes)."));
    }, timeoutMs);
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err });
    });
    signal?.addEventListener("abort", () => {
      p.kill();
      reject(new Error("Cancelled."));
    });
  });
}

async function inTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imagegen-studio-refine-"));
  try {
    return await fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {} // Codex's sandbox can leave the folder locked; it is only a temp folder.
  }
}

const wrap = (instruction, prompt) => `${instruction}\n\nRough idea:\n${prompt}`;

async function claudeCode({ instruction, prompt, model, signal }) {
  const exe = findClaude();
  if (!exe) throw new Error("Claude Code was not found. Install it and sign in, or pick another refiner.");
  return inTemp(async (cwd) => {
    const args = ["-p", wrap(instruction, prompt), "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--output-format", "text"];
    if (model) args.push("--model", model);
    const r = await run(exe, args, cwd, signal);
    if (r.code !== 0 || !r.out.trim()) throw new Error(`Claude Code failed (exit ${r.code}). ${(r.err || r.out).slice(0, 300)}`.trim());
    return r.out.trim();
  });
}

async function codex({ instruction, prompt, model, signal }) {
  const exe = findCodex();
  if (!exe) throw new Error("Codex was not found. Install it and sign in, or pick another refiner.");
  return inTemp(async (cwd) => {
    const outFile = path.join(cwd, "answer.txt");
    // Read-only sandbox, no session saved; only the final message is used.
    const args = ["exec", "--skip-git-repo-check", "-s", "read-only", "--ephemeral", "-o", outFile];
    if (model) args.push("-m", model);
    args.push(wrap(instruction, prompt));
    const r = await run(exe, args, cwd, signal);
    const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "";
    if (!text) throw new Error(`Codex returned no answer (exit ${r.code}). ${(r.err || r.out).slice(-300)}`.trim());
    return text;
  });
}

async function agyText({ instruction, prompt, signal }) {
  const exe = findAgy();
  if (!exe) throw new Error("agy (Antigravity CLI) was not found. Install it and sign in, or pick another refiner.");
  return inTemp(async (cwd) => {
    const text = `${wrap(instruction, prompt)}\n\nDo not generate an image, read files or run commands. Reply with the improved prompt text only.`;
    const r = await run(exe, ["--disable-slash-commands", "-p", text, "--output-format", "json"], cwd, signal);
    let j;
    try {
      j = JSON.parse(r.out);
    } catch {}
    if (!j?.response) throw new Error(`agy returned no answer (exit ${r.code}). ${(r.err || r.out).slice(0, 300)}`.trim());
    return String(j.response).trim();
  });
}

module.exports = { claudeCode, codex, agyText };
