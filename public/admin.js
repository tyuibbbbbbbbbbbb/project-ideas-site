const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const adminList = document.getElementById('admin-list');
const adminEmpty = document.getElementById('admin-empty');

let password = sessionStorage.getItem('adminPassword') || '';
let categories = [];

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
  return `<div class="admin-card" data-id="${idea.id}">
    <input class="f-title" value="${escapeAttr(idea.title)}" placeholder="כותרת" />
    <textarea class="f-description" placeholder="תיאור">${escapeAttr(idea.description)}</textarea>
    <div class="admin-row">
      <input class="f-author" value="${escapeAttr(idea.author)}" placeholder="מאת" />
      <select class="f-category">${catOptions}</select>
      <select class="f-progress">${progOptions}</select>
      <input class="f-takenBy" value="${escapeAttr(idea.takenBy || '')}" placeholder="נלקח ע&quot;י" />
    </div>
    <div class="admin-row">
      <select class="f-status">${statusOptions}</select>
      <input class="f-likes" type="number" min="0" value="${idea.likes}" title="לייקים" />
      <input class="f-dislikes" type="number" min="0" value="${idea.dislikes}" title="דיסלייקים" />
    </div>
    <input class="f-imageUrl" value="${escapeAttr(idea.imageUrl || '')}" placeholder="קישור לתמונה (ריק = בלי תמונה)" />
    <p class="small">נוצר: ${new Date(idea.createdAt).toLocaleString('he-IL')} · 👍 ${idea.likes} · 👎 ${idea.dislikes}</p>
    <div class="admin-actions">
      <button class="save-btn">💾 שמור</button>
      <button class="del-btn">🗑️ מחק</button>
    </div>
  </div>`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': password,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem('adminPassword');
    location.reload();
    throw new Error('unauthorized');
  }
  return res;
}

async function loadAdmin() {
  categories = await fetch('/api/categories').then((r) => r.json());
  const res = await api('/api/admin/ideas');
  const ideas = await res.json();
  adminList.innerHTML = ideas.map(renderAdminCard).join('');
  adminEmpty.hidden = ideas.length > 0;
  loginSection.hidden = true;
  adminSection.hidden = false;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    password = pw;
    sessionStorage.setItem('adminPassword', pw);
    loadAdmin();
  } else {
    alert('סיסמה שגויה');
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
      imageUrl: card.querySelector('.f-imageUrl').value,
    };
    const res = await api(`/api/admin/ideas/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.ok) {
      loadAdmin();
    } else {
      const err = await res.json();
      alert(err.error || 'שגיאה בשמירה');
    }
  } else if (e.target.closest('.del-btn')) {
    if (!confirm('למחוק את הרעיון לצמיתות?')) return;
    const res = await api(`/api/admin/ideas/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadAdmin();
    } else {
      const err = await res.json();
      alert(err.error || 'שגיאה במחיקה');
    }
  }
});

if (password) loadAdmin();
