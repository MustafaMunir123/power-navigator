# Power Navigator

Single-page app: route fields (From/To) with Places autocomplete + chat.

## Run Locally

1. **`.env`** — Create a `.env` file with:
   ```
   MAPS_API_KEY=google_map_api_key
   NOVA_API_KEY=amazon_nova_api_key
   ```

2. ```bash
   cd path/to/power-navigator
   npm install
   npm start
   ```

---

## Deploy to AWS

**Lightsail** (if available on your account):

**[Deploy with Lightsail (us-east-1)](https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https%3A%2F%2Fpower-navigator-template.s3.us-east-1.amazonaws.com%2Ftemplate-lightsail.yaml&stackName=power-navigator)**

1. Open the link, set **MapsApiKey** and **NovaApiKey**, then **Create stack**.
2. Wait ~5–10 minutes. In **Outputs**, copy **AppUrl** and open it in your browser.
