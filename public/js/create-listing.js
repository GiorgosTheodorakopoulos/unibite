let locationMarker = null;
let locationMap = null;

document.addEventListener('DOMContentLoaded', () => {
  const user = requireAuth(['cook', 'consumer']);
  if (!user) return;
  renderNavbar('create');

  // Init location picker map
  locationMap = L.map('locationMap').setView([38.2466, 21.7346], 14); // Πάτρα
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(locationMap);

  locationMap.on('click', e => {
    const { lat, lng } = e.latlng;
    document.getElementById('lat').value = lat.toFixed(6);
    document.getElementById('lng').value = lng.toFixed(6);
    document.getElementById('coordsLabel').textContent =
      `📍 Επιλέχθηκε: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (locationMarker) locationMarker.setLatLng(e.latlng);
    else locationMarker = L.marker(e.latlng, { draggable: true }).addTo(locationMap);
    locationMarker.on('dragend', ev => {
      const p = ev.target.getLatLng();
      document.getElementById('lat').value = p.lat.toFixed(6);
      document.getElementById('lng').value = p.lng.toFixed(6);
      document.getElementById('coordsLabel').textContent =
        `📍 Επιλέχθηκε: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    });
  });

  // Photo preview
  document.getElementById('photo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    document.getElementById('photoImg').src = url;
    document.getElementById('photoPreview').style.display = 'flex';
  });
  document.getElementById('removePhoto').addEventListener('click', () => {
    document.getElementById('photo').value = '';
    document.getElementById('photoPreview').style.display = 'none';
  });

  // Form submit
  document.getElementById('createListingForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');

    const title     = document.getElementById('title').value.trim();
    const portions  = document.getElementById('portions').value;
    const location  = document.getElementById('location').value.trim();
    const pickupTime = document.getElementById('pickupTime').value;
    const notes     = document.getElementById('notes').value.trim();
    const lat       = document.getElementById('lat').value;
    const lng       = document.getElementById('lng').value;
    const allergens = Array.from(
      document.querySelectorAll('input[name="allergens"]:checked')
    ).map(cb => cb.value);
    const photoFile = document.getElementById('photo').files[0];

    if (!title || !portions || !location || !pickupTime) {
      showToast('Συμπλήρωσε όλα τα υποχρεωτικά πεδία', 'error'); return;
    }

    btn.disabled = true; btn.textContent = 'Δημοσίευση...';

    try {
      if (photoFile) {
        const fd = new FormData();
        fd.append('title', title);
        fd.append('portions', portions);
        fd.append('location', location);
        fd.append('pickup_time', pickupTime);
        fd.append('notes', notes);
        fd.append('lat', lat);
        fd.append('lng', lng);
        allergens.forEach(a => fd.append('allergens', a));
        fd.append('photo', photoFile);
        await API.postForm('/api/listings', fd);
      } else {
        await API.post('/api/listings', {
          title, portions: parseInt(portions), location, pickup_time: pickupTime,
          notes, lat: lat || null, lng: lng || null, allergens
        });
      }
      showToast('Η αγγελία δημοσιεύτηκε!', 'success');
      setTimeout(() => window.location.href = '/my-dashboard.html', 1200);
    } catch(err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = '🚀 Δημοσίευση Αγγελίας';
    }
  });
});
