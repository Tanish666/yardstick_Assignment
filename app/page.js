export const metadata = {
  title: 'Yardstick Trello Agent — Backend',
};

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '60px auto', padding: '0 20px', lineHeight: 1.6 }}>
      <h1>Yardstick Trello Agent — backend</h1>
      <p>
        This is the Gemini-powered agent backend for the Trello AI chatbot Chrome extension.
        It exposes a single endpoint:
      </p>
      <pre style={{ background: '#f4f4f5', padding: 12, borderRadius: 8 }}>POST /api/chat</pre>
      <p>
        Status:{' '}
        <strong style={{ color: process.env.GEMINI_API_KEY ? '#16a34a' : '#dc2626' }}>
          {process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY is set ✓' : 'GEMINI_API_KEY is NOT set ✗'}
        </strong>
      </p>
      <p>Load the extension in Chrome and point it at this deployment&apos;s URL. See the project README.</p>
    </main>
  );
}
