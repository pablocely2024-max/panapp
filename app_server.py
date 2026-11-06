"""Uvicorn entry point; FastAPI initializes the Neon schema during startup."""

from saas_app import app, main

__all__ = ["app", "main"]


if __name__ == "__main__":
    raise SystemExit(main())
