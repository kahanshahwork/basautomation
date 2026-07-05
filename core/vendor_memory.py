"""
core/vendor_memory.py — Description normalization, transaction grouping (item 7),
and the vendor-memory lookup table (Part D, path 1: deterministic suggestion engine).

Self-contained: takes/returns plain dicts. Swappable later for an
embedding-based matcher (Part D, path 2) without touching callers — the
function signatures (normalize, group_transactions, suggest_category,
remember) are the contract other modules rely on.
"""

import re
from core.db import get_db

_NOISE_PATTERNS = [
    r"\b\d{2}/\d{2}/\d{2,4}\b",      # dates
    r"\b\d{4,}\b",                    # long reference/account numbers
    r"\bxx+\d*\b",                    # masked card numbers
    r"\breceipt\s*#?\d*\b",
    r"\bref\s*#?\w*\b",
    r"[^a-z\s]",                       # punctuation/digits left over
]

# Tokens that are location/channel/card noise, NOT part of the merchant identity.
# Used by merchant_key() so "Shein AUS Melbourne AU", "shein com melbourne aucard",
# and "SHEIN.COM SOUTH YARRA AU" all collapse to the same merchant: "shein".
_MERCHANT_NOISE = {
    # country / channel
    "au", "aus", "australia", "aucard", "card", "com", "au com", "pty", "ltd", "ptyltd",
    "www", "http", "https", "inc", "co", "the",
    # banking channel words
    "commbank", "app", "payid", "phone", "from", "to", "npp", "osko", "bpay", "eftpos",
    "visa", "mastercard", "debit", "credit", "purchase", "payment", "pos", "value",
    "date", "transfer", "direct", "withdrawal", "deposit",
    # AU cities / common suburbs seen as trailing location tokens
    "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart", "darwin",
    "gold", "coast", "north", "south", "east", "west", "cbd", "central",
    "blacktown", "parramatta", "chatswood", "marsden", "park", "hallam", "yarra",
    "mount", "druitt", "point", "cook", "richmond", "newcastle", "wollongong", "geelong",
}


def merchant_key(desc: str) -> str:
    """Extract a stable merchant identity from a raw bank description, ignoring
    city/channel/card noise. Returns a short key like 'shein', 'aliexpress',
    'officeworks', 'nrma insurance'. Empty string if nothing meaningful remains.

    Strategy: normalize -> drop noise tokens -> keep the first 1-2 meaningful tokens
    (the leading brand words), which is where the merchant name almost always lives."""
    s = (desc or "").lower()
    # drop masked-card fragments like 'xx', 'xxxx' before splitting
    s = re.sub(r"\bx{2,}\d*\b", " ", s)
    # replace separators with spaces, strip digits & punctuation
    s = re.sub(r"[^a-z\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    tokens = [t for t in s.split(" ") if t and t not in _MERCHANT_NOISE and len(t) > 1]
    if not tokens:
        return ""
    # Keep up to the first two meaningful tokens as the merchant identity.
    # One token covers most (shein, aliexpress, officeworks); two captures
    # multi-word brands (nrma insurance, hayden agencies).
    return " ".join(tokens[:2])

# ── Semantic buckets (item: "group uber eats + other food delivery together") ──
# Ordered list of (bucket_label, [keywords]). First match wins. Edit/extend freely —
# nothing else in the app needs to change when you add a keyword or bucket here.
SEMANTIC_BUCKETS = [
    ("Food Delivery",      ["uber eats", "ubereats", "menulog", "doordash", "deliveroo", "hungry panda"]),
    ("Ride Share / Taxi",  ["uber trip", "uber *", "uber technologies", "ola ride", "didi", "taxi"]),
    ("Bank Transfers",     ["npp payment", "osko payment", "payid", "transfer to", "transfer from", "internal transfer"]),
    ("Interest",           ["interest charged", "interest payment", "interest credit", "interest paid"]),
    ("Subscriptions",      ["netflix", "spotify", "stan ", "disney+", "amazon prime", "adobe", "microsoft 365",
                             "dropbox", "google storage", "youtube premium", "apple.com/bill"]),
    ("Merchant Settlement",["merchant settlement"]),
    ("BPAY",                ["bpay debit", "bpay payment", "bpay "]),
    ("Direct Debit",        ["direct debit"]),
    ("Salary / Payroll",    ["salary", "payroll", "wages"]),
    ("Bank Fees",           ["account fee", "monthly fee", "service fee", "merchant fee", "account keeping"]),
]


def normalize_description(desc: str) -> str:
    """Strip dates, reference numbers, punctuation -> stable grouping key."""
    s = (desc or "").lower()
    for pat in _NOISE_PATTERNS:
        s = re.sub(pat, " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    tokens = s.split(" ")
    return " ".join(tokens[:4])


def semantic_bucket(description: str) -> str | None:
    """Returns a human-readable bucket label like 'Food Delivery' if the description
    matches a known keyword set, else None (caller falls back to description grouping)."""
    s = (description or "").lower()
    for label, keywords in SEMANTIC_BUCKETS:
        if any(kw in s for kw in keywords):
            return label
    return None


def group_transactions(transactions: list[dict]) -> dict[str, list[dict]]:
    """Two-pass grouping:
       1) Try to place each transaction into a semantic bucket (Food Delivery, Transfers, ...)
       2) Anything left over groups by normalized description (old behavior) as a fallback.
    This is what lets 'Uber Eats' and 'Menulog' land in the same group even though
    their raw description text is completely different."""
    groups: dict[str, list[dict]] = {}
    for t in transactions:
        desc = t.get("description", "")
        bucket = semantic_bucket(desc)
        if bucket:
            key = bucket
        else:
            key = normalize_description(desc) or "(uncategorized text)"
        groups.setdefault(key, []).append(t)
    return groups


# Prefix used to store a *semantic-bucket* pattern in vendor_memory. This lets a
# single learned decision (e.g. "Uber Eats Sydney -> Food & Meals") apply to every
# other transaction in the same bucket ("Uber Eats Melbourne", "Menulog", ...),
# which is what the user expects: categorise one, and similar vendors get suggested.
_BUCKET_PREFIX = "bucket::"

# Prefix for a MERCHANT-scoped pattern: e.g. "merchant::DR:shein". This generalizes
# across the same vendor's location/channel variants ("Shein AUS Melbourne",
# "SHEIN.COM SOUTH YARRA", ...) so categorizing one Shein row suggests the same
# category for all Shein rows. Direction-scoped so credits/debits never cross.
_MERCHANT_PREFIX = "merchant::"


def _direction(amount) -> str:
    """CR for credits/income (amount >= 0), DR for debits/expenses (amount < 0)."""
    try:
        return "CR" if float(amount) >= 0 else "DR"
    except (TypeError, ValueError):
        return "CR"


def suggest_category(client_id: int, description: str, amount=None):
    """Suggest a category_id for a description, in priority order:
       1. Exact normalized-pattern match (most specific — this exact vendor was learned).
       2. Semantic-bucket match — if a transaction in the same bucket AND same direction
          (Food Delivery, Bank Transfers, ...) was previously learned for this client.
    The bucket match is direction-scoped: a learned CR "transfer from" pattern will NOT
    be suggested for a DR "transfer to" row, and vice versa. Returns category_id or None.
    Purely deterministic; never calls AI."""
    conn = get_db()

    # 1. Exact normalized pattern (already vendor-specific, so direction rarely conflicts)
    key = normalize_description(description)
    if key:
        row = conn.execute(
            "SELECT category_id FROM vendor_memory WHERE client_id = ? AND pattern = ? "
            "ORDER BY hit_count DESC LIMIT 1",
            (client_id, key),
        ).fetchone()
        if row:
            return row["category_id"]

    # 2. Merchant match — collapses location/channel variants of the same vendor.
    #    We look up the merchant pattern in BOTH directions (a vendor is almost always
    #    one direction anyway) and let the caller's direction-guard reject any mismatch.
    #    This makes suggestions robust even if a pattern's direction was recorded
    #    imperfectly (e.g. learned from a BAS with no signed amounts). Prefer the
    #    row's own direction first, then fall back to the other.
    mkey = merchant_key(description)
    if mkey:
        dir_ = _direction(amount) if amount is not None else None
        order = [dir_, ("DR" if dir_ == "CR" else "CR")] if dir_ else ["DR", "CR"]
        for d in order:
            if not d:
                continue
            mrow = conn.execute(
                "SELECT category_id FROM vendor_memory WHERE client_id = ? AND pattern = ? "
                "ORDER BY hit_count DESC LIMIT 1",
                (client_id, f"{_MERCHANT_PREFIX}{d}:{mkey}"),
            ).fetchone()
            if mrow:
                return mrow["category_id"]

    # 3. Semantic bucket — scoped by direction so CR and DR never cross-contaminate
    bucket = semantic_bucket(description)
    if bucket:
        dir_ = _direction(amount) if amount is not None else None
        if dir_:
            brow = conn.execute(
                "SELECT category_id FROM vendor_memory WHERE client_id = ? AND pattern = ? "
                "ORDER BY hit_count DESC LIMIT 1",
                (client_id, f"{_BUCKET_PREFIX}{dir_}:{bucket}"),
            ).fetchone()
            if brow:
                return brow["category_id"]
        # Legacy fallback: a direction-less bucket pattern from older data
        brow = conn.execute(
            "SELECT category_id FROM vendor_memory WHERE client_id = ? AND pattern = ? "
            "ORDER BY hit_count DESC LIMIT 1",
            (client_id, _BUCKET_PREFIX + bucket),
        ).fetchone()
        if brow:
            return brow["category_id"]

    return None


def _upsert(conn, client_id: int, pattern: str, category_id: int):
    existing = conn.execute(
        "SELECT id FROM vendor_memory WHERE client_id = ? AND pattern = ?",
        (client_id, pattern),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE vendor_memory SET category_id = ?, hit_count = hit_count + 1, "
            "updated_at = datetime('now') WHERE id = ?",
            (category_id, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO vendor_memory (client_id, pattern, category_id) VALUES (?,?,?)",
            (client_id, pattern, category_id),
        )


def _upsert_merchant(conn, client_id: int, pattern: str, category_id: int, force: bool = False):
    """Like _upsert, but keeps the MOST-USED category for a merchant rather than
    blindly overwriting. If the same merchant is later confirmed as a different
    category, we only switch the stored category once the new one has been seen
    more often — so an occasional misclassification doesn't hijack the merchant.

    When force=True (an explicit single-row user correction), immediately adopt the
    new category and reset the vote — the user's deliberate action wins now, not
    'eventually'."""
    row = conn.execute(
        "SELECT id, category_id, hit_count FROM vendor_memory WHERE client_id = ? AND pattern = ?",
        (client_id, pattern),
    ).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO vendor_memory (client_id, pattern, category_id) VALUES (?,?,?)",
            (client_id, pattern, category_id),
        )
        return
    if force and row["category_id"] != category_id:
        conn.execute(
            "UPDATE vendor_memory SET category_id = ?, hit_count = 1, updated_at = datetime('now') WHERE id = ?",
            (category_id, row["id"]),
        )
        return
    if row["category_id"] == category_id:
        conn.execute(
            "UPDATE vendor_memory SET hit_count = hit_count + 1, updated_at = datetime('now') WHERE id = ?",
            (row["id"],),
        )
    else:
        # Different category for the same merchant. Decrement the old vote; if the
        # new category overtakes, switch to it. This makes the stored value track
        # the majority category over time.
        new_count = row["hit_count"] - 1
        if new_count <= 0:
            conn.execute(
                "UPDATE vendor_memory SET category_id = ?, hit_count = 1, updated_at = datetime('now') WHERE id = ?",
                (category_id, row["id"]),
            )
        else:
            conn.execute(
                "UPDATE vendor_memory SET hit_count = ? WHERE id = ?",
                (new_count, row["id"]),
            )


def remember(client_id: int, description: str, category_id: int, amount=None, direction=None, force: bool = False):
    """Persist a confirmed vendor->category mapping. Writes THREE layers:
       - the exact normalized pattern (most specific),
       - a DIRECTION-SCOPED merchant pattern (generalizes across the vendor's
         location/channel variants — 'Shein Melbourne' / 'SHEIN.COM South Yarra'),
       - a DIRECTION-SCOPED semantic-bucket pattern (Food Delivery, Transfers, ...).
    Direction scoping means credits and debits never cross-contaminate.

    Direction is taken from `direction` ('CR'/'DR') if given, else derived from
    `amount`. force=True makes an explicit single correction immediately override
    the merchant pattern's category (used by the per-row 'Update VM' action)."""
    conn = get_db()
    if direction in ("CR", "DR"):
        dir_ = direction
    else:
        dir_ = _direction(amount) if amount is not None else "CR"

    key = normalize_description(description)
    if key:
        _upsert(conn, client_id, key, category_id)

    mkey = merchant_key(description)
    if mkey:
        _upsert_merchant(conn, client_id, f"{_MERCHANT_PREFIX}{dir_}:{mkey}", category_id, force=force)

    bucket = semantic_bucket(description)
    if bucket:
        _upsert(conn, client_id, f"{_BUCKET_PREFIX}{dir_}:{bucket}", category_id)
    conn.commit()
