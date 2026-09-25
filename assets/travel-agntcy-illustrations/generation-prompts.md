# Travel Agntcy illustration prompts

Generated with the built-in image generation tool using the ian-xiaohei-illustrations skill.
English labels and technical accuracy override the skill's Chinese-label and metaphor-first defaults.
Code inspected at commit `60bf2a68` on 2026-09-25.

## Architecture prompt

Use case: infographic-diagram. Generate ONE standalone 16:9 landscape image, ideally 3840 x 2160, with English text only. This is an accurate illustrated system architecture for the existing "Travel Agntcy" project, not a speculative design.

STYLE: Ian Xiaohei-inspired minimalist black hand-drawn technical illustration on perfectly white background. Slightly uneven fine pen lines, restrained orange request arrows and blue return/storage arrows, tiny red caution note. No gradients, shadows, paper texture, decorative backgrounds or cute mascot styling. Include ONE small solid-black deadpan Xiaohei creature with white dot eyes and thin legs, actively handling request slips inside the supervisor illustration. It must not obscure labels. User explicitly prioritizes technical accuracy and legibility over whimsical metaphor: clear grouped components, readable English print lettering and explicit arrowheads take precedence over the usual sparse-label or anti-diagram rules. Distinct recognizable silhouettes: browser window, server, database cylinder, message router, plane/hotel/map-pin agent symbols, external cloud. Balanced whitespace and neat routing. No Chinese glyphs.

COMPOSITION: centered title "Travel Agntcy" and small subtitle "Current local Docker architecture". Use three left-to-right zones labeled "Browser", "Local Docker services", "External services". The browser zone occupies left 20%, local services middle 57%, external services right 23%. Nodes have enough space for crisp black labels. Contain local services in a light hand-drawn boundary. These are the exact nodes and short labels:
A. Browser window upper-left: "React + TypeScript" and "Vite-built chat UI".
B. Small storage drawer below A: "localStorage" / "Chat history and UI state".
C. Small separate local-service tile just right of browser, upper part of local zone: "nginx :3000" / "Serves frontend files". Connect C to A with an arrow labeled "HTML / JS / CSS".
D. Large central local card directly right of A, composed of two stacked inner sections. Top: "FastAPI :8000" / "Validate request • serialize chat turns" / "Reuse completed retry responses". Bottom: "Travel supervisor" / "LangGraph + AGNTCY App SDK" / "Extract trip details • validate constraints" / "Choose flight + hotel; check USD budget". Xiaohei is actively arranging request slips here.
E. Database cylinder directly below D: "SQLite" / "Messages • trip state • retry cache" / "Persistent Docker volume".
F. Small external cloud above-right, outside the local boundary: "Configured LLM provider" / "Via LiteLLM / OpenAI-compatible client" / "Intent and structured extraction".
G. Distinct narrow local router to the right of D: "NATS :4222" / "A2A message transport".
H. Three separate vertically stacked agent tiles to the right of G, inside local boundary, each visually distinct: "Flight agent :9001", "Hotel agent :9002", "Activity agent :9003".
I. External cloud at far-right aligned with H: "SerpAPI" with three separated rows: "google_flights", "google_hotels", "google_local".

CONNECTIONS (must accurately connect exactly these nodes; never let arrows terminate in whitespace):
A <-> D: orange arrow pointing to D labeled "POST /agent/prompt", blue return arrow pointing to A labeled "JSON response". Tiny note under request: "prompt + conversation_id + request_id".
A <-> B: blue storage connection.
D <-> E: blue connection labeled "Load / save".
D <-> F: orange/blue connection labeled "Model calls"; the LLM is external, not the database and not a search-data provider.
D <-> G: bidirectional route.
G <-> each of H: bidirectional branching routes. These are independent agent services, not a serial pipeline.
Each H <-> its matching row in I: direct bidirectional route labeled collectively "HTTPS search / quotes"; flight to google_flights, hotel to google_hotels, activity to google_local.
Replies from SerpAPI return through agents and NATS to supervisor, then API to browser; convey with arrowheads, not a spurious separate service. Browser calls the API directly; nginx is only static hosting, not an API proxy.

BOTTOM NOTES, small but legible, no extra connected infrastructure boxes:
"Optional profiles omitted: tracing, analytics, directory and SLIM."
"Current scope: local single-user trip recommendations; no booking or human-guide matching."
Legend: "Orange: requests    Blue: replies / state".
Do not invent PostgreSQL, Redis, authentication, payment services, parallel workflow ordering, or guide marketplace. Keep all labels exact and legible; no rendered source code, no decorative filler.

## Workflow prompt

Use case: infographic-diagram. Generate ONE standalone 16:9 landscape image, ideally 3840 x 2160, all labels in English. An accurate illustrated user journey for the CURRENT "Travel Agntcy" code. This is a separate workflow image, not an architecture diagram.

STYLE: pure white background, fine subtly wobbly black hand-drawn outlines, generous space, crisp legible English print labels, orange main arrows, blue feedback arrows, tiny red limitation callout. Ian Xiaohei visual character: small solid-black figure, white dot eyes, thin legs, blank serious expression. In step 6 the character actively compares two quote slips; do not make it decorative, cute or dominant. User requests legibility and actual code sequence rather than a whimsical single metaphor, so clean numbered technical flow wins. No Chinese, gradients, shadows, texture or realistic UI screenshots.

Centered title "Travel Agntcy". Subtitle "From chat to a trip recommendation". Smaller scope label "Full-trip path • one completed response per turn".

MAIN PATH: 8 clearly numbered steps on TWO ROWS of four spacious illustrated cards. Top row numbered 1, 2, 3, 4 LEFT TO RIGHT. A visible down arrow from 4 to 5. Bottom row numbered 5, 6, 7, 8 RIGHT TO LEFT, directly under 4, 3, 2, 1 respectively. Orange arrows explicitly connect 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Each number large, each heading bold, body max 3–4 short lines. Give each an appropriate small black line illustration.

EXACT CARD CONTENT:
1 "Open chat & describe trip"
"Enter route, dates and preferences."
"New chat gets a conversation ID."
Illustration browser and traveler typing.

2 "Load conversation"
"POST /agent/prompt"
"Validate IDs; load SQLite memory."
"Completed retry? Return saved result."
Illustration server and small drawer.

3 "Understand & validate"
"LLM routes intent and extracts details."
"Check dates, ages, rooms and budget."
"Preserve saved details on follow-ups."
Illustration structured trip slip.

4 "Search flights"
"Flight agent via A2A / NATS"
"SerpAPI: google_flights"
"Selected outbound → return options"
Illustration plane and two flight slips.

5 "Search hotels"
"Hotel agent via A2A / NATS"
"SerpAPI: google_hotels"
"Dates + travelers + children's ages"
Illustration hotel and occupancy slip.

6 "Compare eligible quotes"
"Check hotel ratings and arrival timing."
"Choose lowest flight + full-stay total."
"Check USD budget, if supplied."
Illustration Xiaohei actively comparing quote slips. Do not depict this arithmetic as a model call.

7 "Add activities (optional)"
"Activity agent → google_local"
"Suggestions for the destination"
"Failure does not discard the trip."
Illustration map pin and attraction list.

8 "Save & show recommendation"
"Save turn + trip state in SQLite."
"Return response + budget assessment."
"UI renders cards; saves chat locally."
Illustration final flight/hotel/activity response and storage drawer.

CLARIFICATION BRANCH:
Above step 3, a blue branch with label "Missing, ambiguous or unsupported?" leading to a SMALL side note "Ask a question + save state", then a clear blue return path to step 1 labeled "Traveler replies". Make explicit that searches at steps 4–7 are skipped until details are valid. Place this neatly above the row without crossing title or model labels.
Below step 6, small red note "No eligible quote / over budget: explain and revise." A small arrow from this note can lead to step 8 (the explanatory reply is saved and returned); do NOT continue to activities on this branch.
Blue feedback arrow from step 8 back to step 1 along left margin labeled "Refine the same trip".

BOTTOM FOOTER in two readable short lines:
"Flights-only, hotels-only and activities-only requests use only their relevant search path."
"Recommendations only: no checkout, booking, payment or human-guide matching."

Important correctness: Flights precede hotels in the full-trip code; activities are searched only after a valid plan passes the budget check. No provider search occurs during clarification. API saves the turn before returning it. Browser history is separate from backend SQLite. Current chat waits for the complete response, not token streaming. Do not invent guide allocation, user login, booking confirmation, parallel searches or live inventory guarantees. Do not add other steps or decorative paragraphs.

## architectureCorrection

Edit this architecture illustration. Preserve its white background, hand-drawn Xiaohei style, English text, and all correct components. Deliver a separate 16:9 landscape PNG at 3840x2160.

CRITICAL CORRECTIONS:
1. The "Configured LLM provider" is EXTERNAL. Move that cloud entirely into the far-right External services column, ABOVE SerpAPI. Widen this external column if necessary so its text is readable. It must be outside the local Docker services solid boundary. Use a small two-line subtitle "Model client: LiteLLM / OpenAI-compatible" and "Intent + structured extraction". Supervisor-to-LLM connection should route across empty upper space, with orange arrowhead ONLY at LLM cloud and blue arrowhead ONLY at Travel supervisor. Label Model calls. Model client actually runs in supervisor; cloud represents external provider. Ensure cloud fully external.
2. Make every orange request arrow ONE WAY: browser to API, supervisor to NATS, NATS to each agent, each agent to its corresponding SerpAPI engine. Make paired blue reply arrows ONE WAY back: SerpAPI to each agent, agents to NATS, NATS to supervisor, API to browser. Remove extra arrowheads at opposite ends. Orange nginx-to-browser static files arrow stays ONE WAY toward browser.
3. Keep only the blue localStorage-browser and SQLite-supervisor connections bidirectional because these are load/save.
Everything else should remain semantically the same. Do not add nodes. Keep every component port and engine label; no invented services. All connections must touch their correct nodes. Maintain readable English at slide size.

## workflowCorrection

Edit the attached workflow illustration, preserving the white background, hand-drawn Xiaohei style, readable English, all eight numbered steps and the orange main sequence. Output ONE 16:9 image 3840x2160.

Make these specific factual corrections, keeping all other main headings and explanatory body text:
1. ERASE the blue connector emerging from the TOP OF STEP 4. The clarification branch must originate at TOP OF STEP 3 "Understand & validate", go to blue label "Missing, ambiguous or unsupported?", then to "Ask a question + save state", then return via "Traveler replies" to step 1. Arrange these labels and blue lines neatly so source and destination are unmistakable. Searches do not cause the missing-input branch.
2. Remove ALL specific example dollar prices, totals, example dates, example routes, specific hotels or attraction names from the little illustrated cards. These were invented and inconsistent. Replace small illustration text with the following neutral content, not actual quotes:
Step 1 browser: "Plan a family trip" / "Route + dates" / "Adults + children".
Step 3 trip slip: "Trip details" / "Route + dates" / "Travelers + ages" / "Rooms + USD budget".
Step 4 two slips: "Outbound option" / "Provider quote", and "Return option" / "Provider quote". Never show separate ticket prices or imply adding two round-trip fares.
Step 5 hotel slip: "Hotel options" / "Stay dates" / "Traveler occupancy" / "Full-stay quote".
Step 6 slips: each labeled "Quote A" or "Quote B", with "Flight quote", "Hotel stay", "Combined total". No numeric prices. Keep character comparing.
Step 7 attraction list: "Activity ideas", "Sights", "Museums", "Parks".
Step 8 result slip: "Trip recommendation", "Flight + hotel total", "Activities: suggestions", "Budget check if supplied". Important: activity costs are NOT included in the priced flight+hotel budget; no dollar amount for activities. No numeric prices anywhere.
Keep the red no-eligible/over-budget bypass from step6 to step8 and the blue step8-to-step1 refinement arrow. Preserve all correct main card content, bottom footer, and clearly sequenced 1→2→3→4↓5←6←7←8 layout.

## architectureCorrection2

Surgical connector-only corrections to attached architecture image. Preserve all component boxes, labels, text, icons, colors, positions and white background. 16:9 PNG. Do not reinterpret layout.
ERASE these six incorrect tiny arrowheads / marks by filling them white, leaving the main line intact:
(1) ORANGE arrowhead at the LEFT end of supervisor-to-NATS connector (near x=875 y=494 in this 1672x941 preview). Keep its RIGHT arrowhead pointing into NATS.
(2) ORANGE arrowhead at LEFT end of Flight-agent-to-SerpAPI connector (near x=1296 y=394). Keep RIGHT orange arrowhead into SerpAPI.
(3) ORANGE arrowhead at LEFT end of Hotel-agent-to-SerpAPI connector (near x=1296 y=520). Keep RIGHT orange arrowhead.
(4) ORANGE arrowhead at LEFT end of Activity-agent-to-SerpAPI connector (near x=1296 y=645). Keep RIGHT orange arrowhead.
(5) ORANGE arrowhead at lower-left end of curved Model calls connector above FastAPI (near x=767 y=331). Keep orange arrowhead at far-right end into external LLM. Blue returning arrow stays.
(6) ERASE the tiny gray dangling mark/arrow between the bottom of LLM cloud and the top of SerpAPI cloud, near x=1517 y=317. Those external services must have NO line directly connecting them.
Leave all blue arrowheads unchanged. Keep all other orange arrows unchanged. All orange requests then point right toward destination, except static files correctly points left to browser.

## workflowCorrection2

Make a surgical edit to this image. Preserve every word, character, shape and the complete layout except the following ONE connector deletion:
ERASE the blue elbow-shaped line above STEP 4, in the top-right area. This is the line beginning above "Search flights", running vertically upward from x≈1455 y≈210, bending LEFT at y≈155, and ending in a leftward arrow at the RIGHT SIDE of "Ask a question + save state". Replace that entire line and arrowhead with plain white background. The entire area to the RIGHT of the "Ask a question + save state" note, ABOVE the top-right step4 card, must be EMPTY WHITE. Do not redraw this elbow elsewhere. The blue UPWARD arrow from STEP 3 into that note must stay. Keep the blue label and return line to step1. This single erasure removes an incorrect clarification path originating at flight search. Absolutely no other changes. Output 16:9 PNG.
