const ideasList = document.getElementById('ideas-list');
const reviewList = document.getElementById('review-list');
const emptyMsg = document.getElementById('empty-msg');
const reviewEmpty = document.getElementById('review-empty');
const form = document.getElementById('idea-form');

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderCard(idea, index, withVotes) {
  const topBadge = withVotes && index === 0 ? '<span class="badge">🏆 הכי פופולרי</span>' : '';
  const votes = withVotes
    ? `<div class="votes">
        <button class="vote-btn like" data-id="${idea.id}" data-type="like">👍 ${idea.likes}</button>
        <button class="vote-btn dislike" data-id="${idea.id}" data-type="dislike">👎 ${idea.dislikes}</button>
        <span class="score">ניקוד: ${idea.likes - idea.dislikes}</span>
      </div>`
    : `<div class="votes"><span>👍 ${idea.likes} · 👎 ${idea.dislikes}</span></div>`;
  return `<div class="idea-card${withVotes && index === 0 ? ' top' : ''}">
    <h3>${escapeHtml(idea.title)}${topBadge}</h3>
    ${idea.description ? `<p class="desc">${escapeHtml(idea.description)}</p>` : ''}
    <p class="meta">מאת: ${escapeHtml(idea.author)} · ${new Date(idea.createdAt).toLocaleDateString('he-IL')}</p>
    ${votes}
  </div>`;
}

async function loadIdeas() {
  const [ideas, review] = await Promise.all([
    fetch('/api/ideas').then((r) => r.json()),
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

ideasList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.vote-btn');
  if (!btn) return;
  await fetch(`/api/ideas/${btn.dataset.id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: btn.dataset.type }),
  });
  loadIdeas();
});

loadIdeas();
setInterval(loadIdeas, 10000);
