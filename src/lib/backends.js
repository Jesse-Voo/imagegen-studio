// Image backends. Each takes { prompt, model, size, references, key, localUrl, signal } and returns
// { bytes: Buffer, ext: "png"|"jpg"|"webp" }.
const fs = require("fs");
const path = require("path");

const SIZES = {
  square: { w: 1024, h: 1024, openai: "1024x1024", ratio: "1:1" },
  landscape: { w: 1536, h: 1024, openai: "1536x1024", ratio: "3:2" },
  portrait: { w: 1024, h: 1536, openai: "1024x1536", ratio: "2:3" },
};

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}

function result(bytes) {
  const ext = sniff(bytes);
  if (!ext) throw new Error("The service did not return an image.");
  return { bytes, ext };
}

async function httpError(res, what) {
  let body = "";
  try {
    body = (await res.text()).slice(0, 400);
  } catch {}
  let hint = "";
  if (res.status === 401 || res.status === 403) hint = " Check the API key in Settings.";
  if (res.status === 429) hint = " Rate limited or out of quota; wait and retry.";
  if (res.status === 402) hint = " The free tier is rate-limited right now; try again later.";
  return new Error(`${what} failed (HTTP ${res.status}).${hint} ${body}`.trim());
}

const mimeOf = (p) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(p).toLowerCase()] || "image/png");

async function gemini({ prompt, model, size, references, key, signal }) {
  if (!key) throw new Error("No Gemini API key. Add one in Settings (free at aistudio.google.com).");
  model = model || "gemini-2.5-flash-image";
  const base = "https://generativelanguage.googleapis.com/v1beta/models/";
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  if (model.startsWith("imagen")) {
    const res = await fetch(`${base}${model}:predict`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: size.ratio === "3:2" ? "4:3" : size.ratio === "2:3" ? "3:4" : "1:1" } }),
    });
    if (!res.ok) throw await httpError(res, "Imagen");
    const j = await res.json();
    const b64 = j.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error("Imagen returned no image (the prompt may have been blocked).");
    return result(Buffer.from(b64, "base64"));
  }
  const parts = [{ text: prompt }];
  for (const r of references) {
    parts.push({ inline_data: { mime_type: mimeOf(r), data: fs.readFileSync(r).toString("base64") } });
  }
  const res = await fetch(`${base}${model}:generateContent`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
  });
  if (!res.ok) throw await httpError(res, "Gemini");
  const j = await res.json();
  const out = (j.candidates?.[0]?.content?.parts || []).find((p) => (p.inlineData || p.inline_data)?.data);
  if (!out) throw new Error("Gemini returned no image. " + JSON.stringify(j.promptFeedback || j.candidates?.[0]?.finishReason || "").slice(0, 200));
  return result(Buffer.from((out.inlineData || out.inline_data).data, "base64"));
}

async function imagesApi({ url, prompt, model, size, references, key, signal, label }) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  let res;
  if (references.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size.openai);
    for (const r of references) form.append("image[]", new Blob([fs.readFileSync(r)], { type: mimeOf(r) }), path.basename(r));
    res = await fetch(`${url}/images/edits`, { method: "POST", headers, body: form, signal });
  } else {
    res = await fetch(`${url}/images/generations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ model, prompt, n: 1, size: size.openai }),
    });
  }
  if (!res.ok) throw await httpError(res, label);
  const j = await res.json();
  const item = j.data?.[0];
  if (item?.b64_json) return result(Buffer.from(item.b64_json, "base64"));
  if (item?.url) {
    const img = await fetch(item.url, { signal });
    return result(Buffer.from(await img.arrayBuffer()));
  }
  throw new Error(`${label} returned no image.`);
}

const openai = (o) => {
  if (!o.key) throw new Error("No OpenAI API key. Add one in Settings. (ChatGPT sign-in cannot generate images; an API key is required.)");
  return imagesApi({ ...o, url: "https://api.openai.com/v1", model: o.model || "gpt-image-1", label: "OpenAI" });
};

const local = (o) => {
  if (!o.localUrl) throw new Error("No local server URL. Set it in Settings (an OpenAI-compatible image server).");
  return imagesApi({ ...o, url: o.localUrl.replace(/\/+$/, ""), model: o.model || "default", label: "Local server" });
};

async function pollinations({ prompt, model, size, signal }) {
  const q = new URLSearchParams({ model: model || "flux", width: String(size.w), height: String(size.h), nologo: "true" });
  const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`, { signal });
  if (!res.ok) throw await httpError(res, "Pollinations");
  return result(Buffer.from(await res.arrayBuffer()));
}

const { agy } = require("./agy");

const BACKENDS = {
  agy: { label: "Gemini via Antigravity (agy)", fn: agy, needsKey: null, refs: true, defaultModel: "", models: [], note: "Uses your signed-in Antigravity CLI. Slow (30-90 s) and subject to your agy quota." },
  gemini: { label: "Gemini (API key)", fn: gemini, needsKey: "gemini", refs: true, defaultModel: "gemini-2.5-flash-image", models: ["gemini-2.5-flash-image", "imagen-4.0-generate-001"] },
  openai: { label: "OpenAI (API key)", fn: openai, needsKey: "openai", refs: true, defaultModel: "gpt-image-1", models: ["gpt-image-1", "gpt-image-1-mini", "dall-e-3"] },
  pollinations: { label: "Pollinations (free)", fn: pollinations, needsKey: null, refs: false, defaultModel: "flux", models: ["flux", "turbo"] },
  local: { label: "Local server", fn: local, needsKey: null, refs: true, defaultModel: "default", models: [] },
};

module.exports = { BACKENDS, SIZES };
