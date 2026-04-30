const API = {
  getToken() { return localStorage.getItem('unibite_token'); },
  getUser() { const u = localStorage.getItem('unibite_user'); return u ? JSON.parse(u) : null; },
  setAuth(token, user) {
    localStorage.setItem('unibite_token', token);
    localStorage.setItem('unibite_user', JSON.stringify(user));
  },
  clearAuth() {
    localStorage.removeItem('unibite_token');
    localStorage.removeItem('unibite_user');
  },
  async request(method, path, body, isFormData = false) {
    const headers = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
    });
    if (res.status === 401) { this.clearAuth(); window.location.href = '/login.html'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Σφάλμα server');
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  delete(path) { return this.request('DELETE', path); },
  postForm(path, formData) { return this.request('POST', path, formData, true); }
};

const ALLERGENS = {
  gluten:      { label: 'Γλουτένη',     icon: '🌾' },
  crustaceans: { label: 'Καρκινοειδή',  icon: '🦐' },
  eggs:        { label: 'Αυγά',          icon: '🥚' },
  fish:        { label: 'Ψάρι',          icon: '🐟' },
  peanuts:     { label: 'Φιστίκια',      icon: '🥜' },
  soybeans:    { label: 'Σόγια',         icon: '🫘' },
  milk:        { label: 'Γάλα',          icon: '🥛' },
  nuts:        { label: 'Ξηροί Καρποί', icon: '🌰' },
  celery:      { label: 'Σέλινο',        icon: '🥬' },
  mustard:     { label: 'Μουστάρδα',    icon: '🌿' },
  sesame:      { label: 'Σουσάμι',      icon: '🌱' },
  sulphites:   { label: 'Θειώδη',       icon: '🍷' },
  lupin:       { label: 'Λούπινο',      icon: '🌼' },
  molluscs:    { label: 'Μαλάκια',      icon: '🐙' }
};

function allergenTags(allergens) {
  if (!allergens || allergens.length === 0)
    return '<span class="no-allergens">Χωρίς δηλωμένα αλλεργιογόνα</span>';
  return allergens.map(a => {
    const info = ALLERGENS[a] || { label: a, icon: '⚠️' };
    return `<span class="allergen-tag">${info.icon} ${info.label}</span>`;
  }).join('');
}

function showToast(msg, type = 'success') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function requireAuth(allowedRoles = []) {
  const user = API.getUser();
  if (!user || !API.getToken()) { window.location.href = '/login.html'; return null; }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    window.location.href = '/index.html'; return null;
  }
  return user;
}

function renderNavbar(activePage) {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  const user = API.getUser();
  let links = '';
  if (user) {
    links += `<a href="/index.html" ${activePage === 'feed' ? 'class="active"' : ''}>Feed</a>`;
    links += `<a href="/create-listing.html" ${activePage === 'create' ? 'class="active"' : ''}>+ Αγγελία</a>`;
    links += `<a href="/my-dashboard.html" ${activePage === 'dashboard' ? 'class="active"' : ''}>Dashboard</a>`;
    if (user.role === 'admin') {
      links += `<a href="/admin.html" ${activePage === 'admin' ? 'class="active"' : ''}>Admin</a>`;
    }
    links += `<span class="points-badge">⭐ ${user.points}</span>`;
    links += `<a href="#" id="logoutBtn">Έξοδος</a>`;
  } else {
    links += `<a href="/login.html" ${activePage === 'login' ? 'class="active"' : ''}>Σύνδεση</a>`;
    links += `<a href="/register.html" ${activePage === 'register' ? 'class="active"' : ''}>Εγγραφή</a>`;
  }
  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/index.html" class="nav-logo">🍽️ UniBite</a>
      <button class="nav-hamburger" id="navToggle" aria-label="Menu">☰</button>
      <div class="nav-links" id="navLinks">${links}</div>
    </div>`;
  document.getElementById('logoutBtn')?.addEventListener('click', e => {
    e.preventDefault(); API.clearAuth(); window.location.href = '/login.html';
  });
  document.getElementById('navToggle')?.addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });
}

function starsHTML(score, interactive = false, name = 'score') {
  if (!interactive) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<span class="star ${i <= score ? 'filled' : ''}">★</span>`;
    return `<span class="stars">${s}</span>`;
  }
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<label class="star-label">
      <input type="radio" name="${name}" value="${i}" required>
      <span class="star">★</span>
    </label>`;
  }
  return `<span class="stars interactive">${s}</span>`;
}

function timeSince(dateStr) {
  const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Μόλις τώρα';
  if (h < 24) return `${h}ω πριν`;
  return `${Math.floor(h / 24)}μ πριν`;
}
