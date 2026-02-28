# AI Navigator

Single-page app: route fields (From/To) with Places autocomplete + chat.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

**To see server logs (Nova API, errors, etc.) in the terminal:** run the app from a terminal so stdout stays visible:

```bash
cd "/path/to/AI Navigator"
npm start
```

Leave this terminal open. All `console.log` and `console.error` from `server.js` (e.g. Nova API responses, detect-stops errors) will print here.  
**Maps Directions** is called from the browser, so its response is logged in the **browser DevTools → Console** (F12).

## Setup

1. **`.env`** — Add your Google API key:
   ```
   MAPS_API_KEY=your_google_maps_api_key
   ```

2. **Google Cloud Console** — Enable:
   - Maps JavaScript API
   - Places API  
   (Directions API is for later use.)

3. **Billing** — Enable billing for the project (Places still has free tier, but billing must be on).

4. **API key restrictions** — If you use “Application restrictions”:
   - For **HTTP referrers**, add: `http://localhost:*` and/or `http://localhost:3000/*` so the key works when testing locally.
   - Or leave restrictions off while developing.

If autocomplete still doesn’t suggest addresses, open the browser **Developer Tools (F12) → Console** and look for `Places Autocomplete status: ...` to see the exact error from Google.

## Testing and logs

- **Maps Directions response** (when you click Send with From/To filled): logged in the **browser** only. Open DevTools (F12) → **Console** and look for `[Maps Directions] status:` and `[Maps Directions] full response:`.
- **Nova API response** (when you send a chat message): logged in the **terminal** where the server is running. Look for `[Nova API] full response:` and `[Nova API] message content:`.
- To see those server logs, start the app from a terminal (`npm start`) and keep that window open; don’t run it in the background or from an IDE run config that hides the output.
