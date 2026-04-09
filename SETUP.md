# Daily Tracker Setup Guide

## Step 1: Get Your Credentials

### Claude API Key
1. Go to https://console.anthropic.com
2. Create an API key
3. Copy it

### Telegram Bot Token
1. Open Telegram and message @BotFather
2. Send `/newbot`
3. Follow the prompts, choose a name and username
4. Copy the bot token it gives you

### Your Telegram Chat ID
1. Message @userinfobot on Telegram
2. It will reply with your Chat ID (a number like 123456789)
3. Copy it

## Step 2: Configure

```
cd daily-tracker
copy .env.example .env
```

Open `.env` and fill in your values:
```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_CHAT_ID=123456789
TIMEZONE=America/New_York
PORT=3000
USER_NAME=YourName
```

## Step 3: Install & Run

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser.

## Step 4: Access From Anywhere (Optional)

To get a public link, install ngrok:
```bash
npm install -g ngrok
ngrok http 3000
```

This gives you a URL like https://abc123.ngrok.io you can use anywhere.

## Using the Telegram Bot

After setup, message your bot on Telegram:
- `/today` — See today's full briefing
- `/tasks` — View and complete tasks
- `/events` — View upcoming events
- `/nonneg` — Check non-negotiables
- Or just talk naturally: "Add task: gym tomorrow at 7am"

## Reminders Schedule (via Telegram)

- **6:00 AM** — Good morning briefing (non-negotiables, tasks, events)
- **8:00 AM** — Check-in
- **10:00 AM** — Check-in
- **12:00 PM** — Check-in
- **2:00 PM** — Check-in
- **4:00 PM** — Check-in
- **6:00 PM** — Check-in
- **8:00 PM** — Check-in
- **10:00 PM** — Evening summary (what you did, what to improve, tomorrow)

## Calendar Event Reminders

For any calendar event with a time set, you'll get reminders:
- 1 week before
- 1 day before
- 4 hours before
- 2 hours before
- 1 hour before
- 30 minutes before
- 10 minutes before
