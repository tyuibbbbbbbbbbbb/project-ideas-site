const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const DISLIKE_THRESHOLD = 10;
const CATEGORIES = ['אתר', 'תוסף לדפדפן', 'אפליקציה לאנדרואיד', 'תוכנה לווינדוס', 'תוכנה למק', 'אחר'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { ideas: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalize(idea) {
  return {
    category: 'אחר',
    imageUrl: null,
    progress: 'open',
    takenBy: null,
    voters: {},
    nice: 0,
    forumLink: null,
    ...idea,
  };
}

function buildImageUrl(title, description, category) {
  const prompt = `הדמיה של הפרויקט: ${title}. ${description || ''} (${category || ''}) - concept mockup, clean modern design`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=400&nologo=true`;
}

app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

app.get('/api/ideas', (req, res) => {
  const { category, search, sort } = req.query;
  const data = loadData();
  let ideas = data.ideas.map(normalize).filter((i) => i.status === 'active');
  if (category && category !== 'הכול') {
    ideas = ideas.filter((i) => i.category === category);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    ideas = ideas.filter((i) =>
      i.title.toLowerCase().includes(q) ||
      (i.description && i.description.toLowerCase().includes(q)) ||
      (i.author && i.author.toLowerCase().includes(q))
    );
  }
  if (sort === 'newest') {
    ideas.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (sort === 'likes') {
    ideas.sort((a, b) => (b.likes + b.nice) - (a.likes + a.nice));
  } else {
    ideas.sort((a, b) => ((b.likes + b.nice) - b.dislikes) - ((a.likes + a.nice) - a.dislikes));
  }
  res.json(ideas.map(({ voters, ...i }) => i));
});

app.get('/api/review', (req, res) => {
  const data = loadData();
  res.json(
    data.ideas
      .map(normalize)
      .filter((i) => i.status === 'review')
      .map(({ voters, ...i }) => i)
  );
});

app.post('/api/ideas', (req, res) => {
  const { title, description, author, category, withImage } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'חובה למלא כותרת' });
  }
  const data = loadData();
  const idea = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title.trim(),
    description: (description || '').trim(),
    author: (author || 'אנונימי').trim() || 'אנונימי',
    category: CATEGORIES.includes(category) ? category : 'אחר',
    imageUrl: withImage === false ? null : buildImageUrl(title, description, category),
    progress: 'open',
    takenBy: null,
    likes: 0,
    dislikes: 0,
    voters: {},
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  data.ideas.push(idea);
  saveData(data);
  const { voters, ...out } = idea;
  res.status(201).json(out);
});

app.post('/api/ideas/:id/vote', (req, res) => {
  const { type, voter } = req.body;
  if (type !== 'like' && type !== 'dislike' && type !== 'nice') {
    return res.status(400).json({ error: 'סוג הצבעה לא תקין' });
  }
  if (!voter || typeof voter !== 'string') {
    return res.status(400).json({ error: 'חסר מזהה מצביע' });
  }
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const idea = normalize(data.ideas[idx]);
  if (idea.status !== 'active') {
    return res.status(400).json({ error: 'הרעיון נמצא בבדיקה' });
  }
  if (idea.voters[voter]) {
    return res.status(409).json({ error: 'כבר הצבעת על הרעיון הזה' });
  }
  idea.voters[voter] = type;
  if (type === 'like') idea.likes++;
  else if (type === 'nice') idea.nice++;
  else idea.dislikes++;
  if (idea.dislikes > DISLIKE_THRESHOLD) idea.status = 'review';
  data.ideas[idx] = idea;
  saveData(data);
  const { voters, ...out } = idea;
  res.json(out);
});

app.post('/api/ideas/:id/take', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'חובה למלא שם' });
  }
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const idea = normalize(data.ideas[idx]);
  if (idea.progress !== 'open') {
    return res.status(409).json({ error: 'הרעיון כבר נלקח' });
  }
  idea.progress = 'taken';
  idea.takenBy = name.trim();
  data.ideas[idx] = idea;
  saveData(data);
  const { voters, ...out } = idea;
  res.json(out);
});

app.post('/api/ideas/:id/done', (req, res) => {
  const { forumLink } = req.body;
  if (!forumLink || !/^https?:\/\/[^\s]*mitmachim\.top[^\s]*$/i.test(forumLink)) {
    return res.status(400).json({ error: 'חובה לצרף קישור תקין לפורום מתמחים טופ' });
  }
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const idea = normalize(data.ideas[idx]);
  if (idea.progress !== 'taken') {
    return res.status(400).json({ error: 'אפשר לסמן כבוצע רק רעיון שנלקח' });
  }
  idea.progress = 'done';
  idea.forumLink = forumLink.trim();
  data.ideas[idx] = idea;
  saveData(data);
  const { voters, ...out } = idea;
  res.json(out);
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_PASSWORD not set; using insecure default "admin1234"');
}

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

function requireAdmin(req, res, next) {
  const ip = getClientIp(req);
  if (isLoginBlocked(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות כושלים. נסה שוב מאוחר יותר.' });
  }
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    recordLoginAttempt(ip, false);
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  recordLoginAttempt(ip, true);
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = getClientIp(req);
  if (isLoginBlocked(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות כושלים. נסה שוב מאוחר יותר.' });
  }
  if (req.body.password !== ADMIN_PASSWORD) {
    recordLoginAttempt(ip, false);
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  recordLoginAttempt(ip, true);
  res.json({ ok: true });
});

app.get('/api/admin/ideas', requireAdmin, (req, res) => {
  const data = loadData();
  res.json(data.ideas.map(normalize).map(({ voters, ...i }) => i));
});

app.put('/api/admin/ideas/:id', requireAdmin, (req, res) => {
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const idea = normalize(data.ideas[idx]);
  const { title, description, author, category, progress, takenBy, status, likes, dislikes, nice, forumLink, imageUrl } = req.body;
  if (title !== undefined) idea.title = String(title).trim();
  if (description !== undefined) idea.description = String(description).trim();
  if (author !== undefined) idea.author = String(author).trim() || 'אנונימי';
  if (category !== undefined && CATEGORIES.includes(category)) idea.category = category;
  if (progress !== undefined && ['open', 'taken', 'done'].includes(progress)) idea.progress = progress;
  if (takenBy !== undefined) idea.takenBy = takenBy ? String(takenBy).trim() : null;
  if (status !== undefined && ['active', 'review'].includes(status)) idea.status = status;
  if (likes !== undefined && Number.isInteger(likes) && likes >= 0) idea.likes = likes;
  if (dislikes !== undefined && Number.isInteger(dislikes) && dislikes >= 0) idea.dislikes = dislikes;
  if (nice !== undefined && Number.isInteger(nice) && nice >= 0) idea.nice = nice;
  if (forumLink !== undefined) idea.forumLink = forumLink ? String(forumLink).trim() : null;
  if (imageUrl !== undefined) idea.imageUrl = imageUrl || null;
  data.ideas[idx] = idea;
  saveData(data);
  const { voters, ...out } = idea;
  res.json(out);
});

app.delete('/api/admin/ideas/:id', requireAdmin, (req, res) => {
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  data.ideas.splice(idx, 1);
  saveData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
