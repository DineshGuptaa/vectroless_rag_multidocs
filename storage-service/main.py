from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging

from database import init_storage
from documents import router as documents_router
from trees import router as trees_router
from conversations import router as conversations_router
from stats import router as stats_router

logger = logging.getLogger(__name__)

from shared.consul_discovery import ConsulRegistry


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_storage()
    consul = ConsulRegistry(consul_host=os.getenv("CONSUL_HOST", "consul"))
    port = int(os.getenv("PORT", "8005"))
    await consul.register("storage-service", port)
    yield
    await consul.close()


app = FastAPI(title="Storage Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(documents_router)
app.include_router(trees_router)
app.include_router(conversations_router)
app.include_router(stats_router)


@app.get("/")
async def root():
    return {"service": "Storage Service", "status": "running"}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "storage-service",
        "port": 8005,
        "version": "1.0.0"
    }
