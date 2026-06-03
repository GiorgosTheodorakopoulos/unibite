let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = requireAuth();
  if (!currentUser) return;
  renderNavbar('dashboard');

  if (currentUser.role === 'cook') {
    document.querySelector('[data-tab="myRequests"]').style.display = 'none';
    document.querySelector('[data-tab="ratingsPending"]').style.display = 'none';
  } else if (currentUser.role === 'consumer') {
    document.querySelector('[data-tab="myListings"]').style.display = 'none';
    document.querySelector('[data-tab="incoming"]').style.display = 'none';
    document.querySelector('[data-tab="myRequests"]').classList.add('active');
    document.querySelector('[data-tab="myListings"]').classList.remove('active');
    document.getElementById('myRequests').classList.add('active');
    document.getElementById('myListings').classList.remove('active');
  }

  setupTabs();

  // Initial loads
  await Promise.all([loadPoints(), loadMyListings(), loadIncoming(), loadMyRequests(), loadPendingRatings()]);

  // Edit modal
  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('editModal').style.display = 'none';
  });
  document.getElementById('editForm').addEventListener('submit', saveEdit);
});

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

async function loadPoints() {
  try {
    const user = await API.get('/api/auth/me');
    API.setAuth(API.getToken(), user);
    document.getElementById('pointsValue').textContent = user.points;
    renderNavbar('dashboard');
  } catch {}
}

// ── My Listings (Cook) ──────────────────────────────────
async function loadMyListings() {
  const el = document.getElementById('myListingsContent');
  try {
    const listings = await API.get('/api/listings/mine/all');
    if (!listings.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📢</div><p>Δεν έχεις αγγελίες ακόμα.</p></div>';
      return;
    }
    el.innerHTML = listings.map(l => `
      <div class="my-listing-item">
        <div class="my-listing-info">
          <div class="my-listing-title">${escHtml(l.title)}</div>
          <div class="my-listing-meta">
            🍛 ${l.portions_available}/${l.portions_total} μερίδες &nbsp;|&nbsp;
            📍 ${escHtml(l.location)} &nbsp;|&nbsp;
            🕐 ${l.pickup_time} &nbsp;|&nbsp;
            <span class="badge badge-${l.status}">${statusLabel(l.status)}</span>
          </div>
          <div style="margin-top:.3rem">${allergenTags(l.allergens)}</div>
        </div>
        <div class="my-listing-actions">
          <button class="btn btn-secondary btn-sm" onclick="openEdit(${l.id})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteListing(${l.id}, this)">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<p class="hint">Σφάλμα φόρτωσης.</p>';
  }
}

async function deleteListing(id, btn) {
  if (!confirm('Να διαγραφεί η αγγελία;')) return;
  btn.disabled = true;
  try {
    await API.delete(`/api/listings/${id}`);
    showToast('Αγγελία διαγράφηκε', 'success');
    loadMyListings();
  } catch(e) {
    showToast(e.message, 'error');
    btn.disabled = false;
  }
}

async function openEdit(id) {
  try {
    const l = await API.get(`/api/listings/${id}`);
    document.getElementById('editId').value = l.id;
    document.getElementById('editTitle').value = l.title;
    document.getElementById('editPortions').value = l.portions_available;
    document.getElementById('editLocation').value = l.location;
    document.getElementById('editPickupTime').value = l.pickup_time;
    document.getElementById('editNotes').value = l.notes || '';
    document.getElementById('editModal').style.display = 'flex';
  } catch(e) { showToast(e.message, 'error'); }
}

async function saveEdit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await API.put(`/api/listings/${id}`, {
      title: document.getElementById('editTitle').value,
      portions: document.getElementById('editPortions').value,
      location: document.getElementById('editLocation').value,
      pickup_time: document.getElementById('editPickupTime').value,
      notes: document.getElementById('editNotes').value
    });
    showToast('Αποθηκεύτηκε!', 'success');
    document.getElementById('editModal').style.display = 'none';
    loadMyListings();
  } catch(e) {
    showToast(e.message, 'error');
  } finally { btn.disabled = false; }
}

// ── Incoming Requests (Cook) ────────────────────────────
async function loadIncoming() {
  const el = document.getElementById('incomingContent');
  try {
    const requests = await API.get('/api/requests/incoming');
    if (!requests.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📥</div><p>Δεν υπάρχουν αιτήματα.</p></div>';
      return;
    }
    el.innerHTML = `
      <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Φοιτητής</th><th>Αγγελία</th><th>Κατάσταση</th><th>Ενέργειες</th>
        </tr></thead>
        <tbody>
          ${requests.map(r => `
            <tr id="req-row-${r.id}">
              <td>${escHtml(r.consumer_username)}</td>
              <td>${escHtml(r.listing_title)}</td>
              <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
              <td><div class="action-btns">${incomingActions(r)}</div></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>`;
  } catch {
    el.innerHTML = '<p class="hint">Σφάλμα φόρτωσης.</p>';
  }
}

function incomingActions(r) {
  if (r.status === 'pending') return `
    <button class="btn btn-success btn-sm" onclick="reqAction(${r.id},'approve',this)">✓ Αποδοχή</button>
    <button class="btn btn-danger btn-sm" onclick="reqAction(${r.id},'reject',this)">✗ Απόρριψη</button>`;
  if (r.status === 'approved') return `
    <button class="btn btn-primary btn-sm" onclick="reqAction(${r.id},'complete',this)">📦 Παρελήφθη</button>
    <button class="btn btn-warning btn-sm" onclick="reqAction(${r.id},'no_show',this)">❌ No-show</button>`;
  return `<span class="hint">${statusLabel(r.status)}</span>`;
}

async function reqAction(id, action, btn) {
  btn.disabled = true;
  try {
    await API.put(`/api/requests/${id}/${action}`);
    showToast('Ενημερώθηκε!', 'success');
    loadIncoming();
    loadPoints();
  } catch(e) {
    showToast(e.message, 'error');
    btn.disabled = false;
  }
}

// ── My Requests (Consumer) ──────────────────────────────
async function loadMyRequests() {
  const el = document.getElementById('myRequestsContent');
  try {
    const reqs = await API.get('/api/requests/my');
    loadPoints(); // Penalties may have been applied server-side; refresh displayed balance.
    if (!reqs.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><p>Δεν έχεις αιτήματα ακόμα.</p></div>';
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Φαγητό</th><th>Μάγειρας</th><th>Σημείο</th><th>Ώρα</th><th>Κατάσταση</th></tr></thead>
        <tbody>${reqs.map(r => `
          <tr>
            <td>${escHtml(r.listing_title)}</td>
            <td>${escHtml(r.cook_username)}</td>
            <td>${escHtml(r.location || '')}</td>
            <td>${r.pickup_time || ''}</td>
            <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {
    el.innerHTML = '<p class="hint">Σφάλμα φόρτωσης.</p>';
  }
}

// ── Pending Ratings ─────────────────────────────────────
async function loadPendingRatings() {
  const el = document.getElementById('ratingsContent');
  try {
    const pending = await API.get('/api/ratings/pending');
    if (!pending.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><p>Δεν υπάρχουν εκκρεμείς αξιολογήσεις.</p></div>';
      return;
    }
    el.innerHTML = pending.map(r => {
      const deadline = new Date(r.created_at).getTime() + 48 * 3600 * 1000;
      const msLeft = deadline - Date.now();
      const hLeft = Math.max(0, Math.floor(msLeft / 3600000));
      const mLeft = Math.max(0, Math.floor((msLeft % 3600000) / 60000));
      const urgentClass = hLeft < 6 ? 'style="color:var(--danger);font-weight:600"' : 'style="color:var(--text-muted)"';
      const countdown = `<small ${urgentClass}>⏱ ${hLeft}ω ${mLeft}λ απομένουν</small>`;
      return `
        <div class="rating-item" id="rating-item-${r.request_id}">
          <h3>🍽️ ${escHtml(r.listing_title)} <span class="hint">από ${escHtml(r.cook_username)}</span></h3>
          <div>${countdown}</div>
          <div class="star-widget" data-req="${r.request_id}">
            ${[1,2,3,4,5].map(i => `<span class="star" data-val="${i}">★</span>`).join('')}
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:.5rem"
            onclick="submitRating(${r.request_id}, this)" disabled>Αποστολή</button>
        </div>`;
    }).join('');

    // Star widget logic
    document.querySelectorAll('.star-widget').forEach(widget => {
      const stars = widget.querySelectorAll('.star');
      const btn = widget.nextElementSibling;
      widget._selected = 0;
      stars.forEach(star => {
        star.addEventListener('mouseover', () => {
          const v = +star.dataset.val;
          stars.forEach(s => s.classList.toggle('selected', +s.dataset.val <= v));
        });
        star.addEventListener('mouseleave', () => {
          stars.forEach(s => s.classList.toggle('selected', +s.dataset.val <= widget._selected));
        });
        star.addEventListener('click', () => {
          widget._selected = +star.dataset.val;
          stars.forEach(s => s.classList.toggle('selected', +s.dataset.val <= widget._selected));
          btn.disabled = false;
        });
      });
    });
  } catch {
    el.innerHTML = '<p class="hint">Σφάλμα φόρτωσης.</p>';
  }
}

async function submitRating(requestId, btn) {
  const widget = document.querySelector(`.star-widget[data-req="${requestId}"]`);
  const score = widget._selected;
  if (!score) { showToast('Επίλεξε βαθμολογία', 'error'); return; }
  btn.disabled = true;
  try {
    await API.post('/api/ratings', { request_id: requestId, score });
    showToast('Αξιολόγηση υποβλήθηκε!', 'success');
    document.getElementById(`rating-item-${requestId}`).remove();
    loadPoints();
  } catch(e) {
    showToast(e.message, 'error');
    btn.disabled = false;
  }
}

// ── Helpers ─────────────────────────────────────────────
function statusLabel(s) {
  const map = { active:'Ενεργή', inactive:'Ανενεργή', expired:'Διεγραμμένη',
    pending:'Αναμονή', approved:'Αποδεκτό', rejected:'Απορρίφθηκε',
    completed:'Ολοκληρώθηκε', no_show:'No-show' };
  return map[s] || s;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
