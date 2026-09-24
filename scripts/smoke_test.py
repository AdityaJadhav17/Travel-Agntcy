"""Exercise the real running API. This uses configured LLM/SerpAPI quota."""
import argparse
from datetime import date, timedelta
import json
import urllib.error
import urllib.request
import sys

sys.stdout.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://localhost:8000')
parser.add_argument('--prompt')
parser.add_argument('--stream', action='store_true')
args = parser.parse_args()
start = date.today() + timedelta(days=30)
end = start + timedelta(days=3)
prompt = args.prompt or f'Find flights, hotels, and activities from DFW to New York for {start} to {end}.'
endpoint = '/agent/prompt/stream' if args.stream else '/agent/prompt'
request = urllib.request.Request(args.base_url + endpoint, data=json.dumps({'prompt': prompt}).encode(), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(request, timeout=240) as response:
        print('HTTP', response.status)
        text = response.read().decode()
except urllib.error.HTTPError as exc:
    text = exc.read().decode()
    print('HTTP', exc.code)
# Mask any configured credentials before showing diagnostics.
from dotenv import dotenv_values
import os
for key, value in {**dotenv_values(), **os.environ}.items():
    if value and len(value) > 5 and any(part in key.upper() for part in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD')):
        text = text.replace(value, '[REDACTED]')
print(text)
