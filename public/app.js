const state = { photos: [], currentView: 'all', currentAlbum: '', searchQuery: '', activeIndex: -1 };
const $ = (id) => document.getElementById(id);

const timelineContainer = $('timelineContainer'), emptyState = $('emptyState'), loadingIndicator = $('loadingIndicator');
const currentViewTitle = $('currentViewTitle'), searchInput = $('searchInput'), clearSearchBtn = $('clearSearchBtn');
const albumList = $('albumList'), resetAlbumBtn = $('resetAlbumBtn'), toastBanner = $('toastBanner');
const uploadModal = $('uploadModal'), uploadForm = $('uploadForm'), dropZone = $('dropZone'), imageInput = $('imageInput');
const imagePreview = $('imagePreview'), dropPrompt = $('dropPrompt'), submitUploadBtn = $('submitUploadBtn');
const lightboxModal = $('lightboxModal'), lightboxImage = $('lightboxImage'), lightboxFavBtn = $('lightboxFavBtn');
const lightboxDownloadBtn = $('lightboxDownloadBtn'), lightboxTrashBtn = $('lightboxTrashBtn');
const lightboxDeletePermBtn = $('lightboxDeletePermBtn'), infoDrawer = $('infoDrawer'), editMetadataForm = $('editMetadataForm');

let toastTimer;
function showToast(message) {
  toastBanner.textContent = message;
  toastBanner.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBanner.classList.add('hidden'), 3200);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

// SQLite stores CURRENT_TIMESTAMP in UTC without a zone marker; mark it as UTC before parsing
function parseDbDate(str) { return new Date(String(str).replace(' ', 'T') + 'Z'); }

function formatDateGroupHeader(dateStr) {
  const d = parseDbDate(dateStr);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

async function api(url, options) {
  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Unexpected server response (HTTP ${res.status})`);
  }
  if (!data || !data.success) throw new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
  return data;
}

async function fetchPhotos() {
  loadingIndicator.classList.remove('hidden');
  try {
    const params = new URLSearchParams({ view: state.currentView, album: state.currentAlbum, search: state.searchQuery });
    const result = await api(`/api/photos?${params}`);
    state.photos = result.data;
    renderGallery();
    fetchStorageStats();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  } finally {
    loadingIndicator.classList.add('hidden');
  }
}

async function fetchStorageStats() {
  try {
    const data = await api('/api/photos/stats');
    const { totalPhotos, totalBytes, favoritesCount, trashCount } = data.stats;
    $('favBadge').textContent = favoritesCount || 0;
    $('trashBadge').textContent = trashCount || 0;
    $('totalPhotosCount').textContent = `${totalPhotos || 0} photos stored`;
    const quota = 100 * 1024 * 1024;
    $('storageText').textContent = `${formatBytes(totalBytes || 0)} / 100 MB`;
    $('storageFill').style.width = `${Math.min(100, ((totalBytes || 0) / quota) * 100).toFixed(1)}%`;

    albumList.innerHTML = '';
    data.albums.forEach((alb) => {
      const btn = document.createElement('button');
      btn.className = `album-chip ${state.currentAlbum === alb.album ? 'active' : ''}`;
      const name = document.createElement('span');
      name.textContent = `📁 ${alb.album}`;           // textContent: album names are user input (XSS-safe)
      const count = document.createElement('small');
      count.textContent = alb.count;
      btn.append(name, count);
      btn.addEventListener('click', () => {
        state.currentAlbum = alb.album;
        resetAlbumBtn.classList.remove('hidden');
        currentViewTitle.textContent = `Album: ${alb.album}`;
        fetchPhotos();
      });
      albumList.appendChild(btn);
    });
  } catch (err) { console.error('Stats error:', err); }
}

function renderGallery() {
  timelineContainer.innerHTML = '';
  if (state.photos.length === 0) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  const grouped = {};
  state.photos.forEach((photo, index) => {
    const key = formatDateGroupHeader(photo.created_at);
    (grouped[key] = grouped[key] || []).push({ ...photo, flatIndex: index });
  });

  Object.entries(grouped).forEach(([heading, items]) => {
    const section = document.createElement('section');
    section.className = 'date-group';
    const header = document.createElement('h3');
    header.className = 'date-header';
    header.textContent = heading;
    const grid = document.createElement('div');
    grid.className = 'photo-grid';

    items.forEach((photo) => {
      const card = document.createElement('div');
      card.className = 'photo-card';
      const img = document.createElement('img');
      img.src = photo.filepath; img.alt = photo.title; img.loading = 'lazy';
      const overlay = document.createElement('div');
      overlay.className = 'card-overlay';
      const top = document.createElement('div');
      top.className = 'card-top-actions';
      const fav = document.createElement('button');
      fav.className = `fav-star ${photo.is_favorite ? 'starred' : ''}`;
      fav.textContent = photo.is_favorite ? '★' : '☆';
      fav.title = 'Toggle Favorite';
      fav.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(photo.id, false); });
      top.appendChild(fav);
      const caption = document.createElement('div');
      caption.className = 'card-caption';
      caption.textContent = photo.title;
      overlay.append(top, caption);
      card.append(img, overlay);
      card.addEventListener('click', () => openLightbox(photo.flatIndex));
      grid.appendChild(card);
    });
    section.append(header, grid);
    timelineContainer.appendChild(section);
  });
}

// ---- Upload ----
let previewUrl = null;
function showPreview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);   // avoid leaking the previous blob
  previewUrl = URL.createObjectURL(file);
  imagePreview.src = previewUrl;
  imagePreview.classList.remove('hidden');
  dropPrompt.classList.add('hidden');
}
function clearPreview() {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  imagePreview.removeAttribute('src');
  imagePreview.classList.add('hidden');
  dropPrompt.classList.remove('hidden');
}
dropZone.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => { if (imageInput.files[0]) showPreview(imageInput.files[0]); });
['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files[0]) { imageInput.files = e.dataTransfer.files; showPreview(e.dataTransfer.files[0]); }
});

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = imageInput.files[0];
  if (!file) return showToast('Please choose an image file');
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return showToast('Only JPG, PNG, WEBP and GIF images are allowed');
  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) return showToast('File is too large (maximum 10 MB)');
  submitUploadBtn.disabled = true;               // prevents duplicate submissions
  submitUploadBtn.textContent = 'Uploading...';
  try {
    await api('/api/photos', { method: 'POST', body: new FormData(uploadForm) });
    showToast('Photo uploaded to PhotoVault!');
    uploadForm.reset();
    clearPreview();
    uploadModal.classList.add('hidden');
    fetchPhotos();
  } catch (err) {
    showToast(err.message);
  } finally {
    submitUploadBtn.disabled = false;
    submitUploadBtn.textContent = 'Upload Photo';
  }
});

// ---- Lightbox ----
function openLightbox(index) {
  state.activeIndex = index;
  const photo = state.photos[index];
  if (!photo) return;
  lightboxImage.src = photo.filepath;
  lightboxDownloadBtn.href = photo.filepath;
  lightboxFavBtn.textContent = photo.is_favorite ? '★ Favorited' : '☆ Favorite';
  lightboxTrashBtn.textContent = photo.is_trashed ? '♻️ Restore' : '🗑️ Trash';
  lightboxDeletePermBtn.classList.toggle('hidden', !photo.is_trashed);
  $('editTitle').value = photo.title;
  $('editAlbum').value = photo.album;
  $('editTags').value = photo.tags;
  $('editDesc').value = photo.description;
  $('metaFilename').textContent = photo.filename;
  $('metaSize').textContent = formatBytes(photo.size);
  $('metaType').textContent = photo.mimetype;
  $('metaDate').textContent = parseDbDate(photo.created_at).toLocaleString();
  lightboxModal.classList.remove('hidden');
}
const closeLightbox = () => lightboxModal.classList.add('hidden');

async function toggleFavorite(id, reopen) {
  try {
    const data = await api(`/api/photos/${id}/favorite`, { method: 'PATCH' });
    showToast(data.message);
    await fetchPhotos();
    if (reopen && state.photos[state.activeIndex]) openLightbox(state.activeIndex);
  } catch (err) { showToast(err.message); }
}
lightboxFavBtn.addEventListener('click', () => {
  const p = state.photos[state.activeIndex];
  if (p) toggleFavorite(p.id, true);
});

lightboxTrashBtn.addEventListener('click', async () => {
  const p = state.photos[state.activeIndex];
  if (!p) return;
  try {
    const data = await api(`/api/photos/${p.id}/trash`, { method: 'PATCH' });
    showToast(data.message); closeLightbox(); fetchPhotos();
  } catch (err) { showToast(err.message); }
});

lightboxDeletePermBtn.addEventListener('click', async () => {
  const p = state.photos[state.activeIndex];
  if (!p || !confirm('Permanently delete this photo from disk? This cannot be undone.')) return;
  try {
    const data = await api(`/api/photos/${p.id}`, { method: 'DELETE' });
    showToast(data.message); closeLightbox(); fetchPhotos();
  } catch (err) { showToast(err.message); }
});

editMetadataForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = state.photos[state.activeIndex];
  if (!p) return;
  try {
    await api(`/api/photos/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('editTitle').value, album: $('editAlbum').value, tags: $('editTags').value, description: $('editDesc').value })
    });
    showToast('Photo metadata updated!');
    fetchPhotos();
  } catch (err) { showToast(err.message); }
});

// ---- Navigation, search, shortcuts ----
document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.currentView = btn.dataset.view;
  state.currentAlbum = '';
  resetAlbumBtn.classList.add('hidden');
  currentViewTitle.textContent = btn.querySelector('.nav-label').textContent;
  fetchPhotos();
}));

resetAlbumBtn.addEventListener('click', () => {
  state.currentAlbum = '';
  resetAlbumBtn.classList.add('hidden');
  currentViewTitle.textContent = document.querySelector('.nav-item.active .nav-label').textContent;
  fetchPhotos();
});

let searchTimeout;   // debounce: wait 250 ms after the last keystroke
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  state.searchQuery = searchInput.value.trim();
  clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
  searchTimeout = setTimeout(fetchPhotos, 250);
});
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = ''; state.searchQuery = '';
  clearSearchBtn.classList.add('hidden');
  fetchPhotos();
});

$('openUploadModalBtn').addEventListener('click', () => uploadModal.classList.remove('hidden'));
$('closeUploadModalBtn').addEventListener('click', () => uploadModal.classList.add('hidden'));
$('cancelUploadBtn').addEventListener('click', () => uploadModal.classList.add('hidden'));
$('closeLightboxBtn').addEventListener('click', closeLightbox);
$('lightboxInfoBtn').addEventListener('click', () => infoDrawer.classList.toggle('hidden'));
$('prevPhotoBtn').addEventListener('click', () => { if (state.activeIndex > 0) openLightbox(state.activeIndex - 1); });
$('nextPhotoBtn').addEventListener('click', () => { if (state.activeIndex < state.photos.length - 1) openLightbox(state.activeIndex + 1); });

window.addEventListener('keydown', (e) => {
  if (lightboxModal.classList.contains('hidden')) return;
  if (e.key === 'Escape') return closeLightbox();
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;   // do not navigate while typing
  if (e.key === 'ArrowLeft' && state.activeIndex > 0) openLightbox(state.activeIndex - 1);
  if (e.key === 'ArrowRight' && state.activeIndex < state.photos.length - 1) openLightbox(state.activeIndex + 1);
});

fetchPhotos();
