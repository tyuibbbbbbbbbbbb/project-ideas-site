const ideasList = document.getElementById('ideas-list');
const reviewList = document.getElementById('review-list');
const emptyMsg = document.getElementById('empty-msg');
const reviewEmpty = document.getElementById('review-empty');
const form = document.getElementById('idea-form');
const categorySelect = document.getElementById('category');
const filterBar = document.getElementById('filter-bar');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort');
const toast = document.getElementById('toast');

let currentFilter = 'הכול';
let currentSort = 'top';

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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

const PROGRESS_LABELS = {
  open: '',
  taken: '🔨 נלקח',
  done: '✅ בוצע',
};

function renderCard(idea, index, withVotes, isTop) {
  const topBadge = isTop ? '<span class="badge badge-top">🏆 הכי פופולרי</span>' : '';
  const progressBadge = idea.progress !== 'open'
    ? `<span class="badge badge-progress-${idea.progress}">${PROGRESS_LABELS[idea.progress]}${idea.takenBy ? ' · ' + escapeHtml(idea.takenBy) : ''}</span>`
    : '';
  const catBadge = `<span class="badge badge-cat">${escapeHtml(idea.category || 'אחר')}</span>`;
  const voted = votedIdeas()[idea.id];
  const score = idea.likes - idea.dislikes;
  const votes = withVotes
    ? `<div class="idea-card-footer">
        <button class="vote-btn like${voted === 'like' ? ' voted' : ''}" data-id="${idea.id}" data-type="like" ${voted ? 'disabled' : ''}>👍 ${idea.likes}</button>
        <button class="vote-btn dislike${voted === 'dislike' ? ' voted' : ''}" data-id="${idea.id}" data-type="dislike" ${voted ? 'disabled' : ''}>👎 ${idea.dislikes}</button>
        <span class="score">ניקוד: ${score}</span>
      </div>
      <div class="idea-actions">
        ${idea.progress === 'open' ? `<button class="take-btn" data-id="${idea.id}">🙋 אני לוקח את הפרויקט</button>` : ''}
        ${idea.progress === 'taken' ? `<button class="done-btn" data-id="${idea.id}">✅ סמן כבוצע</button>` : ''}
      </div>`
    : `<div class="idea-card-footer"><span>👍 ${idea.likes} · 👎 ${idea.dislikes}</span></div>`;
  const image = idea.imageUrl
    ? `<img class="idea-card-image" src="${escapeHtml(idea.imageUrl)}" alt="הדמיה של הרעיון" loading="lazy" onerror="this.remove()" />`
    : '';
  const cardClass = ['idea-card', isTop ? 'top' : '', idea.progress === 'done' ? 'done' : ''].filter(Boolean).join(' ');
  return `<div class="${cardClass}">
    ${image}
    <div class="idea-card-body">
      <div class="idea-card-header">
        <h3 class="idea-card-title">${escapeHtml(idea.title)}</h3>
      </div>
      <div>${topBadge}${catBadge}${progressBadge}</div>
      ${idea.description ? `<p class="idea-card-desc">${escapeHtml(idea.description)}</p>` : ''}
      <p class="idea-card-meta">מאת: ${escapeHtml(idea.author || 'אנונימי')} · ${new Date(idea.createdAt).toLocaleDateString('he-IL')}</p>
      ${votes}
    </div>
  </div>`;
}

async function loadCategories() {
  const cats = await fetch('/api/categories').then((r) => r.json());
  categorySelect.innerHTML = cats
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join('');
  filterBar.innerHTML = ['הכול', ...cats]
    .map((c) => `<button class="chip${c === currentFilter ? ' active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join('');
}

async function loadIdeas() {
  const params = new URLSearchParams();
  if (currentFilter !== 'הכול') params.set('category', currentFilter);
  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
  if (currentSort) params.set('sort', currentSort);

  const [ideas, review] = await Promise.all([
    fetch('/api/ideas?' + params.toString()).then((r) => r.json()),
    fetch('/api/review').then((r) => r.json()),
  ]);

  const isSortedByTop = currentSort === 'top';
  const isTop = (i) => isSortedByTop && !searchInput.value.trim() && ideas[0] && ideas[0].id === i.id;

  ideasList.innerHTML = ideas.map((i, idx) => renderCard(i, idx, true, isTop(i))).join('');
  emptyMsg.classList.toggle('hidden', ideas.length > 0);
  reviewList.innerHTML = review.map((i, idx) => renderCard(i, idx, false, false)).join('');
  reviewEmpty.classList.toggle('hidden', review.length > 0);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'שולח...';
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
  submitBtn.disabled = false;
  submitBtn.textContent = 'פרסם רעיון 🚀';
  if (res.ok) {
    form.reset();
    showToast('הרעיון פורסם בהצלחה! 🎉');
    loadIdeas();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה בפרסום הרעיון');
  }
});

filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentFilter = btn.dataset.cat;
  document.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b === btn));
  loadIdeas();
});

searchInput.addEventListener('input', debounce(loadIdeas, 250));

sortSelect.addEventListener('change', () => {
  currentSort = sortSelect.value;
  loadIdeas();
});

function debounce(fn, ms) {
  let timeout;
  return () => {
    clearTimeout(timeout);
    timeout = setTimeout(fn, ms);
  };
}

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
      showToast('הצבעת נרשמה!');
    } else {
      const err = await res.json();
      if (res.status === 409) markVoted(voteBtn.dataset.id, 'unknown');
      showToast(err.error || 'שגיאה בהצבעה');
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
    if (res.ok) {
      showToast('הפרויקט נלקח בהצלחה!');
    } else {
      const err = await res.json();
      showToast(err.error || 'שגיאה');
    }
    loadIdeas();
    return;
  }
  const doneBtn = e.target.closest('.done-btn');
  if (doneBtn) {
    if (!confirm('לסמן את הפרויקט כבוצע?')) return;
    const res = await fetch(`/api/ideas/${doneBtn.dataset.id}/done`, { method: 'POST' });
    if (res.ok) {
      showToast('הפרויקט סומן כבוצע! 🎉');
    } else {
      const err = await res.json();
      showToast(err.error || 'שגיאה');
    }
    loadIdeas();
  }
});

getVoterId();
loadCategories().then(loadIdeas);
setInterval(loadIdeas, 30000);
