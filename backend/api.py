#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import threading
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from env_loader import load_env_file

ROOT = Path(__file__).resolve().parent
load_env_file(ROOT / ".env")

from scrape_monitoring import run_once
from supabase_store import SupabaseStore

RUNTIME_DIR = Path(os.getenv("RUNTIME_DIR", "/tmp/plts-monitoring"))
OUT_DIR = RUNTIME_DIR / "monitoring_output"
COOKIE_DIR = RUNTIME_DIR / "cookies"

INTERVAL_SECONDS = max(60, int(os.getenv("SCRAPE_INTERVAL_SECONDS", "300")))
REQUEST_TIMEOUT = max(5, int(os.getenv("SCRAPE_REQUEST_TIMEOUT", "30")))
REQUEST_DELAY = max(0.0, float(os.getenv("SCRAPE_REQUEST_DELAY", "0.15")))
AUTO_SCRAPE = os.getenv("AUTO_SCRAPE", "true").lower() not in {"0", "false", "no"}
SCRAPE_ON_STARTUP = os.getenv("SCRAPE_ON_STARTUP", "true").lower() not in {"0", "false", "no"}

STORE = SupabaseStore.from_env()

STATE: dict[str, Any] = {
    "running": False,
    "last_started_at": None,
    "last_finished_at": None,
    "last_success": None,
    "last_error": None,
    "last_run_id": None,
    "last_database_write_at": None,
    "last_history_saved": None,
    "last_site_summary": None,
}
STATE_LOCK = threading.Lock()
SCRAPE_LOCK = threading.Lock()
STOP_EVENT = threading.Event()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def env_enabled(name: str, default: bool = True) -> bool:
    default_text = "true" if default else "false"
    return os.getenv(name, default_text).lower() not in {"0", "false", "no"}


def write_json_secret(env_name: str, destination: Path) -> bool:
    raw = os.getenv(env_name, "").strip()
    if not raw:
        return False

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{env_name} is not valid JSON: {exc.msg}") from exc

    if not isinstance(parsed, (list, dict)):
        raise RuntimeError(f"{env_name} must contain a JSON cookie list or storage-state object")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(parsed, ensure_ascii=False), encoding="utf-8")
    return True


def materialize_cookies() -> dict[str, Path | None]:
    huawei_path = COOKIE_DIR / "huawei_Cookies.json"
    kehua_path = COOKIE_DIR / "kehua_Cookies.json"

    huawei_written = write_json_secret("HUAWEI_COOKIES_JSON", huawei_path)
    kehua_written = write_json_secret("KEHUA_COOKIES_JSON", kehua_path)

    return {
        "huawei": huawei_path if huawei_written else None,
        "kehua": kehua_path if kehua_written else None,
    }


def build_scrape_args() -> SimpleNamespace:
    cookie_paths = materialize_cookies()
    sites: list[str] = []

    if env_enabled("ENABLE_HUAWEI"):
        cookie_path = cookie_paths["huawei"]
        binding = f"huawei:{ROOT / 'huawei_api_blueprint.json'}"
        if cookie_path:
            binding += f":{cookie_path}"
        sites.append(binding)

    if env_enabled("ENABLE_KEHUA"):
        cookie_path = cookie_paths["kehua"]
        if not cookie_path:
            raise RuntimeError("KEHUA_COOKIES_JSON is required while ENABLE_KEHUA=true")
        sites.append(f"kehua:{ROOT / 'kehua_api_blueprint.json'}:{cookie_path}")

    if not sites:
        raise RuntimeError("No monitoring sites are enabled")

    return SimpleNamespace(
        sites_config=str(ROOT / "sites.json"),
        site=sites,
        out_dir=str(OUT_DIR),
        timeout=REQUEST_TIMEOUT,
        delay=REQUEST_DELAY,
        jsonl=False,
    )


def set_state(**updates: Any) -> None:
    with STATE_LOCK:
        STATE.update(updates)


def get_state() -> dict[str, Any]:
    with STATE_LOCK:
        return dict(STATE)


def summarize_sites(result: dict[str, Any]) -> dict[str, Any]:
    return {
        site.get("site", "unknown"): site.get("summary", {})
        for site in result.get("sites", [])
    }


def scrape_now() -> None:
    if not SCRAPE_LOCK.acquire(blocking=False):
        return

    try:
        set_state(running=True, last_started_at=now_iso(), last_error=None)
        result = run_once(build_scrape_args())
        summaries = summarize_sites(result)
        scrape_success = bool(summaries) and all(
            summary.get("success_count", 0) > 0 for summary in summaries.values()
        )

        set_state(last_run_id=result.get("run_id"), last_site_summary=summaries)

        if not scrape_success:
            raise RuntimeError("One or more sites returned no successful API calls; keeping the previous Supabase snapshot")

        current = result.get("current")
        if not isinstance(current, dict):
            raise RuntimeError("Scraper did not return a normalized current snapshot")

        database_result = STORE.save_snapshot(
            run_id=str(result.get("run_id")),
            scraped_at=str(result.get("scraped_at") or current.get("updated_at") or now_iso()),
            payload=current,
            summary=summaries,
        )

        set_state(
            running=False,
            last_finished_at=now_iso(),
            last_success=True,
            last_error=None,
            last_run_id=result.get("run_id"),
            last_database_write_at=database_result.get("updated_at"),
            last_history_saved=database_result.get("history_saved"),
        )
    except Exception as exc:  # Keep the web process alive so /health can explain the failure.
        traceback.print_exc()
        set_state(
            running=False,
            last_finished_at=now_iso(),
            last_success=False,
            last_error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        SCRAPE_LOCK.release()


def scrape_loop() -> None:
    if SCRAPE_ON_STARTUP:
        scrape_now()

    while not STOP_EVENT.wait(INTERVAL_SECONDS):
        scrape_now()


@asynccontextmanager
async def lifespan(_: FastAPI):
    worker: threading.Thread | None = None
    if AUTO_SCRAPE:
        worker = threading.Thread(target=scrape_loop, name="monitoring-scraper", daemon=True)
        worker.start()

    yield

    STOP_EVENT.set()
    if worker:
        worker.join(timeout=5)


app = FastAPI(
    title="PLTS Monitoring API",
    description="Huawei and Kehua monitoring scraper backed by Supabase.",
    version="2.0.0",
    lifespan=lifespan,
)

origins = [item.strip() for item in os.getenv("FRONTEND_ORIGIN", "*").split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "PLTS Monitoring API",
        "version": app.version,
        "storage": "Supabase Postgres",
        "endpoints": ["/health", "/ready", "/api/status", "/api/current", "/api/history"],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    """Render liveness endpoint. Database or scraper failures do not terminate the process."""
    return {
        "status": "ok",
        "scraper": get_state(),
        "database": STORE.public_status(),
    }


@app.get("/ready")
def ready() -> JSONResponse:
    try:
        row = STORE.get_current_row()
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "message": f"Supabase is unavailable: {type(exc).__name__}: {exc}",
                "scraper": get_state(),
                "database": STORE.public_status(),
            },
        )

    if not row:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "message": "No monitoring snapshot exists in Supabase yet",
                "scraper": get_state(),
                "database": STORE.public_status(),
            },
        )

    return JSONResponse(
        content={
            "status": "ready",
            "run_id": row.get("run_id"),
            "scraped_at": row.get("scraped_at"),
            "updated_at": row.get("updated_at"),
            "scraper": get_state(),
        }
    )


@app.get("/api/status")
def status() -> dict[str, Any]:
    response: dict[str, Any] = {
        "scraper": get_state(),
        "database": STORE.public_status(),
        "current": None,
    }
    try:
        row = STORE.get_current_row()
        if row:
            response["current"] = {
                "run_id": row.get("run_id"),
                "scraped_at": row.get("scraped_at"),
                "updated_at": row.get("updated_at"),
                "summary": row.get("summary"),
            }
    except Exception as exc:
        response["database_error"] = f"{type(exc).__name__}: {exc}"
    return response


@app.get("/api/current")
def current() -> JSONResponse:
    try:
        row = STORE.get_current_row()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Supabase is unavailable: {type(exc).__name__}: {exc}",
        ) from exc

    if not row or not isinstance(row.get("payload"), dict):
        raise HTTPException(
            status_code=503,
            detail={
                "message": "The first monitoring snapshot has not been stored in Supabase",
                "scraper": get_state(),
            },
        )

    return JSONResponse(
        row["payload"],
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Snapshot-Run-Id": str(row.get("run_id") or ""),
        },
    )


@app.get("/api/history")
def history(
    limit: int = Query(default=24, ge=1, le=168),
    include_payload: bool = Query(default=False),
) -> JSONResponse:
    try:
        rows = STORE.get_history(limit=limit, include_payload=include_payload)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Supabase is unavailable: {type(exc).__name__}: {exc}",
        ) from exc

    return JSONResponse(
        {"count": len(rows), "items": rows},
        headers={"Cache-Control": "no-store, max-age=0"},
    )
