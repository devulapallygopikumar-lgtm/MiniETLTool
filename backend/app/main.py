from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import audit_events, datasets, rules, runs, uploads

app = FastAPI(title="Mini ETL API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.allowed_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets.router)
app.include_router(uploads.router)
app.include_router(rules.router)
app.include_router(runs.router)
app.include_router(audit_events.router)


@app.get("/health")
def health():
    return {"status": "ok"}
