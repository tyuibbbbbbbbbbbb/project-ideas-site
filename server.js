const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const DISLIKE_THRESHOLD = 10;

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

app.get('/api/ideas', (req, res) => {
  const data = loadData();
  const ideas = data.ideas
    .filter((i) => i.status === 'active')
    .sort((a, b) => (b.likes - b.dislikes) - (a.likes - a.dislikes));
  res.json(ideas);
});

app.get('/api/review', (req, res) => {
  const data = loadData();
  res.json(data.ideas.filter((i) => i.status === 'review'));
});

app.post('/api/ideas', (req, res) => {
  const { title, description, author } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'חובה למלא כותרת' });
  }
  const data = loadData();
  const idea = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title.trim(),
    description: (description || '').trim(),
    author: (author || 'אנונימי').trim() || 'אנונימי',
    likes: 0,
    dislikes: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  data.ideas.push(idea);
  saveData(data);
  res.status(201).json(idea);
});

app.post('/api/ideas/:id/vote', (req, res) => {
  const { type } = req.body;
  if (type !== 'like' && type !== 'dislike') {
    return res.status(400).json({ error: 'סוג הצבעה לא תקין' });
  }
  const data = loadData();
  const idea = data.ideas.find((i) => i.id === req.params.id);
  if (!idea) return res.status(404).json({ error: 'הרעיון לא נמצא' });
  if (idea.status !== 'active') {
    return res.status(400).json({ error: 'הרעיון נמצא בבדיקה' });
  }
  if (type === 'like') idea.likes++;
  else idea.dislikes++;
  if (idea.dislikes > DISLIKE_THRESHOLD) idea.status = 'review';
  saveData(data);
  res.json(idea);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
