# FB Messenger Convo Bot (Page + Group AI)

This repository is a ready-to-deploy **Facebook Messenger bot** that works with Pages and can act as a Group AI convo bot.
It uses the official Messenger Send/Receive API (Page-based), stores data in SQLite, and includes an admin UI and cron polling to monitor name changes.

## Features
- Page-based Messenger webhook (reply to DMs and group messages)
- Commands: /nick, /getnick, /song, /photo, /meme, /yt, /ai, /help, and more
- AI convo placeholder (integrate OpenAI or other LLM)
- Nickname enforcement (bot shows nickname in replies)
- Name-lock monitoring and admin alerts (cron job)
- Simple Admin UI (view locks, alerts, toggle locks)
- XP / Level system
- Deploy-ready for Render / Heroku

## Files
- index.js (main server)
- package.json
- .env.example
- README.md
- /commands (command handlers)
- /utils (helpers)
- /public (admin web UI)
- botdata.sqlite3 (created at runtime)

## Setup (local)
1. `git clone` or download this repo
2. `npm install`
3. Copy `.env.example` to `.env` and fill in:
   - PAGE_ACCESS_TOKEN
   - VERIFY_TOKEN
   - ADMIN_PSID
   - OPENAI_API_KEY (optional for AI)
4. `node index.js`
5. Use ngrok for local webhook testing and set the webhook URL in Facebook Developer Portal:
   `https://<ngrok-id>.ngrok.io/webhook`

## Deploy (Render)
1. Push to GitHub
2. Render.com -> New -> Web Service -> connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables on Render dashboard.

## Notes / Limitations
- This bot **does not** use cookies or fbstate. It's Page-token based and safe.
- Bot cannot forcibly change user profile names; it can only monitor and alert.
