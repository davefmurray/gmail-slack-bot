# Gmail Slack Bot 📧

A Slack bot that lets you manage your Gmail inbox directly from Slack using natural language. Powered by Claude AI for intelligent email interactions. Built with [Slack Bolt](https://slack.dev/bolt-js) and deployed on Railway.

## Features

- 🤖 **Natural Language** - Just type `/gmail` and ask in plain English
- 📬 **Full Gmail Access** - List, search, read, send, star, archive, and more
- 🔍 **Smart Search** - All Gmail search operators supported
- ✉️ **Compose Emails** - Claude helps write professional emails
- 🏷️ **Label Management** - Create, apply, and manage labels
- 📧 **Batch Operations** - Star all emails from a sender, etc.
- 🔗 **Unsubscribe Helper** - Find and unsubscribe from marketing emails
- All responses are **ephemeral** (only visible to you)

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Slack     │ ──▶  │  Gmail Slack Bot │ ──▶  │  Gmail HTTP API │
│  Workspace  │      │   (This repo)    │      │   (Railway)     │
└─────────────┘      └──────────────────┘      └─────────────────┘
                              │                         │
                              │                         ▼
                              │                 ┌───────────────┐
                              │                 │  Gmail API    │
                              │                 │  (Google)     │
                              └─────────────────┴───────────────┘
```

This bot connects to a separate [Gmail HTTP API](https://github.com/davefmurray/gmail-mcp-http) service that handles OAuth and Gmail operations.

## Slash Commands

### Main Command (Natural Language)

| Command | Description |
|---------|-------------|
| `/gmail <anything>` | Ask in plain English - Claude handles it! |

**Examples:**
```
/gmail show me unread emails
/gmail emails from last week with attachments
/gmail find large emails over 5MB
/gmail send an email to john@example.com about the project deadline
/gmail star all emails from my boss
/gmail promotional emails I can unsubscribe from
/gmail what are my most recent emails from Amazon?
/gmail compose a professional reply declining the meeting
```

### Direct Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/gmail-list [count]` | List recent emails (default: 5, max: 10) | `/gmail-list 10` |
| `/gmail-unread [count]` | List unread emails | `/gmail-unread` |
| `/gmail-search <query>` | Search emails using Gmail syntax | `/gmail-search from:boss@company.com` |
| `/gmail-read <id>` | Read a specific email by ID | `/gmail-read 19abc123def` |
| `/gmail-send <to> \| <subject> \| <body>` | Send an email | `/gmail-send john@example.com \| Hello \| How are you?` |
| `/gmail-mark-read <id>` | Mark an email as read | `/gmail-mark-read 19abc123def` |
| `/gmail-trash <id>` | Move email to trash | `/gmail-trash 19abc123def` |
| `/gmail-help` | Show help message | `/gmail-help` |

### Gmail Search Syntax (for `/gmail-search`)

All Gmail search operators are supported:

```
# People
from:sender@email.com    to:recipient@email.com    cc:someone@email.com

# Content
subject:meeting          "exact phrase"            word1 OR word2
-excludeword

# Status
is:unread    is:starred    is:important    is:snoozed

# Attachments
has:attachment    filename:pdf    larger:5M    smaller:1M
has:drive         has:document    has:spreadsheet

# Location
in:inbox    in:sent    in:drafts    in:trash    label:work
category:primary    category:social    category:promotions

# Time
after:2024/01/01    before:2024/12/31    newer_than:7d    older_than:1m
```

## Setup Guide

### Prerequisites

1. A deployed [Gmail HTTP API](https://github.com/davefmurray/gmail-mcp-http) instance
2. A Slack workspace where you can install apps

### Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it `Gmail Bot` and select your workspace

### Step 2: Configure Bot Permissions

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `commands`
   - `chat:write`
3. Click **Install to Workspace** at the top
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 3: Get Signing Secret

1. Go to **Basic Information** in the sidebar
2. Under **App Credentials**, copy the **Signing Secret**

### Step 4: Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

Or deploy manually:

1. Fork this repository
2. Create a new Railway project
3. Connect your GitHub repo
4. Add environment variables (see below)

### Step 5: Configure Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Yes | Signing Secret from Basic Information |
| `GMAIL_API_URL` | Yes | URL of your Gmail HTTP API |
| `GMAIL_API_KEY` | Yes | API key for Gmail HTTP API |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude AI |
| `PORT` | No | Server port (default: 3000) |

### Step 6: Add Slash Commands

1. Go to **Slash Commands** in the sidebar
2. Create each command with the Request URL:
   ```
   https://your-app.railway.app/slack/events
   ```

| Command | Request URL | Description |
|---------|-------------|-------------|
| `/gmail` | `https://your-app.railway.app/slack/events` | Natural language assistant (main) |
| `/gmail-list` | `https://your-app.railway.app/slack/events` | List recent emails |
| `/gmail-search` | `https://your-app.railway.app/slack/events` | Search emails |
| `/gmail-read` | `https://your-app.railway.app/slack/events` | Read an email |
| `/gmail-send` | `https://your-app.railway.app/slack/events` | Send an email |
| `/gmail-unread` | `https://your-app.railway.app/slack/events` | List unread emails |
| `/gmail-mark-read` | `https://your-app.railway.app/slack/events` | Mark as read |
| `/gmail-trash` | `https://your-app.railway.app/slack/events` | Trash an email |
| `/gmail-help` | `https://your-app.railway.app/slack/events` | Show help |

### Step 7: Reinstall the App

After adding slash commands, go to **OAuth & Permissions** and click **Reinstall to Workspace**.

## Local Development

```bash
# Clone the repo
git clone https://github.com/davefmurray/gmail-slack-bot.git
cd gmail-slack-bot

# Install dependencies
npm install

# Set environment variables
export SLACK_BOT_TOKEN=xoxb-your-token
export SLACK_SIGNING_SECRET=your-secret
export GMAIL_API_URL=https://your-gmail-api.railway.app
export GMAIL_API_KEY=your-api-key

# Run in development mode
npm run dev
```

For local testing, use [ngrok](https://ngrok.com/) to expose your local server:

```bash
ngrok http 3000
```

Then use the ngrok URL as your Request URL in Slack.

## Project Structure

```
gmail-slack-bot/
├── src/
│   ├── index.ts          # Slack Bolt app and command handlers
│   ├── gmail-client.ts   # Gmail HTTP API client
│   └── gmail-assistant.ts # Claude-powered natural language assistant
├── Dockerfile            # Docker configuration
├── package.json
└── tsconfig.json
```

## Related Projects

- [gmail-mcp-http](https://github.com/davefmurray/gmail-mcp-http) - Gmail HTTP REST API server

## Security Notes

- All Slack responses are **ephemeral** (only visible to the user who ran the command)
- Email content is never posted to public channels
- API keys should be stored as environment variables, never committed to code

## Troubleshooting

### "dispatch_failed" error
- Verify your Request URL is correct and the server is running
- Check that the signing secret matches

### "not_authed" error
- Verify your `SLACK_BOT_TOKEN` is correct
- Make sure the token starts with `xoxb-`

### Commands not showing up
- Reinstall the app after adding new slash commands
- Make sure you added all required bot scopes

### Gmail errors
- Verify `GMAIL_API_URL` and `GMAIL_API_KEY` are correct
- Check that the Gmail HTTP API is running

## License

MIT

---

Built with ❤️ using [Slack Bolt](https://slack.dev/bolt-js) and [Railway](https://railway.app)
