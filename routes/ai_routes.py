"""
routes/ai_routes.py — provider-agnostic AI endpoints (Gemini / Claude / ChatGPT).

  GET  /api/ai/providers                 -> which providers exist + whether keys are set
  POST /api/ai/vision/extract            -> upload doc + provider -> structured JSON transactions
  POST /api/ai/categorize                -> run the AI-categorize prompt through a chosen provider
                                            (alternative to the manual paste-back flow)

The user picks the provider in the UI; the key is read from .env server-side.
"""

from flask import Blueprint, request, jsonify
from core import ai_providers
from core.db import get_db

ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")


def _to_amount(v):
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _normalize_extraction(parsed):
    """Accept either the new {transactions:[...], review:[...]} object or a bare
    array (older/looser model output), and return (transactions, review) lists with
    stable temporary ids. 'review' items are lines the model flagged as uncertain -
    surfaced to the user separately, never silently dropped."""
    if isinstance(parsed, dict):
        raw_txns = parsed.get("transactions", []) or []
        raw_review = parsed.get("review", []) or []
    elif isinstance(parsed, list):
        raw_txns, raw_review = parsed, []
    else:
        raw_txns, raw_review = [], []

    txns = []
    for i, t in enumerate(raw_txns):
        if not isinstance(t, dict):
            continue
        txns.append({
            "transaction_id": f"ai_{i+1}",
            "date": str(t.get("date", "")).strip(),
            "description": str(t.get("description", "")).strip(),
            "amount": _to_amount(t.get("amount", 0)),
            "source_page": 1,
        })

    review = []
    for i, r in enumerate(raw_review):
        if not isinstance(r, dict):
            review.append({"review_id": f"rv_{i+1}", "raw": str(r), "reason": "",
                           "date": "", "description": str(r), "amount": 0.0})
            continue
        review.append({
            "review_id": f"rv_{i+1}",
            "raw": str(r.get("raw", "")).strip(),
            "reason": str(r.get("reason", "")).strip(),
            "date": str(r.get("date", "")).strip(),
            "description": str(r.get("description", r.get("raw", ""))).strip(),
            "amount": _to_amount(r.get("amount", 0)),
        })
    return txns, review


# ── The structured-extraction prompt used for AI Vision ──────────────────────
VISION_PROMPT = (
    "You are a precise bank-statement data-extraction engine. Read this bank statement "
    "document and extract EVERY transaction line.\n\n"
    "Return ONLY a JSON object (no prose, no markdown fences) with two keys:\n"
    '  "transactions" — a JSON array of confident transaction rows, each an object with:\n'
    '       "date"        (string, as printed, e.g. "03 Mar 2025")\n'
    '       "description" (string, the full narration/merchant text)\n'
    '       "amount"      (number: POSITIVE for money in / credits, NEGATIVE for money out / debits)\n'
    '  "review" — a JSON array of lines you are UNSURE about (do NOT drop them silently). '
    "Each item: { \"raw\": \"<the raw text you saw>\", \"reason\": \"<why unsure, e.g. couldn't read amount / "
    "might be a balance/subtotal>\", and best-guess \"date\"/\"description\"/\"amount\" where possible }.\n\n"
    "Rules:\n"
    "- If the statement has separate Debit and Credit columns, convert to a single signed amount.\n"
    "- Never invent transactions. Never merge two lines. Preserve order top-to-bottom.\n"
    "- Strip currency symbols and thousands separators from amount (e.g. \"$1,234.50\" -> 1234.5).\n"
    "- Genuine opening/closing balances, headers, and subtotals are NOT transactions: put them in "
    "\"review\" (flagged) rather than deleting them, so the user can see what was set aside.\n"
    "- Anything you can read cleanly and are confident is a transaction goes in \"transactions\".\n"
    "Output example:\n"
    '{"transactions":[{"date":"01 Jul 2024","description":"WOOLWORTHS 1234","amount":-82.40}],'
    '"review":[{"raw":"CLOSING BALANCE 1,234.50","reason":"looks like a balance, not a transaction",'
    '"description":"CLOSING BALANCE","amount":1234.50}]}'
)


@ai_bp.route("/providers", methods=["GET"])
def providers():
    return jsonify(ai_providers.list_providers())


@ai_bp.route("/vision/extract", methods=["POST"])
def vision_extract():
    """multipart form: file=<image/pdf>, provider=<gemini|claude|chatgpt>.
    Returns {transactions: [{date, description, amount}], raw: "<model text>"}.
    Nothing is written to the DB here — the user reviews, then confirms separately."""
    provider = (request.form.get("provider") or "").lower().strip()
    if provider not in ("gemini", "claude", "chatgpt"):
        return jsonify({"error": "Choose a provider: gemini, claude, or chatgpt"}), 400
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400

    raw_bytes = f.read()
    mime = f.mimetype or "application/octet-stream"
    # Normalize a few common cases
    name = (f.filename or "").lower()
    if mime in ("application/octet-stream", "") and name.endswith(".pdf"):
        mime = "application/pdf"
    if name.endswith((".png",)):
        mime = "image/png"
    elif name.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"

    # ChatGPT vision path does not accept raw PDFs — guide the user.
    if provider == "chatgpt" and mime == "application/pdf":
        return jsonify({
            "error": "ChatGPT vision accepts images (PNG/JPG), not PDF directly. "
                     "Use Gemini or Claude for PDFs, or upload a page image."
        }), 400

    try:
        text = ai_providers.extract_from_document(provider, raw_bytes, mime, VISION_PROMPT)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    try:
        parsed = ai_providers.parse_json_loose(text)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Could not parse model output as JSON: {e}", "raw": text}), 422

    txns, review = _normalize_extraction(parsed)
    return jsonify({"transactions": txns, "review": review, "count": len(txns),
                    "review_count": len(review), "provider": provider, "raw": text})


@ai_bp.route("/vision/extract-text", methods=["POST"])
def vision_extract_from_text():
    """json body: {response_text, }  — the paste-back path for AI Vision.
    The user ran our prompt in their own AI window and pastes the JSON back here.
    Returns normalized transactions for preview."""
    body = request.json or {}
    text = (body.get("response_text") or "").strip()
    if not text:
        return jsonify({"error": "No response text provided"}), 400
    try:
        parsed = ai_providers.parse_json_loose(text)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Could not parse JSON: {e}"}), 422

    txns, review = _normalize_extraction(parsed)
    return jsonify({"transactions": txns, "review": review,
                    "count": len(txns), "review_count": len(review)})


@ai_bp.route("/vision/prompt", methods=["GET"])
def vision_prompt():
    """Expose the exact extraction prompt so the user can run it in their own AI window."""
    return jsonify({"prompt": VISION_PROMPT})


@ai_bp.route("/categorize/<int:sid>", methods=["POST"])
def categorize_via_provider(sid):
    """Run categorization for a statement's uncategorized transactions through the
    selected provider directly (no copy/paste). Body: {provider}.
    Returns the model's raw text in the SAME 'id: Category' format the existing
    /ai-categorize/apply route already parses — the frontend then applies it."""
    body = request.json or {}
    provider = (body.get("provider") or "").lower().strip()
    if provider not in ("gemini", "claude", "chatgpt"):
        return jsonify({"error": "Choose a provider: gemini, claude, or chatgpt"}), 400

    from routes.workflow_routes import _build_ai_categorize_prompt_text  # lazy import
    system, prompt = _build_ai_categorize_prompt_text(get_db(), sid)
    if not prompt:
        return jsonify({"error": "No uncategorized transactions in this statement"}), 400

    try:
        text = ai_providers.complete_text(provider, prompt, system=system, max_tokens=4000)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    return jsonify({"response_text": text, "provider": provider})
