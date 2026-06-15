"""
Chat Service with WebSocket Support
Refactored with modular handlers and routes for better maintainability
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import socketio
import logging
import os

from shared.consul_discovery import ConsulRegistry

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import config as cfg
    consul = ConsulRegistry(consul_host=os.getenv("CONSUL_HOST", "consul"))
    port = int(os.getenv("PORT", "8004"))
    await consul.register("chat-service", port)

    for name, attr_name in [("query-service", "QUERY_SERVICE"),
                             ("storage-service", "STORAGE_SERVICE"),
                             ("settings-service", "SETTINGS_SERVICE")]:
        cur = getattr(cfg, attr_name)
        resolved = await consul.get_service_url(name, cur)
        if resolved and resolved != cur:
            setattr(cfg, attr_name, resolved)
            logger.info(f"Chat service: resolved {attr_name} via Consul: {resolved}")

    yield
    await consul.close()


# Create FastAPI app
_fastapi_app = FastAPI(title="Chat Service", version="1.0.0", lifespan=lifespan)

# Add CORS middleware
_fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=True
)

# Register Socket.IO event handlers
from handlers.connection import handle_connect, handle_disconnect
from handlers.query import handle_query
from handlers.message import handle_message

@sio.event
async def connect(sid, environ):
    await handle_connect(sio, sid, environ)

@sio.event
async def disconnect(sid):
    await handle_disconnect(sio, sid)

@sio.event
async def query(sid, data):
    await handle_query(sio, sid, data)

@sio.event
async def message(sid, data):
    await handle_message(sio, sid, data)

# Include REST API routers
from routes.health import router as health_router
from routes.emit import create_emit_router

_fastapi_app.include_router(health_router)
_fastapi_app.include_router(create_emit_router(sio))

# Combine FastAPI and Socket.IO into single ASGI app
app = socketio.ASGIApp(
    sio,
    other_asgi_app=_fastapi_app,
    socketio_path='/socket.io'
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8004, reload=True)
