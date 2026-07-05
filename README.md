# DocParse — BAS Automation Suite (Production)

A full-stack bank-statement → BAS/GST/P&L automation app.
**Backend:** Flask (Python) · **Frontend:** React + TypeScript + Vite + Zustand.

This is a fresh, self-contained production app. The Flask backend runs on **port 5051**;
the Vite dev server runs on **port 5174** and proxies all API calls to the backend.

---

## 1. One-time setup

Open **two** terminals in the project root (`docparse-final`).

### Terminal A — Backend (Python)

```powershell
# (optional) create a virtual environment
python -m venv venv
venv\Scripts\Activate.ps1

# install backend dependencies
pip install -r requirements.txt
```

### Terminal B — Frontend (Node)

```powershell
cd frontend
npm install
```

---

## 2. Running the app (every time)

### Terminal A — start the backend

```powershell
python app.py
```
→ serves the API on **http://localhost:5051**

### Terminal B — start the frontend

```powershell
cd frontend
npm run dev
```
→ open **http://localhost:5174** in your browser.

---

## 3. Building the frontend for production

```powershell
cd frontend
npm run build      # outputs to frontend/dist
npm run preview    # preview the production build locally
```

To serve the built frontend from Flask directly (single-port deployment), point a
static route at `frontend/dist` — the API and the SPA can then share port 5051.

---

## Workflow

1. **Client Management** — create clients, quarters, and statements.
2. **Upload & Parse** — drop a PDF (auto bank detection) **or** import CSV / Excel
   with a column-mapping step. Click any transaction row to jump to its PDF page
   with the row highlighted.
3. **Approve** — every field (date, description, amount) is editable inline.
4. **Categorize** — flat or grouped (semantic buckets) view. Vendor-memory
   suggestions apply learned categories to similar vendors automatically.
   Vendor memory is written **only** when you explicitly press **Add to VM**
   (single row) or **Add All to Vendor Memory** (bulk). Changing a row's category
   after saving re-flags it as **⚠ Update VM**.
5. **GST Review** — BAS grid (G1/G10/G11/1A/1B), category summary, and per-transaction
   editing with GST recalculation.
6. **P&L** — GST-Unadjusted and GST-Adjusted columns shown side by side.

## Vendor Memory (fixed)

- Categorizing a transaction **does not** write vendor memory (explicit-action only).
- Pressing **Add to VM** learns two patterns: the exact normalized description **and**
  the semantic bucket (e.g. "Food Delivery"). This means categorizing
  "Uber Eats Sydney" now also suggests a category for "Uber Eats Melbourne",
  "Menulog", etc. — the previous bug where similar vendors never matched is fixed.

## Notes

- Database is a local SQLite file at `data/docparse.db`, created automatically.
- OCR / AI-Vision features require optional extras (`pdf2image`, `pytesseract`,
  `Pillow`) and are stubbed as "coming soon" pages in this build.
- The `frontend/` dev proxy already targets `http://localhost:5051`.
