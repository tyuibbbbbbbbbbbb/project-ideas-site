const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const adminList = document.getElementById('admin-list');
const adminEmpty = document.getElementById('admin-empty');
const toast = document.getElementById('toast');

let password = sessionStorage.getItem('adminPassword') || '';
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
  return `<div class="admin-card" data-id="${idea.id}">
    <div class="admin-card-title">${escapeAttr(idea.title)}</div>
    <input class="f-title form-control" value="${escapeAttr(idea.title)}" placeholder="כותרת" />
    <textarea class="f-description form-control" placeholder="תיאור">${escapeAttr(idea.description)}</textarea>
    <div class="admin-grid">
      <input class="f-author form-control" value="${escapeAttr(idea.author)}" placeholder="מאת" />
      <select class="f-category form-control">${catOptions}</select>
      <select class="f-progress form-control">${progOptions}</select>
      <input class="f-takenBy form-control" value="${escapeAttr(idea.takenBy || '')}" placeholder="נלקח ע"י" />
      <select class="f-status form-control">${statusOptions}</select>
      <input class="f-likes form-control" type="number" min="0" value="${idea.likes}" title="לייקים" />
      <input class="f-dislikes form-control" type="number" min="0" value="${idea.dislikes}" title="דיסלייקים" />
      <input class="f-imageUrl form-control" value="${escapeAttr(idea.imageUrl || '')}" placeholder="קישור לתמונה (ריק = בלי תמונה)" />
    </div>
    <p class="idea-card-meta">נוצר: ${new Date(idea.createdAt).toLocaleString('he-IL')} · 👍 ${idea.likes} · 👎 ${idea.dislikes}</p>
    <div class="admin-actions">
      <button class="btn btn-save save-btn">💾 שמור</button>
      <button class="btn btn-delete del-btn">🗑️ מחק</button>
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
  adminEmpty.classList.toggle('hidden', ideas.length > 0);
  loginSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
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
    showToast('סיסמה שגויה');
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

if (password) loadAdmin();
