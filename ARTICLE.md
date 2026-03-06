## 💡 Inspiration

I rely on maps every day. Basic map apps are frustrating: they don’t understand natural language well, they don’t remind you of places based on your history, and they don’t auto-optimise your stops. You type “gym” or “grab coffee on the way” and get nothing useful. You already know you often stop at the same pharmacy on Thursday evenings — but your map never suggests it.

I wanted navigation that actually listens. Power Navigator was built for that. You say what you need in plain language; the app detects stops, finds them along your route, and — when you upload your timeline — suggests places you usually visit on that trip, powered by **Amazon Nova** in the **Amazon Nova AI Hackathon**.

---

## 🛠️ What it does

Power Navigator is an AI-powered route planner that uses **Amazon Nova** to turn natural language into stops and to learn from your location history.

| Feature | What it means for you |
|--------|------------------------|
| **Natural-language stops** | Type “gym”, “pharmacy”, “bookstore” in chat — Nova detects what you asked for and never adds your source or destination as a stop |
| **Find places along route** | Stops are searched near your route waypoints; you get one suggested place per type (e.g. one gym, one ATM) with “add to route” |
| **Timeline patterns** | Upload a timeline (JSON with visits). Nova detects common patterns per day (e.g. “On Thursdays you usually go from A to B via C”) |
| **Personalised suggestions** | When your route matches a pattern (same day, part of day), Nova suggests places from that pattern that aren’t already in your route |
| **Adjust stops** | Reorder waypoints with one click using waypoint optimization — no manual drag-and-drop |
| **Duplicate check** | Nova checks if a place you’re adding is the same as origin, destination, or an existing stop (by name + address) so you don’t add duplicates |
| **Route locations** | Turn-by-turn instructions are sent to Nova to extract place names; those names drive “find stops near route” and personalisation |

All of the above NLU and reasoning runs on **Amazon Nova** via the hackathon stack.

---

## 🏗️ Architecture

Single-page app (HTML/CSS/JS) + Node/Express backend. Autocomplete, directions, and place search run in the frontend; all AI and orchestration run on the server with **Amazon Nova**.

**Request flow**

1. User enters From/To and sends a chat message (e.g. “gym”).
2. Frontend gets directions for the route; instructions are sent to the backend.
3. Backend calls **Amazon Nova** to detect stops from the message (`/api/detect-stops`).
4. Backend calls **Amazon Nova** to extract location names from instructions (`/api/extract-locations`).
5. For each stop type, backend looks up places near route waypoints and returns one suggested place per type.
6. If the user has uploaded a timeline and personalisation is on: backend calls **Amazon Nova** to match patterns (`/api/match-patterns`) and extract places from matched patterns (`/api/extract-places-from-pattern`), then suggests places not already in the route.

```
User → Frontend (autocomplete, directions, place search)
           ↓
       Express backend
           ↓
   Amazon Nova (detect stops, extract locations, detect/match patterns, extract places, duplicate check)
           ↓
       Place lookup (used by backend for suggestions)
```

---

## 📊 Engineering depth

- **Detect stops:** One Nova call with source, destination, and user query. Strict prompt: do not include source or destination in the stops list; return only what the user asked for. Response parsed as JSON (with retries and markdown stripping where needed).
- **Common patterns:** Timeline JSON → simplified day/date/itinerary map → Nova returns `{ day: [ pattern strings ] }`. Each pattern must name at least two locations. Retry up to 3 times on parse failure.
- **Match patterns:** Current route (place names only, not full addresses), day, and part of day sent to Nova with the pattern list; Nova returns matching pattern indices. Only place names used in the prompt so patterns like “Prestige Trade Centre” match the user’s “Prestige Trade Centre, …” address.
- **Extract places from pattern:** For each matched pattern string, Nova returns a list of place names; the app then resolves them via place lookup and suggests the first that isn’t already in the route.
- **Duplicate check:** Nova compares the selected place (name + address) to the route’s origin, destination, and added stops. Used before adding a suggestion so the same venue isn’t added twice.
- **Optimise order:** “Adjust Stops” uses waypoint optimization and applies the returned order to the added stops — no custom solver.

---

## Lessons learned using Amazon Nova in production

1. **Prompt shape beats model size.** Clear instructions (“do not include source or destination”, “return only valid JSON”, “each pattern must name at least 2 locations”) and place-name-only context in match-patterns made outputs reliable on Nova Lite.
2. **Retries and parsing matter.** Nova sometimes returns JSON inside markdown. Stripping ``` blocks and retrying detect-common-patterns (e.g. 3 retries) turned sporadic failures into a stable flow.
3. **Keep prompts short and scoped.** Sending full addresses into match-patterns hurt matching. Using only the first part (place name) before the first comma improved “this route matches your Thursday evening pattern” behaviour.
4. **One stack, many Nova roles.** The same Nova API is used for stop detection, duplicate check, pattern detection, pattern matching, place extraction from pattern text, and location extraction from instructions. Different prompts, one integration.

---

## 🚧 Challenges

**Timeline format and pattern quality**  
Timeline JSON had to be normalised into a day → date → itinerary map that Nova could reason over. We enforced “at least two locations per pattern” in the prompt so patterns were route-like and useful for suggestions.

**Matching without leaking addresses**  
Match-patterns needed to recognise “Prestige Trade Centre” in a pattern when the user’s route had “Prestige Trade Centre, H.S Union, …”. Using only the leading place name (before the first comma) in the prompt kept prompts small and matching accurate.

**Suggestions only when they’re relevant**  
Personalisation runs only when: personalisation is on, timeline is loaded, route is ready, and current day has patterns. We show one suggestions section per route and avoid re-running until the user clears or changes route.

---

## 🌍 Impact and who Power Navigator is for

Anyone who plans routes often and wants to say “gym” or “pharmacy” instead of picking a pin, and who’d like their map to suggest places they usually visit on that trip. Built for the **Amazon Nova AI Hackathon** to show how Nova can sit behind a simple UI and handle stop detection, pattern learning, and suggestion logic end to end.

---

## What’s next

- Support for more timeline sources (e.g. export from other apps).
- “Why this route?” — one Nova call to explain why these stops and this order given the user’s patterns.
- Optional deployment path: S3 + Lambda + CloudFront for serverless, plus one-click Lightsail for a single instance.

---

## 🙏 Acknowledgements

**Amazon Web Services** — **Amazon Nova** and the **Amazon Nova AI Hackathon** for making this possible. All stop detection, pattern detection, pattern matching, place extraction, and duplicate checking are powered by Nova.

Built as a single-page app with Node and Express — one codebase, Nova at the centre.
