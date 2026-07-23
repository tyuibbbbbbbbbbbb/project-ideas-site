// ── Animated emojis (Noto Emoji Animation) ──────────────
const EMOJI = {
  bulb: '1f4a1',        // 💡
  plus: '2795',         // ➕
  trophy: '1f3c6',      // 🏆
  green: '1f49a',       // 💚 (alt for 🟢)
  hammer: '1f4aa',      // 💪 (alt for 🔨)
  check: '2705',        // ✅
  raise: '1f64c',       // 🙌 (alt for 🙋)
  wave: '1f44b',        // 👋 (alt for 🚪)
  thumbsup: '1f44d',    // 👍
  smile: '1f642',       // 🙂
  thumbsdown: '1f44e',  // 👎
  speech: '1f4ac',      // 💬
  clip: '1f4e3',        // 📣 (alt for 📎)
  palette: '2728',      // ✨ (alt for 🎨)
  rocket: '1f680',      // 🚀
  party: '1f389',       // 🎉
  hourglass: '23f3',    // ⏳
  trash: '1f5d1_fe0f',  // 🗑️
  pencil: '270f_fe0f',  // ✏️
  chart: '1f4ca',       // 📊
  floppy: '1f4bf',      // 💿 (alt for 💾)
  eye: '1f441_fe0f',    // 👁️
  monkey: '1f648',      // 🙈
};

function emoji(name, size) {
  const code = EMOJI[name];
  if (!code) return '';
  const s = size || 16;
  return `<img src="https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp" alt="${name}" class="emoji-anim" width="${s}" height="${s}" loading="lazy" />`;
}

// ── State ───────────────────────────────────────────────
let currentUser = null;
let categories = [];
let currentFilter = 'הכול';
let currentSort = 'top';
let currentIdea = null; // for project detail modal

// ── DOM refs ────────────────────────────────────────────
const ideasList = document.getElementById('ideas-list');
const emptyMsg = document.getElementById('empty-msg');
const form = document.getElementById('idea-form');
const ideaModal = document.getElementById('idea-modal');
const toggleFormBtn = document.getElementById('toggle-idea-form');
const categorySelect = document.getElementById('category');
const filterBar = document.getElementById('filter-bar');
const searchInput = document.getElementById('search');
const sortSelect = document.getElementById('sort');
const toast = document.getElementById('toast');
const authArea = document.getElementById('auth-area');
const authModal = document.getElementById('auth-modal');
const projectModal = document.getElementById('project-modal');
const projectDetail = document.getElementById('project-detail');

// ── Utils ───────────────────────────────────────────────
function getVoterId() {
  let id = localStorage.getItem('voterId');
  if (!id) {
    id = 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('voterId', id);
  }
  return id;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

const PROGRESS_LABELS = {
  open: emoji('green', 12) + ' פתוח',
  taken: emoji('hammer', 12) + ' לקחתי על עצמי',
  done: emoji('check', 12) + ' יש הצלחתי',
};

// ── Auth ────────────────────────────────────────────────
async function loadCurrentUser() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  currentUser = await res.json();
  renderAuthArea();
}

function renderAuthArea() {
  if (currentUser) {
    authArea.innerHTML = `
      <span class="user-greeting">שלום, ${escapeHtml(currentUser.username)}</span>
      <button class="btn btn-sm btn-outline" id="logout-btn">התנתק</button>
    `;
    document.getElementById('logout-btn').addEventListener('click', logout);
  } else {
    authArea.innerHTML = `<button class="btn btn-sm btn-outline" id="login-btn">התחבר / הירשם</button>`;
    document.getElementById('login-btn').addEventListener('click', () => authModal.classList.remove('hidden'));
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  renderAuthArea();
  showToast('התנתקת');
  loadIdeas();
}

// Auth modal tabs
document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
  });
});

document.getElementById('auth-close').addEventListener('click', () => authModal.classList.add('hidden'));
document.querySelector('#auth-modal .modal-overlay').addEventListener('click', () => authModal.classList.add('hidden'));

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const remember = document.getElementById('login-remember')?.checked;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      username: document.getElementById('login-username').value,
      password: document.getElementById('login-password').value,
      remember: !!remember,
    }),
  });
  if (res.ok) {
    authModal.classList.add('hidden');
    await loadCurrentUser();
    showToast('התחברת בהצלחה!');
    loadIdeas();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה');
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('reg-password').value;
  const passwordConfirm = document.getElementById('reg-password-confirm').value;
  if (password !== passwordConfirm) {
    showToast('הסיסמאות אינן תואמות');
    return;
  }
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      username: document.getElementById('reg-username').value,
      password: document.getElementById('reg-password').value,
    }),
  });
  if (res.ok) {
    authModal.classList.add('hidden');
    await loadCurrentUser();
    showToast('נרשמת בהצלחה!');
    loadIdeas();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה');
  }
});

// Toggle password visibility
document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.innerHTML = emoji('eye', 18);
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.innerHTML = showing ? emoji('eye', 18) : emoji('monkey', 18);
    btn.setAttribute('aria-label', showing ? 'הצג סיסמה' : 'הסתר סיסמה');
  });
});

// ── Toggle add idea form ────────────────────────────────
toggleFormBtn.addEventListener('click', () => {
  if (!currentUser) {
    showToast('יש להתחבר כדי להעלות רעיון');
    authModal.classList.remove('hidden');
    return;
  }
  ideaModal.classList.remove('hidden');
});

document.getElementById('idea-close').addEventListener('click', () => ideaModal.classList.add('hidden'));
document.querySelector('#idea-modal .modal-overlay').addEventListener('click', () => ideaModal.classList.add('hidden'));

// ── Idea cards ──────────────────────────────────────────
function renderCard(idea, isTop) {
  const topBadge = isTop ? `<span class="badge badge-top">${emoji('trophy', 12)} הכי פופולרי</span>` : '';
  const progressBadge = idea.progress !== 'open'
    ? `<span class="badge badge-progress-${idea.progress}">${PROGRESS_LABELS[idea.progress] || ''}${idea.taken_by ? ' · ' + escapeHtml(idea.taken_by) : ''}</span>`
    : '';
  const catBadge = `<span class="badge badge-cat">${escapeHtml(idea.category || 'אחר')}</span>`;
  const voted = idea.myVote;
  const score = (idea.likes || 0) + (idea.nice || 0) - (idea.dislikes || 0);
  const totalVotes = (idea.likes || 0) + (idea.nice || 0) + (idea.dislikes || 0);
  const stats = voted && totalVotes > 0
    ? `<div class="vote-stats">
         <div class="stat-pcts">${emoji('thumbsup', 14)} ${Math.round((idea.likes / totalVotes) * 100)}% · ${emoji('smile', 14)} ${Math.round((idea.nice / totalVotes) * 100)}% · ${emoji('thumbsdown', 14)} ${Math.round((idea.dislikes / totalVotes) * 100)}%</div>
         <div class="stat-bar">
           <div class="stat-seg like" style="width:${(idea.likes / totalVotes) * 100}%"></div>
           <div class="stat-seg nice" style="width:${(idea.nice / totalVotes) * 100}%"></div>
           <div class="stat-seg dislike" style="width:${(idea.dislikes / totalVotes) * 100}%"></div>
         </div>
       </div>`
    : '';
  const forumLinkHtml = idea.progress === 'done' && idea.forum_link
    ? `<a class="forum-link" href="${escapeHtml(idea.forum_link)}" target="_blank" rel="noopener">${emoji('clip', 14)} פוסט בפורום מתמחים טופ</a>`
    : '';
  const image = idea.image_url
    ? `<img class="idea-card-image" src="${escapeHtml(idea.image_url)}" alt="הדמיה של הרעיון" loading="lazy" onerror="this.remove()" />`
    : '';
  const cardClass = ['idea-card', 'clickable', isTop ? 'top' : '', idea.progress === 'done' ? 'done' : ''].filter(Boolean).join(' ');
  const actionButtons = [
    idea.progress === 'open' && currentUser ? `<button class="action-btn take-btn" data-id="${escapeAttr(idea.id)}" title="לקחתי על עצמי">${emoji('raise', 16)} לקחתי על עצמי</button>` : '',
    idea.progress === 'taken' && currentUser && idea.taken_by_user_id === currentUser.id ? `<button class="action-btn done-btn" data-id="${escapeAttr(idea.id)}" title="יש הצלחתי">${emoji('check', 16)} יש הצלחתי</button>` : '',
    idea.progress === 'taken' && currentUser && idea.taken_by_user_id === currentUser.id ? `<button class="action-btn leave-btn" data-id="${escapeAttr(idea.id)}" title="פרשתי">${emoji('wave', 16)} פרשתי</button>` : '',
  ].filter(Boolean).join('');
  const actionBar = actionButtons ? `<div class="idea-action-bar">${actionButtons}</div>` : '';
  return `<div class="${cardClass}" data-id="${escapeAttr(idea.id)}">
    ${image}
    <div class="idea-card-body">
      <div class="idea-card-header">
        <h3 class="idea-card-title">${escapeHtml(idea.title)}</h3>
        ${progressBadge}
      </div>
      <div>${topBadge}${catBadge}</div>
      ${idea.description ? `<p class="idea-card-desc">${escapeHtml(idea.description)}</p>` : ''}
      ${forumLinkHtml}
      <p class="idea-card-meta">מאת: ${escapeHtml(idea.author || 'אנונימי')} · ${new Date(idea.created_at).toLocaleDateString('he-IL')}</p>
      <div class="idea-card-footer">
        <button class="vote-btn like${voted === 'like' ? ' voted' : ''}" data-id="${escapeAttr(idea.id)}" data-type="like" ${voted ? 'disabled' : ''}>${emoji('thumbsup', 16)} ${idea.likes || 0}</button>
        <button class="vote-btn nice${voted === 'nice' ? ' voted' : ''}" data-id="${escapeAttr(idea.id)}" data-type="nice" ${voted ? 'disabled' : ''}>${emoji('smile', 16)} ${idea.nice || 0}</button>
        <button class="vote-btn dislike${voted === 'dislike' ? ' voted' : ''}" data-id="${escapeAttr(idea.id)}" data-type="dislike" ${voted ? 'disabled' : ''}>${emoji('thumbsdown', 16)} ${idea.dislikes || 0}</button>
        <span class="score">ניקוד: ${score}</span>
      </div>
      ${stats}
      ${actionBar}
      <div class="idea-card-footer" style="margin-top:4px">
        <span class="comments-link" data-id="${escapeAttr(idea.id)}">${emoji('speech', 14)} לחץ לדיון ופרטים נוספים</span>
      </div>
    </div>
  </div>`;
}

async function loadCategories() {
  const cats = await fetch('/api/categories').then((r) => r.json());
  categories = cats;
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
  const ideas = await fetch('/api/ideas?' + params.toString(), { credentials: 'include' }).then((r) => r.json());
  const isSortedByTop = currentSort === 'top';
  const isTop = (i) => isSortedByTop && !searchInput.value.trim() && ideas[0] && ideas[0].id === i.id;
  ideasList.innerHTML = ideas.map((i) => renderCard(i, isTop(i))).join('');
  emptyMsg.classList.toggle('hidden', ideas.length > 0);
}

// ── Submit idea ─────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { showToast('יש להתחבר כדי להעלות רעיון'); return; }
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'שולח...';
  const res = await fetch('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      title: document.getElementById('title').value,
      description: document.getElementById('description').value,
      category: categorySelect.value,
    }),
  });
  submitBtn.disabled = false;
  submitBtn.textContent = 'פרסם רעיון ' + emoji('rocket', 16);
  if (res.ok) {
    form.reset();
    ideaModal.classList.add('hidden');
    showToast('הרעיון פורסם בהצלחה! ' + emoji('party', 16));
    loadIdeas();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה בפרסום הרעיון');
  }
});

// ── Filters ─────────────────────────────────────────────
filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentFilter = btn.dataset.cat;
  document.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b === btn));
  loadIdeas();
});

searchInput.addEventListener('input', debounce(loadIdeas, 250));
sortSelect.addEventListener('change', () => { currentSort = sortSelect.value; loadIdeas(); });

// ── Card actions (vote, take, done, leave, abandon, open detail) ──
ideasList.addEventListener('click', async (e) => {
  // Open project detail when clicking the card itself (not buttons)
  const commentsLink = e.target.closest('.comments-link');
  const card = e.target.closest('.idea-card');
  if (commentsLink || (card && !e.target.closest('button') && !e.target.closest('a'))) {
    if (card) openProjectDetail(card.dataset.id);
    return;
  }

  const voteBtn = e.target.closest('.vote-btn');
  if (voteBtn && !voteBtn.disabled) {
    const res = await fetch(`/api/ideas/${voteBtn.dataset.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: voteBtn.dataset.type, voter: getVoterId() }),
    });
    if (res.ok) showToast('הצבעת נרשמה!');
    else { const err = await res.json(); showToast(err.error || 'שגיאה בהצבעה'); }
    loadIdeas();
    return;
  }

  const takeBtn = e.target.closest('.take-btn');
  if (takeBtn) {
    if (!currentUser) { showToast('יש להתחבר כדי לקחת פרויקט'); return; }
    const name = currentUser.username;
    const res = await fetch(`/api/ideas/${takeBtn.dataset.id}/take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    if (res.ok) showToast('הפרויקט נלקח בהצלחה!');
    else { const err = await res.json(); showToast(err.error || 'שגיאה'); }
    loadIdeas();
    return;
  }

  const doneBtn = e.target.closest('.done-btn');
  if (doneBtn) {
    const forumLink = prompt('הדבק קישור לפוסט בפורום מתמחים טופ שמסביר על הפרויקט שבוצע:');
    if (!forumLink || !forumLink.trim()) { showToast('חובה לצרף קישור לפוסט'); return; }
    if (!/^https?:\/\/[^\s]*mitmachim\.top[^\s]*$/i.test(forumLink.trim())) { showToast('הקישור חייב להיות מאתר מתמחים טופ'); return; }
    const res = await fetch(`/api/ideas/${doneBtn.dataset.id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ forumLink: forumLink.trim() }),
    });
    if (res.ok) showToast('הפרויקט סומן כבוצע! ' + emoji('party', 16));
    else { const err = await res.json(); showToast(err.error || 'שגיאה'); }
    loadIdeas();
    return;
  }

  const leaveBtn = e.target.closest('.leave-btn');
  if (leaveBtn) {
    if (!confirm('לפרוש מהפרויקט? הוא יחזור להיות פתוח.')) return;
    const res = await fetch(`/api/ideas/${leaveBtn.dataset.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (res.ok) showToast('פרשת מהפרויקט');
    else { const err = await res.json(); showToast(err.error || 'שגיאה'); }
    loadIdeas();
    return;
  }

});

// ── Project detail modal ────────────────────────────────
document.getElementById('project-close').addEventListener('click', () => projectModal.classList.add('hidden'));
document.querySelector('#project-modal .modal-overlay').addEventListener('click', () => projectModal.classList.add('hidden'));

async function openProjectDetail(id) {
  projectModal.classList.remove('hidden');
  projectDetail.innerHTML = '<div class="empty-state"><div class="empty-state-icon">' + emoji('hourglass', 32) + '</div><p>טוען...</p></div>';
  const [ideaRes, commentsRes, reportsRes] = await Promise.all([
    fetch(`/api/ideas/${id}`, { credentials: 'include' }).then((r) => r.json()),
    fetch(`/api/ideas/${id}/comments`, { credentials: 'include' }).then((r) => r.json()),
    fetch(`/api/ideas/${id}/reports`, { credentials: 'include' }).then((r) => r.json()),
  ]);
  currentIdea = ideaRes;
  renderProjectDetail(ideaRes, commentsRes, reportsRes);
}

function renderProjectDetail(idea, comments, reports) {
  const canEdit = currentUser && idea.user_id === currentUser.id;
  const progressBadge = idea.progress !== 'open'
    ? `<span class="badge badge-progress-${idea.progress}">${PROGRESS_LABELS[idea.progress] || ''}${idea.taken_by ? ' · ' + escapeHtml(idea.taken_by) : ''}</span>`
    : '';
  const forumLinkHtml = idea.progress === 'done' && idea.forum_link
    ? `<a class="forum-link" href="${escapeHtml(idea.forum_link)}" target="_blank" rel="noopener">${emoji('clip', 14)} פוסט בפורום מתמחים טופ</a>`
    : '';
  const image = idea.image_url
    ? `<img class="project-detail-image" src="${escapeHtml(idea.image_url)}" alt="הדמיה" onerror="this.remove()" />`
    : '';

  function renderItemActions(item, type) {
    const myVote = item.myVote;
    const votedClass = (t) => myVote === t ? ' voted' : '';
    return `<div class="item-votes">
      <button class="vote-btn item-like${votedClass('like')}" data-type="like" data-kind="${type}" data-id="${item.id}" ${myVote ? 'disabled' : ''}>${emoji('thumbsup', 16)} ${item.likes || 0}</button>
      <button class="vote-btn item-dislike${votedClass('dislike')}" data-type="dislike" data-kind="${type}" data-id="${item.id}" ${myVote ? 'disabled' : ''}>${emoji('thumbsdown', 16)} ${item.dislikes || 0}</button>
    </div>`;
  }

  const commentsHtml = comments.length > 0
    ? comments.map((c) => `
        <div class="comment" data-id="${c.id}">
          <div class="comment-header">
            <strong>${escapeHtml(c.username)}</strong>
            <span class="comment-date">${new Date(c.created_at).toLocaleString('he-IL')}</span>
            ${currentUser && (c.user_id === currentUser.id) ? `<button class="comment-delete" data-comment-id="${c.id}">${emoji('trash', 16)}</button>` : ''}
          </div>
          <div class="comment-content">${escapeHtml(c.content)}</div>
          ${renderItemActions(c, 'comment')}
        </div>
      `).join('')
    : '<p class="text-muted">אין עדיין תגובות. היה הראשון להגיב!</p>';

  const reportsHtml = reports.length > 0
    ? reports.map((r) => `
        <div class="report" data-id="${r.id}">
          <div class="report-header">
            <strong>${escapeHtml(r.username)}</strong>
            <span class="comment-date">${new Date(r.created_at).toLocaleString('he-IL')}</span>
            ${currentUser && (r.user_id === currentUser.id) ? `<button class="comment-delete" data-report-id="${r.id}">${emoji('trash', 16)}</button>` : ''}
          </div>
          <div class="comment-content">${escapeHtml(r.content)}</div>
          ${renderItemActions(r, 'report')}
        </div>
      `).join('')
    : '<p class="text-muted">אין עדיין דיווחי התקדמות.</p>';

  const canReport = currentUser && idea.taken_by_user_id === currentUser.id;
  const commentForm = currentUser
    ? `<form class="comment-form" id="comment-form">
        <textarea id="comment-text" class="form-control" placeholder="כתוב תגובה..." required></textarea>
        <button type="submit" class="btn btn-primary btn-sm">פרסם תגובה</button>
      </form>`
    : '<p class="text-muted">יש להתחבר כדי להגיב</p>';

  const reportForm = canReport
    ? `<form class="comment-form" id="report-form">
        <textarea id="report-text" class="form-control" placeholder="דווח על התקדמות הפרויקט..." required></textarea>
        <button type="submit" class="btn btn-primary btn-sm">פרסם דיווח</button>
      </form>`
    : '<p class="text-muted">רק מי שלקח על עצמו את הפרויקט יכול לפרסם דיווח התקדמות</p>';

  const editBtn = canEdit ? `<button class="btn btn-sm btn-outline" id="edit-idea-btn">${emoji('pencil', 14)} ערוך רעיון</button>` : '';
  const deleteBtn = canEdit ? `<button class="btn btn-sm btn-delete" id="delete-idea-btn">${emoji('trash', 14)} מחק רעיון</button>` : '';

  projectDetail.innerHTML = `
    ${image}
    <h2 class="project-detail-title">${escapeHtml(idea.title)}</h2>
    <div class="project-detail-badges">
      <span class="badge badge-cat">${escapeHtml(idea.category || 'אחר')}</span>
      ${progressBadge}
    </div>
    ${idea.description ? `<p class="project-detail-desc">${escapeHtml(idea.description)}</p>` : ''}
    ${forumLinkHtml}
    <p class="idea-card-meta">מאת: ${escapeHtml(idea.author || 'אנונימי')} · ${new Date(idea.created_at).toLocaleDateString('he-IL')}</p>
    <div class="project-detail-actions">${editBtn}${deleteBtn}</div>

    <div class="detail-section">
      <h3 class="detail-section-title">${emoji('chart', 18)} דיווחי התקדמות</h3>
      <div id="reports-list">${reportsHtml}</div>
      ${reportForm}
    </div>

    <div class="detail-section">
      <h3 class="detail-section-title">${emoji('speech', 18)} דיון</h3>
      <div id="comments-list">${commentsHtml}</div>
      ${commentForm}
    </div>
  `;

  // Wire up forms
  const cForm = document.getElementById('comment-form');
  if (cForm) {
    cForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('comment-text').value.trim();
      if (!text) return;
      const res = await fetch(`/api/ideas/${idea.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        openProjectDetail(idea.id);
      } else {
        const err = await res.json();
        showToast(err.error || 'שגיאה');
      }
    });
  }

  const rForm = document.getElementById('report-form');
  if (rForm) {
    rForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = document.getElementById('report-text').value.trim();
      if (!text) return;
      const res = await fetch(`/api/ideas/${idea.id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        openProjectDetail(idea.id);
      } else {
        const err = await res.json();
        showToast(err.error || 'שגיאה');
      }
    });
  }

  // Delete comment/report
  projectDetail.querySelectorAll('[data-comment-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק תגובה?')) return;
      const res = await fetch(`/api/ideas/${idea.id}/comments/${btn.dataset.commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) openProjectDetail(idea.id);
      else { const err = await res.json(); showToast(err.error || 'שגיאה'); }
    });
  });

  projectDetail.querySelectorAll('[data-report-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('למחוק דיווח?')) return;
      const res = await fetch(`/api/ideas/${idea.id}/reports/${btn.dataset.reportId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) openProjectDetail(idea.id);
      else { const err = await res.json(); showToast(err.error || 'שגיאה'); }
    });
  });

  // Vote on comments/reports
  projectDetail.querySelectorAll('.item-votes .vote-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.kind;
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const endpoint = kind === 'comment' ? `/api/comments/${id}/vote` : `/api/reports/${id}/vote`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, voter: getVoterId() }),
      });
      if (res.ok) {
        showToast(type === 'like' ? 'לייק נרשם!' : 'דיסלייק נרשם ויועבר למנהלים');
        openProjectDetail(idea.id);
      } else {
        const err = await res.json();
        showToast(err.error || 'שגיאה');
      }
    });
  });

  // Edit idea
  const editBtnEl = document.getElementById('edit-idea-btn');
  if (editBtnEl) {
    editBtnEl.addEventListener('click', () => showEditForm(idea));
  }

  // Delete idea
  const delBtnEl = document.getElementById('delete-idea-btn');
  if (delBtnEl) {
    delBtnEl.addEventListener('click', async () => {
      if (!confirm('למחוק את הרעיון לצמיתות?')) return;
      const res = await fetch(`/api/ideas/${idea.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        projectModal.classList.add('hidden');
        showToast('הרעיון נמחק');
        loadIdeas();
      } else {
        const err = await res.json();
        showToast(err.error || 'שגיאה');
      }
    });
  }
}

function showEditForm(idea) {
  projectDetail.innerHTML = `
    <h2 class="card-title">עריכת רעיון</h2>
    <form id="edit-form" class="idea-form">
      <div class="form-group">
        <label>כותרת</label>
        <input type="text" id="edit-title" class="form-control" value="${escapeAttr(idea.title)}" required />
      </div>
      <div class="form-group">
        <label>תיאור</label>
        <textarea id="edit-description" class="form-control">${escapeAttr(idea.description)}</textarea>
      </div>
      <div class="form-group">
        <label>קטגוריה</label>
        <select id="edit-category" class="form-control">
          ${categories.map((c) => `<option value="${escapeHtml(c)}"${c === idea.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="admin-actions">
        <button type="submit" class="btn btn-save">${emoji('floppy', 16)} שמור</button>
        <button type="button" class="btn btn-outline" id="edit-cancel">ביטול</button>
      </div>
    </form>
  `;
  document.getElementById('edit-cancel').addEventListener('click', () => openProjectDetail(idea.id));
  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch(`/api/ideas/${idea.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        title: document.getElementById('edit-title').value,
        description: document.getElementById('edit-description').value,
        category: document.getElementById('edit-category').value,
      }),
    });
    if (res.ok) {
      showToast('הרעיון עודכן');
      openProjectDetail(idea.id);
      loadIdeas();
    } else {
      const err = await res.json();
      showToast(err.error || 'שגיאה');
    }
  });
}

// ── Init ────────────────────────────────────────────────
getVoterId();
loadCurrentUser().then(() => loadCategories().then(loadIdeas));
setInterval(loadIdeas, 30000);
