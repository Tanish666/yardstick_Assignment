# Trello HAR capture → agent tools

The agent's tools (`extension/tools-executor.js` + the function declarations in
`lib/tools.js`) were derived from a HAR capture of the **Trello web app** doing
each task manually. This file documents how to (re)capture and how each request
maps to a tool, so you can verify or extend the toolset against your own account.

## How to capture

1. Log in to https://trello.com in Chrome.
2. Open **DevTools → Network**. Tick **Preserve log**. Filter to `Fetch/XHR`.
3. Perform each task by hand in the UI:
   - Open a board (captures `GET /1/boards/{id}/lists`).
   - Create a card in a list (captures `POST /1/cards`).
   - Add a new list/column (captures `POST /1/lists`).
   - Comment on a card (captures `POST /1/cards/{id}/actions/comments`).
   - Drag a card to another list (captures `PUT /1/cards/{id}`).
   - Use the search box (captures `GET /1/search`).
4. Right-click the request list → **Save all as HAR with content** → save here as
   `trello.har`. (Not committed — it contains your session token.)

## What to look for in the capture

- **Base path:** all internal calls go to `https://trello.com/1/...`.
- **Auth:** there is **no API key / OAuth token** on these calls. Auth is the
  `cloud.session.token` cookie, sent automatically because the request is
  same-origin. This is exactly why the extension executes tools from the page
  context — it inherits the live session.
- **CSRF on writes:** every `POST`/`PUT`/`DELETE` includes a `dsc` parameter.
  Its value matches the non-HttpOnly `dsc` cookie. The executor reads
  `document.cookie` and attaches it on writes. If your capture shows `dsc`
  elsewhere (e.g. a header) or a different name, adjust `api()` in
  `tools-executor.js`.

## Request → tool mapping

| Tool          | Method & path                              | Key params                       |
| ------------- | ------------------------------------------ | -------------------------------- |
| `list_boards` | `GET /1/members/me/boards`                 | `filter=open`, `fields=name`     |
| `list_lists`  | `GET /1/boards/{board_id}/lists`           | `filter=open`, `fields=name`     |
| `list_cards`  | `GET /1/lists/{list_id}/cards`             | `fields=name,idList`             |
| `create_card` | `POST /1/cards`                            | `idList`, `name`, `desc`, `dsc`  |
| `create_list` | `POST /1/lists`                            | `idBoard`, `name`, `dsc`         |
| `add_comment` | `POST /1/cards/{card_id}/actions/comments` | `text`, `dsc`                    |
| `move_card`   | `PUT /1/cards/{card_id}`                    | `idList`, `dsc`                  |
| `search`      | `GET /1/search`                            | `query`, `modelTypes=cards,boards` |

## If a write returns 401 / "invalid token"

The `dsc` cookie is tied to the active session. Open a fresh Trello tab so the
extension reads a current token, then retry. If it still fails, re-capture a HAR
and confirm the exact param name/location Trello currently uses for `dsc`.
