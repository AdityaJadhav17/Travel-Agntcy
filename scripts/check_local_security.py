"""Check deployed local auth through the UI proxy without making paid searches.

Prompt payloads are deliberately invalid, so even a broken auth gate cannot
dispatch a model/provider search. One authenticated validation attempt consumes
one admission from the daily request quota.
"""

import argparse
import http.cookiejar
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPCookieProcessor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://ui:3000/api")
    parser.add_argument("--origin", default="http://localhost:3000")
    args = parser.parse_args()
    key = os.environ.get("TRAVEL_ACCESS_KEY")
    if not key:
        raise SystemExit("TRAVEL_ACCESS_KEY is required; no credentials were printed.")
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(path, payload=None, origin=None):
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        req = Request(args.base_url.rstrip("/") + path,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers)
        try:
            with opener.open(req, timeout=15) as response:
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, {}

    for path in ("/agent/prompt", "/agent/prompt/stream"):
        status, _ = request(path, {"prompt": ""})
        assert status == 401, f"Unauthenticated endpoint expected 401, got {status}"
    assert request("/auth/status")[1] == {"authenticated": False}
    status, _ = request("/auth/login", {"access_key": key}, args.origin)
    assert status == 200, f"Login expected 200, got {status}"
    assert request("/auth/status")[1] == {"authenticated": True}
    status, _ = request("/agent/prompt", {"prompt": ""}, "https://invalid.example")
    assert status == 403, f"Cross-origin request expected 403, got {status}"
    status, _ = request("/agent/prompt", {"prompt": ""}, args.origin)
    assert status == 422, f"Authenticated invalid payload expected 422, got {status}"
    assert request("/auth/logout", {}, args.origin)[0] == 200
    assert request("/auth/status")[1] == {"authenticated": False}
    print("Local proxy auth checks passed; no model or provider searches dispatched.")


if __name__ == "__main__":
    main()
