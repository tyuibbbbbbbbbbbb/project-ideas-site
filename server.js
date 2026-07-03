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
  const { category } = req.query;
  const data = loadData();
  let ideas = data.ideas.map(normalize).filter((i) => i.status === 'active');
  if (category && category !== 'הכול') {
    ideas = ideas.filter((i) => i.category === category);
  }
  ideas.sort((a, b) => (b.likes - b.dislikes) - (a.likes - a.dislikes));
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
    imageUrl: withImage ? buildImageUrl(title, description, category) : null,
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
  if (type !== 'like' && type !== 'dislike') {
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
  const data = loadData();
  const idx = data.ideas.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  const idea = normalize(data.ideas[idx]);
  if (idea.progress !== 'taken') {
    return res.status(400).json({ error: 'אפשר לסמן כבוצע רק רעיון שנלקח' });
  }
  idea.progress = 'done';
  data.ideas[idx] = idea;
  saveData(data);
  const { voters, ...out } = idea;
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
