// Prompt refinement: rewrite a rough idea into a detailed image prompt using a chosen AI.
const INSTRUCTION =
  "You rewrite rough ideas into detailed prompts for an AI image generator. Keep the user's subject and intent, " +
  "add concrete detail about composition, lighting, style, colour and mood, and keep it under 120 words. " +
  "If the user names a style, keep it. Reply with the improved prompt only: no quotes, no preface, no explanation.";

async function fail(res, what) {
  let body = "";
  try {
    body = (await res.text()).slice(0, 300);
  } catch {}
  return new Error(`${what} failed (HTTP ${res.status}). ${body}`.trim());
}

const REFINERS = {
  gemini: {
    label: "Gemini (API key)",
    needsKey: "gemini",
    defaultModel: "gemini-2.5-flash",
    async run({ prompt, model, key, signal }) {
      if (!key) throw new Error("No Gemini API key. Add one in Settings.");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: INSTRUCTION }] }, contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) throw await fail(res, "Gemini");
      const j = await res.json();
      return j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    },
  },
  openai: {
    label: "OpenAI (API key)",
    needsKey: "openai",
    defaultModel: "gpt-4o-mini",
    async run({ prompt, model, key, signal }) {
      if (!key) throw new Error("No OpenAI API key. Add one in Settings.");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        signal,
        body: JSON.stringify({ model, messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: prompt }] }),
      });
      if (!res.ok) throw await fail(res, "OpenAI");
      const j = await res.json();
      return j.choices?.[0]?.message?.content?.trim();
    },
  },
  ollama: {
    label: "Ollama (local)",
    needsKey: null,
    defaultModel: "",
    async run({ prompt, model, ollamaUrl, signal }) {
      const base = (ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
      let m = model;
      if (!m) {
        const t = await fetch(`${base}/api/tags`, { signal }).catch(() => null);
        if (!t || !t.ok) throw new Error("Ollama is not running. Start it, or pick another refiner.");
        m = (await t.json()).models?.[0]?.name;
        if (!m) throw new Error("Ollama has no models. Run: ollama pull llama3.2");
      }
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        signal,
        body: JSON.stringify({ model: m, stream: false, messages: [{ role: "system", content: INSTRUCTION }, { role: "user", content: prompt }] }),
      }).catch(() => {
        throw new Error("Could not reach Ollama. Is it running?");
      });
      if (!res.ok) throw await fail(res, "Ollama");
      return (await res.json()).message?.content?.trim();
    },
  },
};

module.exports = { REFINERS };
