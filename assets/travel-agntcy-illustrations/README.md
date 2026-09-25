# Travel Agntcy architecture and workflow

Two English illustrations based on the repository at commit `60bf2a68`, inspected on 2026-09-25. Created with the built-in image generation tool and the ian-xiaohei-illustrations skill. Technical diagrams and English annotations intentionally take priority over the skill's usual metaphor-first Chinese style.

- [System architecture](01-system-architecture.png)
- [Traveler workflow](02-traveler-workflow.png)
- [Generation and correction prompts](generation-prompts.md)

Both are widescreen PNGs. The generator returned 1672 × 941 pixels, approximately 16:9 (0.05% aspect-ratio difference), rather than the requested exact canvas. Original generated files are preserved in the Codex generated-images directory.

## Source map

| Diagram element | Code evidence |
| --- | --- |
| Browser chat, conversation IDs and local history | `frontend/src/App.tsx` |
| Prompt request and retry identifiers | `frontend/src/hooks/useAgentAPI.ts` |
| Response cards and budget display | `frontend/src/components/Chat/TravelResponseCard.tsx` |
| Static frontend hosting | `docker/nginx.conf` |
| FastAPI request lifecycle and saved responses | `agents/supervisors/travel/main.py` |
| SQLite messages, trip state and retry cache | `agents/supervisors/travel/conversations.py` |
| Intent, extraction, clarification and full-trip search order | `agents/supervisors/travel/graph/graph.py` |
| A2A agent calls through AGNTCY transport | `agents/supervisors/travel/graph/tools.py` |
| External model client configuration | `common/llm.py` |
| SerpAPI flight, hotel and activity searches | `agents/travel/serpapi_tools.py` |
| Eligible flight/hotel combination and price calculation | `agents/travel/travel_logic.py` |

## Scope and reading notes

- Architecture shows the normal local Docker deployment. Nginx serves static files; the browser calls FastAPI directly. NATS links the supervisor and the three independent specialist services. Their positions do not imply parallel execution.
- The workflow shows the full-trip path: flight search, hotel search, eligible-plan selection and budget assessment, then optional activities. Single-category requests take their respective search path.
- Missing, ambiguous or unsupported details lead to a saved clarification response before provider searches. Follow-up turns reuse trip state.
- The selected budget total covers flights and the full hotel stay. Activities are suggestions and are not included as a priced budget item. Hotel rating criteria may be relaxed when no candidates meet the initial threshold.
- An over-budget or unavailable plan returns an explanatory response instead of continuing to activities. Provider failures and malformed results have additional handling not expanded in this overview.
- Normal chat waits for a completed response. The API saves conversation state before returning; frontend history is separately saved in localStorage.
- The result is a trip recommendation, not a booking, payment, or human-guide match. Optional tracing, analytics, directory and alternative SLIM transport are omitted from the architecture illustration.

No application behavior was changed to produce these assets.
