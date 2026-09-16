/* ==========================================================================
   RepoDesk — app.js
   Sections: storage → auth → theme → helpers → icons → GitHub API →
             render: home/projects/news → settings (multi-page) → legal →
             install → handlers → boot
   ========================================================================== */

const DB_KEYS = {
  projects: 'repodesk.projects',
  settings: 'repodesk.settings',
  news: 'repodesk.news',
  newsMeta: 'repodesk.newsMeta',
  account: 'repodesk.account',
  session: 'repodesk.session',
  theme: 'repodesk.theme',
  prefs: 'repodesk.prefs',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const state = {
  projects: loadJSON(DB_KEYS.projects, []),
  settings: loadJSON(DB_KEYS.settings, {}),
  news: loadJSON(DB_KEYS.news, []),
  newsMeta: loadJSON(DB_KEYS.newsMeta, {}),
  account: loadJSON(DB_KEYS.account, null),
  authed: loadJSON(DB_KEYS.session, false),
  theme: loadJSON(DB_KEYS.theme, 'system'),
  prefs: loadJSON(DB_KEYS.prefs, { autoRefresh: true, reduceMotion: false }),
  tab: 'home',
  activeProjectId: null,
  showingDetailMobile: false,
  projectSearch: '',
  projectFilter: 'all',
  settingsError: null,
  settingsPage: 'profile',
  settingsShowingPage: false,
  legalDoc: null,
  ghConnectionsView: null,
  newsFilter: 'all',
  issueSuggestions: [],
  authMode: 'landing',
  authError: null,
  authBusy: false,
};

const dismissedStale = new Set();
const fetchingHealthIds = new Set();
let fetchingGhStats = false;
let ghConnectionsCache = { followers: null, following: null };
let fetchingGhConnections = false;
let ghImportState = { loading: false, repos: null, checked: new Set(), error: null, filter: '' };

function persistProjects() { saveJSON(DB_KEYS.projects, state.projects); }
function persistSettings() { saveJSON(DB_KEYS.settings, state.settings); }
function persistNews() { saveJSON(DB_KEYS.news, state.news); }
function persistNewsMeta() { saveJSON(DB_KEYS.newsMeta, state.newsMeta); }
function persistAccount() { saveJSON(DB_KEYS.account, state.account); }
function persistSession() { saveJSON(DB_KEYS.session, state.authed); }
function persistTheme() { saveJSON(DB_KEYS.theme, state.theme); }
function persistPrefs() { saveJSON(DB_KEYS.prefs, state.prefs); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function findProject(id) { return state.projects.find(p => p.id === id); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function priorityRank(p) { return { urgent: 0, high: 1, normal: 2, low: 3 }[p] ?? 2; }
function shortRepo(full) { return full.split('/')[1] || full; }
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
const escapeAttr = escapeHtml;

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fullDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupByDay(list) {
  const groups = [];
  let currentLabel = null, currentItems = [];
  for (const item of list) {
    const label = dayLabel(item.createdAt);
    if (label !== currentLabel) {
      if (currentItems.length) groups.push({ label: currentLabel, items: currentItems });
      currentLabel = label; currentItems = [item];
    } else currentItems.push(item);
  }
  if (currentItems.length) groups.push({ label: currentLabel, items: currentItems });
  return groups;
}

function taskCounts(p) { return { total: p.tasks.length, done: p.tasks.filter(t => t.done).length }; }
function projectProgress(p) { const { total, done } = taskCounts(p); return total ? Math.round((done / total) * 100) : 0; }
function healthLevel(h) {
  if (!h || !h.lastCommitAt) return 'gray';
  const days = (Date.now() - new Date(h.lastCommitAt).getTime()) / 86400000;
  if (days <= 3) return 'green';
  if (days <= 10) return 'yellow';
  if (days <= 21) return 'orange';
  return 'red';
}

/* ==========================================================================
   Icons
   ========================================================================== */
const ICON_PATHS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  github: '<path fill="currentColor" d="M12 .5A12 12 0 0 0 8.3 23.8c.6.1.8-.3.8-.6v-2c-3.3.7-4.1-1.5-4.1-1.5-.6-1.5-1.4-1.9-1.4-1.9-1.1-.7.1-.7.1-.7 1.3.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.4 3.6 1.1.1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.5 1.2-3.3-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.3 0 4.6-2.8 5.6-5.5 5.9.4.3.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/>',
  star: '<path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8L6 21l1.6-7L2.2 9.2l7.1-.6z"/>',
  fork: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8M12 12v4"/>',
  pr: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="15" r="2"/><path d="M6 8v8M18 6a6 6 0 0 1-6 6h-1"/>',
  userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M19 8v6M22 11h-6"/>',
  chevronleft: '<path d="M15 18l-6-6 6-6"/>',
  chevronright: '<path d="M9 18l6-6-6-6"/>',
  externallink: '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.6 18a1.5 1.5 0 0 0 1.3 2.3h16.2a1.5 1.5 0 0 0 1.3-2.3L13.7 3.9a1.5 1.5 0 0 0-2.6 0z"/>',
  link: '<path d="M9 15l6-6"/><path d="M13 5l1.5-1.5a3.5 3.5 0 0 1 5 5L18 10"/><path d="M11 19l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  shield: '<path d="M12 3l7 3v6c0 4.8-3 8-7 9-4-1-7-4.2-7-9V6z"/>',
  doc: '<path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  laptop: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20l-2-4H4z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  sliders: '<circle cx="16" cy="6" r="2"/><path d="M4 6h10M18 6h2"/><circle cx="10" cy="12" r="2"/><path d="M4 12h4M12 12h8"/><circle cx="16" cy="18" r="2"/><path d="M4 18h10M18 18h2"/>',
  scale: '<path d="M12 3v18"/><path d="M5 7l-3.5 6.5a3 3 0 0 0 5.7 1.4z"/><path d="M19 7l-3.5 6.5a3 3 0 0 0 5.7 1.4z"/><path d="M4.5 7h5M14.5 7h5"/><path d="M8 21h8"/>',
  checkcircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6 5-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  apple: '<path fill="currentColor" d="M16.3 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.9-1.5-.1-2.9.9-3.6.9-.8 0-1.9-.9-3.2-.9-1.7 0-3.2.9-4 2.3-1.7 3-.5 7.5 1.2 9.9.8 1.2 1.7 2.5 3 2.5 1.2 0 1.7-.8 3.2-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 3-2.4 1-1.5 1.4-2.9 1.4-3l-3.8-1.5zm-2.4-7.3c.7-.8 1.2-1.9 1-3.1-1 .1-2.2.7-2.9 1.6-.7.8-1.3 1.9-1.1 2.9 1.2.1 2.3-.6 3-1.4z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'news', label: 'News', icon: 'bell' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function unreadNewsCount() { return state.news.filter(n => !n.read).length; }
function markNewsRead() {
  let changed = false;
  state.news.forEach(n => { if (!n.read) { n.read = true; changed = true; } });
  if (changed) persistNews();
}

/* ==========================================================================
   Auth (local, on-device — see README/Legal: there is no server)
   ========================================================================== */
async function hashSecret(text) {
  try {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return 'fallback-' + h;
  }
}
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

function renderAuthRoot() {
  const root = document.getElementById('auth-root');
  root.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  if (state.authMode === 'landing') {
    root.innerHTML = `
      <div class="auth-bg"><div class="auth-card">
        <img src="icons/icon-192.png" class="auth-logo" alt="">
        <div><div class="auth-title">RepoDesk</div>
        <div class="auth-subtitle" style="margin-top:6px;">Your projects, tasks and GitHub activity, in one calm workspace.</div></div>
        <div class="auth-features">
          <div class="auth-feature"><span class="auth-feature-icon">${icon('folder')}</span>Track projects, tasks and ideas together</div>
          <div class="auth-feature"><span class="auth-feature-icon">${icon('github')}</span>See GitHub activity without the noise</div>
          <div class="auth-feature"><span class="auth-feature-icon">${icon('shield')}</span>Everything stays on this device, always</div>
        </div>
        <div class="auth-actions">
          <button class="btn btn-primary btn-lg btn-block" id="auth-go-create">Create account</button>
        </div>
      </div></div>`;
    document.getElementById('auth-go-create').addEventListener('click', () => { state.authMode = 'create'; state.authError = null; renderAuthRoot(); });
    return;
  }

  if (state.authMode === 'create') {
    root.innerHTML = `
      <div class="auth-bg"><div class="auth-card">
        <button class="btn btn-ghost btn-sm auth-back" id="auth-back-btn">${icon('chevronleft')} Back</button>
        <img src="icons/icon-192.png" class="auth-logo" alt="">
        <div><div class="auth-title">Create your account</div>
        <div class="auth-subtitle" style="margin-top:6px;">Just for this device — nothing is sent anywhere.</div></div>
        <div class="auth-form">
          <div class="field"><label>Name</label><input type="text" id="af-name" placeholder="Ada Lovelace" autocomplete="name"></div>
          <div class="field"><label>Email</label><input type="email" id="af-email" placeholder="ada@example.com" autocomplete="email"></div>
          <div class="field"><label>Password</label><input type="password" id="af-password" placeholder="At least 6 characters" autocomplete="new-password"></div>
          ${state.authError ? `<div class="auth-error">${escapeHtml(state.authError)}</div>` : ''}
          <button class="btn btn-primary btn-lg btn-block" id="auth-create-submit" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Creating…' : 'Create account'}</button>
        </div>
      </div></div>`;
    document.getElementById('auth-back-btn').addEventListener('click', () => { state.authMode = 'landing'; state.authError = null; renderAuthRoot(); });
    const submit = document.getElementById('auth-create-submit');
    const doSubmit = () => submit.click();
    ['af-name', 'af-email', 'af-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    });
    submit.addEventListener('click', async () => {
      const name = document.getElementById('af-name').value.trim();
      const email = document.getElementById('af-email').value.trim();
      const password = document.getElementById('af-password').value;
      if (!name) { state.authError = 'Enter your name.'; renderAuthRoot(); return; }
      if (!isValidEmail(email)) { state.authError = 'Enter a valid email address.'; renderAuthRoot(); return; }
      if (password.length < 6) { state.authError = 'Password must be at least 6 characters.'; renderAuthRoot(); return; }
      state.authBusy = true; state.authError = null; renderAuthRoot();
      const passwordHash = await hashSecret(password);
      state.account = { name, email, passwordHash, createdAt: new Date().toISOString() };
      state.authed = true;
      state.authBusy = false;
      persistAccount(); persistSession();
      enterApp();
      showToast(`Welcome, ${name.split(' ')[0]}`);
    });
    return;
  }

  if (state.authMode === 'signin') {
    const acc = state.account || {};
    root.innerHTML = `
      <div class="auth-bg"><div class="auth-card">
        <div class="avatar-fallback profile-avatar-lg" style="margin:0 auto;">${escapeHtml(initials(acc.name))}</div>
        <div><div class="auth-title">Welcome back</div>
        <div class="auth-subtitle" style="margin-top:6px;">Signed out as <b>${escapeHtml(acc.name || '')}</b>. Enter your password to continue.</div></div>
        <div class="auth-form">
          <div class="field"><label>Password</label><input type="password" id="af-signin-password" placeholder="Password" autocomplete="current-password"></div>
          ${state.authError ? `<div class="auth-error">${escapeHtml(state.authError)}</div>` : ''}
          <button class="btn btn-primary btn-lg btn-block" id="auth-signin-submit" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </div></div>`;
    const submit = document.getElementById('auth-signin-submit');
    document.getElementById('af-signin-password').addEventListener('keydown', e => { if (e.key === 'Enter') submit.click(); });
    submit.addEventListener('click', async () => {
      const password = document.getElementById('af-signin-password').value;
      state.authBusy = true; state.authError = null; renderAuthRoot();
      const hash = await hashSecret(password);
      if (hash === state.account.passwordHash) {
        state.authed = true; state.authBusy = false;
        persistSession();
        enterApp();
        showToast(`Welcome back, ${state.account.name.split(' ')[0]}`);
      } else {
        state.authBusy = false;
        state.authError = 'That password is incorrect.';
        renderAuthRoot();
      }
    });
    return;
  }
}

function enterApp() {
  document.getElementById('auth-root').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  renderSidebarAccount();
  setTab(state.tab || 'home');
  maybeStartNewsPolling();
}

function logOut() {
  state.authed = false;
  persistSession();
  state.authMode = 'signin';
  state.authError = null;
  renderAuthRoot();
}

/* ==========================================================================
   Theme
   ========================================================================== */
function resolveTheme(pref) {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return pref;
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolveTheme(state.theme));
  document.documentElement.classList.toggle('reduce-motion', !!state.prefs.reduceMotion);
}
function setTheme(pref) {
  state.theme = pref;
  persistTheme();
  applyTheme();
  if (state.tab === 'settings') renderSettings();
}
window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (state.theme === 'system') applyTheme();
});

/* ==========================================================================
   GitHub API
   ========================================================================== */
const GITHUB_API = 'https://api.github.com';
function ghHeaders() {
  return { Authorization: `Bearer ${state.settings.githubToken}`, Accept: 'application/vnd.github+json' };
}
async function ghFetch(path) {
  const res = await fetch(GITHUB_API + path, { headers: ghHeaders() });
  if (!res.ok) throw new Error('github_error_' + res.status);
  return res.json();
}

async function ghConnect(token) {
  const res = await fetch(GITHUB_API + '/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('invalid_token');
  const user = await res.json();
  state.settings = {
    githubToken: token,
    githubLogin: user.login,
    githubName: user.name || user.login,
    githubAvatar: user.avatar_url,
    publicRepos: user.public_repos,
    followers: user.followers,
    connectedAt: new Date().toISOString(),
  };
  persistSettings();
  return user;
}
function ghDisconnect() {
  state.settings = {};
  persistSettings();
  state.news = [];
  persistNews();
  state.newsMeta = {};
  persistNewsMeta();
}

async function ghListRepos() {
  let page = 1, all = [];
  while (page <= 5) {
    const repos = await ghFetch(`/user/repos?per_page=100&page=${page}&affiliation=owner&sort=updated`);
    all = all.concat(repos);
    if (repos.length < 100) break;
    page++;
  }
  return all;
}

async function ghGraphQL(query) {
  const res = await fetch(GITHUB_API + '/graphql', {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('github_graphql_error_' + res.status);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'github_graphql_error');
  return json.data;
}

async function fetchGithubProfileStats() {
  const query = `{
    viewer {
      followers { totalCount }
      following { totalCount }
      starredRepositories { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositoryDiscussions { totalCount }
      repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]) { totalCount }
      ownedRepos: repositories(ownerAffiliations: OWNER, isFork: false, first: 100, orderBy: {field: STARGAZERS, direction: DESC}) {
        totalCount
        nodes { stargazerCount forkCount }
      }
    }
  }`;
  const data = await ghGraphQL(query);
  const v = data.viewer;
  const starsReceived = v.ownedRepos.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);
  const forksReceived = v.ownedRepos.nodes.reduce((sum, r) => sum + r.forkCount, 0);
  return {
    followers: v.followers.totalCount,
    following: v.following.totalCount,
    publicRepos: v.ownedRepos.totalCount,
    starredRepos: v.starredRepositories.totalCount,
    pullRequests: v.pullRequests.totalCount,
    issues: v.issues.totalCount,
    discussions: v.repositoryDiscussions.totalCount,
    contributedTo: v.repositoriesContributedTo.totalCount,
    starsReceived, forksReceived,
    fetchedAt: Date.now(),
  };
}

async function ghListConnections(kind) {
  // kind: 'followers' | 'following'
  const login = state.settings.githubLogin;
  return ghFetch(`/users/${login}/${kind}?per_page=100`);
}

async function fetchProjectHealth(p) {
  if (!p.githubOwner || !p.githubRepo || !state.settings.githubToken) return null;
  const full = `${p.githubOwner}/${p.githubRepo}`;
  try {
    const [repoData, commits, pulls, issuesRaw, release] = await Promise.all([
      ghFetch(`/repos/${full}`),
      ghFetch(`/repos/${full}/commits?per_page=1`).catch(() => []),
      ghFetch(`/repos/${full}/pulls?state=open&per_page=100`).catch(() => []),
      ghFetch(`/repos/${full}/issues?state=open&per_page=100`).catch(() => []),
      ghFetch(`/repos/${full}/releases/latest`).catch(() => null),
    ]);
    const openIssuesList = issuesRaw.filter(i => !i.pull_request)
      .map(i => ({ number: i.number, title: i.title, url: i.html_url, createdAt: i.created_at }));
    return {
      fetchedAt: Date.now(),
      lastCommitAt: commits[0] ? commits[0].commit.author.date : repoData.pushed_at,
      openIssues: openIssuesList.length,
      openIssuesList,
      openPRs: pulls.length,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      lastReleaseAt: release ? release.published_at : null,
    };
  } catch (e) { return null; }
}

async function refreshNews(force) {
  if (!state.settings.githubToken) return;
  const meta = state.newsMeta || {};
  if (!force && meta.lastFetchedAt && Date.now() - meta.lastFetchedAt < 5 * 60 * 1000) return;
  try {
    const repos = await ghListRepos();
    const myLogin = state.settings.githubLogin;
    const items = [];
    for (const repo of repos.slice(0, 30)) {
      let events = [];
      try { events = await ghFetch(`/repos/${repo.full_name}/events?per_page=30`); } catch (e) { continue; }
      for (const ev of events) {
        if (!ev.actor || ev.actor.login === myLogin) continue;
        if (ev.type === 'WatchEvent') {
          items.push({ id: `star-${ev.id}`, type: 'star', actorLogin: ev.actor.login, repoFullName: repo.full_name, createdAt: ev.created_at });
        } else if (ev.type === 'ForkEvent') {
          items.push({ id: `fork-${ev.id}`, type: 'fork', actorLogin: ev.actor.login, repoFullName: repo.full_name, createdAt: ev.created_at });
        } else if (ev.type === 'PullRequestEvent' && ev.payload && ev.payload.action === 'opened') {
          items.push({
            id: `pr-${ev.id}`, type: 'pr', actorLogin: ev.actor.login, repoFullName: repo.full_name,
            prTitle: ev.payload.pull_request.title, prNumber: ev.payload.number, createdAt: ev.created_at,
          });
        }
      }
    }
    let followers = [];
    try { followers = await ghFetch(`/users/${myLogin}/followers?per_page=100`); } catch (e) {}
    const followerLogins = followers.map(f => f.login);
    if (meta.followerLogins && meta.followerLogins.length) {
      const newOnes = followerLogins.filter(l => !meta.followerLogins.includes(l));
      for (const login of newOnes) {
        items.push({ id: `follow-${login}-${Date.now()}`, type: 'follow', actorLogin: login, createdAt: new Date().toISOString() });
      }
    }
    const existingIds = new Set(state.news.map(n => n.id));
    const fresh = items.filter(n => !existingIds.has(n.id)).map(n => ({ ...n, read: false }));
    state.news = [...fresh, ...state.news]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200);
    persistNews();
    state.newsMeta = { lastFetchedAt: Date.now(), followerLogins };
    persistNewsMeta();
  } catch (e) {}
}

/* ==========================================================================
   Modal / toast
   ========================================================================== */
function showToast(msg) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${escapeHtml(msg)}</div>`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { root.innerHTML = ''; }, 2600);
}

function openModal(innerHtml, extraClass) {
  document.getElementById('modal-root').innerHTML =
    `<div class="modal-overlay" id="modal-overlay"><div class="modal-panel ${extraClass || ''}">${innerHtml}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function openConfirm(title, message, onConfirm, confirmLabel) {
  openModal(`
    <div class="modal-title">${escapeHtml(title)}</div>
    <p style="color:var(--text-dim);font-size:13.5px;">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cf-cancel">Cancel</button>
      <button class="btn btn-danger" id="cf-confirm">${escapeHtml(confirmLabel || 'Confirm')}</button>
    </div>
  `);
  document.getElementById('cf-cancel').addEventListener('click', closeModal);
  document.getElementById('cf-confirm').addEventListener('click', () => { closeModal(); onConfirm(); });
}

function openProjectModal(id) {
  const editing = id ? findProject(id) : null;
  openModal(`
    <div class="modal-title">${editing ? 'Edit project' : 'New project'}</div>
    <div class="field"><label>Name</label><input type="text" id="pf-name" value="${editing ? escapeAttr(editing.name) : ''}" placeholder="Clearing"></div>
    <div class="field"><label>Description</label><input type="text" id="pf-desc" value="${editing ? escapeAttr(editing.description || '') : ''}" placeholder="Finance management app"></div>
    <div class="field"><label>Status</label>
      <select id="pf-status">
        <option value="active" ${editing && editing.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="paused" ${editing && editing.status === 'paused' ? 'selected' : ''}>Paused</option>
        <option value="completed" ${editing && editing.status === 'completed' ? 'selected' : ''}>Completed</option>
      </select>
    </div>
    <div class="field">
      <label>GitHub repository</label>
      <div style="display:flex;gap:8px;">
        <input type="text" id="pf-owner" value="${editing ? escapeAttr(editing.githubOwner || '') : escapeAttr(state.settings.githubLogin || '')}" placeholder="owner">
        <input type="text" id="pf-repo" value="${editing ? escapeAttr(editing.githubRepo || '') : ''}" placeholder="repo-name">
      </div>
      <div class="field-hint">Used to pull commits, issues and pull requests for this project.</div>
    </div>
    <div class="field"><label>Live URL</label><input type="url" id="pf-live" value="${editing ? escapeAttr(editing.liveUrl || '') : ''}" placeholder="https://..."></div>
    <div class="field"><label>Figma</label><input type="url" id="pf-figma" value="${editing ? escapeAttr(editing.figmaUrl || '') : ''}" placeholder="https://..."></div>
    <div class="field"><label>Docs</label><input type="url" id="pf-docs" value="${editing ? escapeAttr(editing.docsUrl || '') : ''}" placeholder="https://..."></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="pf-cancel">Cancel</button>
      <button class="btn btn-primary" id="pf-save">${editing ? 'Save changes' : 'Create project'}</button>
    </div>
  `);
  document.getElementById('pf-cancel').addEventListener('click', closeModal);
  document.getElementById('pf-save').addEventListener('click', () => {
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { document.getElementById('pf-name').focus(); return; }
    const fields = {
      name,
      description: document.getElementById('pf-desc').value.trim(),
      status: document.getElementById('pf-status').value,
      githubOwner: document.getElementById('pf-owner').value.trim(),
      githubRepo: document.getElementById('pf-repo').value.trim(),
      liveUrl: document.getElementById('pf-live').value.trim(),
      figmaUrl: document.getElementById('pf-figma').value.trim(),
      docsUrl: document.getElementById('pf-docs').value.trim(),
    };
    if (editing) {
      Object.assign(editing, fields, { updatedAt: new Date().toISOString() });
    } else {
      const project = {
        id: uid(), tasks: [], ideas: [], notes: '', health: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...fields,
      };
      state.projects.unshift(project);
      state.activeProjectId = project.id;
    }
    persistProjects();
    closeModal();
    state.showingDetailMobile = true;
    setTab('projects');
    showToast(editing ? 'Project updated' : 'Project created');
  });
}

/* ==========================================================================
   Tabs / topbar / nav
   ========================================================================== */
function showView(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + tab).classList.add('active');
}

let markReadTimer = null;
function setTab(tab) {
  state.tab = tab;
  renderSidebarNav();
  renderBottomNav();
  renderTopbar();
  showView(tab);
  if (tab === 'home') renderHome();
  if (tab === 'projects') renderProjects();
  if (tab === 'news') {
    renderNews();
    refreshNews(false).then(() => { renderNews(); renderSidebarNav(); renderBottomNav(); });
    clearTimeout(markReadTimer);
    markReadTimer = setTimeout(() => { markNewsRead(); renderSidebarNav(); renderBottomNav(); renderNews(); }, 1400);
  }
  if (tab === 'settings') renderSettings();
}

function openProject(id) {
  state.activeProjectId = id;
  state.showingDetailMobile = true;
  setTab('projects');
}

function renderTopbar() {
  const el = document.getElementById('topbar');
  const titles = { home: 'Home', projects: 'Projects', news: 'News', settings: 'Settings' };
  let actions = '';
  if ((state.tab === 'home' || state.tab === 'news') && state.settings.githubToken) {
    actions = `<button class="btn btn-ghost btn-sm" data-action="refresh-news">${icon('refresh')} Refresh</button>`;
  }
  el.innerHTML = `<h1>${titles[state.tab]}</h1><div class="topbar-actions">${actions}</div>`;
}

function renderSidebarNav() {
  const el = document.getElementById('sidebar-nav');
  el.innerHTML = NAV_ITEMS.map(item => {
    const count = item.id === 'news' ? unreadNewsCount() : 0;
    return `<button class="nav-item ${state.tab === item.id ? 'active' : ''}" data-action="set-tab" data-id="${item.id}">
      ${icon(item.icon)}<span>${item.label}</span>${count > 0 ? `<span class="nav-badge">${count > 9 ? '9+' : count}</span>` : ''}
    </button>`;
  }).join('');
}

function renderBottomNav() {
  const el = document.getElementById('bottom-nav');
  el.innerHTML = NAV_ITEMS.map(item => {
    const count = item.id === 'news' ? unreadNewsCount() : 0;
    return `<button class="bn-item ${state.tab === item.id ? 'active' : ''}" data-action="set-tab" data-id="${item.id}">
      ${icon(item.icon)}<span>${item.label}</span>${count > 0 ? `<span class="bn-badge">${count > 9 ? '9+' : count}</span>` : ''}
    </button>`;
  }).join('');
}

function renderSidebarAccount() {
  const el = document.getElementById('sidebar-account');
  const acc = state.account || {};
  el.innerHTML = `<div class="account-chip" data-action="set-tab" data-id="settings">
    <div class="avatar-fallback">${escapeHtml(initials(acc.name))}</div>
    <div><div class="account-name">${escapeHtml(acc.name || 'Account')}</div><div class="account-sub">${state.settings.githubToken ? '@' + escapeHtml(state.settings.githubLogin) : 'View settings'}</div></div>
  </div>`;
}

/* ==========================================================================
   Home / Projects / News (rendering — unchanged behavior, restyled by CSS)
   ========================================================================== */
function emptyInline(text) { return `<div style="color:var(--text-faint);font-size:13.5px;padding:10px 0;">${escapeHtml(text)}</div>`; }
function emptyStateBlock(iconName, title, desc, btnLabel, btnAction, btnId) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(desc)}</p>
    ${btnLabel ? `<button class="btn btn-primary btn-sm" data-action="${btnAction}" data-id="${btnId || ''}">${escapeHtml(btnLabel)}</button>` : ''}
  </div>`;
}
function statCard(num, label) { return `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`; }

function lineChartHtml(values, labels, className) {
  const safeValues = values.length ? values : [0];
  const max = 100;
  const min = 0;
  const span = 100;
  const coordinates = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? 50 : (index / (safeValues.length - 1)) * 100;
    const y = 88 - ((Math.max(min, Math.min(max, value)) - min) / span) * 68;
    return { x, y };
  });
  const smoothPath = coordinates.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    const previous = coordinates[index - 1];
    const midX = (previous.x + point.x) / 2;
    return `${path} Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${midX.toFixed(2)} ${((previous.y + point.y) / 2).toFixed(2)} Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, '');
  const areaPath = `${smoothPath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} 88 L ${coordinates[0].x.toFixed(2)} 88 Z`;
  return `<div class="line-chart ${className || ''}">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Project progress line chart">
      <defs><linearGradient id="chart-fill-${className || 'default'}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <path class="line-chart-grid" d="M0 20H100 M0 54H100 M0 88H100"></path>
      <path class="line-chart-area" d="${areaPath}"></path>
      <path class="line-chart-path" d="${smoothPath}"></path>
      ${safeValues.map((value, index) => {
        const point = coordinates[index];
        return `<circle class="line-chart-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="1.8" tabindex="0"><title>${escapeHtml(labels[index] || '')}: ${Math.round(value)}%</title></circle>`;
      }).join('')}
    </svg>
    <div class="line-chart-scale"><span>100%</span><span>50%</span><span>0%</span></div>
    <div class="line-chart-labels">${labels.map(label => `<span>${escapeHtml(label)}</span>`).join('')}</div>
  </div>`;
}

function homeProgressChartHtml(projects) {
  if (!projects.length) return '';
  const width = 600;
  const height = 170;
  const left = 18;
  const right = width - 18;
  const baseline = 132;
  const chartHeight = 94;
  const step = projects.length === 1 ? 0 : (right - left) / (projects.length - 1);
  const points = projects.map((project, index) => ({
    project,
    value: projectProgress(project),
    x: projects.length === 1 ? width / 2 : left + step * index,
    y: baseline - (projectProgress(project) / 100) * chartHeight,
  }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return `<div class="home-progress-chart" role="img" aria-label="Active project progress chart">
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path class="home-progress-line" d="${path}"></path>
    </svg>
    <div class="home-progress-labels">
      ${points.map(point => `<button class="home-progress-label" data-action="open-project" data-id="${point.project.id}"><span>${point.value}%</span><small>${escapeHtml(point.project.name)}</small></button>`).join('')}
    </div>
  </div>`;
}

function attnRowHtml(t) {
  return `<div class="attn-row" data-action="open-project" data-id="${t.projectId}">
    <span class="priority-dot priority-${t.priority}"></span>
    <div class="attn-text"><div class="attn-title">${escapeHtml(t.text)}</div><div class="attn-sub"><b>${escapeHtml(t.projectName)}</b> · ${capitalize(t.priority)}</div></div>
  </div>`;
}

function projectCardHtml(p) {
  const { total, done } = taskCounts(p);
  const pct = projectProgress(p);
  const level = p.health ? healthLevel(p.health) : 'gray';
  const urgentCount = p.tasks.filter(t => !t.done && t.priority === 'urgent').length;
  return `<div class="project-card" data-action="open-project" data-id="${p.id}">
    <div class="project-card-top">
      <div class="project-card-heading"><h3>${escapeHtml(p.name)}</h3></div>
      <span class="health-dot health-${level}" title="Repo health"></span>
    </div>
    <div class="project-card-metrics">
      <span class="metric-pill">${done}/${total} tasks</span>
      <span class="metric-pill">${pct}% complete</span>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="project-card-footer">
      <span class="card-edited">Edited ${timeAgo(p.updatedAt || p.createdAt)}</span>
      ${urgentCount ? `<span class="card-flags"><span class="priority-dot priority-urgent"></span>${urgentCount} urgent</span>` : `<span class="status-pill-soft">Stable</span>`}
    </div>
  </div>`;
}

function staleBannerHtml(list) {
  const text = list.length === 1
    ? `<b>${escapeHtml(list[0].name)}</b> hasn't had a commit in a while.`
    : `${list.length} active projects haven't had a commit in a while.`;
  return `<div class="stale-banner">${icon('alert')}<div style="flex:1">${text}</div>
    <button class="btn btn-ghost btn-sm" data-action="dismiss-stale" data-id="${list.map(p => p.id).join(',')}">Dismiss</button>
  </div>`;
}

function renderHome() {
  const el = document.getElementById('view-home');
  const active = state.projects.filter(p => p.status === 'active');
  const taskTotals = state.projects.reduce((acc, p) => {
    const counts = taskCounts(p);
    acc.total += counts.total;
    acc.done += counts.done;
    acc.open += counts.total - counts.done;
    acc.urgent += p.tasks.filter(t => !t.done && t.priority === 'urgent').length;
    return acc;
  }, { total: 0, done: 0, open: 0, urgent: 0 });
  const completion = taskTotals.total ? Math.round((taskTotals.done / taskTotals.total) * 100) : 0;
  const githubProjects = state.projects.filter(p => p.githubOwner && p.githubRepo);
  const githubTotals = githubProjects.reduce((acc, p) => {
    if (!p.health) return acc;
    acc.issues += Number(p.health.openIssues) || 0;
    acc.prs += Number(p.health.openPRs) || 0;
    acc.stars += Number(p.health.stars) || 0;
    return acc;
  }, { issues: 0, prs: 0, stars: 0 });
  const chartProjects = active.slice(0, 6);
  const allUrgent = [];
  state.projects.forEach(p => p.tasks.forEach(t => {
    if (!t.done && (t.priority === 'urgent' || t.priority === 'high')) {
      allUrgent.push({ ...t, projectName: p.name, projectId: p.id });
    }
  }));
  allUrgent.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const stale = active.filter(p => p.githubOwner && p.health && healthLevel(p.health) === 'red' && !dismissedStale.has(p.id));
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = state.account && state.account.name ? state.account.name.split(' ')[0] : '';
  const withGithub = state.projects.filter(p => p.githubOwner && p.githubRepo)
    .sort((a, b) => healthRank(a.health) - healthRank(b.health));

  el.innerHTML = `
    <h1 style="font-size:24px;font-weight:750;letter-spacing:-0.02em;">${greeting}${firstName ? ', ' + escapeHtml(firstName) : ''}.</h1>
    <div class="stat-row">
      ${statCard(state.projects.length, 'Projects')}
      ${statCard(active.length, 'Active')}
      ${statCard(allUrgent.length, 'Urgent')}
      ${statCard(unreadNewsCount(), 'News')}
    </div>
    <div class="home-insights">
      <div class="insight-card progress-insight">
        <div class="insight-heading"><div><span class="eyebrow">Workspace pulse</span><h2>Delivery overview</h2></div><strong>${completion}%</strong></div>
        <div class="insight-progress"><div style="width:${completion}%"></div></div>
        <div class="insight-meta"><span>${taskTotals.done} completed</span><span>${taskTotals.open} open tasks</span></div>
      </div>
      <div class="insight-card github-insight">
        <div class="insight-heading"><div><span class="eyebrow">${state.settings.githubToken ? 'GitHub connected' : 'GitHub workspace'}</span><h2>Repository signals</h2></div>${icon('github')}</div>
        <div class="github-metrics"><span><b>${githubProjects.length}</b> repos</span><span><b>${githubTotals.issues}</b> issues</span><span><b>${githubTotals.prs}</b> PRs</span><span><b>${githubTotals.stars}</b> stars</span></div>
        ${state.settings.githubToken ? `<button class="btn btn-ghost btn-sm insight-action" data-action="refresh-news">${icon('refresh')} Update signals</button>` : `<button class="btn btn-ghost btn-sm insight-action" data-action="set-tab" data-id="settings">${icon('github')} Connect GitHub</button>`}
      </div>
      ${chartProjects.length ? `<div class="insight-card project-chart"><div class="insight-heading"><div><span class="eyebrow">Active projects</span><h2>Progress at a glance</h2></div><span class="chart-caption">${active.length} total</span></div>${homeProgressChartHtml(chartProjects)}</div>` : ''}
    </div>
    ${stale.length ? staleBannerHtml(stale) : ''}
    ${state.issueSuggestions.length ? `<div class="issue-suggest-list">${state.issueSuggestions.slice(0, 3).map(issueSuggestionHtml).join('')}</div>` : ''}
    <div class="section-title"><h2>Needs attention</h2></div>
    ${allUrgent.length ? `<div class="attn-list">${allUrgent.slice(0, 8).map(attnRowHtml).join('')}</div>` : emptyInline('Nothing urgent right now.')}
    ${withGithub.length ? `<div class="section-title"><h2>Project health</h2></div><div class="health-mini-list">${withGithub.map(healthMiniRowHtml).join('')}</div>` : ''}
    <div class="section-title"><h2>Active projects</h2></div>
    ${active.length ? `<div class="project-grid">${active.map(projectCardHtml).join('')}</div>` : emptyInline('No active projects yet.')}
    <div class="section-title"><h2>Recent GitHub activity</h2></div>
    ${renderNewsPreviewList()}
  `;
  ensureHealthForProjects(state.projects);
}

function healthRank(h) { return h ? { red: 0, orange: 1, yellow: 2, green: 3 }[healthLevel(h)] ?? 4 : 5; }

function healthMiniRowHtml(p) {
  const level = p.health ? healthLevel(p.health) : 'gray';
  return `<div class="health-mini-row" data-action="open-project" data-id="${p.id}">
    <span class="health-dot health-${level}"></span>
    <span class="health-mini-name">${escapeHtml(p.name)}</span>
    <span class="health-mini-updated">${p.health ? `Updated ${timeAgo(p.health.lastCommitAt)}` : 'No data yet'}</span>
  </div>`;
}

function renderNewsPreviewList() {
  if (!state.settings.githubToken) return emptyInline('Connect GitHub in Settings to see activity here.');
  if (!state.news.length) return emptyInline('No activity yet.');
  return state.news.slice(0, 3).map(newsItemHtml).join('');
}

function projectRowHtml(p) {
  return `<div class="project-row ${p.id === state.activeProjectId ? 'active' : ''}" data-action="open-project" data-id="${p.id}">
    <span class="health-dot health-${p.health ? healthLevel(p.health) : 'gray'}"></span>
    <span class="project-row-main">
      <span class="project-row-name">${escapeHtml(p.name)}</span>
      <span class="project-row-updated">Edited ${timeAgo(p.updatedAt || p.createdAt)}</span>
    </span>
    <span class="project-row-pct">${projectProgress(p)}%</span>
  </div>`;
}

function projectLinksHtml(p) {
  const chips = [];
  if (p.githubOwner && p.githubRepo) chips.push(`<a class="link-chip" href="https://github.com/${escapeAttr(p.githubOwner)}/${escapeAttr(p.githubRepo)}" target="_blank" rel="noopener">${icon('github')} GitHub</a>`);
  if (p.liveUrl) chips.push(`<a class="link-chip" href="${escapeAttr(p.liveUrl)}" target="_blank" rel="noopener">${icon('externallink')} Live</a>`);
  if (p.figmaUrl) chips.push(`<a class="link-chip" href="${escapeAttr(p.figmaUrl)}" target="_blank" rel="noopener">${icon('link')} Figma</a>`);
  if (p.docsUrl) chips.push(`<a class="link-chip" href="${escapeAttr(p.docsUrl)}" target="_blank" rel="noopener">${icon('link')} Docs</a>`);
  return chips.join('');
}

function healthCardHtml(p) {
  if (!p.githubOwner || !p.githubRepo) return '';
  const h = p.health;
  if (!h) {
    return `<div class="health-card">
      <div class="health-card-top">${icon('github')}<span>Repo health</span><button class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="fetch-health" data-id="${p.id}">Fetch</button></div>
      <div style="font-size:12.5px;color:var(--text-faint)">No data yet for ${escapeHtml(p.githubOwner)}/${escapeHtml(p.githubRepo)}.</div>
    </div>`;
  }
  const level = healthLevel(h);
  const label = { green: 'Healthy', yellow: 'Active', orange: 'Needs attention', red: 'Needs attention', gray: 'Unknown' }[level];
  const unresolvedTasks = p.tasks.filter(t => !t.done).length;
  const rows = [
    ['Last commit', timeAgo(h.lastCommitAt)],
    ['Open issues', h.openIssues],
    ['Open PRs', h.openPRs],
    ['Unresolved tasks', unresolvedTasks],
    ['Last release', h.lastReleaseAt ? timeAgo(h.lastReleaseAt) : 'None yet'],
    ['Stars', h.stars],
  ];
  return `<div class="health-card">
    <div class="health-card-top"><span class="health-dot health-${level}"></span><span>${label}</span><button class="btn btn-ghost btn-icon" style="margin-left:auto;width:28px;height:28px;" data-action="fetch-health" data-id="${p.id}">${icon('refresh')}</button></div>
    <div class="health-table">
      ${rows.map(([l, v]) => `<div class="health-table-row"><span>${escapeHtml(l)}</span><b>${escapeHtml(String(v))}</b></div>`).join('')}
    </div>
  </div>`;
}

function taskRowHtml(pid, t) {
  return `<div class="task-row ${t.done ? 'done' : ''}">
    <div class="task-check" data-action="toggle-task" data-id="${pid}::${t.id}">${icon('check')}</div>
    <div class="task-text">${escapeHtml(t.text)}</div>
    ${t.source === 'github' ? `<span class="task-source">#${t.githubNumber}</span>` : ''}
    <span class="priority-dot priority-${t.priority}" title="${t.priority}"></span>
    <div class="task-del" data-action="delete-task" data-id="${pid}::${t.id}">${icon('trash')}</div>
  </div>`;
}
function ideaRowHtml(pid, i) {
  return `<div class="idea-row"><span>${escapeHtml(i.text)}</span><div class="task-del" data-action="delete-idea" data-id="${pid}::${i.id}">${icon('trash')}</div></div>`;
}
function addTaskRowHtml(pid) {
  return `<div class="task-add-row">
    <input type="text" data-new-task="${pid}" data-enter="add-task" data-id="${pid}" placeholder="Add a task...">
    <select data-new-task-priority="${pid}">
      <option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option>
    </select>
    <button class="btn btn-ghost btn-sm" data-action="add-task" data-id="${pid}">${icon('plus')}</button>
  </div>`;
}
function addIdeaRowHtml(pid) {
  return `<div class="task-add-row">
    <input type="text" data-new-idea="${pid}" data-enter="add-idea" data-id="${pid}" placeholder="Add an idea...">
    <button class="btn btn-ghost btn-sm" data-action="add-idea" data-id="${pid}">${icon('plus')}</button>
  </div>`;
}

function projectDetailHtml(p) {
  const { total, done } = taskCounts(p);
  const pct = projectProgress(p);
  const urgent = p.tasks.filter(t => !t.done && t.priority === 'urgent');
  const rest = p.tasks.filter(t => !urgent.includes(t)).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  const links = projectLinksHtml(p);
  const healthLabel = { green: 'Healthy', yellow: 'Active', orange: 'Watch', red: 'Critical', gray: 'Unknown' }[p.health ? healthLevel(p.health) : 'gray'];
  const detailStats = [
    { label: 'Completion', value: `${pct}%`, tone: 'primary' },
    { label: 'Tasks', value: `${done}/${total}`, tone: 'neutral' },
    { label: 'Ideas', value: `${p.ideas.length}`, tone: 'accent' },
    { label: 'Health', value: healthLabel, tone: p.health ? healthLevel(p.health) : 'gray' }
  ];
  const sparkValues = [
    Math.max(18, Math.min(100, pct)),
    Math.max(24, Math.min(100, ((done / Math.max(total, 1)) * 100) + 10)),
    Math.max(20, Math.min(100, urgent.length ? 72 : 45)),
    Math.max(16, Math.min(100, p.ideas.length * 18 + 18))
  ];
  return `
    <div class="detail-back"><button class="btn btn-ghost btn-sm" data-action="back-to-list">${icon('chevronleft')} Projects</button></div>
    <div class="detail-header">
      <div class="detail-top-row">
        <div>
          <div class="detail-title">${escapeHtml(p.name)}</div>
          ${p.description ? `<div class="detail-desc">${escapeHtml(p.description)}</div>` : ''}
        </div>
        <div class="detail-menu">
          <button class="btn btn-ghost btn-icon" data-action="edit-project" data-id="${p.id}">${icon('pencil')}</button>
          <button class="btn btn-danger btn-icon" data-action="delete-project" data-id="${p.id}">${icon('trash')}</button>
        </div>
      </div>
      <div class="detail-meta-row">
        <select class="status-pill" data-change="set-status" data-id="${p.id}">
          <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="paused" ${p.status === 'paused' ? 'selected' : ''}>Paused</option>
          <option value="completed" ${p.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </div>
      <div class="detail-progress">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${done}/${total} tasks complete</span><span>${pct}%</span></div>
      </div>
    </div>
    <div class="detail-summary-grid">
      ${detailStats.map(stat => `<div class="detail-stat-card ${stat.tone}">
        <span class="detail-stat-label">${escapeHtml(stat.label)}</span>
        <strong>${escapeHtml(String(stat.value))}</strong>
      </div>`).join('')}
      <div class="detail-stat-card chart">
        <span class="detail-stat-label">Signals</span>
        ${lineChartHtml(sparkValues, ['Start', 'Tasks', 'Focus', 'Ideas'], 'detail-line-chart')}
      </div>
    </div>
    ${links ? `<div class="links-row">${links}</div>` : ''}
    ${healthCardHtml(p)}
    ${urgent.length ? `<div class="subsection"><div class="subsection-head"><h3>Urgent</h3></div><div class="task-list">${urgent.map(t => taskRowHtml(p.id, t)).join('')}</div></div>` : ''}
    <div class="subsection">
      <div class="subsection-head"><h3>Tasks</h3></div>
      <div class="task-list">${rest.length ? rest.map(t => taskRowHtml(p.id, t)).join('') : emptyInline('No tasks yet.')}</div>
      ${addTaskRowHtml(p.id)}
    </div>
    <div class="subsection">
      <div class="subsection-head"><h3>Ideas</h3></div>
      ${p.ideas.length ? p.ideas.map(i => ideaRowHtml(p.id, i)).join('') : emptyInline('No ideas noted yet.')}
      ${addIdeaRowHtml(p.id)}
    </div>
    <div class="subsection">
      <div class="subsection-head"><h3>Notes</h3></div>
      <textarea class="notes-box" data-notes-for="${p.id}" placeholder="Anything worth remembering about this project...">${escapeHtml(p.notes || '')}</textarea>
    </div>
  `;
}

function renderProjects() {
  const el = document.getElementById('view-projects');
  el.classList.add('view-wide');
  const query = (state.projectSearch || '').trim().toLowerCase();
  const filterMode = state.projectFilter || 'all';
  const matchesQuery = p => {
    if (!query) return true;
    const haystack = [
      p.name,
      p.description,
      p.githubOwner,
      p.githubRepo,
      p.status,
      (p.health && p.health.language) || '',
      (p.tags || []).join(' '),
      (p.ideas || []).map(i => i.text).join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  };
  const matchesFilter = p => {
    if (filterMode === 'all') return true;
    if (filterMode === 'updated') return !p.updatedAt || (Date.now() - new Date(p.updatedAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
    if (filterMode === 'stale') return p.health ? ['orange', 'red'].includes(healthLevel(p.health)) : (p.githubOwner && p.githubRepo);
    if (filterMode === 'healthy') return !p.health || ['green', 'yellow'].includes(healthLevel(p.health));
    if (filterMode === 'github') return !!(p.githubOwner && p.githubRepo);
    return true;
  };
  const visibleProjects = state.projects.filter(p => matchesQuery(p) && matchesFilter(p));
  const groups = { active: [], paused: [], completed: [] };
  visibleProjects.forEach(p => groups[p.status].push(p));
  const listHtml = ['active', 'paused', 'completed'].map(status => {
    if (!groups[status].length) return '';
    return `<div class="projects-group-label">${capitalize(status)} (${groups[status].length})</div>` + groups[status].map(projectRowHtml).join('');
  }).join('');

  if (!state.activeProjectId && state.projects.length) state.activeProjectId = state.projects[0].id;
  const activeProject = findProject(state.activeProjectId);
  const filterTabs = ['all', 'updated', 'stale', 'healthy', 'github'].map(id => {
    const label = { all: 'All', updated: 'Updated', stale: 'Stale', healthy: 'Healthy', github: 'GitHub' }[id];
    return `<button class="project-filter-tab ${state.projectFilter === id ? 'active' : ''}" data-action="filter-projects" data-id="${id}">${escapeHtml(label)}</button>`;
  }).join('');

  el.innerHTML = `
    <div class="projects-layout ${state.showingDetailMobile ? 'showing-detail' : ''}">
      <div class="projects-list-pane">
        <button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:14px;" data-action="new-project">${icon('plus')} New project</button>
        <div class="project-filter-row">${filterTabs}</div>
        <div class="project-search-wrap">
          ${icon('search')}
          <input type="text" id="project-search-input" class="project-search-input" placeholder="Search projects…" value="${escapeAttr(state.projectSearch || '')}" autocomplete="off">
          ${query ? `<button class="project-search-clear" data-action="clear-project-search" aria-label="Clear search">${icon('close')}</button>` : ''}
        </div>
        ${state.projects.length
          ? (visibleProjects.length ? listHtml : emptyInline('No projects match your search.'))
          : emptyInline('Create your first project to get started.')}
      </div>
      <div class="projects-detail-pane">
        ${activeProject ? projectDetailHtml(activeProject) : emptyStateBlock('folder', 'No project selected', 'Pick a project from the list, or create a new one.')}
      </div>
    </div>
  `;

  const searchInput = document.getElementById('project-search-input');
  if (searchInput) {
    if (state.projectSearchFocused) {
      const pos = searchInput.value.length;
      searchInput.focus();
      searchInput.setSelectionRange(pos, pos);
    }
    searchInput.addEventListener('focus', () => { state.projectSearchFocused = true; });
    searchInput.addEventListener('blur', () => { state.projectSearchFocused = false; });
    searchInput.addEventListener('input', () => {
      state.projectSearch = searchInput.value;
      renderProjects();
    });
  }

  if (activeProject && activeProject.githubOwner && activeProject.githubRepo && state.settings.githubToken) {
    const stale = !activeProject.health || (Date.now() - activeProject.health.fetchedAt) > 15 * 60 * 1000;
    const recentlyFailed = activeProject.healthFetchFailedAt && (Date.now() - activeProject.healthFetchFailedAt) < 5 * 60 * 1000;
    if (stale && !recentlyFailed && !fetchingHealthIds.has(activeProject.id)) {
      fetchingHealthIds.add(activeProject.id);
      fetchProjectHealth(activeProject).then(h => {
        fetchingHealthIds.delete(activeProject.id);
        if (h) { activeProject.health = h; delete activeProject.healthFetchFailedAt; persistProjects(); checkNewIssues(activeProject, h); }
        else { activeProject.healthFetchFailedAt = Date.now(); }
        if (state.tab === 'projects' && state.activeProjectId === activeProject.id) renderProjects();
      });
    }
  }
  ensureHealthForProjects(state.projects);
}

function ensureHealthForProjects(list) {
  if (!state.settings.githubToken) return;
  const candidates = list.filter(p => p.githubOwner && p.githubRepo)
    .filter(p => !p.health || (Date.now() - p.health.fetchedAt) > 15 * 60 * 1000)
    .filter(p => !p.healthFetchFailedAt || (Date.now() - p.healthFetchFailedAt) > 5 * 60 * 1000)
    .filter(p => !fetchingHealthIds.has(p.id))
    .slice(0, 5);
  candidates.forEach(p => {
    fetchingHealthIds.add(p.id);
    fetchProjectHealth(p).then(h => {
      fetchingHealthIds.delete(p.id);
      if (h) {
        p.health = h;
        delete p.healthFetchFailedAt;
        persistProjects();
        checkNewIssues(p, h);
      } else {
        p.healthFetchFailedAt = Date.now();
      }
      if (state.tab === 'home') renderHome();
      if (state.tab === 'projects') renderProjects();
    });
  });
}

function checkNewIssues(p, h) {
  if (!h || !h.openIssuesList) return;
  const handled = new Set(p.githubIssueHandled || []);
  const existingTaskNumbers = new Set(p.tasks.filter(t => t.source === 'github').map(t => t.githubNumber));
  h.openIssuesList.forEach(iss => {
    if (handled.has(iss.number) || existingTaskNumbers.has(iss.number)) return;
    if (state.issueSuggestions.some(s => s.projectId === p.id && s.issue.number === iss.number)) return;
    state.issueSuggestions.push({ id: uid(), projectId: p.id, projectName: p.name, issue: iss });
  });
}

function issueSuggestionHtml(s) {
  return `<div class="issue-suggest-card">
    <div class="issue-suggest-top">${icon('alert')}<span>New GitHub issue detected</span></div>
    <div class="issue-suggest-repo">${escapeHtml(s.projectName)}</div>
    <div class="issue-suggest-title">#${s.issue.number} ${escapeHtml(s.issue.title)}</div>
    <div class="issue-suggest-q">Create a local task for this?</div>
    <div class="issue-suggest-actions">
      <button class="btn btn-primary btn-sm" data-action="accept-issue-task" data-id="${s.id}">${icon('plus')} Add task</button>
      <button class="btn btn-ghost btn-sm" data-action="ignore-issue-task" data-id="${s.id}">Ignore</button>
    </div>
  </div>`;
}

const NEWS_ICON = { star: 'star', fork: 'fork', pr: 'pr', follow: 'userplus' };
function newsItemHtml(n) {
  const text = {
    star: `<b>${escapeHtml(n.actorLogin)}</b> starred <b>${escapeHtml(shortRepo(n.repoFullName))}</b>`,
    fork: `<b>${escapeHtml(n.actorLogin)}</b> forked <b>${escapeHtml(shortRepo(n.repoFullName))}</b>`,
    pr: `<b>${escapeHtml(n.actorLogin)}</b> opened a pull request in <b>${escapeHtml(shortRepo(n.repoFullName))}</b>`,
    follow: `<b>${escapeHtml(n.actorLogin)}</b> started following you`,
  }[n.type];
  const sub = n.type === 'pr' ? `#${n.prNumber} ${n.prTitle}` : n.type === 'follow' ? `@${n.actorLogin}` : n.repoFullName;
  const href = n.type === 'follow' ? `https://github.com/${n.actorLogin}`
    : n.type === 'pr' ? `https://github.com/${n.repoFullName}/pull/${n.prNumber}`
    : `https://github.com/${n.repoFullName}`;
  return `<a class="news-item ${n.read ? '' : 'unread'}" href="${escapeAttr(href)}" target="_blank" rel="noopener">
    ${!n.read ? `<span class="news-unread-dot"></span>` : ''}
    <div class="news-icon ${n.type}">${icon(NEWS_ICON[n.type])}</div>
    <div class="news-body"><div class="news-title">${text}</div><div class="news-sub">${escapeHtml(sub)}</div></div>
    <div class="news-time">${timeAgo(n.createdAt)}</div>
    ${icon('externallink')}
  </a>`;
}

const NEWS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'star', label: 'Stars' },
  { id: 'fork', label: 'Forks' },
  { id: 'pr', label: 'Pull requests' },
  { id: 'follow', label: 'Followers' },
];

function renderNews() {
  const el = document.getElementById('view-news');
  if (!state.settings.githubToken) {
    el.innerHTML = emptyStateBlock('github', 'Connect GitHub to see activity',
      'See stars, forks, pull requests and new followers on your repos as they happen.',
      'Connect GitHub', 'set-tab', 'settings');
    return;
  }
  if (!state.news.length) {
    el.innerHTML = emptyStateBlock('bell', 'No activity yet',
      'When someone stars, forks, opens a pull request, or follows you, it shows up here.');
    return;
  }
  const filter = state.newsFilter || 'all';
  const filtered = filter === 'all' ? state.news : state.news.filter(n => n.type === filter);
  const groups = groupByDay(filtered);
  const tabs = `<div class="news-filter-tabs">${NEWS_FILTERS.map(f => {
    const count = f.id === 'all' ? state.news.length : state.news.filter(n => n.type === f.id).length;
    return `<button class="news-filter-tab ${filter === f.id ? 'active' : ''}" data-action="filter-news" data-id="${f.id}">${escapeHtml(f.label)}${count ? ` <span class="news-filter-count">${count}</span>` : ''}</button>`;
  }).join('')}</div>`;
  const body = groups.length
    ? groups.map(g => `<div class="news-day-label">${g.label}</div><div class="news-day-group">${g.items.map(newsItemHtml).join('')}</div>`).join('')
    : emptyInline(`No ${NEWS_FILTERS.find(f => f.id === filter).label.toLowerCase()} yet.`);
  el.innerHTML = tabs + body;
}

/* ==========================================================================
   Settings — multi-page (iOS-style) shell
   ========================================================================== */
const SETTINGS_NAV = [
  { id: 'profile', label: 'Profile', icon: 'user', color: 'si-blue' },
  { id: 'general', label: 'General', icon: 'sliders', color: 'si-gray' },
  { id: 'github', label: 'GitHub', icon: 'github', color: 'si-gray' },
  { id: 'appearance', label: 'Appearance', icon: 'sun', color: 'si-orange' },
  { id: 'install', label: 'Install App', icon: 'download', color: 'si-green' },
  { id: 'data', label: 'Data', icon: 'database', color: 'si-teal' },
  { id: 'privacy', label: 'Data & Privacy', icon: 'shield', color: 'si-purple2' },
  { id: 'legal', label: 'Legal', icon: 'scale', color: 'si-red' },
];

function goSettingsPage(id) {
  state.settingsPage = id;
  state.settingsShowingPage = true;
  state.legalDoc = null;
  renderSettings();
}
function settingsBackToList() {
  state.settingsShowingPage = false;
  renderSettings();
}

function renderSettings() {
  const nav = document.getElementById('view-settings');
  const navHtml = SETTINGS_NAV.map(item => `
    <button class="settings-nav-item ${state.settingsPage === item.id ? 'active' : ''}" data-action="goto-settings" data-id="${item.id}">
      <span class="settings-nav-icon ${item.color}">${icon(item.icon)}</span>
      <span>${item.label}</span>
      ${icon('chevronright')}
    </button>`).join('');

  nav.innerHTML = `
    <div class="settings-shell ${state.settingsShowingPage ? 'showing-page' : ''}">
      <div class="settings-nav">${navHtml}</div>
      <div class="settings-content">
        <button class="btn btn-ghost btn-sm settings-back" data-action="settings-back">${icon('chevronleft')} Settings</button>
        ${settingsPageContent(state.settingsPage)}
      </div>
    </div>
  `;
  wireSettingsPageEvents(state.settingsPage);
}

function settingsPageContent(page) {
  switch (page) {
    case 'profile': return settingsProfilePage();
    case 'general': return settingsGeneralPage();
    case 'github': return settingsGithubPage();
    case 'appearance': return settingsAppearancePage();
    case 'install': return settingsInstallPage();
    case 'data': return settingsDataPage();
    case 'privacy': return settingsPrivacyPage();
    case 'legal': return settingsLegalPage();
    default: return '';
  }
}

function pageTitle(icn, title) {
  return `<div class="settings-page-title"><h2>${escapeHtml(title)}</h2></div>`;
}

function settingsProfilePage() {
  const acc = state.account || {};
  return `
    ${pageTitle('user', 'Profile')}
    <div class="profile-hero">
      <div class="avatar-fallback profile-avatar-lg">${escapeHtml(initials(acc.name))}</div>
      <div>
        <div class="profile-name">${escapeHtml(acc.name || '')}</div>
        <div class="profile-email">${escapeHtml(acc.email || '')}</div>
      </div>
    </div>
    <div class="settings-section">
      <h2>Account</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Name</div></div>
          <input type="text" id="pr-name" value="${escapeAttr(acc.name || '')}" style="max-width:180px;background:var(--surface);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--text);font-size:13px;text-align:right;">
        </div>
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Email</div></div>
          <input type="email" id="pr-email" value="${escapeAttr(acc.email || '')}" style="max-width:200px;background:var(--surface);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:7px 10px;color:var(--text);font-size:13px;text-align:right;">
        </div>
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Member since</div><div class="settings-row-sub">${escapeHtml(fullDate(acc.createdAt))}</div></div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" id="pr-save" style="align-self:flex-start;">Save changes</button>
    </div>
    <div class="settings-section">
      <h2>Session</h2>
      <div class="settings-group">
        <div class="settings-row clickable" data-action="log-out">
          <span class="settings-nav-icon si-red" style="width:28px;height:28px;">${icon('logout')}</span>
          <div class="settings-row-main"><div class="settings-row-title" style="color:var(--urgent);">Log out</div><div class="settings-row-sub">You can sign back in with your password.</div></div>
        </div>
      </div>
    </div>
  `;
}

function settingsGeneralPage() {
  return `
    ${pageTitle('sliders', 'General')}
    <div class="settings-section">
      <h2>Activity</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Auto-refresh GitHub activity</div><div class="settings-row-sub">Check for new activity every 5 minutes while the app is open.</div></div>
          <label class="switch"><input type="checkbox" id="gen-autorefresh" ${state.prefs.autoRefresh ? 'checked' : ''}><span class="switch-track"></span><span class="switch-thumb"></span></label>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h2>Motion</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Reduce motion</div><div class="settings-row-sub">Minimize animations throughout RepoDesk.</div></div>
          <label class="switch"><input type="checkbox" id="gen-reducemotion" ${state.prefs.reduceMotion ? 'checked' : ''}><span class="switch-track"></span><span class="switch-thumb"></span></label>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h2>About</h2>
      <div class="settings-group">
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">Version</div></div><div class="settings-row-sub">1.0</div></div>
      </div>
    </div>
  `;
}

function settingsGithubPage() {
  const s = state.settings;
  if (s.githubToken) {
    const stale = !s.profileStats || (Date.now() - s.profileStats.fetchedAt) > 15 * 60 * 1000;
    const recentlyFailed = s.profileStatsFailedAt && (Date.now() - s.profileStatsFailedAt) < 5 * 60 * 1000;
    if (stale && !recentlyFailed && !fetchingGhStats) {
      fetchingGhStats = true;
      fetchGithubProfileStats().then(stats => {
        fetchingGhStats = false;
        if (stats) { state.settings.profileStats = stats; delete state.settings.profileStatsFailedAt; }
        else { state.settings.profileStatsFailedAt = Date.now(); }
        persistSettings();
        if (state.tab === 'settings' && state.settingsPage === 'github') renderSettings();
      }).catch(() => {
        fetchingGhStats = false;
        state.settings.profileStatsFailedAt = Date.now();
        persistSettings();
      });
    }
  }
  return `
    ${pageTitle('github', 'GitHub')}
    <div class="settings-section">
      ${s.githubToken ? githubConnectedCardHtml(s) : githubConnectCardHtml()}
    </div>
    ${s.githubToken ? githubConnectionsPanelHtml() : ''}
    ${s.githubToken ? githubImportPanelHtml() : ''}
  `;
}

function settingsAppearancePage() {
  const t = state.theme;
  return `
    ${pageTitle('sun', 'Appearance')}
    <div class="settings-section">
      <h2>Theme</h2>
      <div class="segmented" id="theme-segmented">
        <button data-theme-choice="light" class="${t === 'light' ? 'active' : ''}">${icon('sun')} Light</button>
        <button data-theme-choice="dark" class="${t === 'dark' ? 'active' : ''}">${icon('moon')} Dark</button>
        <button data-theme-choice="system" class="${t === 'system' ? 'active' : ''}">${icon('monitor')} System</button>
      </div>
      <div class="field-hint" style="padding-left:4px;">System matches your device's light/dark setting automatically.</div>
    </div>
  `;
}

function settingsInstallPage() {
  const installed = isStandalone();
  return `
    ${pageTitle('download', 'Install App')}
    <div class="install-hero">
      <img src="icons/icon-192.png" class="install-hero-icon" alt="">
      <h3>RepoDesk</h3>
      ${installed
        ? `<span class="install-badge">${icon('checkcircle')} Installed as an app on this device</span>`
        : `<p>Add RepoDesk to your Home Screen for a full-screen, app-like experience — no browser bar, faster launch, offline-friendly icon.</p>`}
      ${(!installed && deferredInstallPrompt) ? `<button class="btn btn-primary" id="install-native-btn">${icon('download')} Install RepoDesk</button>` : ''}
    </div>
    ${!installed ? `
    <div class="install-steps">
      <div class="install-step-card">
        <div class="install-step-card-head">${icon('apple')} iOS Safari</div>
        <ol class="install-step-list">
          <li>Tap the <b>Share</b> icon in Safari's toolbar.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
          <li>Tap <b>Add</b> in the top-right corner.</li>
        </ol>
      </div>
      <div class="install-step-card">
        <div class="install-step-card-head">${icon('smartphone')} Android Chrome</div>
        <ol class="install-step-list">
          <li>Tap the <b>⋮</b> menu in the top-right corner.</li>
          <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
          <li>Confirm by tapping <b>Install</b>.</li>
        </ol>
      </div>
      <div class="install-step-card">
        <div class="install-step-card-head">${icon('laptop')} Desktop (Chrome / Edge)</div>
        <ol class="install-step-list">
          <li>Look for an install icon in the address bar, or open the browser menu.</li>
          <li>Choose <b>Install RepoDesk…</b></li>
          <li>Confirm to open RepoDesk in its own window.</li>
        </ol>
      </div>
    </div>` : ''}
  `;
}

function settingsDataPage() {
  return `
    ${pageTitle('database', 'Data')}
    <div class="settings-section">
      <h2>Backup</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Export data</div><div class="settings-row-sub">Save all projects as a JSON file.</div></div>
          <button class="btn btn-primary btn-sm" data-action="export-data">Export</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-main"><div class="settings-row-title">Import data</div><div class="settings-row-sub">Restore from a previously exported file.</div></div>
          <button class="btn btn-ghost btn-sm" data-action="import-data">Import</button>
        </div>
      </div>
      <input type="file" id="import-file-input" accept="application/json" style="display:none">
    </div>
    <div class="settings-section">
      <h2>Storage</h2>
      <div class="settings-group">
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">Projects stored</div></div><div class="settings-row-sub">${state.projects.length}</div></div>
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">Activity items stored</div></div><div class="settings-row-sub">${state.news.length}</div></div>
      </div>
    </div>
    <div class="settings-section">
      <h2>Danger zone</h2>
      <div class="danger-zone">
        <div class="danger-row">
          <div><div class="danger-row-title">Clear all projects</div><div class="danger-row-sub">Delete every project, task and note. This cannot be undone.</div></div>
          <button class="btn btn-danger btn-sm" data-action="clear-data">Clear</button>
        </div>
      </div>
    </div>
  `;
}

function settingsPrivacyPage() {
  return `
    ${pageTitle('shield', 'Data & Privacy')}
    <div class="settings-section">
      <h2>What stays on this device</h2>
      <div class="settings-group">
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">Account &amp; profile</div><div class="settings-row-sub">Your name, email and password are stored only in this browser's local storage.</div></div></div>
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">Projects, tasks &amp; notes</div><div class="settings-row-sub">Never leave your device except when you choose to export them.</div></div></div>
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">GitHub token</div><div class="settings-row-sub">Stored locally and sent only to api.github.com, directly from your browser.</div></div></div>
      </div>
    </div>
    <div class="settings-section">
      <h2>What we don't do</h2>
      <div class="settings-group">
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">No servers</div><div class="settings-row-sub">RepoDesk has no backend — nothing is uploaded anywhere.</div></div></div>
        <div class="settings-row"><div class="settings-row-main"><div class="settings-row-title">No analytics or tracking</div><div class="settings-row-sub">No cookies, no third-party trackers, no ads.</div></div></div>
      </div>
    </div>
    <div class="settings-section">
      <h2>Danger zone</h2>
      <div class="danger-zone">
        <div class="danger-row">
          <div><div class="danger-row-title">Delete account &amp; all data</div><div class="danger-row-sub">Permanently erases your account, GitHub connection and every project on this device.</div></div>
          <button class="btn btn-danger btn-sm" data-action="delete-account">Delete</button>
        </div>
      </div>
    </div>
  `;
}

const LEGAL_DOCS = {
  terms: { title: 'Terms of Service', icon: 'doc' },
  privacy: { title: 'Privacy Policy', icon: 'shield' },
  acceptable: { title: 'Acceptable Use Policy', icon: 'checkcircle' },
  licenses: { title: 'Open-Source & Third-Party Notices', icon: 'scale' },
};

function settingsLegalPage() {
  if (state.legalDoc) return legalDocDetail(state.legalDoc);
  const rows = Object.entries(LEGAL_DOCS).map(([key, d]) => `
    <div class="settings-row clickable" data-action="open-legal-doc" data-id="${key}">
      <span class="settings-nav-icon si-gray" style="width:28px;height:28px;">${icon(d.icon)}</span>
      <div class="settings-row-main"><div class="settings-row-title">${escapeHtml(d.title)}</div></div>
      ${icon('chevronright')}
    </div>`).join('');
  return `
    ${pageTitle('scale', 'Legal')}
    <div class="settings-section">
      <h2>Documents</h2>
      <div class="settings-group">${rows}</div>
    </div>
  `;
}

function legalDocDetail(key) {
  const d = LEGAL_DOCS[key];
  return `
    <div class="settings-page-title">
      <button class="btn btn-ghost btn-sm" data-action="legal-back">${icon('chevronleft')}</button>
      <h2>${escapeHtml(d.title)}</h2>
    </div>
    <div class="legal-doc">${legalDocBody(key)}</div>
  `;
}

function legalDocBody(key) {
  const updated = `<div class="legal-updated">Last updated: January 1, 2026</div>`;
  if (key === 'terms') return updated + `
    <p>These Terms of Service ("Terms") govern your use of RepoDesk, a client-side web application that runs entirely in your browser. By using RepoDesk, you agree to these Terms.</p>
    <h3>1. The service</h3>
    <p>RepoDesk has no server or backend. All information you enter — projects, tasks, notes and your local profile — is stored only in your browser's local storage on your device. If you optionally connect a GitHub personal access token, requests are made directly from your browser to GitHub's API; RepoDesk does not operate any intermediary server that sees or stores that traffic.</p>
    <h3>2. Your account</h3>
    <p>The account you create is local to this device and browser. There is no central directory of accounts, and RepoDesk cannot recover a lost password on your behalf — if you clear your browser data or lose your password, you will need to create a new local account.</p>
    <h3>3. Acceptable use</h3>
    <p>You agree not to use RepoDesk to violate any applicable law, to interfere with GitHub's services in a manner that breaches GitHub's own terms, or to attempt to reverse engineer the application for malicious purposes. See our Acceptable Use Policy for further detail.</p>
    <h3>4. Third-party services</h3>
    <p>If you connect GitHub, your use of GitHub's API is additionally governed by GitHub's own Terms of Service and Privacy Statement. RepoDesk is not affiliated with or endorsed by GitHub, Inc.</p>
    <h3>5. Disclaimer of warranties</h3>
    <p>RepoDesk is provided "as is" and "as available," without warranties of any kind, express or implied, including fitness for a particular purpose, merchantability, or non-infringement. Because all data lives in local browser storage, you are solely responsible for backing up important information using the export feature.</p>
    <h3>6. Limitation of liability</h3>
    <p>To the fullest extent permitted by law, RepoDesk and its authors are not liable for any indirect, incidental, or consequential damages arising from your use of the application, including loss of data stored locally in your browser.</p>
    <h3>7. Changes</h3>
    <p>We may update these Terms from time to time. Continued use of RepoDesk after changes are posted constitutes acceptance of the revised Terms.</p>
    <h3>8. Contact</h3>
    <p>Questions about these Terms can be directed to the maintainer listed in the project's repository.</p>
  `;
  if (key === 'privacy') return updated + `
    <p>This Privacy Policy explains what information RepoDesk handles and how, in plain terms.</p>
    <h3>1. No servers, no accounts database</h3>
    <p>RepoDesk does not have a backend. There is no server that receives, stores, or processes your personal information. Everything you see in the app — your profile, projects, tasks, notes and settings — is written to your browser's local storage on your own device.</p>
    <h3>2. Information you provide</h3>
    <ul>
      <li><b>Profile:</b> the name, email and password you enter when creating your local account. These stay on this device only; the password is hashed before it is stored.</li>
      <li><b>Projects &amp; tasks:</b> anything you type into RepoDesk to organize your work.</li>
      <li><b>GitHub token (optional):</b> a personal access token you generate on GitHub. It is stored locally and used only to call api.github.com directly from your browser — RepoDesk never transmits it anywhere else.</li>
    </ul>
    <h3>3. Cookies and tracking</h3>
    <p>RepoDesk does not use cookies, analytics, fingerprinting, or advertising identifiers of any kind.</p>
    <h3>4. Data retention and deletion</h3>
    <p>Data persists in local storage until you clear it. You can remove individual projects, use Clear Data to wipe all projects, or use Delete Account to remove everything including your local profile, in Settings → Data &amp; Privacy.</p>
    <h3>5. Children's privacy</h3>
    <p>RepoDesk is not directed at children under 13 and does not knowingly collect information from them — in practice, because nothing is collected by us at all.</p>
    <h3>6. Changes to this policy</h3>
    <p>If this policy changes, the "Last updated" date above will change accordingly.</p>
    <h3>7. Contact</h3>
    <p>For privacy questions, reach out via the contact listed in the project's repository.</p>
  `;
  if (key === 'acceptable') return updated + `
    <p>RepoDesk is a personal productivity tool. When you optionally connect it to GitHub, please:</p>
    <ul>
      <li>Only use personal access tokens you are authorized to use.</li>
      <li>Respect GitHub's own Acceptable Use Policies and rate limits — RepoDesk makes requests using your token and on your behalf.</li>
      <li>Do not use RepoDesk to automate abusive, spammy, or harassing activity toward other GitHub users or repositories.</li>
      <li>Do not attempt to use the app to gain unauthorized access to any account, repository, or system.</li>
    </ul>
    <p>Violating these guidelines may result in consequences imposed by GitHub directly on your GitHub account, independent of RepoDesk.</p>
  `;
  if (key === 'licenses') return updated + `
    <p>RepoDesk is built with plain HTML, CSS and JavaScript, with no bundled third-party libraries or frameworks.</p>
    <h3>Third-party services</h3>
    <p>When you connect GitHub, RepoDesk calls GitHub's public REST API (api.github.com) directly from your browser using the token you provide. That usage is subject to GitHub's own terms.</p>
    <h3>Fonts &amp; icons</h3>
    <p>RepoDesk uses your device's built-in system font stack and a small set of hand-drawn interface icons included with the app — no external font or icon services are loaded.</p>
  `;
  return '';
}

function githubConnectCardHtml() {
  return `<div class="gh-card">
    <div class="gh-connect-steps">
      <div class="gh-step"><div class="gh-step-num">1</div><div class="gh-step-text">Open <a href="https://github.com/settings/tokens/new?description=RepoDesk&scopes=repo,read:user,notifications" target="_blank" rel="noopener">github.com/settings/tokens/new</a> and sign in to your GitHub account.</div></div>
      <div class="gh-step"><div class="gh-step-num">2</div><div class="gh-step-text">Grant these scopes, then generate the token.
        <div class="gh-scopes"><span class="scope-chip">repo</span><span class="scope-chip">read:user</span><span class="scope-chip">notifications</span></div>
      </div></div>
      <div class="gh-step"><div class="gh-step-num">3</div><div class="gh-step-text">Copy the token and paste it below. It's saved only in this browser, never sent anywhere else.</div></div>
    </div>
    <div class="field">
      <label>Personal access token</label>
      <div class="gh-token-row">
        <input type="password" id="gh-token-input" placeholder="ghp_..." data-enter="connect-github" data-id="">
        <button class="btn btn-primary" data-action="connect-github">Connect</button>
      </div>
      ${state.settingsError ? `<div class="gh-error">${escapeHtml(state.settingsError)}</div>` : ''}
    </div>
  </div>`;
}
function githubConnectedCardHtml(s) {
  const st = s.profileStats;
  return `<div class="gh-card">
    <div class="gh-connected-top">
      <img class="gh-avatar" src="${escapeAttr(s.githubAvatar)}" alt="">
      <div><div class="gh-name">${escapeHtml(s.githubName || s.githubLogin)}</div><div class="gh-handle">@${escapeHtml(s.githubLogin)}</div></div>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="disconnect-github">Disconnect</button>
    </div>
    <div class="gh-stat-grid">
      <button class="gh-stat-tile" data-action="view-gh-connections" data-id="followers">
        <b>${st ? st.followers : (s.followers ?? '—')}</b><span>Followers</span>
      </button>
      <button class="gh-stat-tile" data-action="view-gh-connections" data-id="following">
        <b>${st ? st.following : '—'}</b><span>Following</span>
      </button>
      <div class="gh-stat-tile"><b>${st ? st.publicRepos : (s.publicRepos ?? '—')}</b><span>Repos</span></div>
      <div class="gh-stat-tile"><b>${st ? st.starsReceived : '—'}</b><span>Stars earned</span></div>
      <div class="gh-stat-tile"><b>${st ? st.forksReceived : '—'}</b><span>Forks</span></div>
      <div class="gh-stat-tile"><b>${st ? st.pullRequests : '—'}</b><span>Pull requests</span></div>
      <div class="gh-stat-tile"><b>${st ? st.issues : '—'}</b><span>Issues</span></div>
      <div class="gh-stat-tile"><b>${st ? st.discussions : '—'}</b><span>Discussions</span></div>
      <div class="gh-stat-tile"><b>${st ? st.starredRepos : '—'}</b><span>Starred</span></div>
      <div class="gh-stat-tile"><b>${st ? st.contributedTo : '—'}</b><span>Contributed to</span></div>
      <div class="gh-stat-tile"><b>${timeAgo(s.connectedAt)}</b><span>Connected</span></div>
    </div>
    ${!st ? `<div class="field-hint" style="padding-left:2px;">${icon('refresh')} Loading your full GitHub profile stats…</div>` : ''}
  </div>`;
}

function githubConnectionsPanelHtml() {
  if (!state.ghConnectionsView) return '';
  const kind = state.ghConnectionsView;
  const cached = ghConnectionsCache[kind];
  return `<div class="settings-section">
    <div class="settings-page-title" style="margin-bottom:6px;">
      <button class="btn btn-ghost btn-sm" data-action="close-gh-connections">${icon('chevronleft')}</button>
      <h2 style="text-transform:capitalize;">${kind}</h2>
    </div>
    <div class="gh-connections-list">
      ${cached === null ? emptyInline('Loading…') : (
        cached.length ? cached.map(u => `
          <a class="gh-connection-row" href="${escapeAttr(u.html_url)}" target="_blank" rel="noopener">
            <img src="${escapeAttr(u.avatar_url)}" alt="">
            <span class="gh-connection-login">@${escapeHtml(u.login)}</span>
            ${icon('externallink')}
          </a>`).join('') : emptyInline(`No ${kind} yet.`)
      )}
    </div>
  </div>`;
}

function githubImportPanelHtml() {
  return `<div class="settings-section">
    <h2>Import from GitHub</h2>
    <div class="settings-group">
      <div class="settings-row">
        <div class="settings-row-main"><div class="settings-row-title">Import repositories</div><div class="settings-row-sub">Pick which of your GitHub repos become RepoDesk projects.</div></div>
        <button class="btn btn-primary btn-sm" data-action="open-github-import">${icon('download')} Import…</button>
      </div>
    </div>
  </div>`;
}

function visibleImportRepos() {
  const list = ghImportState.repos || [];
  const q = ghImportState.filter.trim().toLowerCase();
  if (!q) return list;
  return list.filter(r => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
}

function openGithubImportModal() {
  ghImportState = { loading: true, repos: null, checked: new Set(), error: null, filter: '' };
  openModal(githubImportModalBody(), 'modal-wide');
  ghListRepos().then(repos => {
    ghImportState.loading = false;
    ghImportState.repos = repos;
    const existing = new Set(state.projects.filter(p => p.githubOwner && p.githubRepo).map(p => `${p.githubOwner}/${p.githubRepo}`.toLowerCase()));
    repos.forEach(r => { if (!existing.has(r.full_name.toLowerCase()) && !r.archived) ghImportState.checked.add(r.full_name); });
    renderGithubImportModal();
  }).catch(() => {
    ghImportState.loading = false;
    ghImportState.error = 'Could not load your repositories. Check your connection and token scopes.';
    renderGithubImportModal();
  });
}

function renderGithubImportModal() {
  if (!document.getElementById('modal-overlay')) return;
  document.querySelector('.modal-panel').innerHTML = githubImportModalBody();
  const search = document.getElementById('gh-import-search');
  if (search) {
    search.focus();
    const pos = search.value.length;
    search.setSelectionRange(pos, pos);
    search.addEventListener('input', () => { ghImportState.filter = search.value; renderGithubImportModal(); });
  }
}

function githubImportModalBody() {
  if (ghImportState.loading) {
    return `<div class="modal-title">Import from GitHub</div>
      <div class="gh-import-loading">${icon('refresh')} Fetching your repositories…</div>`;
  }
  if (ghImportState.error) {
    return `<div class="modal-title">Import from GitHub</div>
      <p style="color:var(--urgent);font-size:13.5px;">${escapeHtml(ghImportState.error)}</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal-generic">Close</button></div>`;
  }
  const list = visibleImportRepos();
  const existing = new Set(state.projects.filter(p => p.githubOwner && p.githubRepo).map(p => `${p.githubOwner}/${p.githubRepo}`.toLowerCase()));
  const rows = list.map(r => {
    const already = existing.has(r.full_name.toLowerCase());
    const checked = ghImportState.checked.has(r.full_name);
    return `<div class="gh-import-row ${already ? 'already' : ''} ${checked ? 'checked' : ''}" ${already ? '' : `data-action="toggle-import-repo" data-id="${escapeAttr(r.full_name)}"`}>
      <span class="gh-import-check">${already ? icon('check') : (checked ? icon('check') : '')}</span>
      <span class="gh-import-info">
        <span class="gh-import-name">${escapeHtml(r.name)}${r.private ? ` <span class="gh-import-badge">Private</span>` : ''}${r.archived ? ` <span class="gh-import-badge">Archived</span>` : ''}</span>
        <span class="gh-import-desc">${escapeHtml(r.description || 'No description')}</span>
      </span>
      <span class="gh-import-meta">${already ? 'Already added' : `${icon('star')} ${r.stargazers_count}`}</span>
    </div>`;
  }).join('');
  return `
    <div class="modal-title">Import from GitHub</div>
    <div class="gh-import-toolbar">
      <div class="project-search-wrap" style="flex:1;">
        ${icon('search')}
        <input type="text" id="gh-import-search" class="project-search-input" placeholder="Filter repositories…" value="${escapeAttr(ghImportState.filter)}" autocomplete="off">
      </div>
      <button class="btn btn-ghost btn-sm" data-action="import-select-all">Select all</button>
      <button class="btn btn-ghost btn-sm" data-action="import-select-none">None</button>
    </div>
    <div class="gh-import-list">${list.length ? rows : emptyInline('No repositories match.')}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="close-modal-generic">Cancel</button>
      <button class="btn btn-primary" data-action="confirm-import-repos">Import ${ghImportState.checked.size ? `(${ghImportState.checked.size})` : ''}</button>
    </div>
  `;
}

function wireSettingsPageEvents(page) {
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) fileInput.addEventListener('change', handleImportFile);

  if (page === 'profile') {
    const saveBtn = document.getElementById('pr-save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const name = document.getElementById('pr-name').value.trim();
      const email = document.getElementById('pr-email').value.trim();
      if (!name || !isValidEmail(email)) { showToast('Enter a valid name and email'); return; }
      state.account.name = name;
      state.account.email = email;
      persistAccount();
      renderSidebarAccount();
      showToast('Profile updated');
    });
  }
  if (page === 'general') {
    const ar = document.getElementById('gen-autorefresh');
    if (ar) ar.addEventListener('change', () => {
      state.prefs.autoRefresh = ar.checked;
      persistPrefs();
      maybeStartNewsPolling();
      showToast(ar.checked ? 'Auto-refresh on' : 'Auto-refresh off');
    });
    const rm = document.getElementById('gen-reducemotion');
    if (rm) rm.addEventListener('change', () => {
      state.prefs.reduceMotion = rm.checked;
      persistPrefs();
      applyTheme();
    });
  }
  if (page === 'appearance') {
    document.querySelectorAll('[data-theme-choice]').forEach(btn => {
      btn.addEventListener('click', () => setTheme(btn.dataset.themeChoice));
    });
  }
  if (page === 'install') {
    const installBtn = document.getElementById('install-native-btn');
    if (installBtn) installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      renderSettings();
    });
  }
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.projects)) {
        state.projects = data.projects;
        persistProjects();
        showToast('Data imported');
        setTab('projects');
      } else {
        showToast('That file has no projects in it');
      }
    } catch (err) { showToast('Could not read that file'); }
  };
  reader.readAsText(file);
}

/* ==========================================================================
   Install prompt (Add to Home Screen)
   ========================================================================== */
let deferredInstallPrompt = null;
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (state.tab === 'settings' && state.settingsPage === 'install') renderSettings();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (state.tab === 'settings' && state.settingsPage === 'install') renderSettings();
  });
}

/* ==========================================================================
   Handlers
   ========================================================================== */
const handlers = {
  'set-tab': id => setTab(id),
  'goto-settings': id => goSettingsPage(id),
  'settings-back': () => settingsBackToList(),
  'open-legal-doc': id => { state.legalDoc = id; renderSettings(); },
  'legal-back': () => { state.legalDoc = null; renderSettings(); },
  'log-out': () => {
    openConfirm('Log out?', 'You can sign back in any time with your password.', () => logOut(), 'Log out');
  },
  'delete-account': () => {
    openConfirm('Delete account & all data?', 'This permanently erases your local profile, GitHub connection, and every project on this device. This cannot be undone.', () => {
      localStorage.removeItem(DB_KEYS.projects);
      localStorage.removeItem(DB_KEYS.settings);
      localStorage.removeItem(DB_KEYS.news);
      localStorage.removeItem(DB_KEYS.newsMeta);
      localStorage.removeItem(DB_KEYS.account);
      localStorage.removeItem(DB_KEYS.session);
      localStorage.removeItem(DB_KEYS.prefs);
      location.reload();
    }, 'Delete everything');
  },
  'new-project': () => openProjectModal(null),
  'clear-project-search': () => { state.projectSearch = ''; renderProjects(); },
  'filter-projects': id => { state.projectFilter = id; renderProjects(); },
  'edit-project': id => openProjectModal(id),
  'open-project': id => openProject(id),
  'back-to-list': () => { state.showingDetailMobile = false; renderProjects(); },
  'delete-project': id => {
    const p = findProject(id);
    openConfirm('Delete project?', `This permanently deletes "${p.name}" and all of its tasks and notes.`, () => {
      state.projects = state.projects.filter(x => x.id !== id);
      if (state.activeProjectId === id) state.activeProjectId = null;
      persistProjects();
      renderProjects();
      showToast('Project deleted');
    });
  },
  'toggle-task': id => {
    const [pid, tid] = id.split('::');
    const p = findProject(pid);
    const t = p.tasks.find(x => x.id === tid);
    t.done = !t.done;
    persistProjects();
    renderProjects();
  },
  'delete-task': id => {
    const [pid, tid] = id.split('::');
    const p = findProject(pid);
    p.tasks = p.tasks.filter(x => x.id !== tid);
    persistProjects();
    renderProjects();
  },
  'add-task': id => {
    const input = document.querySelector(`[data-new-task="${id}"]`);
    const prioritySel = document.querySelector(`[data-new-task-priority="${id}"]`);
    const text = input.value.trim();
    if (!text) return;
    const p = findProject(id);
    p.tasks.push({ id: uid(), text, priority: prioritySel.value, done: false, source: 'manual', createdAt: new Date().toISOString() });
    persistProjects();
    renderProjects();
  },
  'delete-idea': id => {
    const [pid, iid] = id.split('::');
    const p = findProject(pid);
    p.ideas = p.ideas.filter(x => x.id !== iid);
    persistProjects();
    renderProjects();
  },
  'add-idea': id => {
    const input = document.querySelector(`[data-new-idea="${id}"]`);
    const text = input.value.trim();
    if (!text) return;
    const p = findProject(id);
    p.ideas.push({ id: uid(), text });
    persistProjects();
    renderProjects();
  },
  'fetch-health': async id => {
    const p = findProject(id);
    showToast('Fetching repo status…');
    const h = await fetchProjectHealth(p);
    if (h) { p.health = h; persistProjects(); } else { showToast('Could not fetch repo status'); }
    renderProjects();
  },
  'dismiss-stale': idsStr => { idsStr.split(',').forEach(id => dismissedStale.add(id)); renderHome(); },
  'refresh-news': async () => { await refreshNews(true); renderNews(); renderSidebarNav(); renderBottomNav(); showToast('News refreshed'); },
  'filter-news': id => { state.newsFilter = id; renderNews(); },
  'accept-issue-task': id => {
    const s = state.issueSuggestions.find(x => x.id === id);
    if (!s) return;
    const p = findProject(s.projectId);
    if (p) {
      p.tasks.unshift({ id: uid(), text: s.issue.title, done: false, priority: 'high', source: 'github', githubNumber: s.issue.number });
      p.githubIssueHandled = p.githubIssueHandled || [];
      p.githubIssueHandled.push(s.issue.number);
      p.updatedAt = new Date().toISOString();
      persistProjects();
    }
    state.issueSuggestions = state.issueSuggestions.filter(x => x.id !== id);
    renderHome();
    showToast('Task added from GitHub issue');
  },
  'ignore-issue-task': id => {
    const s = state.issueSuggestions.find(x => x.id === id);
    if (s) {
      const p = findProject(s.projectId);
      if (p) { p.githubIssueHandled = p.githubIssueHandled || []; p.githubIssueHandled.push(s.issue.number); persistProjects(); }
    }
    state.issueSuggestions = state.issueSuggestions.filter(x => x.id !== id);
    renderHome();
  },
  'connect-github': async () => {
    const input = document.getElementById('gh-token-input');
    const token = input.value.trim();
    if (!token) return;
    state.settingsError = null;
    try {
      await ghConnect(token);
      renderSettings();
      renderSidebarAccount();
      renderSidebarNav();
      showToast('GitHub connected');
      refreshNews(true).then(() => { renderSidebarNav(); renderBottomNav(); if (state.tab === 'news') renderNews(); });
    } catch (e) {
      state.settingsError = 'That token could not be verified. Check it and try again.';
      renderSettings();
    }
  },
  'disconnect-github': () => {
    openConfirm('Disconnect GitHub?', 'This removes your token and stops activity syncing.', () => {
      ghDisconnect();
      ghConnectionsCache = { followers: null, following: null };
      state.ghConnectionsView = null;
      renderSettings();
      renderSidebarAccount();
      renderSidebarNav();
      renderBottomNav();
      showToast('GitHub disconnected');
    });
  },
  'view-gh-connections': kind => {
    state.ghConnectionsView = kind;
    renderSettings();
    if (ghConnectionsCache[kind] === null && !fetchingGhConnections) {
      fetchingGhConnections = true;
      ghListConnections(kind).then(list => {
        fetchingGhConnections = false;
        ghConnectionsCache[kind] = list;
        if (state.ghConnectionsView === kind) renderSettings();
      }).catch(() => {
        fetchingGhConnections = false;
        ghConnectionsCache[kind] = [];
        if (state.ghConnectionsView === kind) renderSettings();
      });
    }
  },
  'close-gh-connections': () => { state.ghConnectionsView = null; renderSettings(); },
  'open-github-import': () => { openGithubImportModal(); },
  'close-modal-generic': () => closeModal(),
  'toggle-import-repo': (fullName) => {
    if (ghImportState.checked.has(fullName)) ghImportState.checked.delete(fullName);
    else ghImportState.checked.add(fullName);
    renderGithubImportModal();
  },
  'import-select-all': () => {
    const list = visibleImportRepos();
    list.forEach(r => ghImportState.checked.add(r.full_name));
    renderGithubImportModal();
  },
  'import-select-none': () => {
    const list = visibleImportRepos();
    list.forEach(r => ghImportState.checked.delete(r.full_name));
    renderGithubImportModal();
  },
  'confirm-import-repos': () => {
    const repos = (ghImportState.repos || []).filter(r => ghImportState.checked.has(r.full_name));
    const existing = new Set(state.projects.filter(p => p.githubOwner && p.githubRepo).map(p => `${p.githubOwner}/${p.githubRepo}`.toLowerCase()));
    let added = 0;
    repos.forEach(r => {
      if (existing.has(r.full_name.toLowerCase())) return;
      const now = new Date().toISOString();
      state.projects.unshift({
        id: uid(), name: r.name, description: r.description || '', status: 'active',
        githubOwner: r.owner.login, githubRepo: r.name,
        liveUrl: r.homepage || '', figmaUrl: '', docsUrl: '',
        tasks: [], ideas: [], notes: '', health: null,
        createdAt: now, updatedAt: now,
      });
      added++;
    });
    persistProjects();
    closeModal();
    showToast(added ? `Imported ${added} project${added === 1 ? '' : 's'}` : 'Nothing new to import');
    if (added) { renderProjects(); renderHome(); }
  },
  'export-data': () => {
    const data = { projects: state.projects, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'repodesk-export.json'; a.click();
    URL.revokeObjectURL(url);
  },
  'import-data': () => document.getElementById('import-file-input').click(),
  'clear-data': () => {
    openConfirm('Clear all data?', 'This permanently deletes every project, task and note stored in this browser.', () => {
      state.projects = [];
      persistProjects();
      setTab('home');
      showToast('All data cleared');
    });
  },
};

const changeHandlers = {
  'set-status': (id, value) => {
    const p = findProject(id);
    p.status = value;
    p.updatedAt = new Date().toISOString();
    persistProjects();
    renderProjects();
    if (state.tab === 'home') renderHome();
  },
};

function wireGlobalEvents() {
  document.body.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const fn = handlers[t.dataset.action];
    if (fn) fn(t.dataset.id, t);
  });
  document.body.addEventListener('change', e => {
    const t = e.target.closest('[data-change]');
    if (!t) return;
    const fn = changeHandlers[t.dataset.change];
    if (fn) fn(t.dataset.id, t.value, t);
  });
  document.body.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = e.target.closest('[data-enter]');
    if (!t) return;
    e.preventDefault();
    const fn = handlers[t.dataset.enter];
    if (fn) fn(t.dataset.id, t);
  });
  document.body.addEventListener('focusout', e => {
    const t = e.target.closest && e.target.closest('[data-notes-for]');
    if (!t) return;
    const p = findProject(t.dataset.notesFor);
    if (p) { p.notes = t.value; persistProjects(); }
  });
}

/* ==========================================================================
   News polling
   ========================================================================== */
let newsPollTimer = null;
function maybeStartNewsPolling() {
  clearInterval(newsPollTimer);
  if (!state.prefs.autoRefresh) return;
  if (state.settings.githubToken) {
    refreshNews(false).then(() => { renderSidebarNav(); renderBottomNav(); if (state.tab === 'news') renderNews(); });
  }
  newsPollTimer = setInterval(() => {
    if (state.settings.githubToken) {
      refreshNews(false).then(() => { renderSidebarNav(); renderBottomNav(); if (state.tab === 'news') renderNews(); });
    }
  }, 5 * 60 * 1000);
}

/* ==========================================================================
   Boot
   ========================================================================== */
function boot() {
  wireGlobalEvents();
  applyTheme();
  setupInstallPrompt();

  if (state.account && state.authed) {
    enterApp();
  } else if (state.account && !state.authed) {
    state.authMode = 'signin';
    renderAuthRoot();
  } else {
    state.authMode = 'landing';
    renderAuthRoot();
  }
}

document.addEventListener('DOMContentLoaded', boot);
