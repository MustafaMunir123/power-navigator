# Power Navigator

Single-page app: route fields (From/To) with Places autocomplete + chat.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

**To see server logs (Nova API, errors, etc.) in the terminal:** run the app from a terminal so stdout stays visible:

```bash
cd "/path/to/Power Navigator"
npm start
```

Leave this terminal open. All `console.log` and `console.error` from `server.js` (e.g. Nova API responses, detect-stops errors) will print here.  
Directions are requested from the browser; that response is logged in **Developer Tools → Console** (F12).

## Setup

1. **`.env`** — Create a `.env` file with:
   ```
   MAPS_API_KEY=your_maps_api_key
   NOVA_API_KEY=your_amazon_nova_api_key
   ```
   (Use a maps provider API key that supports autocomplete, directions, and place search. Restrict the key by referrer in your provider’s console if needed.)

## Testing and logs

- **Directions response** (when you click Send with From/To filled): logged in the **browser** only. Open DevTools (F12) → **Console** and look for `[Maps Directions] status:` and full response.
- **Nova API response** (when you send a chat message): logged in the **terminal** where the server is running. Look for `[Nova API] full response:` and `[Nova API] message content:`.
- To see those server logs, start the app from a terminal (`npm start`) and keep that window open; don’t run it in the background or from an IDE run config that hides the output.

---

## Deploy to AWS Lightsail (one-click)

You can deploy Power Navigator to a single **Lightsail** instance with **one form + click** using CloudFormation. No CLI required in the browser flow.

### One-click link (template in a public repo)

If this repo is public on GitHub, use this link (replace `YOUR_USERNAME`, `YOUR_REPO`, and `main` with your repo path if different):

```
https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?templateURL=https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/template-lightsail.yaml&stackName=power-navigator
```

Or **manually**:

1. **AWS Console** → **CloudFormation** → **Create stack** → **With new resources**.
2. **Template**: Upload `template-lightsail.yaml` from this repo (or paste the template URL above if the file is in a public repo).
3. **Parameters**:
   - **MapsApiKey** – your maps API key (autocomplete, directions, place search)
   - **NovaApiKey** – your Amazon Nova API key
   - **RepoUrl** – Git clone URL (e.g. `https://github.com/YOUR_USERNAME/power-navigator.git`). Default in the template is a placeholder; set it to your fork or this repo.
   - **InstanceName** – optional (default: `power-navigator`).
4. **Create stack**. Wait 5–10 minutes for the instance to start and the launch script to install Node, clone the repo, and start the app.
5. **Outputs** → copy **AppUrl** (e.g. `http://<static-ip>:3000`) and open it in your browser.

### What gets created

- **Lightsail instance** (Ubuntu 22.04, micro) with ports 22 and 3000 open
- **Static IP** attached to the instance
- **Launch script** (User Data): installs Node 20, clones your repo, sets `.env`, runs `pm2 start server.js`

### If your region doesn’t have `ubuntu_22_04`

Edit `template-lightsail.yaml` and set `BlueprintId` to `ubuntu_20_04`, then upload that file as the template.
