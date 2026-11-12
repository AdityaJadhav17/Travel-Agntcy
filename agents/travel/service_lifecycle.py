"""Keep provider resources alive until HTTP and transport work has stopped."""
import asyncio
import signal

from agents.travel.provider_http import provider_http_lifespan


async def run_service(http, transport):
    """Own serving tasks and cancel/drain siblings before closing the pool."""
    async with provider_http_lifespan():
        tasks = [asyncio.create_task(transport())]
        installed_signals = []
        loop = asyncio.get_running_loop()
        if http is not None:
            tasks.append(asyncio.create_task(http()))
        else:
            # Uvicorn owns signals in HTTP mode. NATS-only mode needs its own
            # stop task; Windows Ctrl+C still cancels asyncio.run's main task.
            stopped = asyncio.Event()
            for sig in (signal.SIGTERM, signal.SIGINT):
                try:
                    loop.add_signal_handler(sig, stopped.set)
                    installed_signals.append(sig)
                except (NotImplementedError, RuntimeError):
                    pass
            tasks.append(asyncio.create_task(stopped.wait()))
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for sig in installed_signals:
                loop.remove_signal_handler(sig)
