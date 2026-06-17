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
        background: #0c66e4; color: #fff; font-size: 24px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
        display: flex; align-items: center; justify-content: center; transition: transform .15s;
      }
      .launcher:hover { transform: scale(1.06); }
      .panel {
        position: fixed; right: 20px; bottom: 88px; z-index: 2147483647;
        width: 380px; height: 560px; max-height: calc(100vh - 120px);
        background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.3);
        display: none; flex-direction: column; overflow: hidden; border: 1px solid #e4e6ea;
      }
      .panel.open { display: flex; }
      .header {
        background: #0c66e4; color: #fff; padding: 14px 16px; font-weight: 600; font-size: 15px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .header .sub { font-weight: 400; font-size: 12px; opacity: .85; }
      .header button { background: transparent; border: none; color: #fff; font-size: 18px; cursor: pointer; }
      .msgs { flex: 1; overflow-y: auto; padding: 14px; background: #f7f8f9; }
      .msg { margin-bottom: 10px; display: flex; }
      .msg .bubble {
        padding: 9px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.45;
        max-width: 85%; white-space: pre-wrap; word-wrap: break-word;
      }
      .msg.user { justify-content: flex-end; }
      .msg.user .bubble { background: #0c66e4; color: #fff; border-bottom-right-radius: 3px; }
      .msg.assistant .bubble { background: #fff; color: #172b4d; border: 1px solid #e4e6ea; border-bottom-left-radius: 3px; }
      .msg.error .bubble { background: #ffeceb; color: #ae2a19; border: 1px solid #ffd5d2; }
      .tool { font-size: 11.5px; color: #5e6c84; margin: 4px 2px 8px; display: flex; align-items: center; gap: 6px; }
      .tool code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; color: #44546f; }
      .suggest { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; background: #f7f8f9; }
      .suggest button {
        font-size: 12px; background: #fff; border: 1px solid #d3d8de; color: #44546f;
        padding: 6px 9px; border-radius: 14px; cursor: pointer;
      }
      .suggest button:hover { background: #eef1f4; }
      .composer { display: flex; padding: 10px; gap: 8px; border-top: 1px solid #e4e6ea; background: #fff; }
      .composer textarea {
        flex: 1; resize: none; border: 1px solid #d3d8de; border-radius: 8px; padding: 8px 10px;
        font-size: 13.5px; height: 40px; max-height: 110px; outline: none; font-family: inherit;
      }
      .composer textarea:focus { border-color: #0c66e4; }
      .composer button {
        background: #0c66e4; color: #fff; border: none; border-radius: 8px; padding: 0 14px;
        cursor: pointer; font-size: 14px; font-weight: 600;
      }
      .composer button:disabled { opacity: .5; cursor: default; }
      .dots span { animation: blink 1.2s infinite both; }
      .dots span:nth-child(2){ animation-delay:.2s } .dots span:nth-child(3){ animation-delay:.4s }
      @keyframes blink { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
    </style>

    <button class="launcher" id="launcher" title="Trello AI Agent">🤖</button>

    <div class="panel" id="panel">
      <div class="header">
        <div>
          Trello AI Agent
          <div class="sub">Powered by Gemini · acts as you</div>
        </div>
        <button id="close" title="Close">✕</button>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="suggest" id="suggest">
        <button data-q="What boards do I have?">What boards do I have?</button>
        <button data-q="Add a card called 'Draft Q3 roadmap' to my To Do list">Add a card to To Do</button>
        <button data-q="Create a list called 'In Review' on my main board">Create a list</button>
      </div>
      <div class="composer">
        <textarea id="input" placeholder="Ask me to do something on Trello..."></textarea>
        <button id="send">➤</button>
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
  $('#close').addEventListener('click', () => panel.classList.remove('open'));

  root.querySelectorAll('.suggest button').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.getAttribute('data-q');
      send();
    })
  );

  function addMsg(role, text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);
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

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
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
