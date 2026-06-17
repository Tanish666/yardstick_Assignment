import { GoogleGenAI } from '@google/genai';
import tools from '../../../lib/tools.js';

const { SYSTEM, TOOLS } = tools;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Always 200 + CORS so the extension can read a clean payload regardless.
function reply(body) {
  return Response.json(body, { headers: CORS });
}

// Turn any thrown error (SDK ApiError, network error, raw JSON string) into a
// clean, safe { code, retryAfterSeconds, message } — never leak raw provider JSON.
function parseError(err) {
  let code = typeof err?.status === 'number' ? err.status : 0;
  let retryAfterSeconds = null;

  const raw = (err && err.message) || String(err || '');
  let obj = null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      obj = JSON.parse(m[0]);
    } catch (_) {
      /* not JSON */
    }
  }
  const e = (obj && obj.error) || obj;
  if (e && typeof e === 'object') {
    if (!code && typeof e.code === 'number') code = e.code;
    const details = Array.isArray(e.details) ? e.details : [];
    for (const d of details) {
      const t = d && d['@type'];
      if (t && String(t).includes('RetryInfo') && d.retryDelay) {
        const s = parseFloat(String(d.retryDelay).replace(/s$/, ''));
        if (!Number.isNaN(s)) retryAfterSeconds = Math.ceil(s);
      }
    }
  }
  // Infer from text if no numeric code surfaced.
  if (!code) {
    if (/quota|rate.?limit|exhausted|RESOURCE_EXHAUSTED/i.test(raw)) code = 429;
    else if (/api key|API_KEY_INVALID|unauthenticated|permission/i.test(raw)) code = 401;
  }
  return { code, retryAfterSeconds, message: friendlyMessage(code, retryAfterSeconds) };
}

function friendlyMessage(code, retryAfterSeconds) {
  switch (code) {
    case 429: {
      const when = retryAfterSeconds ? ` Try again in about ${retryAfterSeconds}s.` : ' Please wait a moment and try again.';
      return `I’ve hit the Gemini API rate limit (the free tier allows only a few requests per minute).${when}`;
    }
    case 401:
    case 403:
      return 'The agent backend’s Gemini API key is missing or not authorized. Please check the GEMINI_API_KEY configuration.';
    case 400:
      return 'Gemini rejected that request. Try rephrasing what you’d like me to do.';
    case 404:
      return 'The configured Gemini model wasn’t found. Check the GEMINI_MODEL setting on the backend.';
    case 500:
    case 503:
      return 'Gemini is temporarily unavailable. Please try again in a moment.';
    default:
      return 'Something went wrong reaching the AI service. Please try again.';
  }
}

// One agent step. Stateless: given the running conversation (Gemini `contents`
// format), return the model's next turn, or a clean structured error.
export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return reply({ error: { code: 401, retryAfterSeconds: null, message: friendlyMessage(401) } });
  }

  let contents;
  try {
    const body = await req.json();
    contents = Array.isArray(body?.contents) ? body.contents : null;
  } catch (_) {
    contents = null;
  }
  if (!contents) {
    return reply({ error: { code: 400, retryAfterSeconds: null, message: 'Bad request: expected { contents: [...] }.' } });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations: TOOLS }],
        temperature: 0.2,
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts || !parts.length) {
      return reply({ error: { code: 0, retryAfterSeconds: null, message: 'The model returned an empty response. Please try again.' } });
    }
    return reply({ parts });
  } catch (err) {
    const e = parseError(err);
    // Full detail to server logs only — never to the client.
    console.error('[/api/chat] gemini error', { code: e.code, raw: err?.message || err });
    return reply({ error: e });
  }
}
