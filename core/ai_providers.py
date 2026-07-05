"""
core/ai_providers.py — one interface for three AI providers: Gemini, Claude, ChatGPT.

The caller picks a provider at request time (the user selects it in the UI). Each
provider reads its own API key from the environment (.env):

    GEMINI_API_KEY   -> Google Gemini
    ANTHROPIC_API_KEY-> Anthropic Claude
    OPENAI_API_KEY   -> OpenAI (ChatGPT)

Two capabilities are exposed:
    complete_text(provider, prompt, ...)         -> str          (categorization etc.)
    extract_from_document(provider, file_bytes, mime, prompt)   -> str  (vision/OCR)

Everything returns plain text (usually JSON when we ask for it). Parsing is the
caller's job. No provider SDK is required — all calls are plain HTTPS via requests,
so the only dependency is `requests` (already used across the app).
"""

import os
import base64
import json
import requests

AI_TIMEOUT = 90

# ── Provider registry ──────────────────────────────────────────────────────
# Each entry: env key, default model (text), default model (vision), whether vision-capable.
PROVIDERS = {
    "gemini": {
        "label": "Google Gemini",
        "env": "GEMINI_API_KEY",
        "text_model": os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.0-flash"),
        "vision_model": os.environ.get("GEMINI_VISION_MODEL", "gemini-2.0-flash"),
        "vision": True,
    },
    "claude": {
        "label": "Anthropic Claude",
        "env": "ANTHROPIC_API_KEY",
        "text_model": os.environ.get("CLAUDE_TEXT_MODEL", "claude-sonnet-4-5-20250929"),
        "vision_model": os.environ.get("CLAUDE_VISION_MODEL", "claude-sonnet-4-5-20250929"),
        "vision": True,
    },
    "chatgpt": {
        "label": "OpenAI ChatGPT",
        "env": "OPENAI_API_KEY",
        "text_model": os.environ.get("OPENAI_TEXT_MODEL", "gpt-4o"),
        "vision_model": os.environ.get("OPENAI_VISION_MODEL", "gpt-4o"),
        "vision": True,
    },
}


def list_providers():
    """For the UI selector — returns each provider with whether its key is configured."""
    out = []
    for pid, cfg in PROVIDERS.items():
        out.append({
            "id": pid,
            "label": cfg["label"],
            "configured": bool(os.environ.get(cfg["env"], "").strip()),
            "vision": cfg["vision"],
            "env_key": cfg["env"],
        })
    return out


def _key(provider: str) -> str:
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise ValueError(f"Unknown provider: {provider!r}")
    key = os.environ.get(cfg["env"], "").strip()
    if not key:
        raise RuntimeError(f"{cfg['label']} API key not set. Add {cfg['env']} to your .env file.")
    return key


# ── Text completion ─────────────────────────────────────────────────────────

def complete_text(provider: str, prompt: str, system: str = "", max_tokens: int = 2000) -> str:
    provider = (provider or "").lower()
    if provider == "gemini":
        return _gemini_text(prompt, system, max_tokens)
    if provider == "claude":
        return _claude_text(prompt, system, max_tokens)
    if provider == "chatgpt":
        return _openai_text(prompt, system, max_tokens)
    raise ValueError(f"Unknown provider: {provider!r}")


def _gemini_text(prompt, system, max_tokens):
    key = _key("gemini")
    model = PROVIDERS["gemini"]["text_model"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    parts = [{"text": (system + "\n\n" + prompt) if system else prompt}]
    payload = {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens}}
    r = requests.post(url, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _claude_text(prompt, system, max_tokens):
    key = _key("claude")
    model = PROVIDERS["claude"]["text_model"]
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    payload = {
        "model": model, "max_tokens": max_tokens, "temperature": 0.1,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        payload["system"] = system
    r = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")


def _openai_text(prompt, system, max_tokens):
    key = _key("chatgpt")
    model = PROVIDERS["chatgpt"]["text_model"]
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = {"model": model, "messages": messages, "temperature": 0.1, "max_tokens": max_tokens}
    r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


# ── Vision / document extraction ────────────────────────────────────────────

def extract_from_document(provider: str, file_bytes: bytes, mime: str, prompt: str, max_tokens: int = 8000) -> str:
    """Send an image or PDF to the selected provider with an extraction prompt.
    Returns the model's text response (expected to be JSON when the prompt asks for it)."""
    provider = (provider or "").lower()
    b64 = base64.b64encode(file_bytes).decode()
    if provider == "gemini":
        return _gemini_vision(b64, mime, prompt, max_tokens)
    if provider == "claude":
        return _claude_vision(b64, mime, prompt, max_tokens)
    if provider == "chatgpt":
        return _openai_vision(b64, mime, prompt, max_tokens)
    raise ValueError(f"Unknown provider: {provider!r}")


def _gemini_vision(b64, mime, prompt, max_tokens):
    key = _key("gemini")
    model = PROVIDERS["gemini"]["vision_model"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": mime, "data": b64}},
            {"text": prompt},
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens},
    }
    r = requests.post(url, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _claude_vision(b64, mime, prompt, max_tokens):
    key = _key("claude")
    model = PROVIDERS["claude"]["vision_model"]
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    # Claude accepts images as image blocks and PDFs as document blocks
    if mime == "application/pdf":
        media_block = {"type": "document", "source": {"type": "base64", "media_type": mime, "data": b64}}
    else:
        media_block = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}
    payload = {
        "model": model, "max_tokens": max_tokens, "temperature": 0.1,
        "messages": [{"role": "user", "content": [media_block, {"type": "text", "text": prompt}]}],
    }
    r = requests.post("https://api.anthropic.com/v1/messages", headers=headers, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")


def _openai_vision(b64, mime, prompt, max_tokens):
    key = _key("chatgpt")
    model = PROVIDERS["chatgpt"]["vision_model"]
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    # OpenAI vision takes images as data URLs. (PDF direct upload isn't supported here;
    # convert to image upstream if needed — images are the common case for statements.)
    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
    ]
    payload = {"model": model, "messages": [{"role": "user", "content": content}], "temperature": 0.1, "max_tokens": max_tokens}
    r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload, timeout=AI_TIMEOUT)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


# ── JSON helper ─────────────────────────────────────────────────────────────

def parse_json_loose(text: str):
    """Extract a JSON object/array from a model response that may be wrapped in
    markdown fences or prose. Returns the parsed object, or raises ValueError."""
    if not text:
        raise ValueError("Empty response")
    s = text.strip()
    # Strip markdown code fences
    if s.startswith("```"):
        s = s.split("```", 2)
        s = s[1] if len(s) > 1 else text
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
    s = s.strip()
    # Find the outermost JSON bracket span
    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        start = s.find(open_ch)
        end = s.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(s[start:end + 1])
            except json.JSONDecodeError:
                continue
    return json.loads(s)  # last resort — will raise with a clear message
