const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, hashPassword, verifyPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DISLIKE_THRESHOLD = 10;
const CATEGORIES = ['אתר', 'תוסף לדפדפן', 'אפליקציה לאנדרואיד', 'תוכנה לווינדוס', 'תוכנה למק', 'אחר'];
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Admin password (stored in DB with hash) ─────────────
function getAdminPasswordHash() {
  const row = db.prepare('SELECT value FROM admin_config WHERE key = ?').get('admin_password_hash');
  return row ? row.value : null;
}

function setAdminPasswordHash(pw) {
  const hash = hashPassword(pw);
  db.prepare('INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)').run('admin_password_hash', hash);
}

// Initialise admin password from env or default
if (!getAdminPasswordHash()) {
  const envPw = process.env.ADMIN_PASSWORD;
  if (envPw) {
    setAdminPasswordHash(envPw);
    console.log('Admin password initialised from ADMIN_PASSWORD env var');
  } else {
    setAdminPasswordHash('admin1234');
    console.warn('WARNING: No ADMIN_PASSWORD env var. Using insecure default "admin1234". Change it from the admin panel!');
  }
}

// ── Image generation (Stability AI with pollinations fallback) ──
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const IMAGES_DIR = path.join(__dirname, 'public', 'generated-images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

async function generateImageStability(prompt) {
  if (!STABILITY_API_KEY) return null;
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', '16:9');
  form.append('output_format', 'jpeg');
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STABILITY_API_KEY}`, Accept: 'image/*' },
    body: form,
  });
  if (!res.ok) {
    console.warn('Stability AI failed:', res.status, await res.text());
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
  return `/generated-images/${filename}`;
}

function buildPollinationsUrl(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=400&nologo=true`;
}

async function buildImageUrl(title, description, category) {
  // Use English-only prompt to avoid content moderation issues
  const categoryMap = {
    'אתר': 'website',
    'תוסף לדפדפן': 'browser extension',
    'אפליקציה לאנדרואיד': 'Android app',
    'תוכנה לווינדוס': 'Windows software',
    'תוכנה למק': 'Mac software',
    'אחר': 'software project',
  };
  const catEn = categoryMap[category] || 'software project';
  const prompt = `A clean modern concept mockup illustration representing a ${catEn}. App icon or UI dashboard design, minimalist, professional, digital art, flat design style.`;
  if (STABILITY_API_KEY) {
    const localUrl = await generateImageStability(prompt);
    if (localUrl) return localUrl;
  }
  // Fallback: pollinations with the original Hebrew prompt
  const fallbackPrompt = `הדמיה של הפרויקט: ${title}. ${description || ''} (${category || ''}) - concept mockup, clean modern design`;
  return buildPollinationsUrl(fallbackPrompt);
}

// ── Cookie / token helpers ──────────────────────────────
function parseCookies(req) {
  const cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = decodeURIComponent(pair.slice(0, idx).trim());
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    cookies[key] = value;
  });
  return cookies;
}

function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
}

function adminCookie(value, maxAge, secure) {
  const age = maxAge === 0 ? 'Max-Age=0' : `Max-Age=${Math.round(maxAge / 1000)}`;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', secure ? 'Secure' : '', age].filter(Boolean).join('; ');
  return `adminToken=${encodeURIComponent(value || '')}; ${flags}`;
}

function sessionCookie(value, maxAge, secure) {
  const age = maxAge === 0 ? 'Max-Age=0' : `Max-Age=${Math.round(maxAge / 1000)}`;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', secure ? 'Secure' : '', age].filter(Boolean).join('; ');
  return `sessionToken=${encodeURIComponent(value || '')}; ${flags}`;
}

function signAdminToken() {
  const timestamp = Date.now().toString();
  const hash = getAdminPasswordHash() || 'fallback';
  const signature = crypto.createHmac('sha256', hash).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

function verifyAdminToken(token) {
  if (typeof token !== 'string') return false;
  const [timestamp, signature] = token.split('.');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Date.now() - parseInt(timestamp, 10) > TOKEN_MAX_AGE_MS) return false;
  const hash = getAdminPasswordHash();
  if (!hash) return false;
  const expected = crypto.createHmac('sha256', hash).update(timestamp).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Brute-force protection ──────────────────────────────
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function isLoginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!rec && rec.blockedUntil > Date.now();
}

function recordLoginAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, blockedUntil: 0 };
  if (rec.blockedUntil > now) return;
  rec.count++;
  if (rec.count >= MAX_LOGIN_ATTEMPTS) {
    rec.blockedUntil = now + LOGIN_LOCKOUT_MS;
    rec.count = 0;
  }
  loginAttempts.set(ip, rec);
}

// ── Auth middleware ─────────────────────────────────────
function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  if (!verifyAdminToken(cookies.adminToken)) {
    return res.status(401).json({ error: 'אינך מחובר' });
  }
  next();
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.sessionToken;
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

function requireUser(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'יש להתחבר כדי לבצע פעולה זו' });
  req.user = user;
  next();
}

// ── Public API: categories ──────────────────────────────
app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

// ── Ideas list ──────────────────────────────────────────
app.get('/api/ideas', (req, res) => {
  const { category, search, sort } = req.query;
  let sql = 'SELECT * FROM ideas WHERE status = ?';
  const params = ['active'];
  if (category && category !== 'הכול') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (search && search.trim()) {
    sql += ' AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(author) LIKE ?)';
    const q = '%' + search.trim().toLowerCase() + '%';
    params.push(q, q, q);
  }
  if (sort === 'newest') {
    sql += ' ORDER BY created_at DESC';
  } else if (sort === 'likes') {
    sql += ' ORDER BY (likes + nice) DESC';
  } else {
    sql += ' ORDER BY ((likes + nice) - dislikes) DESC';
  }
  const ideas = db.prepare(sql).all(...params);
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.headers['x-voter-key'] || req.ip);
  const result = ideas.map((idea) => {
    const myVote = db.prepare('SELECT vote_type FROM votes WHERE idea_id = ? AND voter_key = ?').get(idea.id, voterKey);
    return { ...idea, myVote: myVote ? myVote.vote_type : null };
  });
  res.json(result);
});

// ── Single idea (full detail) ───────────────────────────
app.get('/api/ideas/:id', (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.headers['x-voter-key'] || req.ip);
  const myVote = db.prepare('SELECT vote_type FROM votes WHERE idea_id = ? AND voter_key = ?').get(idea.id, voterKey);
  res.json({ ...idea, myVote: myVote ? myVote.vote_type : null });
});

// ── Create idea ─────────────────────────────────────────
app.post('/api/ideas', requireUser, async (req, res) => {
  const { title, description, category, withImage } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'חובה למלא כותרת' });
  const user = req.user;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let imageUrl = null;
  if (withImage !== false) {
    try { imageUrl = await buildImageUrl(title, description, category); } catch (e) { console.warn('Image gen failed:', e.message); }
  }
  const idea = {
    id,
    title: title.trim(),
    description: (description || '').trim(),
    author: user.username,
    user_id: user.id,
    category: CATEGORIES.includes(category) ? category : 'אחר',
    image_url: imageUrl,
    progress: 'open',
    taken_by: null,
    taken_by_user_id: null,
    forum_link: null,
    likes: 0,
    dislikes: 0,
    nice: 0,
    status: 'active',
  };
  db.prepare(`INSERT INTO ideas (id, title, description, author, user_id, category, image_url, progress, taken_by, taken_by_user_id, forum_link, likes, dislikes, nice, status)
    VALUES (@id, @title, @description, @author, @user_id, @category, @image_url, @progress, @taken_by, @taken_by_user_id, @forum_link, @likes, @dislikes, @nice, @status)`).run(idea);
  res.status(201).json(idea);
});

// ── Edit idea (owner or admin) ──────────────────────────
app.put('/api/ideas/:id', (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const user = getSessionUser(req);
  const cookies = parseCookies(req);
  const isAdmin = verifyAdminToken(cookies.adminToken);
  if (!isAdmin && (!user || idea.user_id !== user.id)) {
    return res.status(403).json({ error: 'אין לך הרשאה לערוך רעיון זה' });
  }
  const { title, description, category } = req.body;
  if (title !== undefined) db.prepare('UPDATE ideas SET title = ? WHERE id = ?').run(String(title).trim(), idea.id);
  if (description !== undefined) db.prepare('UPDATE ideas SET description = ? WHERE id = ?').run(String(description).trim(), idea.id);
  if (category !== undefined && CATEGORIES.includes(category)) db.prepare('UPDATE ideas SET category = ? WHERE id = ?').run(category, idea.id);
  const updated = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json(updated);
});

// ── Delete idea (owner or admin) ────────────────────────
app.delete('/api/ideas/:id', (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const user = getSessionUser(req);
  const cookies = parseCookies(req);
  const isAdmin = verifyAdminToken(cookies.adminToken);
  if (!isAdmin && (!user || idea.user_id !== user.id)) {
    return res.status(403).json({ error: 'אין לך הרשאה למחוק רעיון זה' });
  }
  db.prepare('DELETE FROM ideas WHERE id = ?').run(idea.id);
  res.json({ ok: true });
});

// ── Vote ────────────────────────────────────────────────
app.post('/api/ideas/:id/vote', (req, res) => {
  const { type } = req.body;
  if (type !== 'like' && type !== 'dislike' && type !== 'nice') {
    return res.status(400).json({ error: 'סוג הצבעה לא תקין' });
  }
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.status !== 'active') return res.status(400).json({ error: 'הרעיון נמצא בבדיקה' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.body.voter || req.ip);
  if (!voterKey) return res.status(400).json({ error: 'חסר מזהה מצביע' });
  const existing = db.prepare('SELECT vote_type FROM votes WHERE idea_id = ? AND voter_key = ?').get(idea.id, voterKey);
  if (existing) return res.status(409).json({ error: 'כבר הצבעת על הרעיון הזה' });
  db.prepare('INSERT INTO votes (idea_id, user_id, voter_key, vote_type) VALUES (?, ?, ?, ?)').run(idea.id, user ? user.id : null, voterKey, type);
  const col = type === 'like' ? 'likes' : type === 'nice' ? 'nice' : 'dislikes';
  db.prepare(`UPDATE ideas SET ${col} = ${col} + 1 WHERE id = ?`).run(idea.id);
  if (type === 'dislike') {
    const updated = db.prepare('SELECT dislikes FROM ideas WHERE id = ?').get(idea.id);
    if (updated.dislikes > DISLIKE_THRESHOLD) {
      db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run('review', idea.id);
    }
  }
  const result = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json({ ...result, myVote: type });
});

// ── Take project ────────────────────────────────────────
app.post('/api/ideas/:id/take', (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.progress !== 'open') return res.status(409).json({ error: 'הרעיון כבר נלקח' });
  const user = getSessionUser(req);
  const name = (req.body.name || (user ? user.username : '') || '').trim();
  if (!name) return res.status(400).json({ error: 'חובה למלא שם' });
  db.prepare('UPDATE ideas SET progress = ?, taken_by = ?, taken_by_user_id = ? WHERE id = ?')
    .run('taken', name, user ? user.id : null, idea.id);
  const result = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json(result);
});

// ── Mark done ───────────────────────────────────────────
app.post('/api/ideas/:id/done', (req, res) => {
  const { forumLink } = req.body;
  if (!forumLink || !/^https?:\/\/[^\s]*mitmachim\.top[^\s]*$/i.test(forumLink)) {
    return res.status(400).json({ error: 'חובה לצרף קישור תקין לפורום מתמחים טופ' });
  }
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.progress !== 'taken') return res.status(400).json({ error: 'אפשר לסמן כבוצע רק רעיון שנלקח' });
  db.prepare('UPDATE ideas SET progress = ?, forum_link = ? WHERE id = ?').run('done', forumLink.trim(), idea.id);
  const result = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json(result);
});

// ── Leave project (only the person who took it) ─────────
app.post('/api/ideas/:id/leave', requireUser, (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.progress !== 'taken') return res.status(400).json({ error: 'הרעיון לא נלקח על ידי אף אחד' });
  if (idea.taken_by_user_id !== req.user.id) {
    return res.status(403).json({ error: 'אין לך הרשאה לפרוש מהפרויקט' });
  }
  db.prepare('UPDATE ideas SET progress = ?, taken_by = NULL, taken_by_user_id = NULL WHERE id = ?').run('open', idea.id);
  const result = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json(result);
});

// ── Comments ────────────────────────────────────────────
// ── Comments ────────────────────────────────────────────
app.get('/api/ideas/:id/comments', (req, res) => {
  const idea = db.prepare('SELECT id FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.headers['x-voter-key'] || req.ip);
  const comments = db.prepare(`
    SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.idea_id = ? ORDER BY c.created_at ASC
  `).all(req.params.id);
  const withVotes = comments.map(c => {
    const myVote = db.prepare('SELECT vote_type FROM comment_votes WHERE comment_id = ? AND voter_key = ?').get(c.id, voterKey);
    return { ...c, myVote: myVote ? myVote.vote_type : null };
  });
  res.json(withVotes);
});

app.post('/api/ideas/:id/comments', requireUser, (req, res) => {
  const { content, parentId } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'חובה למלא תוכן' });
  const idea = db.prepare('SELECT id FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const result = db.prepare('INSERT INTO comments (idea_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.user.id, parentId || null, content.trim());
  const comment = db.prepare('SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...comment, likes: 0, dislikes: 0, myVote: null });
});

app.delete('/api/ideas/:id/comments/:commentId', requireUser, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND idea_id = ?').get(req.params.commentId, req.params.id);
  if (!comment) return res.status(404).json({ error: 'התגובה לא נמצאה' });
  const cookies = parseCookies(req);
  const isAdmin = verifyAdminToken(cookies.adminToken);
  if (!isAdmin && comment.user_id !== req.user.id) {
    return res.status(403).json({ error: 'אין לך הרשאה למחוק תגובה זו' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
});

app.post('/api/comments/:commentId/vote', (req, res) => {
  const { type } = req.body;
  if (type !== 'like' && type !== 'dislike') return res.status(400).json({ error: 'סוג הצבעה לא תקין' });
  const comment = db.prepare('SELECT c.*, i.id as idea_id FROM comments c JOIN ideas i ON c.idea_id = i.id WHERE c.id = ?').get(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'התגובה לא נמצאה' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.body.voter || req.ip);
  if (!voterKey) return res.status(400).json({ error: 'חסר מזהה מצביע' });
  const existing = db.prepare('SELECT vote_type FROM comment_votes WHERE comment_id = ? AND voter_key = ?').get(comment.id, voterKey);
  if (existing) return res.status(409).json({ error: 'כבר הצבעת על תגובה זו' });
  db.prepare('INSERT INTO comment_votes (comment_id, user_id, voter_key, vote_type) VALUES (?, ?, ?, ?)')
    .run(comment.id, user ? user.id : null, voterKey, type);
  db.prepare(`UPDATE comments SET ${type === 'like' ? 'likes = likes + 1' : 'dislikes = dislikes + 1'} WHERE id = ?`).run(comment.id);
  if (type === 'dislike') {
    db.prepare('INSERT INTO admin_flags (idea_id, comment_id, user_id, reason) VALUES (?, ?, ?, ?)')
      .run(comment.idea_id, comment.id, user ? user.id : null, 'דיסלייק לתגובה');
  }
  const updated = db.prepare('SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?').get(comment.id);
  res.json({ ...updated, myVote: type });
});

// ── Progress reports ────────────────────────────────────
app.get('/api/ideas/:id/reports', (req, res) => {
  const idea = db.prepare('SELECT id FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.headers['x-voter-key'] || req.ip);
  const reports = db.prepare(`
    SELECT r.*, u.username FROM progress_reports r JOIN users u ON r.user_id = u.id
    WHERE r.idea_id = ? ORDER BY r.created_at DESC
  `).all(req.params.id);
  const withVotes = reports.map(r => {
    const myVote = db.prepare('SELECT vote_type FROM report_votes WHERE report_id = ? AND voter_key = ?').get(r.id, voterKey);
    return { ...r, myVote: myVote ? myVote.vote_type : null };
  });
  res.json(withVotes);
});

app.post('/api/ideas/:id/reports', requireUser, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'חובה למלא תוכן' });
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.taken_by_user_id !== req.user.id) {
    return res.status(403).json({ error: 'רק מי שלקח על עצמו את הפרויקט יכול לפרסם דיווח התקדמות' });
  }
  const result = db.prepare('INSERT INTO progress_reports (idea_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.id, content.trim());
  const report = db.prepare('SELECT r.*, u.username FROM progress_reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...report, likes: 0, dislikes: 0, myVote: null });
});

app.delete('/api/ideas/:id/reports/:reportId', requireUser, (req, res) => {
  const report = db.prepare('SELECT * FROM progress_reports WHERE id = ? AND idea_id = ?').get(req.params.reportId, req.params.id);
  if (!report) return res.status(404).json({ error: 'הדיווח לא נמצא' });
  const cookies = parseCookies(req);
  const isAdmin = verifyAdminToken(cookies.adminToken);
  if (!isAdmin && report.user_id !== req.user.id) {
    return res.status(403).json({ error: 'אין לך הרשאה למחוק דיווח זה' });
  }
  db.prepare('DELETE FROM progress_reports WHERE id = ?').run(report.id);
  res.json({ ok: true });
});

app.post('/api/reports/:reportId/vote', (req, res) => {
  const { type } = req.body;
  if (type !== 'like' && type !== 'dislike') return res.status(400).json({ error: 'סוג הצבעה לא תקין' });
  const report = db.prepare('SELECT r.*, i.id as idea_id FROM progress_reports r JOIN ideas i ON r.idea_id = i.id WHERE r.id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'הדיווח לא נמצא' });
  const user = getSessionUser(req);
  const voterKey = user ? `u${user.id}` : (req.body.voter || req.ip);
  if (!voterKey) return res.status(400).json({ error: 'חסר מזהה מצביע' });
  const existing = db.prepare('SELECT vote_type FROM report_votes WHERE report_id = ? AND voter_key = ?').get(report.id, voterKey);
  if (existing) return res.status(409).json({ error: 'כבר הצבעת על דיווח זה' });
  db.prepare('INSERT INTO report_votes (report_id, user_id, voter_key, vote_type) VALUES (?, ?, ?, ?)')
    .run(report.id, user ? user.id : null, voterKey, type);
  db.prepare(`UPDATE progress_reports SET ${type === 'like' ? 'likes = likes + 1' : 'dislikes = dislikes + 1'} WHERE id = ?`).run(report.id);
  if (type === 'dislike') {
    db.prepare('INSERT INTO admin_flags (idea_id, report_id, user_id, reason) VALUES (?, ?, ?, ?)')
      .run(report.idea_id, report.id, user ? user.id : null, 'דיסלייק לדיווח התקדמות');
  }
  const updated = db.prepare('SELECT r.*, u.username FROM progress_reports r JOIN users u ON r.user_id = u.id WHERE r.id = ?').get(report.id);
  res.json({ ...updated, myVote: type });
});

// ── Auth: register ──────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'חובה למלא שם משתמש' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'הסיסמה חייבת להיות לפחות 4 תווים' });
  const uname = username.trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (existing) return res.status(409).json({ error: 'שם המשתמש כבר תפוס' });
  const hash = hashPassword(password);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(uname, hash);
  // Auto-login
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, result.lastInsertRowid, expires);
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE_MS, isSecureRequest(req)));
  res.status(201).json({ id: result.lastInsertRowid, username: uname });
});

// ── Auth: login (multiple sessions allowed) ─────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'חובה למלא שם משתמש וסיסמה' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  }
  db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').run(user.id);
  const remember = req.body.remember === true || req.body.remember === 'true' || req.body.remember === 'on' || req.body.remember === true;
  const maxAge = remember ? SESSION_MAX_AGE_MS : SESSION_SHORT_AGE_MS;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + maxAge).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);
  res.setHeader('Set-Cookie', sessionCookie(token, maxAge, isSecureRequest(req)));
  res.json({ id: user.id, username: user.username });
});

// ── Auth: logout ────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sessionToken) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies.sessionToken);
  }
  res.setHeader('Set-Cookie', sessionCookie('', 0, isSecureRequest(req)));
  res.json({ ok: true });
});

// ── Auth: me ────────────────────────────────────────────
app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.json(null);
  res.json(user);
});

// ── Admin: login ────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const ip = getClientIp(req);
  if (isLoginBlocked(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות כושלים. נסה שוב מאוחר יותר.' });
  }
  const { password } = req.body;
  const hash = getAdminPasswordHash();
  if (!hash || !verifyPassword(password || '', hash)) {
    recordLoginAttempt(ip, false);
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  recordLoginAttempt(ip, true);
  res.setHeader('Set-Cookie', adminCookie(signAdminToken(), TOKEN_MAX_AGE_MS, isSecureRequest(req)));
  res.json({ ok: true });
});

// ── Admin: logout ───────────────────────────────────────
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', adminCookie('', 0, isSecureRequest(req)));
  res.json({ ok: true });
});

// ── Admin: change password ──────────────────────────────
app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const hash = getAdminPasswordHash();
  if (!verifyPassword(currentPassword || '', hash)) {
    return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'הסיסמה החדשה חייבת להיות לפחות 6 תווים' });
  }
  setAdminPasswordHash(newPassword);
  // Re-issue token with new hash
  res.setHeader('Set-Cookie', adminCookie(signAdminToken(), TOKEN_MAX_AGE_MS, isSecureRequest(req)));
  res.json({ ok: true });
});

// ── Admin: list all ideas ───────────────────────────────
app.get('/api/admin/ideas', requireAdmin, (req, res) => {
  const ideas = db.prepare('SELECT * FROM ideas ORDER BY created_at DESC').all();
  res.json(ideas);
});

// ── Admin: edit idea ────────────────────────────────────
app.put('/api/admin/ideas/:id', requireAdmin, (req, res) => {
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const { title, description, author, category, progress, takenBy, status, likes, dislikes, nice, forumLink, imageUrl } = req.body;
  const updates = [];
  const params = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(String(title).trim()); }
  if (description !== undefined) { updates.push('description = ?'); params.push(String(description).trim()); }
  if (author !== undefined) { updates.push('author = ?'); params.push(String(author).trim() || 'אנונימי'); }
  if (category !== undefined && CATEGORIES.includes(category)) { updates.push('category = ?'); params.push(category); }
  if (progress !== undefined && ['open', 'taken', 'done', 'abandoned'].includes(progress)) { updates.push('progress = ?'); params.push(progress); }
  if (takenBy !== undefined) { updates.push('taken_by = ?'); params.push(takenBy ? String(takenBy).trim() : null); }
  if (status !== undefined && ['active', 'review'].includes(status)) { updates.push('status = ?'); params.push(status); }
  if (likes !== undefined && Number.isInteger(likes) && likes >= 0) { updates.push('likes = ?'); params.push(likes); }
  if (dislikes !== undefined && Number.isInteger(dislikes) && dislikes >= 0) { updates.push('dislikes = ?'); params.push(dislikes); }
  if (nice !== undefined && Number.isInteger(nice) && nice >= 0) { updates.push('nice = ?'); params.push(nice); }
  if (forumLink !== undefined) { updates.push('forum_link = ?'); params.push(forumLink ? String(forumLink).trim() : null); }
  if (imageUrl !== undefined) { updates.push('image_url = ?'); params.push(imageUrl || null); }
  if (updates.length > 0) {
    params.push(idea.id);
    db.prepare(`UPDATE ideas SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const result = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idea.id);
  res.json(result);
});

// ── Admin: delete idea ──────────────────────────────────
app.delete('/api/admin/ideas/:id', requireAdmin, (req, res) => {
  const idea = db.prepare('SELECT id FROM ideas WHERE id = ?').get(req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  db.prepare('DELETE FROM ideas WHERE id = ?').run(idea.id);
  res.json({ ok: true });
});

// ── Admin: list users ───────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, created_at, last_login FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// ── Review list (public, for admin panel) ───────────────
app.get('/api/review', (req, res) => {
  const ideas = db.prepare('SELECT * FROM ideas WHERE status = ?').all('review');
  res.json(ideas);
});

// ── Admin: flags/reports from dislikes ──────────────────
app.get('/api/admin/flags', requireAdmin, (req, res) => {
  const flags = db.prepare(`
    SELECT f.*, u.username as flagged_by, i.title as idea_title
    FROM admin_flags f
    LEFT JOIN users u ON f.user_id = u.id
    LEFT JOIN ideas i ON f.idea_id = i.id
    WHERE f.resolved = 0
    ORDER BY f.created_at DESC
  `).all();
  res.json(flags);
});

app.post('/api/admin/flags/:id/resolve', requireAdmin, (req, res) => {
  db.prepare('UPDATE admin_flags SET resolved = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
