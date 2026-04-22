"""
Ombre-Brain Bridge for Yua Memory System

Handles:
- MCP client initialization
- Tool invocation (breath, hold, grow, trace, pulse, dream)
- Response parsing and normalization
- Circuit breaker pattern for fault tolerance
- Singleton instance for shared state
"""

import httpx
import asyncio
from typing import Optional

# Default Ombre-Brain MCP server URL
DEFAULT_BASE_URL = "http://localhost:3848"


class OmbreUnavailable(Exception):
    """Ombre-Brain unavailable, fallback to TF-IDF"""
    pass


class OmbreBridge:
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self._client = httpx.AsyncClient(
            base_url=base_url,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            timeout=httpx.Timeout(10.0, connect=2.0)
        )
        self._state = self.CLOSED
        self._failure_count = 0
        self._half_open_success = False
        self.TIMEOUTS = {
            "pulse": 1.0,
            "breath": 3.0,
            "hold": 5.0,
            "trace": 5.0,
            "dream": 10.0,
            "grow": 10.0
        }

    async def call_tool(self, tool: str, payload: dict) -> dict:
        """Call Ombre-Brain MCP tool with circuit breaker and tiered timeout."""
        if self._state == self.OPEN:
            raise OmbreUnavailable("Circuit open - falling back to TF-IDF")

        timeout = self.TIMEOUTS.get(tool, 5.0)
        try:
            resp = await self._client.post(
                f"/tools/{tool}",
                json=payload,
                timeout=timeout
            )
            resp.raise_for_status()
            result = resp.json()

            # State transitions on success
            if self._state == self.HALF_OPEN:
                self._half_open_success = True
                self._state = self.CLOSED
                self._failure_count = 0
            elif self._failure_count > 0:
                self._failure_count = 0  # Reset on success

            return result
        except Exception as e:
            return await self._handle_failure(e)

    async def _handle_failure(self, exc: Exception) -> dict:
        """Handle failure with circuit breaker state transitions."""
        self._failure_count += 1

        if self._state == self.HALF_OPEN:
            self._state = self.OPEN
            raise OmbreUnavailable(f"Half-open failed: {exc}")

        if self._failure_count >= 3 and self._state != self.OPEN:
            self._state = self.OPEN
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._schedule_half_open(30))
            except RuntimeError:
                # Non-async environment, use threading
                import threading
                threading.Timer(
                    30,
                    lambda: setattr(self, '_state', self.HALF_OPEN)
                ).start()

        raise OmbreUnavailable(str(exc))

    async def _schedule_half_open(self, delay: int):
        """Schedule transition to half-open state after delay."""
        await asyncio.sleep(delay)
        self._state = self.HALF_OPEN
        self._half_open_success = False

    # Tool methods

    async def pulse(self) -> dict:
        """Get system status across all buckets."""
        return await self.call_tool("pulse", {})

    async def breath(self, query: str, max_results: int = 5) -> list:
        """Dual-channel search (keyword + vector)."""
        result = await self.call_tool(
            "breath",
            {"query": query, "max_results": max_results}
        )
        return result.get("results", [])

    async def hold(self, content: str, tags: list = None, importance: int = 5,
                   valence: float = None, arousal: float = None) -> dict:
        """Store memory with LLM auto-tagging."""
        payload = {"content": content, "importance": importance}
        if tags:
            payload["tags"] = tags
        if valence is not None:
            payload["valence"] = valence
        if arousal is not None:
            payload["arousal"] = arousal
        return await self.call_tool("hold", payload)

    async def trace(self, bucket_id: str, resolved: bool = None, **kwargs) -> dict:
        """Modify metadata, mark resolved, or delete."""
        payload = {"bucket_id": bucket_id}
        if resolved is not None:
            payload["resolved"] = resolved
        payload.update(kwargs)
        return await self.call_tool("trace", payload)

    async def dream(self, reflection_depth: str = "medium") -> list:
        """Self-reflect on recent memories at conversation start."""
        result = await self.call_tool("dream", {"depth": reflection_depth})
        return result.get("reflections", [])

    async def grow(self, content: str) -> list:
        """Digest diary entries into multiple memory buckets."""
        result = await self.call_tool("grow", {"content": content})
        return result.get("buckets", [])

    @property
    def state(self) -> str:
        """Get current circuit breaker state."""
        return self._state

    @property
    def failure_count(self) -> int:
        """Get current failure count."""
        return self._failure_count


# Singleton instance
_bridge_instance: Optional[OmbreBridge] = None


def get_ombre_bridge() -> OmbreBridge:
    """Get singleton OmbreBridge instance."""
    global _bridge_instance
    if _bridge_instance is None:
        _bridge_instance = OmbreBridge()
    return _bridge_instance
