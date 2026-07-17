// Vercel serverless function: proxies chat-completion requests to Groq
// so the API key stays server-side (env var) instead of in client JS / git history.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'GROQ_API_KEY is not configured on the server' } });
    return;
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(req.body)
    });
    const data = await groqRes.json();
    res.status(groqRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'Failed to reach Groq: ' + err.message } });
  }
};
