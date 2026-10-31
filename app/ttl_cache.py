import time
from collections.abc import Callable, Hashable
from typing import Any


class TtlCache:
    """In-process memo for expensive aggregates.

    Every viewer polls the same handful of (period, filters) combinations, so a short TTL turns
    N identical full-table scans per interval into one.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._entries: dict[Hashable, tuple[float, Any]] = {}

    def __len__(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def get_or_compute(self, key: Hashable, ttl: float, compute: Callable[[], Any]) -> Any:
        now = self._clock()
        entry = self._entries.get(key)
        if entry is not None and entry[0] > now:
            return entry[1]
        # Filter combinations are unbounded (any IP, any username), so prune instead of growing.
        self._entries = {k: v for k, v in self._entries.items() if v[0] > now}
        value = compute()
        self._entries[key] = (now + ttl, value)
        return value
