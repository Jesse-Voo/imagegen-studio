const $ = (id) => document.getElementById(id);
let meta;
let refs = [];
let currentId = null;

const toFileUrl = (p) => "file:///" + p.replace(/\\/g, "/").split("/").map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join("/");

function setStatus(text, err) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (err ? " err" : "");
}

function fillSelect(sel, obj, value) {
  sel.innerHTML = "";
  for (const [k, v] of Object.entries(obj)) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = v.label;
    sel.appendChild(o);
  }
  if (value) sel.value = value;
}

function renderBackend() {
  const b = meta.backends[$("backend").value];
  $("model").placeholder = b.defaultModel || "default";
  $("models").innerHTML = "";
  for (const m of b.models) {
    const o = document.createElement("option");
    o.value = m;
    $("models").appendChild(o);
  }
  $("model").value = "";
  $("keyWarn").hidden = b.hasKey;
  $("keyWarn").textContent = b.hasKey ? "" : "No API key saved for this source. Open Settings to add one.";
  $("refNote").hidden = b.refs || refs.length === 0;
}

function renderRefs() {
  const box = $("refs");
  box.innerHTML = "";
  refs.forEach((p, i) => {
    const d = document.createElement("div");
    d.className = "thumb";
    const img = document.createElement("img");
    img.src = toFileUrl(p);
    img.alt = p.split(/[\\/]/).pop();
    const x = document.createElement("button");
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove reference image");
    x.onclick = () => {
      refs.splice(i, 1);
      renderRefs();
    };
    d.append(img, x);
    box.appendChild(d);
  });
  $("refNote").hidden = meta.backends[$("backend").value].refs || refs.length === 0;
}

function card(img) {
  const c = document.createElement("div");
  c.className = "card";
  const im = document.createElement("img");
  im.src = img.dataUrl;
  im.alt = "Generated image";
  const m = document.createElement("div");
  m.className = "meta";
  const name = document.createElement("span");
  name.textContent = img.path.split(/[\\/]/).pop();
  name.title = img.path;
  const b = document.createElement("button");
  b.textContent = "Show in folder";
  b.onclick = () => window.studio.reveal(img.path);
  m.append(name, b);
  c.append(im, m);
  return c;
}

async function refinePrompt() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return false;
  setStatus("Refining prompt...");
  const r = await window.studio.refine({ prompt, refiner: $("refiner").value, model: $("refModel").value.trim() });
  if (r.error) {
    setStatus("Refine failed: " + r.error, true);
    return false;
  }
  $("prompt").value = r.text;
  setStatus("Prompt refined. Edit it if you like.");
  return true;
}

async function generate() {
  let prompt = $("prompt").value.trim();
  if (!prompt) return setStatus("Type a description first.", true);
  $("go").disabled = true;
  $("refineBtn").disabled = true;
  try {
    if ($("refineOn").checked && !(await refinePrompt())) return;
    prompt = $("prompt").value.trim();
    currentId = String(Date.now());
    $("stop").hidden = false;
    setStatus("Generating...");
    const r = await window.studio.generate({
      id: currentId,
      prompt,
      backend: $("backend").value,
      model: $("model").value.trim(),
      size: $("size").value,
      count: $("count").value,
      references: refs,
    });
    if (r.error) return setStatus(r.error, true);
    const g = $("gallery");
    for (const img of r.images.slice().reverse()) g.prepend(card(img));
    if (r.errors.length) setStatus((r.images.length ? "Some images failed:\n" : "") + r.errors.join("\n"), true);
    else setStatus(`Done. Saved ${r.images.length} image${r.images.length > 1 ? "s" : ""}.`);
  } finally {
    $("go").disabled = false;
    $("refineBtn").disabled = false;
    $("stop").hidden = true;
    currentId = null;
  }
}

async function openSettings() {
  $("outDir").value = meta.settings.outDir;
  $("localUrl").value = meta.settings.localUrl;
  $("ollamaUrl").value = meta.settings.ollamaUrl;
  $("geminiKey").value = "";
  $("openaiKey").value = "";
  $("dlg").showModal();
}

async function reloadMeta() {
  const keepBackend = $("backend").value;
  meta = await window.studio.meta();
  fillSelect($("backend"), meta.backends, keepBackend || "pollinations");
  renderBackend();
}

async function init() {
  meta = await window.studio.meta();
  fillSelect($("backend"), meta.backends, meta.backends.gemini.hasKey ? "gemini" : "pollinations");
  fillSelect($("refiner"), meta.refiners, meta.refiners.gemini.hasKey ? "gemini" : "ollama");
  renderBackend();
  $("backend").onchange = renderBackend;
  $("refiner").onchange = () => ($("refModel").placeholder = meta.refiners[$("refiner").value].defaultModel || "default");
  $("refModel").placeholder = meta.refiners[$("refiner").value].defaultModel || "default";
  $("refineOn").onchange = () => ($("refineOpts").hidden = !$("refineOn").checked);
  $("addRef").onclick = async () => {
    const files = await window.studio.pickImages();
    refs = [...new Set([...refs, ...files])].slice(0, 6);
    renderRefs();
  };
  $("refineBtn").onclick = async () => {
    $("refineBtn").disabled = true;
    try {
      await refinePrompt();
    } finally {
      $("refineBtn").disabled = false;
    }
  };
  $("go").onclick = generate;
  $("stop").onclick = () => currentId && window.studio.cancel(currentId);
  $("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !$("go").disabled) generate();
  });
  window.studio.onProgress((d) => setStatus(`Generating image ${d.done + 1} of ${d.total}...`));

  $("settingsBtn").onclick = openSettings;
  $("pickOut").onclick = async () => {
    const f = await window.studio.pickFolder();
    if (f) $("outDir").value = f;
  };
  $("clearGemini").onclick = async () => {
    await window.studio.saveSettings({ keys: { gemini: null } });
    await reloadMeta();
    setStatus("Gemini key removed.");
  };
  $("clearOpenai").onclick = async () => {
    await window.studio.saveSettings({ keys: { openai: null } });
    await reloadMeta();
    setStatus("OpenAI key removed.");
  };
  $("settingsForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "save") return;
    try {
      await window.studio.saveSettings({
        outDir: $("outDir").value,
        localUrl: $("localUrl").value,
        ollamaUrl: $("ollamaUrl").value,
        keys: { gemini: $("geminiKey").value, openai: $("openaiKey").value },
      });
      await reloadMeta();
      setStatus("Settings saved.");
    } catch (err) {
      setStatus("Could not save settings: " + err.message, true);
    }
  });
}
init();
