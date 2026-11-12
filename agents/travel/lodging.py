"""Pure lodging evidence and flight/stay timing policies.

Provider fields remain evidence only when explicitly present in the quote. These
helpers deliberately do not infer room privacy from occupancy or a listing name.
"""

import re
from datetime import date, datetime, timedelta

from config.config import TRAVEL_HOTEL_CHECKIN_GAP_HOURS


def _text(value):
    return " ".join(str(value or "").replace("\u00a0", " ").split())


def assess_accommodation(hotel, accommodation_type=None, private_room_required=None):
    """Assess a quote against explicit lodging requirements.

    Result keys: status (matched/contradicted/unknown), reasons, evidence.
    A listing title can conservatively identify a hostel, but cannot establish
    that any room is private.
    """
    hotel = hotel or {}
    raw_property = _text(hotel.get("property_type"))
    raw_room = _text(hotel.get("room_type"))
    source = _text(hotel.get("accommodation_evidence_source")) or None
    # Do not treat an unprovenanced normalized field as provider evidence.
    if source is None:
        raw_property = ""
        raw_room = ""
    prop = raw_property.casefold()
    room = raw_room.casefold()
    name = _text(hotel.get("name")).casefold()
    reasons = []
    contradicted = False
    unknown = False

    requested = accommodation_type if accommodation_type in ("hotel", "hostel") else None
    known_hostel = "hostel" in prop or "hostel" in name
    known_hotel = bool(prop) and ("hotel" in prop or "resort" in prop)
    known_other_type = bool(prop) and not known_hostel and not known_hotel
    if requested == "hotel":
        if known_hostel:
            contradicted = True
            reasons.append("known_hostel_excluded")
        elif known_hotel:
            reasons.append("hotel_property_evidence")
        elif known_other_type:
            contradicted = True
            reasons.append("known_nonhotel_property_type")
        else:
            unknown = True
            reasons.append("property_type_unverified")
    elif requested == "hostel":
        if known_hostel:
            reasons.append("hostel_property_evidence")
        elif known_hotel:
            contradicted = True
            reasons.append("known_hotel_excluded")
        elif known_other_type:
            contradicted = True
            reasons.append("known_nonhostel_property_type")
        else:
            unknown = True
            reasons.append("property_type_unverified")
    elif known_hostel:
        # This is useful evidence for an explicit hotel-only request, while
        # broad accommodation searches remain broad.
        reasons.append("listing_name_suggests_hostel")

    if private_room_required is True:
        explicit_nonprivate = bool(re.search(
            r"\b(?:not\s+(?:a\s+)?private|non[ -]?private)\s+(?:room|accommodation)\b",
            room,
        ))
        if explicit_nonprivate or any(term in room for term in ("shared", "dorm", "bunk")):
            contradicted = True
            reasons.append("non_private_room_evidence" if explicit_nonprivate else "shared_room_evidence")
        elif any(term in room for term in ("private room", "entire room", "entire place")):
            reasons.append("private_room_evidence")
        else:
            unknown = True
            reasons.append("room_privacy_unverified")
    elif private_room_required is False:
        reasons.append("private_room_not_required")

    status = "contradicted" if contradicted else "unknown" if unknown else "matched"
    evidence = {
        "property_type": raw_property or None,
        "room_type": raw_room or None,
        "source": source,
    }
    return {"status": status, "reasons": reasons, "evidence": evidence}


def _parse_date(value):
    try:
        return date.fromisoformat(_text(value)[:10]) if value else None
    except ValueError:
        return None


def _parse_time(value):
    value = _text(value)
    if not value:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(value.upper(), fmt).time()
        except ValueError:
            pass
    return None


def _parse_arrival(value):
    value = _text(value)
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    return None


def assess_timing(flight, hotel, check_in_date=None, check_out_date=None, gap_hours=None):
    """Assess whether a flight arrival can fit a quoted hotel stay.

    Missing time/date evidence never becomes confirmed. The configured airport
    buffer is an estimate; arrival dates are treated as destination-local only
    when the provider supplies a full local datetime (as SerpAPI does).
    """
    flight, hotel = flight or {}, hotel or {}
    check_in_date = check_in_date or hotel.get("check_in_date")
    check_out_date = check_out_date or hotel.get("check_out_date")
    ci, co = _parse_date(check_in_date), _parse_date(check_out_date)
    arrival = _parse_arrival(flight.get("arrival_time"))
    reasons = []
    status = "needs_confirmation"
    arrived = None
    if ci is None or co is None:
        reasons.append("stay_dates_missing_or_invalid")
    elif co <= ci:
        status = "incompatible"
        reasons.append("invalid_stay_dates")
    elif arrival is None:
        reasons.append("arrival_time_missing_or_invalid")
    else:
        gap = TRAVEL_HOTEL_CHECKIN_GAP_HOURS if gap_hours is None else gap_hours
        arrived = arrival + timedelta(hours=gap)
        if arrived.date() > co:
            status = "incompatible"
            reasons.append("arrival_at_or_after_checkout")
        elif arrived.date() == co:
            checkout = _parse_time(hotel.get("check_out_time"))
            if checkout and arrived.time() >= checkout:
                status = "incompatible"
                reasons.append("arrival_at_or_after_checkout")
            else:
                status = "needs_confirmation"
                reasons.append("arrival_on_checkout_date_needs_confirmation")
        elif arrived.date() < ci:
            status = "needs_confirmation"
            reasons.append("arrival_before_checkin_date")
        elif arrived.date() > ci:
            status = "needs_confirmation"
            reasons.append("prior_night_booking_or_late_arrival_needs_confirmation")
        else:
            opening = _parse_time(hotel.get("check_in_time"))
            closing = _parse_time(hotel.get("check_in_end_time"))
            if opening and arrived.time() < opening:
                status = "compatible"
                reasons.append("early_arrival_wait_for_checkin")
            elif closing and arrived.time() > closing:
                status = "needs_confirmation"
                reasons.append("arrival_after_provider_checkin_window")
            elif closing and arrived.time() <= closing:
                status = "compatible"
                reasons.append("arrival_within_provider_checkin_window")
            elif opening and arrived.time() >= opening:
                status = "compatible"
                reasons.append("arrival_after_provider_checkin_opening")
            elif not opening:
                status = "needs_confirmation"
                reasons.append("provider_checkin_time_unknown")
            else:
                status = "needs_confirmation"
                reasons.append("provider_checkin_time_unparseable")
    return {
        "timing_status": status,
        "timing_reason_codes": reasons,
        "timing_message": _timing_message(status, reasons, arrived),
        "arrival_at_hotel": arrived.strftime("%Y-%m-%d %H:%M") if arrived else None,
        "check_in_date": ci.isoformat() if ci else None,
        "check_out_date": co.isoformat() if co else None,
        "provisional": status == "needs_confirmation",
    }


def _timing_message(status, reasons, arrival):
    stamp = arrival.strftime("%Y-%m-%d %H:%M") if arrival else "unknown"
    if "prior_night_booking_or_late_arrival_needs_confirmation" in reasons:
        return f"Estimated hotel arrival is {stamp}, after the booked check-in date; confirm late arrival and reservation retention with the property."
    if "arrival_at_or_after_checkout" in reasons:
        return "The estimated arrival is at or after checkout, so this stay cannot cover the arrival."
    if "arrival_on_checkout_date_needs_confirmation" in reasons:
        return f"Estimated hotel arrival is {stamp} on the booked checkout date; confirm whether the reservation covers this arrival."
    if "early_arrival_wait_for_checkin" in reasons:
        return f"Estimated hotel arrival is {stamp}, before the provider's check-in opening; waiting may be required."
    if status == "compatible":
        return f"Estimated hotel arrival is {stamp}; it fits the available timing evidence, but hotel arrangements are not independently confirmed."
    if "arrival_before_checkin_date" in reasons:
        return f"Estimated hotel arrival is {stamp}, before the booked check-in date; confirm the intended stay dates."
    return "Arrival or stay timing evidence is incomplete; confirm timing with the property."
