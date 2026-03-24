const express = require("express");
const dotenv = require("dotenv");
const { HighLevel } = require("@gohighlevel/api-client");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const oauthEnv = [
  "HIGHLEVEL_CLIENT_ID",
  "HIGHLEVEL_CLIENT_SECRET",
  "HIGHLEVEL_REDIRECT_URI",
];

const hasPit = Boolean(process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN);
const hasOAuth = oauthEnv.every((key) => Boolean(process.env[key]));

if (!hasPit && !hasOAuth) {
  throw new Error(
    "Set either HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN or all OAuth env vars: HIGHLEVEL_CLIENT_ID, HIGHLEVEL_CLIENT_SECRET, HIGHLEVEL_REDIRECT_URI."
  );
}

const highLevel = new HighLevel(
  hasPit
    ? {
        privateIntegrationToken: process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN,
      }
    : {
        clientId: process.env.HIGHLEVEL_CLIENT_ID,
        clientSecret: process.env.HIGHLEVEL_CLIENT_SECRET,
      }
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ghl-oauth-test-backend",
    authMode: hasPit ? "private-integration-token" : "oauth-sdk",
    message: "Backend is running",
  });
});

app.get("/health", (_req, res) => {
  const missingOAuthEnv = oauthEnv.filter((key) => !process.env[key]);

  res.json({
    ok: hasPit || missingOAuthEnv.length === 0,
    authMode: hasPit ? "private-integration-token" : "oauth-sdk",
    hasPit,
    missingOAuthEnv,
  });
});

app.get("/install-url", (_req, res) => {
  if (hasPit) {
    return res.status(400).json({
      ok: false,
      error: "Install URL is only used for OAuth apps, not Private Integration Tokens.",
    });
  }

  const missingOAuthEnv = oauthEnv.filter((key) => !process.env[key]);
  if (missingOAuthEnv.length > 0) {
    return res.status(400).json({
      ok: false,
      error: "Missing required OAuth environment variables",
      missingOAuthEnv,
    });
  }

  const authUrl = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", process.env.HIGHLEVEL_REDIRECT_URI);
  authUrl.searchParams.set("client_id", process.env.HIGHLEVEL_CLIENT_ID);
  authUrl.searchParams.set("scope", "voice-ai-dashboard.readonly voice-ai-agents.readonly voice-ai-agent-goals.readonly");
  authUrl.searchParams.set("user_type", "Location");

  return res.json({
    ok: true,
    installUrl: authUrl.toString(),
  });
});

app.get("/oauth/callback", (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(400).json({
      ok: false,
      error,
      errorDescription,
    });
  }

  if (!code) {
    return res.status(400).json({
      ok: false,
      error: "Missing code query parameter",
    });
  }

  return res.json({
    ok: true,
    message: "Authorization completed. The SDK should receive INSTALL/UNINSTALL events on the webhook URL and manage tokens from there.",
    codeReceived: true,
    nextStep: "Configure your app's Default Webhook URL to POST to /webhooks/ghl on this service.",
  });
});

app.use("/webhooks/ghl", highLevel.webhooks.subscribe());

app.post("/webhooks/ghl", (req, res) => {
  res.json({
    ok: true,
    isSignatureValid: Boolean(req.isSignatureValid),
    eventType: req.body?.type || null,
    message: "Webhook processed by HighLevel SDK",
  });
});

app.get("/debug/location/:locationId", async (req, res) => {
  try {
    const response = await highLevel.locations.getLocation(
      {
        locationId: req.params.locationId,
      },
      {
        preferredTokenType: "location",
      }
    );

    return res.json({
      ok: true,
      location: response,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      hint: "If you are using OAuth, make sure the app is installed and the INSTALL webhook reached /webhooks/ghl.",
    });
  }
});

app.listen(port, host, () => {
  console.log(`HighLevel OAuth test backend listening on http://${host}:${port}`);
});
