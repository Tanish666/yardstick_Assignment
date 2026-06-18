// Injects the chat UI into Trello and drives the agent loop.
//
// Loop: send conversation -> backend returns model turn -> if it contains
// functionCalls, execute them against Trello (in this page origin, with the
// user's session) and feed results back -> repeat until the model returns text.

(function () {
  if (window.__YBOT_LOADED) return;
  window.__YBOT_LOADED = true;

  const MAX_STEPS = 8;
  const contents = []; // Gemini `contents` history, owned by the extension
  let busy = false;

  // ---- backend bridge (via background SW, to bypass page CSP) ----
  function agentStep(history) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'AGENT_STEP', contents: history }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: false, error: 'No response from background.' });
      });
    });
  }

  // ---------------- UI ----------------
  const host = document.createElement('div');
  host.id = 'ybot-host';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      
      .launcher {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
        width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
        background: #1a1a1a; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.2);
        display: flex; align-items: center; justify-content: center; transition: transform .15s, background-color 0.2s;
      }
      .launcher:hover { transform: scale(1.06); background-color: #333; }
      .launcher svg { width: 24px; height: 24px; stroke: #fff; }

      .panel {
        position: fixed; right: 20px; bottom: 88px; z-index: 2147483647;
        width: 380px; height: 580px; max-height: calc(100vh - 120px);
        background: #f3f2ee; border-radius: 24px; box-shadow: 0 12px 40px rgba(0,0,0,.15);
        display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(0,0,0,0.06);
        opacity: 0;
        transform: translateY(24px) scale(0.96);
        transform-origin: bottom right;
        pointer-events: none;
        visibility: hidden;
        transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), visibility 0.28s;
      }
      .panel.open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
        visibility: visible;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 8px;
        background: transparent;
        z-index: 10;
      }
      .header button {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 8px;
        color: #4f4f4f;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
      }
      .header button:hover {
        background-color: rgba(0, 0, 0, 0.05);
      }
      .header button svg {
        width: 20px;
        height: 20px;
      }
      .header .avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, #bbb 0%, #444 100%);
        box-shadow: inset 0 1px 2px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.15);
      }

      /* Toggle between welcome state and active chat state */
      .panel.has-chat .welcome-container {
        display: none;
      }
      .panel.has-chat .msgs {
        display: flex;
      }
      
      .panel:not(.has-chat) .welcome-container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        flex: 1;
        padding: 20px;
        box-sizing: border-box;
      }
      .panel:not(.has-chat) .msgs {
        display: none;
      }

      .welcome-title {
        font-size: 28px;
        font-weight: 600;
        color: #1a1a1a;
        margin-bottom: 36px;
        text-align: center;
        letter-spacing: -0.5px;
      }

      .welcome-suggest {
        display: flex;
        flex-direction: row;
        gap: 12px;
        padding: 0 12px;
        width: 100%;
        justify-content: center;
        flex-wrap: wrap;
        box-sizing: border-box;
      }
      .welcome-suggest button {
        background: #e5e4e0;
        border: none;
        border-radius: 20px;
        padding: 16px 20px;
        color: #1a1a1a;
        font-size: 13.5px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s, transform 0.1s;
        text-align: left;
        width: 100%;
        max-width: 340px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.02);
      }
      .welcome-suggest button:hover {
        background: #dad9d4;
      }
      .welcome-suggest button:active {
        transform: scale(0.98);
      }

      .msgs {
        flex: 1;
        overflow-y: auto;
        padding: 12px 20px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .msgs::-webkit-scrollbar {
        width: 6px;
      }
      .msgs::-webkit-scrollbar-thumb {
        background: rgba(0,0,0,0.1);
        border-radius: 3px;
      }

      .msg {
        display: flex;
        width: 100%;
      }
      .msg.user {
        justify-content: flex-end;
      }
      .msg.user .bubble {
        background: #e9e8e4;
        color: #1a1a1a;
        border-radius: 20px;
        padding: 12px 16px;
        max-width: 80%;
        font-size: 14.5px;
        line-height: 1.45;
        word-wrap: break-word;
        box-shadow: 0 1px 2px rgba(0,0,0,0.02);
      }
      
      .msg.assistant {
        justify-content: flex-start;
        flex-direction: column;
        align-items: flex-start;
      }
      .msg.assistant .bubble {
        background: transparent;
        color: #1a1a1a;
        padding: 0;
        max-width: 100%;
        font-size: 14.5px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .msg.error {
        justify-content: center;
      }
      .msg.error .bubble {
        background: #ffeceb;
        color: #ae2a19;
        border: 1px solid #ffd5d2;
        border-radius: 16px;
        padding: 10px 14px;
        font-size: 13.5px;
        max-width: 90%;
        text-align: center;
      }

      .tool {
        font-size: 12px;
        color: #707070;
        margin: 4px 0 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.03);
        padding: 6px 12px;
        border-radius: 12px;
        width: fit-content;
      }
      .tool code {
        background: #e2e1dc;
        padding: 2px 6px;
        border-radius: 6px;
        color: #333;
        font-family: monospace;
        font-size: 11px;
      }

      .assistant-actions {
        display: flex;
        gap: 10px;
        margin-top: 8px;
        color: #8c8c8c;
      }
      .assistant-actions button {
        background: transparent;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: inherit;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: color 0.2s, background-color 0.2s;
      }
      .assistant-actions button:hover {
        color: #1a1a1a;
        background-color: rgba(0,0,0,0.05);
      }
      .assistant-actions button svg {
        width: 14px;
        height: 14px;
      }

      .footer-area {
        padding: 8px 16px 16px;
        background: transparent;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-sizing: border-box;
      }

      .composer {
        background: #ffffff;
        border-radius: 26px;
        padding: 12px 14px 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02);
        border: 1px solid rgba(0, 0, 0, 0.05);
        box-sizing: border-box;
      }
      .composer textarea {
        width: 100%;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        font-size: 14.5px;
        line-height: 1.4;
        color: #1a1a1a;
        min-height: 24px;
        max-height: 120px;
        font-family: inherit;
        padding: 4px 6px;
        box-sizing: border-box;
      }
      .composer textarea::placeholder {
        color: #9c9c9c;
      }
      .composer-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 4px;
      }
      .utility-btns {
        display: flex;
        gap: 4px;
      }
      .util-btn {
        background: transparent;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #707070;
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s;
      }
      .util-btn:hover {
        background-color: #f0f0f0;
        color: #1a1a1a;
      }
      .util-btn svg {
        width: 18px;
        height: 18px;
      }

      #send {
        background: #1a1a1a;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background-color 0.2s, transform 0.1s;
      }
      #send:hover {
        background-color: #333333;
      }
      #send:disabled {
        background-color: #e0e0e0;
        cursor: default;
      }
      #send:disabled svg {
        stroke: #a0a0a0;
      }
      #send:active:not(:disabled) {
        transform: scale(0.95);
      }
      #send svg {
        width: 16px;
        height: 16px;
      }

      .disclaimer {
        font-size: 11px;
        color: #8c8c8c;
        text-align: center;
        width: 100%;
        margin-top: 2px;
      }

      .dots {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        background: #e9e8e4;
        padding: 8px 14px;
        border-radius: 16px;
      }
      .dots span {
        font-size: 10px;
        color: #707070;
        animation: blink 1.2s infinite both;
      }
      .dots span:nth-child(2){ animation-delay:.2s }
      .dots span:nth-child(3){ animation-delay:.4s }
      @keyframes blink { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
    </style>

    <button class="launcher" id="launcher" title="Trello AI Agent">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>

    <div class="panel" id="panel">
      <div class="header">
        <button id="sidebar-toggle" title="Close Panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 3v18"/>
          </svg>
        </button>
        <div class="avatar"></div>
      </div>

      <div class="welcome-container" id="welcome-container">
        <div class="welcome-title">What can I help with?</div>
        <div class="welcome-suggest suggest" id="suggest">
          <button data-q="What boards do I have?">What boards do I have?</button>
          <button data-q="Add a card called 'Draft Q3 roadmap' to my To Do list">Add a card to To Do</button>
          <button data-q="Create a list called 'In Review' on my main board">Create a list</button>
        </div>
      </div>

      <div class="msgs" id="msgs"></div>

      <div class="footer-area">
        <div class="composer">
          <textarea id="input" rows="1" placeholder="Ask anything"></textarea>
          <div class="composer-actions">
            <div class="utility-btns">
              <button class="util-btn" title="Add attachment" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <button class="util-btn" title="Search web" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              </button>
              <button class="util-btn" title="Inspiration" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
              </button>
              <button class="util-btn" title="More" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
              </button>
            </div>
            <button id="send" title="Send message">
              <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          </div>
        </div>
        <div class="disclaimer">AI can make mistakes. Please double-check responses.</div>
      </div>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const panel = $('#panel');
  const msgs = $('#msgs');
  const input = $('#input');
  const sendBtn = $('#send');

  $('#launcher').addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) input.focus();
  });
  $('#sidebar-toggle').addEventListener('click', () => panel.classList.remove('open'));

  root.querySelectorAll('.suggest button').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.getAttribute('data-q');
      send();
    })
  );

  function addMsg(role, text) {
    if (role === 'user') {
      panel.classList.add('has-chat');
    }
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (role === 'assistant' && text) {
      const actions = document.createElement('div');
      actions.className = 'assistant-actions';
      actions.innerHTML = `
        <button class="action-btn" title="Copy response">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="action-btn" title="Good response">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        </button>
        <button class="action-btn" title="Bad response">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
        </button>
        <button class="action-btn" title="Listen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
        <button class="action-btn" title="Regenerate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
      `;
      actions.querySelector('[title="Copy response"]').addEventListener('click', () => {
        navigator.clipboard.writeText(text);
      });
      wrap.appendChild(actions);
    }

    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }

  function addTool(name) {
    const el = document.createElement('div');
    el.className = 'tool';
    el.innerHTML = `🔧 <span>using</span> <code></code>`;
    el.querySelector('code').textContent = name;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  let thinkingEl = null;
  function setThinking(on) {
    if (on && !thinkingEl) {
      thinkingEl = addMsg('assistant', '');
      thinkingEl.querySelector('.bubble').innerHTML =
        '<span class="dots"><span>●</span><span>●</span><span>●</span></span>';
    } else if (!on && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    input.disabled = b;
  }

  // Auto-grow textarea logic
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('keyup', (e) => {
    e.stopPropagation();
  });
  input.addEventListener('keypress', (e) => {
    e.stopPropagation();
  });
  sendBtn.addEventListener('click', send);

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // A self-updating bubble, used for retry countdowns.
  function transientBubble() {
    const el = addMsg('assistant', '');
    const bubble = el.querySelector('.bubble');
    return {
      set(t) { bubble.textContent = t; },
      remove() { el.remove(); },
    };
  }

  const RETRYABLE = new Set([429, 500, 503]);

  // Performs one backend step, transparently retrying transient errors
  // (rate limit / overload) once, with a visible countdown. Returns either
  // { parts } on success or { error: <friendly message> } to show the user.
  // Never surfaces raw provider JSON.
  async function stepWithRetry() {
    for (let attempt = 0; attempt < 2; attempt++) {
      setThinking(true);
      const resp = await agentStep(contents);
      setThinking(false);

      // Backend unreachable (network / service-worker error).
      if (!resp.ok) {
        return {
          error:
            'I can’t reach the agent backend right now. Check that it’s running and that the backend URL is set in the extension popup.',
        };
      }

      const data = resp.data || {};

      // Structured, already-friendly error from the backend.
      if (data.error) {
        const e = data.error; // { code, retryAfterSeconds, message }
        const wait = Math.min(Number(e.retryAfterSeconds) || 0, 60);
        if (RETRYABLE.has(e.code) && attempt === 0 && wait > 0) {
          const t = transientBubble();
          for (let s = wait; s > 0; s--) {
            t.set(`Rate limit reached — retrying in ${s}s…`);
            await sleep(1000);
          }
          t.remove();
          continue; // retry the same step
        }
        return { error: e.message || 'Something went wrong. Please try again.' };
      }

      if (!Array.isArray(data.parts) || !data.parts.length) {
        return { error: 'The assistant returned an empty response. Please try again.' };
      }
      return { parts: data.parts };
    }
    return { error: 'Still rate-limited after retrying. Please wait a minute and try again.' };
  }

  async function send() {
    const text = input.value.trim();
    if (busy || !text) return;
    input.value = '';
    input.style.height = 'auto'; // Reset autogrow height
    setBusy(true);
    addMsg('user', text);

    const checkpoint = contents.length; // for clean rollback on failure
    contents.push({ role: 'user', parts: [{ text }] });

    let failed = false;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const resp = await stepWithRetry();
        if (resp.error) {
          addMsg('error', resp.error);
          failed = true;
          break;
        }

        const parts = resp.parts;
        contents.push({ role: 'model', parts });

        const textOut = parts.filter((p) => p.text).map((p) => p.text).join('').trim();
        if (textOut) addMsg('assistant', textOut);

        const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
        if (calls.length === 0) break;

        const respParts = [];
        for (const c of calls) {
          addTool(c.name);
          let result;
          try {
            result = await window.YBOT_executeTool(c.name, c.args || {});
          } catch (e) {
            result = { error: String(e && e.message ? e.message : e) };
          }
          respParts.push({ functionResponse: { name: c.name, response: result } });
        }
        contents.push({ role: 'user', parts: respParts });

        if (step === MAX_STEPS - 1) {
          addMsg('error', 'That needed more steps than expected, so I stopped. Try a more specific request.');
          failed = true;
        }
      }
    } catch (e) {
      setThinking(false);
      addMsg('error', 'Unexpected error — please try again.');
      failed = true;
    }

    // On failure, drop the incomplete exchange so the conversation stays valid
    // for a retry, and restore the user's text so they can resend in one click.
    if (failed) {
      contents.length = checkpoint;
      if (!input.value) input.value = text;
    }

    setBusy(false);
    input.focus();
  }

  // greeting
  addMsg('assistant', "Hi! I'm your Trello agent. Tell me what to do — e.g. \"add a card to my To Do list\" — and I'll do it on your real boards.");
})();
