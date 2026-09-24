.PHONY: help up down test travel-supervisor flight-agent hotel-agent activity-agent
help:
	@echo "Targets: up, down, test, travel-supervisor, flight-agent, hotel-agent, activity-agent"
up:
	docker compose up -d --build --wait
down:
	docker compose down
test:
	uv run pytest tests/travel -q
travel-supervisor:
	uv run uvicorn agents.supervisors.travel.main:app --host 0.0.0.0 --port 8000 --reload
flight-agent:
	uv run python -m agents.flight.server
hotel-agent:
	uv run python -m agents.hotel.server
activity-agent:
	uv run python -m agents.activity.server
