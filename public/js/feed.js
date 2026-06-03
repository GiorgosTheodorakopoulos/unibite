let allListings = [];
let map, markers = [];
let userLocation = null;
let userMarker = null, userCircle = null;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

document.addEventListener('DOMContentLoaded', async () => {
  const _u = API.getUser();
  if (_u && _u.role === 'cook') { window.location.href = '/my-dashboard.html'; return; }
  if (_u && _u.role === 'admin') { window.location.href = '/admin.html'; return; }
  renderNavbar('feed');
  await loadListings();

  // Auto-refresh every 30s
  setInterval(loadListings, 30000);

  // View toggle
  document.getElementById('listViewBtn').addEventListener('click', () => {
    document.getElementById('listView').style.display = '';
    document.getElementById('mapView').style.display = 'none';
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('mapViewBtn').classList.remove('active');
  });
  document.getElementById('mapViewBtn').addEventListener('click', () => {
    document.getElementById('listView').style.display = 'none';
    document.getElementById('mapView').style.display = '';
    document.getElementById('listViewBtn').classList.remove('active');
    document.getElementById('mapViewBtn').classList.add('active');
    if (!map) initMap();
    else renderMapMarkers();
  });

  // Filters
  document.getElementById('searchInput').addEventListener('input', renderListings);
  document.getElementById('sortSelect').addEventListener('change', renderListings);
  document.getElementById('allergenFilter').addEventListener('change', renderListings);
  document.getElementById('limitSelect').addEventListener('change', renderListings);
  document.getElementById('maxDistSelect').addEventListener('change', () => {
    renderListings();
    if (map) renderMapMarkers();
  });
  document.getElementById('locateBtn').addEventListener('click', locateUser);
});

async function loadListings() {
  try {
    allListings = await API.get('/api/listings');
    renderListings();
    if (map) renderMapMarkers();
    // Update user points in navbar
    const freshUser = API.getUser();
    if (freshUser) {
      try {
        const me = await API.get('/api/auth/me');
        API.setAuth(API.getToken(), me);
        renderNavbar('feed');
      } catch {}
    }
  } catch(e) {
    document.getElementById('listingsGrid').innerHTML =
      '<p style="color:var(--danger);grid-column:1/-1">Σφάλμα φόρτωσης αγγελιών.</p>';
  }
}

function getFiltered() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const sort = document.getElementById('sortSelect').value;
  const allergenExclude = document.getElementById('allergenFilter').value;
  const maxDist = parseFloat(document.getElementById('maxDistSelect').value) || null;
  const limit = parseInt(document.getElementById('limitSelect').value) || null;
  let items = allListings.filter(l => l.status !== 'expired');

  if (q) items = items.filter(l => l.title.toLowerCase().includes(q) || l.location.toLowerCase().includes(q));
  if (allergenExclude) items = items.filter(l => !l.allergens.includes(allergenExclude));

  if (userLocation && maxDist) {
    items = items.filter(l => {
      if (!l.lat || !l.lng) return false;
      return haversineKm(userLocation.lat, userLocation.lng, l.lat, l.lng) <= maxDist;
    });
  }

  if (sort === 'distance' && userLocation) {
    items.sort((a, b) => {
      const da = (a.lat && a.lng) ? haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng) : Infinity;
      const db = (b.lat && b.lng) ? haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng) : Infinity;
      return da - db;
    });
  } else if (sort === 'portions_asc') {
    items.sort((a, b) => a.portions_available - b.portions_available);
  } else if (sort === 'portions_desc') {
    items.sort((a, b) => b.portions_available - a.portions_available);
  } else {
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  if (limit) items = items.slice(0, limit);

  return items;
}

function renderListings() {
  const items = getFiltered();
  const grid = document.getElementById('listingsGrid');
  const user = API.getUser();

  if (!items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🍽️</div><p>Δεν βρέθηκαν αγγελίες</p></div>';
    return;
  }

  grid.innerHTML = items.map(l => listingCardHTML(l, user)).join('');

  // Attach request buttons
  grid.querySelectorAll('.request-btn').forEach(btn => {
    btn.addEventListener('click', () => requestPortion(btn.dataset.id, btn));
  });
}

function listingCardHTML(l, user) {
  const isInactive = l.status === 'inactive';
  const imgContent = l.photo
    ? `<img src="${l.photo}" alt="${l.title}" loading="lazy" />`
    : `<span>🍽️</span>`;

  let distanceTag = '';
  if (userLocation && l.lat && l.lng) {
    const d = haversineKm(userLocation.lat, userLocation.lng, l.lat, l.lng);
    const label = d < 1 ? Math.round(d * 1000) + 'μ' : d.toFixed(1) + 'χλμ';
    distanceTag = `<span class="distance-tag">📍 ${label}</span>`;
  }

  let actionBtn = '';
  if (!user) {
    actionBtn = `<a href="/login.html" class="btn btn-secondary btn-sm">Σύνδεση</a>`;
  } else if (user.role === 'admin') {
    actionBtn = '';
  } else if (user.role === 'cook') {
    actionBtn = l.user_id === user.id
      ? `<span class="hint">Δική σου</span>`
      : '';
  } else if (isInactive) {
    actionBtn = `<button class="btn btn-secondary btn-sm" disabled>Εξαντλήθηκε</button>`;
  } else if (user.points < 1) {
    actionBtn = `<button class="btn btn-secondary btn-sm" disabled title="Χρειάζεσαι τουλάχιστον 1 πόντο">🍴 Κράτηση (0 πόντοι)</button>`;
  } else {
    actionBtn = `<button class="btn btn-primary btn-sm request-btn" data-id="${l.id}">🍴 Κράτηση</button>`;
  }

  return `
    <div class="listing-card ${isInactive ? 'inactive' : ''}">
      <div class="listing-card-img">${imgContent}</div>
      <div class="listing-card-body">
        <div class="listing-card-title">${escHtml(l.title)}</div>
        <div class="listing-card-meta">
          <span>👨‍🍳 ${escHtml(l.cook_username)}</span>
          <span class="badge badge-${l.status}">${l.status === 'active' ? 'Διαθέσιμο' : 'Εξαντλήθηκε'}</span>
        </div>
        <div class="listing-card-meta">
          <span>📍 ${escHtml(l.location)}</span>
          <span>🕐 ${l.pickup_time}</span>
          ${distanceTag}
        </div>
        ${l.notes ? `<div style="font-size:.82rem;color:var(--text-muted)">${escHtml(l.notes).slice(0,80)}${l.notes.length>80?'…':''}</div>` : ''}
        <div class="listing-card-allergens">${allergenTags(l.allergens)}</div>
      </div>
      <div class="listing-card-footer">
        <span class="portions-badge">🍛 ${l.portions_available} μερίδες</span>
        ${actionBtn}
      </div>
    </div>`;
}

async function requestPortion(listingId, btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await API.post('/api/requests', { listing_id: parseInt(listingId) });
    showToast('Το αίτημά σου στάλθηκε!', 'success');
    btn.textContent = 'Στάλθηκε ✓';
    btn.classList.replace('btn-primary', 'btn-success');
    // Update local points
    const me = await API.get('/api/auth/me');
    API.setAuth(API.getToken(), me);
    renderNavbar('feed');
  } catch(err) {
    showToast(err.message, 'error');
    btn.disabled = false; btn.textContent = '🍴 Κράτηση';
  }
}

function locateUser() {
  const btn = document.getElementById('locateBtn');
  const status = document.getElementById('locStatus');
  if (!navigator.geolocation) {
    status.textContent = '✗ Δεν υποστηρίζεται';
    return;
  }
  btn.disabled = true;
  status.textContent = '⏳ Εντοπισμός...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.disabled = false;
      btn.textContent = '📍 Ενημέρωση';
      status.textContent = '✓ Εντοπίστηκε';
      status.classList.add('loc-ok');
      document.getElementById('maxDistSelect').disabled = false;
      document.getElementById('sortSelect').value = 'distance';
      renderListings();
      if (map) {
        renderMapMarkers();
        map.setView([userLocation.lat, userLocation.lng], 15);
      }
    },
    () => {
      btn.disabled = false;
      status.textContent = '✗ Δεν επιτράπηκε';
      status.classList.remove('loc-ok');
    },
    { timeout: 10000 }
  );
}

// ── Map ──
function initMap() {
  map = L.map('map').setView([38.2466, 21.7346], 14); // Πάτρα
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  renderMapMarkers();
}

function renderMapMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
  if (userMarker) { userMarker.remove(); userMarker = null; }
  if (userCircle) { userCircle.remove(); userCircle = null; }

  const maxDist = parseFloat(document.getElementById('maxDistSelect').value) || null;
  if (userLocation) {
    userMarker = L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#2563eb;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
        iconSize: [14, 14], iconAnchor: [7, 7]
      })
    }).addTo(map).bindPopup('📍 Η τοποθεσία σου');
    if (maxDist) {
      userCircle = L.circle([userLocation.lat, userLocation.lng], {
        radius: maxDist * 1000,
        color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.07, weight: 2
      }).addTo(map);
    }
  }

  const items = getFiltered();
  const user = API.getUser();

  for (const l of items) {
    if (!l.lat || !l.lng) continue;
    const color = l.status === 'active' ? '#e67e22' : '#999';
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:${color};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 2px 6px rgba(0,0,0,.3)">🍽️</div>`,
      iconSize: [32, 32], iconAnchor: [16, 16]
    });

    let btnHtml = '';
    if (user && user.role === 'consumer' && l.user_id !== user.id && l.status === 'active') {
      btnHtml = `<button class="popup-btn" onclick="requestFromMap(${l.id}, this)">🍴 Κράτηση Μερίδας</button>`;
    }

    const marker = L.marker([l.lat, l.lng], { icon }).addTo(map);
    marker.bindPopup(`
      <div class="popup-title">${escHtml(l.title)}</div>
      <div>👨‍🍳 ${escHtml(l.cook_username)}</div>
      <div>🍛 ${l.portions_available} μερίδες</div>
      <div>📍 ${escHtml(l.location)}</div>
      <div>🕐 ${l.pickup_time}</div>
      ${allergenTags(l.allergens)}
      ${btnHtml}
    `);
    markers.push(marker);
  }
}

async function requestFromMap(listingId, btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await API.post('/api/requests', { listing_id: listingId });
    showToast('Αίτημα στάλθηκε!', 'success');
    btn.textContent = 'Στάλθηκε ✓';
    const me = await API.get('/api/auth/me');
    API.setAuth(API.getToken(), me);
    renderNavbar('feed');
  } catch(err) {
    showToast(err.message, 'error');
    btn.disabled = false; btn.textContent = '🍴 Κράτηση Μερίδας';
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
