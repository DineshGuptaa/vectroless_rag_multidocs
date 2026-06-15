"""
Settings Service
Refactored with modular routes for better maintainability
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging
from database import init_db

from shared.consul_discovery import ConsulRegistry

logger = logging.getLogger(__name__)

# Import routes
from routes.health import router as health_router
from routes.api_keys import router as api_keys_router
from routes.settings import router as settings_router
from routes.usage import router as usage_router

CONSUL_HOST = os.getenv("CONSUL_HOST", "consul")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs('data', exist_ok=True)
    init_db()

    consul = ConsulRegistry(consul_host=CONSUL_HOST)
    port = int(os.getenv("PORT", "8007"))
    await consul.register("settings-service", port)
    yield
    await consul.close()


# Create FastAPI app
app = FastAPI(title="Settings Service", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include routers
app.include_router(health_router)
app.include_router(api_keys_router)
app.include_router(settings_router)
app.include_router(usage_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)
