// Tool / "skill" definitions for the Trello agent.
//
// Each function declaration below was derived from a real Trello HAR capture
// (see /har/README.md). The agent only DECIDES which tool to call and with what
// arguments — the actual HTTP request to Trello is executed inside the Chrome
// extension's content script, using the user's existing trello.com session.
// That keeps the backend stateless and auth-free.

const SYSTEM = `You are "Yardstick", an AI assistant embedded directly inside the user's Trello workspace.
You complete REAL tasks on Trello by calling the provided tools. Every tool runs in the user's own
browser session, so all actions are performed as the user, on their real boards.

How to work:
- Trello objects are referenced by IDs, never by name. To act on something, first RESOLVE its ID:
  • Call list_boards to find a board by name.
  • Call list_lists(board_id) to find a list within a board.
  • Call list_cards(list_id) or search(query) to find a card.
- Never invent or guess an ID. If a name is ambiguous (multiple matches), either ask the user to clarify
  or pick the clearly-intended one and say which you chose.
- Chain tools as needed: e.g. to "add a card to To Do on my Marketing board", call list_boards,
  then list_lists, then create_card.
- After a write action (create_card, create_list, add_comment, move_card), confirm in one short sentence
  what you did, naming the card/list involved.
- If a tool returns an "error" field, explain it plainly and suggest a fix. If a WRITE fails with an
  auth / invalid-token error, tell the user to open a fresh Trello tab so the extension can read a valid
  session token, then try again.
- Be concise. Don't dump raw IDs at the user unless they ask.`;

const TOOLS = [
  {
    name: 'list_boards',
    description: "List the user's open Trello boards (their names and IDs). Use to resolve a board name to a board_id.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_lists',
    description: 'List the open lists (columns) on a board. Use to resolve a list name to a list_id before creating or moving cards.',
    parameters: {
      type: 'OBJECT',
      properties: {
        board_id: { type: 'STRING', description: 'The id of the board, from list_boards.' },
      },
      required: ['board_id'],
    },
  },
  {
    name: 'list_cards',
    description: 'List the cards in a single list (column), with their names and IDs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        list_id: { type: 'STRING', description: 'The id of the list, from list_lists.' },
      },
      required: ['list_id'],
    },
  },
  {
    name: 'create_card',
    description: 'Create a new card in a list. Resolve the list_id first via list_boards + list_lists.',
    parameters: {
      type: 'OBJECT',
      properties: {
        list_id: { type: 'STRING', description: 'The id of the list to add the card to.' },
        name: { type: 'STRING', description: 'The title of the card.' },
        desc: { type: 'STRING', description: 'Optional card description / body text.' },
      },
      required: ['list_id', 'name'],
    },
  },
  {
    name: 'create_list',
    description: 'Create a new list (column) on a board.',
    parameters: {
      type: 'OBJECT',
      properties: {
        board_id: { type: 'STRING', description: 'The id of the board to add the list to.' },
        name: { type: 'STRING', description: 'The name of the new list.' },
      },
      required: ['board_id', 'name'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a card. Resolve the card_id first via search or list_cards.',
    parameters: {
      type: 'OBJECT',
      properties: {
        card_id: { type: 'STRING', description: 'The id of the card to comment on.' },
        text: { type: 'STRING', description: 'The comment text.' },
      },
      required: ['card_id', 'text'],
    },
  },
  {
    name: 'move_card',
    description: 'Move a card to a different list (e.g. from "To Do" to "Done"). Resolve both ids first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        card_id: { type: 'STRING', description: 'The id of the card to move.' },
        list_id: { type: 'STRING', description: 'The id of the destination list.' },
      },
      required: ['card_id', 'list_id'],
    },
  },
  {
    name: 'search',
    description: 'Search the user\'s Trello for cards and boards matching a query string. Returns ids you can act on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Free-text search query.' },
      },
      required: ['query'],
    },
  },
];

module.exports = { SYSTEM, TOOLS };
