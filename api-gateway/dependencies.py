"""Shared dependencies for API Gateway"""
import os
from service_client import ServiceRegistry

consul_host = os.getenv("CONSUL_HOST", "consul")

# Global service registry instance
service_registry = ServiceRegistry(consul_host=consul_host)


def get_service_registry() -> ServiceRegistry:
    """Dependency to inject service registry"""
    return service_registry
