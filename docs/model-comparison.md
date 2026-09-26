# Supervisor model trial

The live app uses `openai/gpt-6-sol` as its main model. The integration accepts
optional `LLM_INTENT_MODEL`, `LLM_EXTRACTION_MODEL`, and `LLM_REFLECTION_MODEL`
overrides; each inherits `LLM_MODEL` when blank. An OpenAI GPT-6 model uses
LangChain's Responses API adapter with `LLM_REASONING_EFFORT=low` by default.
The app continues to own conversation state and sends `store=false` on Responses
requests. Other providers and GPT-5.2 keep their existing LiteLLM path.

Set `LLM_MODEL=openai/gpt-6-sol` with `OPENAI_API_KEY` to run the same default
in another environment. Do not point this path at the existing LiteLLM proxy: this
implementation needs an endpoint that supports Responses. With the current
single-user app, the SQLite conversation store remains the source of context.
The route and output contracts remain unchanged.

The tracked `scripts/compare_supervisor_models.py` evaluates four short
conversation journeys: destination correction, family/room continuity, nearby
arrival-airport follow-up, and budget revision/removal. It uses the real graph
and model, with travel provider calls blocked. The script writes JSON reports to
an ignored `.runtime/model-comparison/` directory when run with `--output`.

Docker commands used for the 2026-09-25 trial:

```powershell
docker compose -f docker-compose.yaml build travel-supervisor
docker compose -f docker-compose.yaml run --rm --no-deps -v ./.runtime/model-comparison:/reports --entrypoint /app/.venv/bin/python travel-supervisor scripts/compare_supervisor_models.py --model openai/gpt-5.2 --output /reports/gpt-5.2.json
docker compose -f docker-compose.yaml run --rm --no-deps -v ./.runtime/model-comparison:/reports --entrypoint /app/.venv/bin/python travel-supervisor scripts/compare_supervisor_models.py --model openai/gpt-6-sol --output /reports/gpt-6-sol.json
```

| Model | Correct turns | Median turn | Slowest turn (nearest-rank p95) | Estimated model cost |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.2 | 11/11 | 2,774 ms | 3,293 ms | $0.061774 |
| GPT-6 Sol, low effort | 11/11 | 3,069 ms | 5,787 ms | $0.047326 |

These are single runs on only 11 unpriced turns. Estimates use returned token
usage and [OpenAI's listed model prices](https://developers.openai.com/api/docs/pricing);
they omit travel-provider charges and any unreported cache-write adjustments.
The trial establishes compatibility and equal task completion on this sample,
but does not establish a quality improvement. Sol is the selected default at
the owner's request despite higher latency in this sample. Set
`LLM_MODEL=openai/gpt-5.2` to restore the previous model. Broader repeated
evaluation remains useful for tuning reasoning effort and monitoring latency.

After the switch, the local Docker supervisor reported `ChatOpenAI` with
Responses enabled at low effort. The API and UI health endpoints returned 200,
and the live clarification/correction and family/room smoke journeys passed.

[OpenAI's model guidance](https://developers.openai.com/api/docs/guides/latest-model)
recommends the Responses API for GPT-6 reasoning with tools and comparing
representative task success, latency, token usage, and cost.
