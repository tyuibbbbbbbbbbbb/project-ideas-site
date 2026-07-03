const ideasList = document.getElementById('ideas-list');
const reviewList = document.getElementById('review-list');
const emptyMsg = document.getElementById('empty-msg');
const reviewEmpty = document.getElementById('review-empty');
const form = document.getElementById('idea-form');
const categorySelect = document.getElementById('category');
const filterBar = document.getElementById('filter-bar');

let currentFilter = 'הכול';

function getVoterId() {
  let id = localStorage.getItem('voterId');
  if (!id) {
    id = 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('voterId', id);
  }
  return id;
}

function votedIdeas() {
  try {
    return JSON.parse(localStorage.getItem('votedIdeas')) || {};
  } catch {
    return {};
  }
}

function markVoted(id, type) {
  const v = votedIdeas();
  v[id] = type;
  localStorage.setItem('votedIdeas', JSON.stringify(v));
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const PROGRESS_LABELS = {
  open: '',
  taken: '🔨 נלקח',
  done: '✅ בוצע',
};

function renderCard(idea, index, withVotes) {
  const topBadge = withVotes && index === 0 ? '<span class="badge">🏆 הכי פופולרי</span>' : '';
  const progressBadge = idea.progress !== 'open'
    ? `<span class="badge progress-${idea.progress}">${PROGRESS_LABELS[idea.progress]}${idea.takenBy ? ' ע"י ' + escapeHtml(idea.takenBy) : ''}</span>`
    : '';
  const catBadge = `<span class="badge cat">${escapeHtml(idea.category || 'אחר')}</span>`;
  const voted = votedIdeas()[idea.id];
  const votes = withVotes
    ? `<div class="votes">
        <button class="vote-btn like${voted === 'like' ? ' voted' : ''}" data-id="${idea.id}" data-type="like" ${voted ? 'disabled' : ''}>👍 ${idea.likes}</button>
        <button class="vote-btn dislike${voted === 'dislike' ? ' voted' : ''}" data-id="${idea.id}" data-type="dislike" ${voted ? 'disabled' : ''}>👎 ${idea.dislikes}</button>
        ${idea.progress === 'open' ? `<button class="take-btn" data-id="${idea.id}">🙋 אני לוקח את הפרויקט</button>` : ''}
        ${idea.progress === 'taken' ? `<button class="done-btn" data-id="${idea.id}">✅ סמן כבוצע</button>` : ''}
        <span class="score">ניקוד: ${idea.likes - idea.dislikes}</span>
      </div>`
    : `<div class="votes"><span>👍 ${idea.likes} · 👎 ${idea.dislikes}</span></div>`;
  const image = idea.imageUrl
    ? `<img class="idea-img" src="${escapeHtml(idea.imageUrl)}" alt="הדמיה של הרעיון" loading="lazy" onerror="this.remove()" />`
    : '';
  return `<div class="idea-card${withVotes && index === 0 ? ' top' : ''}${idea.progress === 'done' ? ' done' : ''}">
    <h3>${escapeHtml(idea.title)}${topBadge}${catBadge}${progressBadge}</h3>
    ${image}
    ${idea.description ? `<p class="desc">${escapeHtml(idea.description)}</p>` : ''}
    <p class="meta">מאת: ${escapeHtml(idea.author)} · ${new Date(idea.createdAt).toLocaleDateString('he-IL')}</p>
    ${votes}
  </div>`;
}

async function loadCategories() {
  const cats = await fetch('/api/categories').then((r) => r.json());
  categorySelect.innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join('');
  filterBar.innerHTML = ['הכול', ...cats]
    .map((c) => `<button class="filter-btn${c === currentFilter ? ' active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join('');
}

async function loadIdeas() {
  const [ideas, review] = await Promise.all([
    fetch('/api/ideas?category=' + encodeURIComponent(currentFilter)).then((r) => r.json()),
    fetch('/api/review').then((r) => r.json()),
  ]);
  ideasList.innerHTML = ideas.map((i, idx) => renderCard(i, idx, true)).join('');
  emptyMsg.hidden = ideas.length > 0;
  reviewList.innerHTML = review.map((i, idx) => renderCard(i, idx, false)).join('');
  reviewEmpty.hidden = review.length > 0;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: document.getElementById('title').value,
      description: document.getElementById('description').value,
      author: document.getElementById('author').value,
      category: categorySelect.value,
    }),
  });
  if (res.ok) {
    form.reset();
    loadIdeas();
  } else {
    const err = await res.json();
    alert(err.error || 'שגיאה בפרסום הרעיון');
  }
});

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  currentFilter = btn.dataset.cat;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
  loadIdeas();
});

ideasList.addEventListener('click', async (e) => {
  const voteBtn = e.target.closest('.vote-btn');
  if (voteBtn && !voteBtn.disabled) {
    const res = await fetch(`/api/ideas/${voteBtn.dataset.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: voteBtn.dataset.type, voter: getVoterId() }),
    });
    if (res.ok) {
      markVoted(voteBtn.dataset.id, voteBtn.dataset.type);
    } else {
      const err = await res.json();
      if (res.status === 409) markVoted(voteBtn.dataset.id, 'unknown');
      alert(err.error || 'שגיאה בהצבעה');
    }
    loadIdeas();
    return;
  }
  const takeBtn = e.target.closest('.take-btn');
  if (takeBtn) {
    const name = prompt('מה השם שלך? (יוצג ליד הפרויקט)');
    if (!name || !name.trim()) return;
    const res = await fetch(`/api/ideas/${takeBtn.dataset.id}/take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'שגיאה');
    }
    loadIdeas();
    return;
  }
  const doneBtn = e.target.closest('.done-btn');
  if (doneBtn) {
    if (!confirm('לסמן את הפרויקט כבוצע?')) return;
    const res = await fetch(`/api/ideas/${doneBtn.dataset.id}/done`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'שגיאה');
    }
    loadIdeas();
  }
});

getVoterId();
loadCategories().then(loadIdeas);
setInterval(loadIdeas, 10000);
