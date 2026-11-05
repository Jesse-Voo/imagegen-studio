const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const { BACKENDS, SIZES } = require("./lib/backends");
const { REFINERS } = require("./lib/refine");

let win;
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  const defaults = { outDir: path.join(app.getPath("pictures"), "ImageGen Studio"), localUrl: "http://127.0.0.1:8080/v1", ollamaUrl: "http://127.0.0.1:11434", keys: {} };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) };
  } catch {
    return defaults;
  }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
function getKey(s, name) {
  const env = { gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, openai: process.env.OPENAI_API_KEY }[name];
  if (env) return env;
  const enc = s.keys[name];
  if (!enc || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  } catch {
    return "";
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: "#0f1115",
    title: "ImageGen Studio",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

const controllers = new Map();

ipcMain.handle("meta", () => {
  const s = loadSettings();
  return {
    backends: Object.fromEntries(Object.entries(BACKENDS).map(([k, b]) => [k, { label: b.label, refs: b.refs, note: b.note || "", defaultModel: b.defaultModel, models: b.models, hasKey: b.needsKey ? !!getKey(s, b.needsKey) : true }])),
    refiners: Object.fromEntries(Object.entries(REFINERS).map(([k, r]) => [k, { label: r.label, defaultModel: r.defaultModel, hasKey: r.needsKey ? !!getKey(s, r.needsKey) : true }])),
    sizes: Object.keys(SIZES),
    settings: { outDir: s.outDir, localUrl: s.localUrl, ollamaUrl: s.ollamaUrl },
  };
});

ipcMain.handle("settings:save", (_e, p) => {
  const s = loadSettings();
  if (typeof p.outDir === "string" && p.outDir) s.outDir = p.outDir;
  if (typeof p.localUrl === "string") s.localUrl = p.localUrl.trim();
  if (typeof p.ollamaUrl === "string") s.ollamaUrl = p.ollamaUrl.trim();
  for (const name of ["gemini", "openai"]) {
    const v = p.keys?.[name];
    if (v === null) delete s.keys[name];
    else if (typeof v === "string" && v.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure key storage is not available on this system.");
      s.keys[name] = safeStorage.encryptString(v.trim()).toString("base64");
    }
  }
  saveSettings(s);
  return true;
});

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("pick-images", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("reveal", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("cancel", (_e, id) => controllers.get(id)?.abort());

ipcMain.handle("refine", async (_e, { prompt, refiner, model }) => {
  const r = REFINERS[refiner];
  if (!r) return { error: "Unknown refiner." };
  const s = loadSettings();
  try {
    const text = await r.run({ prompt, model: model || r.defaultModel, key: r.needsKey ? getKey(s, r.needsKey) : "", ollamaUrl: s.ollamaUrl });
    if (!text) return { error: "The refiner returned nothing." };
    return { text };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("generate", async (_e, req) => {
  const b = BACKENDS[req.backend];
  if (!b) return { error: "Unknown backend." };
  const s = loadSettings();
  const size = SIZES[req.size] || SIZES.square;
  const refs = b.refs ? (req.references || []).filter((p) => fs.existsSync(p)) : [];
  const count = Math.min(Math.max(parseInt(req.count) || 1, 1), 8);
  const key = b.needsKey ? getKey(s, b.needsKey) : "";
  const ctl = new AbortController();
  controllers.set(req.id, ctl);
  const timeout = setTimeout(() => ctl.abort(), 5 * 60 * 1000);
  fs.mkdirSync(s.outDir, { recursive: true });
  const slug = req.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const images = [];
  const errors = [];
  try {
    for (let i = 0; i < count; i++) {
      win.webContents.send("progress", { id: req.id, done: i, total: count });
      try {
        const out = await b.fn({ prompt: req.prompt, model: req.model || b.defaultModel, size, references: refs, key, localUrl: s.localUrl, signal: ctl.signal });
        const file = path.join(s.outDir, `${stamp}-${slug}${count > 1 ? "-" + String(i + 1).padStart(2, "0") : ""}.${out.ext}`);
        fs.writeFileSync(file, out.bytes);
        images.push({ path: file, dataUrl: `data:image/${out.ext === "jpg" ? "jpeg" : out.ext};base64,${out.bytes.toString("base64")}` });
      } catch (e) {
        errors.push(ctl.signal.aborted ? "Cancelled or timed out." : e.message);
        if (ctl.signal.aborted) break;
      }
    }
  } finally {
    clearTimeout(timeout);
    controllers.delete(req.id);
  }
  return { images, errors: [...new Set(errors)] };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => app.quit());
