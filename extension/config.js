// Shared config. `self` works in both the content script (window) and the
// background service worker. The backend URL can be overridden at runtime from
// the extension popup (stored in chrome.storage.local); this is the fallback.
self.YBOT_CONFIG = {
  // Local dev default. After deploying to Vercel, either edit this to your
  // deployment URL (e.g. "https://your-app.vercel.app") or set it from the popup.
  BACKEND_URL: 'http://localhost:3000',
};
