import http from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.resolve(__dirname, process.env.KNIP_DATA_FILE || './data/database.json');
const SEED_FILE = path.resolve(__dirname, './data/seed.json');

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

async function ensureDatabase() {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await access(DATA_FILE);
  } catch {
    const seed = await readFile(SEED_FILE, 'utf8');
    await writeFile(DATA_FILE, seed, 'utf8');
  }
}

async function readDb() {
  await ensureDatabase();
  return JSON.parse(await readFile(DATA_FILE, 'utf8'));
}

async function writeDb(db) {
  await writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function audit(db, action, entityType, entityId, actorId = 'usr_admin') {
  db.auditEvents.unshift({
    id: `audit_${crypto.randomUUID()}`,
    action,
    entityType,
    entityId,
    actorId,
    createdAt: new Date().toISOString()
  });
}

async function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url;
  const safe = path.normalize(requested).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(__dirname, 'public', safe);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return false;
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
    sendText(res, 200, body, types[ext] || 'application/octet-stream');
    return true;
  } catch {
    return false;
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'knip-platform',
      version: '0.1.0-alpha-foundation',
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/stories') {
    const db = await readDb();
    return sendJson(res, 200, { stories: db.stories });
  }

  if (req.method === 'POST' && url.pathname === '/api/stories') {
    try {
      const body = await readBody(req);
      if (!body.title || typeof body.title !== 'string') {
        return sendJson(res, 400, { error: 'title is required' });
      }
      const db = await readDb();
      const story = {
        id: `story_${crypto.randomUUID()}`,
        title: body.title.trim(),
        summary: String(body.summary || '').trim(),
        source: String(body.source || '').trim(),
        status: 'NEW',
        createdAt: new Date().toISOString()
      };
      db.stories.unshift(story);
      audit(db, 'STORY_CREATED', 'STORY', story.id);
      await writeDb(db);
      return sendJson(res, 201, { story });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const db = await readDb();
    return sendJson(res, 200, { auditEvents: db.auditEvents });
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    const seed = JSON.parse(await readFile(SEED_FILE, 'utf8'));
    audit(seed, 'DATABASE_RESET', 'SYSTEM', 'foundation');
    await writeDb(seed);
    return sendJson(res, 200, { ok: true });
  }

  if (await serveStatic(req, res)) return;
  return sendJson(res, 404, { error: 'Not found' });
}

if (process.env.NODE_ENV !== 'test') {
  await ensureDatabase();
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error(JSON.stringify({ level: 'error', message: error.message, stack: error.stack, timestamp: new Date().toISOString() }));
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.end();
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', message: `KNIP listening on port ${PORT}`, timestamp: new Date().toISOString() }));
  });
}
