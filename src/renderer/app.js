const $ = (id) => document.getElementById(id);
let meta;
let refs = [];
let currentId = null;
let size = "square";
let count = 1;
const icons = () => window.lucide && window.lucide.createIcons();
const fadeIn = (el, delay = 0) => window.Motion && window.Motion.animate(el, { opacity: [0, 1], y: [12, 0], scale: [0.97, 1] }, { duration: 0.35, delay });

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
  $("srcNote").textContent = b.note || "";
  $("srcNote").hidden = !b.note;
  $("keyWarn").hidden = b.hasKey;
  $("keyWarn").querySelector("span").textContent = "No API key saved for this source. Open Settings to add one.";
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
    x.innerHTML = '<i data-lucide="x"></i>';
    x.setAttribute("aria-label", "Remove reference image");
    x.onclick = () => {
      refs.splice(i, 1);
      renderRefs();
    };
    d.append(img, x);
    box.appendChild(d);
  });
  icons();
  $("refNote").hidden = meta.backends[$("backend").value].refs || refs.length === 0;
}

function card(img) {
  const c = document.createElement("div");
  c.className = "card";
  const im = document.createElement("img");
  im.src = img.dataUrl;
  im.alt = "Generated image";
  im.onclick = () => openLightbox(img.dataUrl);
  const m = document.createElement("div");
  m.className = "meta";
  const name = document.createElement("span");
  name.textContent = img.path.split(/[\\/]/).pop();
  name.title = img.path;
  const b = document.createElement("button");
  b.title = "Show in folder";
  b.setAttribute("aria-label", "Show in folder");
  b.innerHTML = '<i data-lucide="folder-open"></i>';
  b.onclick = () => window.studio.reveal(img.path);
  const u = document.createElement("button");
  u.title = "Use as reference image";
  u.setAttribute("aria-label", "Use as reference image");
  u.innerHTML = '<i data-lucide="image-plus"></i>';
  u.onclick = () => {
    refs = [...new Set([...refs, img.path])].slice(0, 6);
    renderRefs();
  };
  const btns = document.createElement("div");
  btns.append(u, b);
  m.append(name, btns);
  c.append(im, m);
  return c;
}

function openLightbox(src) {
  $("lbImg").src = src;
  $("lightbox").hidden = false;
  fadeIn($("lbImg"));
}

function showSkeletons(n) {
  const g = $("gallery");
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "skel";
    g.prepend(s);
    list.push(s);
  }
  return list;
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
  let skels = [];
  let prompt = $("prompt").value.trim();
  if (!prompt) return setStatus("Type a description first.", true);
  $("go").disabled = true;
  $("refineBtn").disabled = true;
  try {
    if ($("refineOn").checked && !(await refinePrompt())) return;
    prompt = $("prompt").value.trim();
    currentId = String(Date.now());
    $("stop").hidden = false;
    $("empty").hidden = true;
    skels = showSkeletons(count);
    setStatus("Generating...");
    const r = await window.studio.generate({
      id: currentId,
      prompt,
      backend: $("backend").value,
      model: $("model").value.trim(),
      size,
      count,
      references: refs,
    });
    skels.forEach((x) => x.remove());
    skels = [];
    if (r.error) return setStatus(r.error, true);
    const g = $("gallery");
    r.images.slice().reverse().forEach((img, i) => {
      const c = card(img);
      g.prepend(c);
      fadeIn(c, i * 0.06);
    });
    icons();
    if (r.errors.length) setStatus((r.images.length ? "Some images failed:\n" : "") + r.errors.join("\n"), true);
    else setStatus(`Done. Saved ${r.images.length} image${r.images.length > 1 ? "s" : ""}.`);
  } finally {
    skels.forEach((x) => x.remove());
    $("empty").hidden = $("gallery").children.length > 0;
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
  document.querySelectorAll("#sizeSeg button").forEach((b) => {
    b.onclick = () => {
      size = b.dataset.size;
      document.querySelectorAll("#sizeSeg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    };
  });
  $("minus").onclick = () => ($("count").textContent = count = Math.max(1, count - 1));
  $("plus").onclick = () => ($("count").textContent = count = Math.min(8, count + 1));
  $("lightbox").onclick = (e) => {
    if (e.target === $("lightbox") || e.currentTarget.contains($("lbClose")) && e.target.closest("#lbClose")) $("lightbox").hidden = true;
  };
  document.addEventListener("keydown", (e) => e.key === "Escape" && ($("lightbox").hidden = true));
  icons();
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
