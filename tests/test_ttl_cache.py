from app.ttl_cache import TtlCache


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_returns_cached_value_within_ttl():
    clock = FakeClock()
    cache = TtlCache(clock=clock)
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    assert cache.get_or_compute("k", 60, compute) == 1
    clock.now = 59
    assert cache.get_or_compute("k", 60, compute) == 1
    assert len(calls) == 1


def test_recomputes_after_ttl():
    clock = FakeClock()
    cache = TtlCache(clock=clock)
    values = iter([1, 2])
    cache.get_or_compute("k", 10, lambda: next(values))
    clock.now = 10
    assert cache.get_or_compute("k", 10, lambda: next(values)) == 2


def test_keys_are_independent():
    cache = TtlCache(clock=FakeClock())
    assert cache.get_or_compute("a", 60, lambda: "A") == "A"
    assert cache.get_or_compute("b", 60, lambda: "B") == "B"


def test_expired_entries_are_dropped():
    clock = FakeClock()
    cache = TtlCache(clock=clock)
    for i in range(5):
        cache.get_or_compute(i, 10, lambda: i)
    clock.now = 20
    cache.get_or_compute("fresh", 10, lambda: 0)
    assert len(cache) == 1


def test_clear_forces_recompute():
    cache = TtlCache(clock=FakeClock())
    values = iter([1, 2])
    cache.get_or_compute("k", 60, lambda: next(values))
    cache.clear()
    assert cache.get_or_compute("k", 60, lambda: next(values)) == 2
