// Antigravity CLI (agy) backend: runs agy headlessly and picks up the image its Gemini tool creates.
// No permission bypass is used; agy only has to call its own image tool.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function findAgy() {
  if (process.env.AGY_EXE) return fs.existsSync(process.env.AGY_EXE) ? process.env.AGY_EXE : null;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of ["agy.exe", "agy.cmd"]) {
      const p = path.join(dir, name);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  const fallback = path.join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe");
  return fs.existsSync(fallback) ? fallback : null;
}

function newestImage(dir, since) {
  let best = null;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name) && !e.name.startsWith("ref-")) {
        const t = fs.statSync(p).mtimeMs;
        if (t >= since && (!best || t > best.t)) best = { p, t };
      }
    }
  };
  walk(dir);
  return best && best.p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAIL = /RESOURCE_EXHAUSTED|quota|capacity|rate.?limit|\b429\b|generation failed|could not (create|generate)|no image could be/i;

async function agy({ prompt, references, signal }) {
  const exe = findAgy();
  if (!exe) throw new Error("agy (Antigravity CLI) not found. Install it and sign in, or set the AGY_EXE environment variable.");
  const brain = process.env.AGY_BRAIN_DIR || path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "imagegen-studio-agy-"));
  const started = Date.now();
  try {
    let text;
    if (references.length) {
      const names = references.map((r, i) => {
        const n = `ref-${Math.random().toString(16).slice(2, 8)}-${i + 1}${path.extname(r)}`;
        fs.copyFileSync(r, path.join(work, n));
        return n;
      });
      text =
        `Open and look at these reference image file(s) in the current folder: ${names.join(", ")}. ` +
        `Then call your built-in image generation tool right now to generate an image of ${prompt}, using the reference image(s) as inspiration or as the thing to edit. ` +
        "Do not run any commands and do not read any other files or skills.";
    } else {
      text =
        `Call your built-in image generation tool right now to generate an image of ${prompt}. ` +
        "Do not read any files or skills and do not run any commands. Just generate the image.";
    }

    // --disable-slash-commands stops this agy session from loading the image skill and recursing.
    const out = await new Promise((resolve, reject) => {
      const p = spawn(exe, ["--disable-slash-commands", "-p", text, "--output-format", "json"], { cwd: work, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: /\.cmd$/i.test(exe) });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (c) => (stdout += c));
      p.stderr.on("data", (c) => (stderr += c));
      p.on("error", reject);
      p.on("close", (code) => resolve({ code, stdout, stderr }));
      signal?.addEventListener("abort", () => {
        p.kill();
        reject(new Error("Cancelled."));
      });
    });

    let result;
    try {
      result = JSON.parse(out.stdout);
    } catch {}
    if (!result?.conversation_id) throw new Error(`agy returned no usable result (exit ${out.code}). ${out.stderr.slice(0, 300)}`.trim());

    const dir = path.join(brain, result.conversation_id);
    if (FAIL.test(result.response || "") && !newestImage(dir, started - 5000)) {
      throw new Error(`agy could not generate the image: ${String(result.response).slice(0, 300)}`);
    }
    // agy replies before its image subagent finishes, so poll the conversation folder.
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Cancelled.");
      const img = newestImage(dir, started - 5000);
      if (img) {
        await sleep(600);
        return { bytes: fs.readFileSync(img), ext: path.extname(img).slice(1).toLowerCase().replace("jpeg", "jpg") };
      }
      await sleep(2000);
    }
    throw new Error(`No image appeared for agy conversation ${result.conversation_id}. agy said: ${String(result.response).slice(0, 200)}`);
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { agy, findAgy };
