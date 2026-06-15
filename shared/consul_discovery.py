import os
import httpx
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


class ConsulRegistry:
    """Consul-based service registration and discovery via HTTP API"""

    def __init__(self, consul_host: str = "consul", consul_port: int = 8500):
        self._base_url = f"http://{consul_host}:{consul_port}"
        self._client = httpx.AsyncClient(timeout=5.0)
        self._service_id = None
        self._service_name = None

    async def register(
        self,
        service_name: str,
        service_port: int,
        tags: Optional[List[str]] = None,
    ) -> None:
        host = os.getenv("CONSUL_ADVERTISE_HOST", os.getenv("HOSTNAME", "127.0.0.1"))
        service_id = f"{service_name}-{host}-{service_port}"
        self._service_id = service_id
        self._service_name = service_name

        body = {
            "ID": service_id,
            "Name": service_name,
            "Address": host,
            "Port": service_port,
            "Tags": tags or [],
            "Check": {
                "HTTP": f"http://{host}:{service_port}/health",
                "Interval": "15s",
                "Timeout": "5s",
                "DeregisterCriticalServiceAfter": "1m",
            },
        }

        try:
            resp = await self._client.put(
                f"{self._base_url}/v1/agent/service/register", json=body
            )
            resp.raise_for_status()
            logger.info(
                f"Registered '{service_name}' with Consul "
                f"(ID: {service_id}, addr: {host}:{service_port})"
            )
        except Exception as e:
            logger.warning(f"Failed to register '{service_name}' with Consul: {e}")

    async def deregister(self) -> None:
        if not self._service_id:
            return
        try:
            await self._client.put(
                f"{self._base_url}/v1/agent/service/deregister/{self._service_id}"
            )
            logger.info(f"Deregistered '{self._service_name}' from Consul")
        except Exception as e:
            logger.warning(f"Failed to deregister '{self._service_name}': {e}")

    async def discover(
        self, service_name: str, passing_only: bool = True
    ) -> List[Dict[str, Any]]:
        url = f"{self._base_url}/v1/health/service/{service_name}"
        if passing_only:
            url += "?passing"
        try:
            resp = await self._client.get(url)
            resp.raise_for_status()
            results = []
            for entry in resp.json():
                svc = entry.get("Service", {})
                addr = svc.get("Address", "")
                port = svc.get("Port", 0)
                if addr and port:
                    results.append(
                        {
                            "id": svc.get("ID"),
                            "name": svc.get("Service"),
                            "address": addr,
                            "port": port,
                            "tags": svc.get("Tags", []),
                        }
                    )
            return results
        except Exception as e:
            logger.debug(f"Consul discover '{service_name}' failed: {e}")
            return []

    async def get_service_url(
        self, service_name: str, default_url: Optional[str] = None
    ) -> Optional[str]:
        services = await self.discover(service_name)
        if services:
            s = services[0]
            return f"http://{s['address']}:{s['port']}"
        return default_url

    async def close(self) -> None:
        await self.deregister()
        await self._client.aclose()
