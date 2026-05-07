# Pushover setup — iPhone push notifications

Pushover is a one-time $5 purchase per platform (iPhone), no subscription. You own your tokens, no third-party cloud lock-in. Notifications arrive in 1–3 seconds.

## 1. Sign up + install the iPhone app

1. Sign up at [pushover.net](https://pushover.net) (free tier covers personal use, $5 unlocks the iPhone app permanently)
2. On your iPhone, install **Pushover** from the App Store
3. Open the app, sign in — your device registers automatically
4. After signin, the [Pushover dashboard](https://pushover.net/) shows your **User Key** at the top right. Copy it.

## 2. Create an Application

1. Go to [pushover.net/apps/build](https://pushover.net/apps/build)
2. Fill in:
   - **Name:** Phoenix Phase Converters
   - **Type:** Application
   - **Description:** CallRail realtime call alerts
   - **Icon:** (optional) upload your logo
3. Click **Create Application**
4. The next page shows your **API Token/Key** — copy it.

## 3. Plug the tokens into the n8n workflow

Open the imported workflow → **Send Pushover Notification** node → replace:

```
REPLACE_PUSHOVER_APP_TOKEN  →  your application API token
REPLACE_PUSHOVER_USER_KEY   →  your user key
```

Save the workflow.

## 4. Test

The workflow will fire a push on every CallRail post-call. To test without an actual call, click **Execute Workflow** with a manual call ID payload, or just wait for the next inbound call.

## Notification design

The push contains:

- **Title**: `📞 Inbound · Mac Reed · 4 min` (or `📭 Voicemail`, `⛔ Missed`, `📤 Outbound`)
- **Body**: AI-generated one-sentence summary + customer stat line (`3× caller · $7,863 lifetime`)
- **Tap action**: Opens the call in CallRail's web app
- **Sound**: `incoming` (the default phone-call sound)
- **Priority**: Voicemails and missed calls = high priority (bypass quiet hours), answered inbound = normal

You can change the sound or priority by editing the **Send Pushover Notification** node.

## Adding Danny

When Danny is ready, give him your **App Token** (safe to share) and have him:

1. Buy Pushover on his iPhone ($5)
2. Sign up at pushover.net, get *his* User Key
3. Tell you the User Key — add it as a second `user` field on the same notification, or duplicate the node so you can give Danny a different filter (e.g. only high-value or first-time callers)

## Pushcut alternative

If you prefer Pushcut (more iPhone automation power, runs Shortcuts on receipt), the swap is trivial — replace the **Send Pushover Notification** HTTP node with a POST to your Pushcut notification URL:

```
URL:  https://api.pushcut.io/v1/notifications/PhoenixCall
Body: { "title": "{{ $json.title }}", "text": "{{ $json.message }}" }
```

Pushcut lets you run a Siri Shortcut when the notification arrives — useful if you want it to start a Shortcut that, say, looks up the customer and reads it back via TTS.
