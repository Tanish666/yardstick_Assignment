// The "skills" layer: turns the agent's tool calls into real Trello API requests.
//
// These endpoints + parameters were taken from a HAR capture of the Trello web
// app performing each task manually (see /har/README.md). All requests run from
// the trello.com page origin, so:
//   • the session cookie (cloud.session.token) is included automatically, and
//   • the CSRF "dsc" token is read from document.cookie and sent on writes.
// No API key, no OAuth, no login flow — we reuse the user's live session.

(function () {
  const BASE = 'https://trello.com/1';

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function api(path, method, params) {
    method = method || 'GET';
    params = Object.assign({}, params);
    const isWrite = method !== 'GET';

    // Trello requires the double-submit CSRF token ("dsc") on write requests.
    if (isWrite) {
      const dsc = getCookie('dsc');
      if (dsc) params.dsc = dsc;
    }

    let url = BASE + path;
    const opts = {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    };

    const qs = new URLSearchParams(params).toString();
    if (isWrite) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = qs;
    } else if (qs) {
      url += '?' + qs;
    }

    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
    if (!res.ok) {
      return { error: 'Trello API ' + res.status, detail: data };
    }
    return data;
  }

  const TOOLS = {
    async list_boards() {
      const b = await api('/members/me/boards', 'GET', { filter: 'open', fields: 'name' });
      if (b && b.error) return b;
      return { boards: (b || []).map((x) => ({ id: x.id, name: x.name })) };
    },

    async list_lists(args) {
      const l = await api('/boards/' + args.board_id + '/lists', 'GET', { filter: 'open', fields: 'name' });
      if (l && l.error) return l;
      return { lists: (l || []).map((x) => ({ id: x.id, name: x.name })) };
    },

    async list_cards(args) {
      const c = await api('/lists/' + args.list_id + '/cards', 'GET', { fields: 'name,idList' });
      if (c && c.error) return c;
      return { cards: (c || []).map((x) => ({ id: x.id, name: x.name })) };
    },

    async create_card(args) {
      const c = await api('/cards', 'POST', { idList: args.list_id, name: args.name, desc: args.desc || '' });
      if (c && c.error) return c;
      return { ok: true, id: c.id, name: c.name, url: c.shortUrl || c.url };
    },

    async create_list(args) {
      const l = await api('/lists', 'POST', { idBoard: args.board_id, name: args.name });
      if (l && l.error) return l;
      return { ok: true, id: l.id, name: l.name };
    },

    async add_comment(args) {
      const a = await api('/cards/' + args.card_id + '/actions/comments', 'POST', { text: args.text });
      if (a && a.error) return a;
      return { ok: true, id: a.id };
    },

    async move_card(args) {
      const c = await api('/cards/' + args.card_id, 'PUT', { idList: args.list_id });
      if (c && c.error) return c;
      return { ok: true, id: c.id, idList: c.idList };
    },

    async search(args) {
      const s = await api('/search', 'GET', {
        query: args.query,
        modelTypes: 'cards,boards',
        card_fields: 'name,idList',
        cards_limit: 10,
        boards_limit: 10,
      });
      if (s && s.error) return s;
      return {
        cards: (s.cards || []).map((x) => ({ id: x.id, name: x.name, idList: x.idList })),
        boards: (s.boards || []).map((x) => ({ id: x.id, name: x.name })),
      };
    },
  };

  // Exposed to content.js
  window.YBOT_executeTool = async function (name, args) {
    const fn = TOOLS[name];
    if (!fn) return { error: 'Unknown tool: ' + name };
    try {
      return await fn(args || {});
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
  };
})();
