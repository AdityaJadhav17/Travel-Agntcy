"""Budget checks use returned quotes, never model-generated prices or FX rates."""

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .models import TravelSearchArgs


def money(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0:
            return None
        rounded = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return rounded if rounded > 0 else None
    except (InvalidOperation, ValueError):
        return None


def budget_question(params: TravelSearchArgs):
    if params.budget_amount is None:
        return None
    if money(params.budget_amount) is None:
        return "Please give a budget of at least USD 0.01."
    if not params.budget_currency:
        return "Which currency is your budget in? The current search quotes are in USD."
    if params.budget_currency != "USD":
        return f"I can compare quotes in USD, but cannot convert your {params.budget_currency} budget. What USD limit should I use?"
    if params.search_type == "activity_only":
        return "Activity suggestions do not include reliable prices, so I cannot check an activity budget. Would you like suggestions without a price guarantee?"
    if params.budget_scope != "quoted_total":
        return "Should I apply that budget to the quoted flight fare and/or full hotel stay for this search? Meals, activities, transfers and unquoted fees are excluded; per-person, nightly and all-in budgets are not supported yet."
    return None


def quote_total(quote, kind, params):
    # Currency is attached by the USD provider adapters. Unknown/mixed currency
    # and incomplete prices cannot become zero-cost or affordable results.
    if quote.get("currency") != "USD":
        return None
    if kind == "flight":
        return money(quote.get("price"))
    if quote.get("total_price") is not None:
        return money(quote["total_price"])
    nightly = money(quote.get("price"))
    try:
        nights = (date.fromisoformat(params.end_date) - date.fromisoformat(params.start_date)).days
    except (TypeError, ValueError):
        return None
    return nightly * nights if nightly and nights > 0 else None


def assessment(params, total):
    limit = money(params.budget_amount)
    scope = {"full_trip": "flight + full hotel stay", "flight_only": "flight fare", "hotel_only": "full hotel stay"}[params.search_type]
    exclusions = "For the provider's default passenger/room selection. Activities, meals, transfers and unquoted fees are excluded. Prices can change."
    if total is None:
        status = "unknown"
        message = f"Budget check: USD {limit:.2f} for {scope}. No complete USD quote was available to verify this budget. {exclusions}"
    elif total <= limit:
        status = "within"
        message = f"Within quoted-cost budget: USD {total:.2f} of USD {limit:.2f} for {scope} (USD {limit - total:.2f} remaining). {exclusions}"
    else:
        status = "over"
        message = f"No returned option meets your quoted-cost budget. The lowest eligible quote is USD {total:.2f}, which is USD {total - limit:.2f} over your USD {limit:.2f} limit for {scope}. {exclusions}"
    return {"status": status, "currency": "USD", "limit": float(limit), "quoted_total": float(total) if total is not None else None, "scope": scope, "message": message}


def filter_quotes(quotes, kind, params):
    priced = [(quote, quote_total(quote, kind, params)) for quote in quotes]
    priced = [(quote, total) for quote, total in priced if total is not None]
    summary = assessment(params, min((total for _, total in priced), default=None))
    limit = money(params.budget_amount)
    return [quote for quote, total in priced if total <= limit], summary
