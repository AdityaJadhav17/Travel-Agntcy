"""Per-request public progress events; never expose graph internals."""

from contextvars import ContextVar

progress_sink: ContextVar = ContextVar("travel_progress_sink", default=None)


def emit(kind: str, **payload):
    sink = progress_sink.get()
    if sink is not None:
        sink({"type": kind, **payload})
