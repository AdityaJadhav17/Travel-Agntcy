"""Durable local conversation turns, with atomic optimistic concurrency checks."""

import asyncio
import json
import os
import sqlite3
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path


class ConversationConflict(Exception):
    pass


@dataclass
class _TurnQueue:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


class ConversationTurns:
    """Serialize turns per chat in one API event loop, including retry lookups.

    Independent chats run concurrently. Entries include waiters and are removed
    on completion/cancellation. SQLite revision checks still protect writes from
    other processes; this is not a distributed lock or exactly-once execution.
    """

    def __init__(self):
        self._active: dict[str, _TurnQueue] = {}

    @asynccontextmanager
    async def acquire(self, conversation_id: str):
        entry = self._active.setdefault(conversation_id, _TurnQueue())
        entry.users += 1
        try:
            async with entry.lock:
                yield
        finally:
            entry.users -= 1
            if not entry.users:
                del self._active[conversation_id]


class ConversationStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("TRAVEL_CONVERSATION_DB", ".runtime/conversations.sqlite3"))

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("""CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
            messages TEXT NOT NULL, trip TEXT NOT NULL, requests TEXT NOT NULL
        )""")
        db.execute("CREATE TABLE IF NOT EXISTS deleted_conversations (id TEXT PRIMARY KEY)")
        try:
            with db:
                yield db
        finally:
            db.close()

    def load(self, conversation_id):
        with self.connect() as db:
            # Serialize the tombstone check and initial insert against deletion.
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM deleted_conversations WHERE id = ?", (conversation_id,)).fetchone():
                raise ConversationConflict("This conversation was deleted. Start a new chat.")
            db.execute("INSERT OR IGNORE INTO conversations VALUES (?, 0, '[]', '{}', '{}')", (conversation_id,))
            row = db.execute("SELECT revision, messages, trip, requests FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        return {"revision": row[0], "messages": json.loads(row[1]), "trip": json.loads(row[2]), "requests": json.loads(row[3])}

    def save(self, conversation_id, snapshot, request_id, prompt, result):
        messages = (snapshot["messages"] + [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": result["response"]},
        ])[-40:]
        requests = {**snapshot["requests"], request_id: {"prompt": prompt, "result": result}}
        requests = dict(list(requests.items())[-10:])
        with self.connect() as db:
            changed = db.execute(
                "UPDATE conversations SET revision = revision + 1, messages = ?, trip = ?, requests = ? WHERE id = ? AND revision = ?",
                (json.dumps(messages), json.dumps(result["trip_state"]), json.dumps(requests), conversation_id, snapshot["revision"]),
            ).rowcount
            if not changed:
                raise ConversationConflict("Conversation changed during this request. Please send your message again.")

    def delete(self, conversation_id):
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO deleted_conversations VALUES (?)", (conversation_id,))
            db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
