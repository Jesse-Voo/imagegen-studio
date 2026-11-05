# ImageGen Studio

A small Windows desktop app (Electron) for generating images. Pick where the image comes from, optionally let an AI
rewrite your rough idea into a better prompt first, and get the files saved to a folder you choose.

It is the standalone companion to [agy-imagegen](https://github.com/Jesse-Voo/agy-imagegen) (the skill for coding agents) and does not need it.

## Image sources

| Source | Needs |
| --- | --- |
| Gemini via Antigravity (`agy`) | the Antigravity CLI installed and signed in; uses its own Gemini image tool (slow, ignores the size choice, uses your agy quota) |
| Gemini (`gemini-2.5-flash-image`, `imagen-4.0-generate-001`) | a Google AI Studio API key |
| OpenAI (`gpt-image-1`, `gpt-image-1-mini`, `dall-e-3`) | an OpenAI API key (ChatGPT sign-in cannot generate images) |
| Pollinations | nothing (free, lower quality, rate-limited: may answer 402/429) |
| Local server | any OpenAI-compatible image server, set its URL in Settings |

Reference images (for inspiration or editing) work with agy, Gemini, OpenAI and a local server.

Local server tip: [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp)'s `sd-server` exposes an OpenAI-compatible `/v1/images/generations`; point Settings at `http://127.0.0.1:8080/v1`.

## Prompt refinement

Tick "Refine my prompt with AI first" (or press "Refine prompt" to preview it) and choose the AI:
Gemini, OpenAI or a local Ollama model. The refined prompt replaces the text box so you can edit it before generating.

## Run

```bash
npm install
npm start
```

Build a portable `.exe` with `npm run dist`.

## Keys and privacy

API keys are encrypted with Windows DPAPI (Electron `safeStorage`) and stored in your user profile. The environment
variables `GEMINI_API_KEY` and `OPENAI_API_KEY` are also read. Prompts and reference images go only to the source you picked.

## Status

Tested end to end in the app: agy and a real local sd-server (SDXL Q8 on an RTX 3060, about 70 s per 1024px image), plus a fake OpenAI-compatible server.
Not tested with real accounts: Gemini API, OpenAI, Pollinations and the refiners (no keys were available), so expect rough edges there.

## Responsible use and terms

- Each source has its own terms. You must follow them: [Google Gemini API terms and prohibited use policy](https://ai.google.dev/gemini-api/terms), [OpenAI usage policies](https://openai.com/policies/usage-policies), [Pollinations terms](https://pollinations.ai), and the licence of any local model (for example SDXL is OpenRAIL++, FLUX.1 schnell is Apache 2.0, FLUX.1 dev is non-commercial).
- The app does not bypass, retry around or strip anything from a provider: if a source refuses a prompt or blocks an image, you see its message. Provider watermarks and metadata (for example SynthID, C2PA) are left intact.
- Prompt refinement only rewrites your text for detail; it is not meant to rephrase prompts to evade a provider's content filters.
- Do not generate images of real people to deceive, impersonate or harass, sexual content involving minors, or anything else those policies forbid. AI-generated images should be disclosed as such where the law or a platform requires it.
- Your API keys stay on your PC (DPAPI-encrypted). The app never sends keys, prompts or reference images anywhere except the source you selected.
