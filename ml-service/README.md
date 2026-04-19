# ml-service

Python FastAPI service for CSV ingest and dispute-prediction training.
Deployed on Railway. See root [ARCHITECTURE.md](../ARCHITECTURE.md) for the full picture.

## Local dev

```bash
python -m venv .venv
source .venv/Scripts/activate    # Windows git-bash
pip install -r requirements.txt
cp ../.env .env    # or let bootstrap fill it in
uvicorn main:app --reload --port 8000
```

## Endpoints

- `GET /health` — liveness probe
- `POST /ingest` — TODO (Phase 1)
- `POST /train`  — TODO (Phase 3)
