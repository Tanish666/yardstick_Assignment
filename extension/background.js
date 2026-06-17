// MV3 service worker. Its only job is to proxy the agent step request to the
// backend. We do this from the background (not the content script) because
// trello.com's Content-Security-Policy would block a cross-origin fetch made
// from the page context. The background SW has host_permissions for the backend
// and is not subject to the page CSP.
//
// The actual Trello API calls happen in the content script (page origin), so
// they carry the user's trello.com session cookie. The backend never sees them.

importScripts('config.js');

async function getBackendUrl() {
  try {
    const { backendUrl } = await chrome.storage.local.get('backendUrl');
    const url = backendUrl || self.YBOT_CONFIG.BACKEND_URL;
    return url.replace(/\/+$/, '');
  } catch (e) {
    return self.YBOT_CONFIG.BACKEND_URL.replace(/\/+$/, '');
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'AGENT_STEP') {
    (async () => {
      try {
        const base = await getBackendUrl();
        const res = await fetch(base + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: msg.contents }),
        });
        if (!res.ok) {
          const t = await res.text();
          sendResponse({ ok: false, error: 'HTTP ' + res.status + ' — ' + t.slice(0, 300) });
          return;
        }
        const data = await res.json();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true; // keep the message channel open for the async response
  }
});
