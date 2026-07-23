const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const adminList = document.getElementById('admin-list');
const adminEmpty = document.getElementById('admin-empty');
const usersList = document.getElementById('users-list');
const flagsList = document.getElementById('flags-list');
const toast = document.getElementById('toast');

let categories = [];

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

const PROGRESS_OPTIONS = [
  ['open', 'פתוח'],
  ['taken', 'נלקח'],
  ['done', 'בוצע'],
];
const STATUS_OPTIONS = [
  ['active', 'פעיל'],
  ['review', 'בבדיקה'],
];

function renderAdminCard(idea) {
  const catOptions = categories
    .map((c) => `<option value="${escapeAttr(c)}"${c === idea.category ? ' selected' : ''}>${escapeAttr(c)}</option>`)
    .join('');
  const progOptions = PROGRESS_OPTIONS
    .map(([v, l]) => `<option value="${v}"${v === idea.progress ? ' selected' : ''}>${l}</option>`)
    .join('');
  const statusOptions = STATUS_OPTIONS
    .map(([v, l]) => `<option value="${v}"${v === idea.status ? ' selected' : ''}>${l}</option>`)
    .join('');
  return `<div class="admin-card" data-id="${escapeAttr(idea.id)}">
    <div class="admin-card-title">${escapeAttr(idea.title)}</div>
    <input class="f-title form-control" value="${escapeAttr(idea.title)}" placeholder="כותרת" />
    <textarea class="f-description form-control" placeholder="תיאור">${escapeAttr(idea.description)}</textarea>
    <div class="admin-grid">
      <input class="f-author form-control" value="${escapeAttr(idea.author)}" placeholder="מאת" />
      <select class="f-category form-control">${catOptions}</select>
      <select class="f-progress form-control">${progOptions}</select>
      <input class="f-takenBy form-control" value="${escapeAttr(idea.taken_by || '')}" placeholder="נלקח ע"י" />
      <select class="f-status form-control">${statusOptions}</select>
      <input class="f-likes form-control" type="number" min="0" value="${idea.likes}" title="לייקים" />
      <input class="f-dislikes form-control" type="number" min="0" value="${idea.dislikes}" title="דיסלייקים" />
      <input class="f-nice form-control" type="number" min="0" value="${idea.nice}" title="נחמד" />
      <input class="f-forumLink form-control" value="${escapeAttr(idea.forum_link || '')}" placeholder="קישור לפורום" />
      <input class="f-imageUrl form-control" value="${escapeAttr(idea.image_url || '')}" placeholder="קישור לתמונה" />
    </div>
    <p class="idea-card-meta">נוצר: ${new Date(idea.created_at).toLocaleString('he-IL')} · 👍 ${idea.likes} · 👎 ${idea.dislikes} · 🙂 ${idea.nice}</p>
    <div class="admin-actions">
      <button class="btn btn-save save-btn">💾 שמור</button>
      <button class="btn btn-delete del-btn">🗑️ מחק</button>
    </div>
  </div>`;
}

function renderFlagCard(flag) {
  return `<div class="admin-card" data-flag-id="${flag.id}">
    <div class="admin-card-title">${escapeAttr(flag.reason)}${flag.idea_title ? ' · ' + escapeAttr(flag.idea_title) : ''}</div>
    <p class="idea-card-meta">על ידי: ${escapeAttr(flag.flagged_by || 'אנונימי')} · ${new Date(flag.created_at).toLocaleString('he-IL')}</p>
    <button class="btn btn-save resolve-flag-btn">✅ סמן כטופל</button>
  </div>`;
}

async function loadFlags() {
  const res = await api('/api/admin/flags');
  if (res.ok) {
    const flags = await res.json();
    flagsList.innerHTML = flags.length
      ? flags.map(renderFlagCard).join('')
      : '<p class="text-muted">אין דגלים ממתינים</p>';
  }
}

function renderUserCard(user) {
  return `<div class="admin-card">
    <div class="admin-card-title">${escapeAttr(user.username)}</div>
    <p class="idea-card-meta">נרשם: ${new Date(user.created_at).toLocaleString('he-IL')} · התחברות אחרונה: ${user.last_login ? new Date(user.last_login).toLocaleString('he-IL') : 'אין'}</p>
  </div>`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    location.reload();
    throw new Error('unauthorized');
  }
  return res;
}

async function loadAdmin() {
  categories = await fetch('/api/categories').then((r) => r.json());
  const res = await fetch('/api/admin/ideas', { credentials: 'include' });
  if (res.status === 401) {
    loginSection.classList.remove('hidden');
    adminSection.classList.add('hidden');
    return;
  }
  const ideas = await res.json();
  adminList.innerHTML = ideas.map(renderAdminCard).join('');
  adminEmpty.classList.toggle('hidden', ideas.length > 0);
  loginSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
}

async function loadUsers() {
  const res = await api('/api/admin/users');
  if (res.ok) {
    const users = await res.json();
    usersList.innerHTML = users.map(renderUserCard).join('');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    loadAdmin();
  } else {
    const err = await res.json();
    showToast(err.error || 'סיסמה שגויה');
  }
});

// Admin tabs
document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-ideas').classList.toggle('hidden', tab.dataset.tab !== 'ideas');
    document.getElementById('tab-users').classList.toggle('hidden', tab.dataset.tab !== 'users');
    document.getElementById('tab-flags').classList.toggle('hidden', tab.dataset.tab !== 'flags');
    document.getElementById('tab-settings').classList.toggle('hidden', tab.dataset.tab !== 'settings');
    if (tab.dataset.tab === 'users') loadUsers();
    if (tab.dataset.tab === 'flags') loadFlags();
  });
});

// Change password
document.getElementById('change-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({
      currentPassword: document.getElementById('current-pw').value,
      newPassword: document.getElementById('new-pw').value,
    }),
  });
  if (res.ok) {
    showToast('הסיסמה שונתה בהצלחה!');
    document.getElementById('change-pw-form').reset();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה');
  }
});

flagsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.resolve-flag-btn');
  if (!btn) return;
  const card = btn.closest('.admin-card');
  const id = card.dataset.flagId;
  const res = await api(`/api/admin/flags/${id}/resolve`, { method: 'POST' });
  if (res.ok) {
    showToast('הדגל סומן כטופל');
    loadFlags();
  } else {
    const err = await res.json();
    showToast(err.error || 'שגיאה');
  }
});

adminList.addEventListener('click', async (e) => {
  const card = e.target.closest('.admin-card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('.save-btn')) {
    const body = {
      title: card.querySelector('.f-title').value,
      description: card.querySelector('.f-description').value,
      author: card.querySelector('.f-author').value,
      category: card.querySelector('.f-category').value,
      progress: card.querySelector('.f-progress').value,
      takenBy: card.querySelector('.f-takenBy').value,
      status: card.querySelector('.f-status').value,
      likes: parseInt(card.querySelector('.f-likes').value, 10) || 0,
      dislikes: parseInt(card.querySelector('.f-dislikes').value, 10) || 0,
      nice: parseInt(card.querySelector('.f-nice').value, 10) || 0,
      forumLink: card.querySelector('.f-forumLink').value,
      imageUrl: card.querySelector('.f-imageUrl').value,
    };
    const res = await api(`/api/admin/ideas/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) {
      showToast('השינויים נשמרו בהצלחה');
      loadAdmin();
    } else {
      const err = await res.json();
      showToast(err.error || 'שגיאה בשמירה');
    }
  } else if (e.target.closest('.del-btn')) {
    if (!confirm('למחוק את הרעיון לצמיתות?')) return;
    const res = await api(`/api/admin/ideas/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('הרעיון נמחק');
      loadAdmin();
    } else {
      const err = await res.json();
      showToast(err.error || 'שגיאה במחיקה');
    }
  }
});

loadAdmin();
