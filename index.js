import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'VERIFY123';
const ADMIN_PSID = process.env.ADMIN_PSID || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MIN = parseInt(process.env.POLL_INTERVAL_MIN || '10', 10);

const GRAPH = 'https://graph.facebook.com/v17.0';

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB
let db;
(async () => {
  db = await open({
    filename: path.join(__dirname, 'botdata.sqlite3'),
    driver: sqlite3.Database
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      psid TEXT PRIMARY KEY,
      nickname TEXT,
      last_known_name TEXT,
      name_locked INTEGER DEFAULT 0,
      lock_since INTEGER
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      psid TEXT,
      old_name TEXT,
      new_name TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS xp (
      psid TEXT PRIMARY KEY,
      points INTEGER DEFAULT 0
    );
  `);
})();

// Helper: Send API
async function callSendAPI(psid, message) {
  try {
    await axios.post(`${GRAPH}/me/messages`, {
      recipient: { id: psid },
      message
    }, { params: { access_token: PAGE_ACCESS_TOKEN }});
  } catch (err) {
    console.error('Send API error:', err.response?.data || err.message);
  }
}

// Helper: fetch profile name
async function fetchProfileName(psid) {
  try {
    const res = await axios.get(`${GRAPH}/${psid}`, {
      params: { access_token: PAGE_ACCESS_TOKEN, fields: 'name' }
    });
    return res.data?.name || null;
  } catch (err) {
    return null;
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      for (const event of entry.messaging) {
        const sender = event.sender.id;
        if (event.message) {
          await handleMessage(sender, event);
        } else if (event.postback) {
          // handle postbacks
        }
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  }
  return res.sendStatus(404);
});

// Admin endpoints
app.get('/admin/locks', async (req, res) => {
  const rows = await db.all('SELECT psid, nickname, last_known_name, name_locked, lock_since FROM users');
  res.json(rows);
});

app.post('/admin/toggle-lock', async (req, res) => {
  const { psid, lock } = req.body;
  await db.run('INSERT INTO users(psid, name_locked, lock_since) VALUES(?,?,strftime("%s","now")) ON CONFLICT(psid) DO UPDATE SET name_locked=excluded.name_locked, lock_since=excluded.lock_since', [psid, lock?1:0]);
  res.json({ ok:true });
});

app.get('/admin/alerts', async (req, res) => {
  const rows = await db.all('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

// Simple admin UI
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Core message handler
async function handleMessage(sender, event) {
  const message = event.message;
  const text = (message && message.text) ? message.text.trim() : '';

  // ensure user exists
  const user = await db.get('SELECT * FROM users WHERE psid = ?', [sender]);
  if (!user) {
    const prof = await fetchProfileName(sender);
    await db.run('INSERT INTO users(psid, last_known_name) VALUES(?,?)', [sender, prof || null]);
  }

  // XP increment
  await db.run('INSERT INTO xp(psid, points) VALUES(?,1) ON CONFLICT(psid) DO UPDATE SET points = points + 1', [sender]);

  // ignore echoes
  if (message.is_echo) return;

  // command parsing
  const lower = text.toLowerCase();

  if (lower.startsWith('/nick ')) {
    const nick = text.substring(6).trim();
    await db.run('INSERT INTO users(psid, nickname) VALUES(?,?) ON CONFLICT(psid) DO UPDATE SET nickname=excluded.nickname', [sender, nick]);
    return callSendAPI(sender, { text: `Nickname set to: ${nick}`});
  }

  if (lower === '/getnick') {
    const r = await db.get('SELECT nickname FROM users WHERE psid = ?', [sender]);
    return callSendAPI(sender, { text: `Your nickname: ${r?.nickname || '(not set)'}`});
  }

  if (lower === '/level') {
    const r = await db.get('SELECT points FROM xp WHERE psid = ?', [sender]);
    return callSendAPI(sender, { text: `⭐ Your XP: ${r?.points || 0}`});
  }

  if (lower === '/help') {
    return callSendAPI(sender, { text: 'Commands: /nick, /getnick, /level, /song, /photo, /meme, /yt <q>, /ai <q>, /help' });
  }

  if (lower === '/song') {
    return callSendAPI(sender, { text: '🎵 Song: https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  }

  if (lower === '/photo') {
    return callSendAPI(sender, { attachment: { type:'image', payload:{ url:'https://via.placeholder.com/800x400.png?text=Photo', is_reusable:true } } });
  }

  if (lower === '/meme') {
    return callSendAPI(sender, { attachment: { type:'image', payload:{ url:'https://i.imgflip.com/1bij.jpg', is_reusable:false } } });
  }

  if (lower.startsWith('/yt ')) {
    const q = text.substring(4);
    return callSendAPI(sender, { text: `YouTube search: https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` });
  }

  if (lower.startsWith('/ai ')) {
    // AI placeholder: echo back or call OpenAI if key provided
    const q = text.substring(4);
    if (OPENAI_API_KEY) {
      // NOTE: This is a placeholder - integrating OpenAI API requires usage compliance and possible billing.
      try {
        const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o-mini', messages:[{role:'user', content:q}]
        }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }});
        const reply = resp.data?.choices?.[0]?.message?.content || 'AI error';
        return callSendAPI(sender, { text: `🤖 ${reply}` });
      } catch (err) {
        console.error('OpenAI error', err.response?.data || err.message);
        return callSendAPI(sender, { text: '🤖 AI error' });
      }
    } else {
      return callSendAPI(sender, { text: `🤖 (demo) ${q}` });
    }
  }

  // default: use nickname for display if set
  const r = await db.get('SELECT nickname FROM users WHERE psid = ?', [sender]);
  const display = r?.nickname || null;
  const replyText = display ? `(${display}) — You said: ${text}` : `You said: ${text}`;
  return callSendAPI(sender, { text: replyText });
}

// Polling locked users
async function pollLockedUsers() {
  const rows = await db.all('SELECT psid, last_known_name FROM users WHERE name_locked = 1');
  for (const r of rows) {
    try {
      const current = await fetchProfileName(r.psid);
      if (current && r.last_known_name && current !== r.last_known_name) {
        await db.run('INSERT INTO alerts(psid, old_name, new_name) VALUES(?,?,?)', [r.psid, r.last_known_name, current]);
        // notify admin
        if (ADMIN_PSID) {
          await callSendAPI(ADMIN_PSID, { text: `ALERT: User ${r.psid} changed name from "${r.last_known_name}" to "${current}"`});
        }
        await db.run('UPDATE users SET last_known_name = ? WHERE psid = ?', [current, r.psid]);
      } else if (current && !r.last_known_name) {
        await db.run('UPDATE users SET last_known_name = ? WHERE psid = ?', [current, r.psid]);
      }
    } catch (err) {
      console.warn('Poll error', err.message);
    }
  }
}

setInterval(pollLockedUsers, Math.max(60_000, POLL_INTERVAL_MIN*60*1000));

// Health
app.get('/', (req,res)=> res.send('FB Messenger Convo Bot running'));

// Start
app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`));
