# DocParse — Deployment (Docker + PostgreSQL)

The whole app (PostgreSQL database + backend + frontend) now runs as one Docker
stack. You need **Docker Desktop** installed on the machine that will run it
(your laptop for testing, or the office/server machine later). Nothing else —
no manual Python, Node, or Postgres installs.

## First run

From the project folder (where `docker-compose.yml` lives):

```
docker compose up --build
```

That builds the frontend, starts PostgreSQL, and starts the app. When it settles,
open a browser to:

- On the same machine: http://localhost:5051
- From another PC on the same network: http://<THIS-MACHINE-IP>:5051
  (find the IP with `ipconfig` on Windows — the IPv4 address.)

Stop it with `Ctrl+C`, or run detached with `docker compose up -d`.

## Everyday commands

```
docker compose up -d          # start in background
docker compose down           # stop
docker compose logs -f app    # watch app logs (errors show here)
docker compose up --build -d  # rebuild + restart after a code update
```

## Updating after code changes

If you use git on the server:

```
git pull
docker compose up --build -d
```

That's the whole update — works the same remoted-in or in person.

## AI provider keys (optional)

Create a file named `.env` next to `docker-compose.yml`:

```
DB_PASSWORD=choose-a-strong-password
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

Only fill what you use. `DB_PASSWORD` is optional but recommended for a real
deployment (defaults to `docparse` if omitted).

## Data & persistence

- The database lives in a Docker volume (`dbdata`) and survives restarts.
- Uploaded files / scratch live in the `./data` folder on the host.
- Backups are covered in the next step (Step 3).

## Notes

- The app runs under gunicorn with 4 workers — fine for a small team; raise
  `--workers` in the Dockerfile if the office grows.
- Only port 5051 is exposed. Postgres is not reachable from outside the stack,
  which is the safe default.
