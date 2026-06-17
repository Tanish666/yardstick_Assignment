const urlInput = document.getElementById('url');
const statusEl = document.getElementById('status');

chrome.storage.local.get('backendUrl', ({ backendUrl }) => {
  urlInput.value = backendUrl || self.YBOT_CONFIG.BACKEND_URL || '';
});

document.getElementById('save').addEventListener('click', () => {
  let url = urlInput.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) {
    statusEl.textContent = 'URL must start with http:// or https://';
    statusEl.className = 'status err';
    return;
  }
  chrome.storage.local.set({ backendUrl: url }, () => {
    statusEl.textContent = 'Saved ✓';
    statusEl.className = 'status ok';
  });
});
