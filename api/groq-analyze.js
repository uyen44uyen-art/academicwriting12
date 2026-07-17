// Vercel serverless function: proxies the app's AI vocab/grammar analysis
// requests to a Claude-compatible endpoint (default: api.tongkhokr.com) so the
// paid token stays server-side (env var) instead of in client JS / git history.
//
// The browser posts an OpenAI-shaped body ({model, messages, max_tokens, ...}).
// This function translates it to the Anthropic Messages API and translates the
// response back to the OpenAI shape the browser expects
// (data.choices[0].message.content), so index.html needs no changes.
//
// Required Vercel env var:
//   AI_AUTH_TOKEN  – the sk-... token for the proxy (KEEP SECRET)
// Optional:
//   AI_BASE_URL    – default https://api.tongkhokr.com
//   AI_MODEL       – default claude-3-5-sonnet-20241022 (set to whatever your plan supports)
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const token = process.env.AI_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || process.env.GROQ_API_KEY;
  if (!token) {
    res.status(500).json({ error: { message: 'AI_AUTH_TOKEN is not configured on the server' } });
    return;
  }
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.tongkhokr.com').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';

  try {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    // Anthropic keeps the system prompt separate from the messages array.
    const systemMsg = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const convoMsgs = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));

    const anthropicBody = {
      model,
      max_tokens: body.max_tokens || 4000,
      messages: convoMsgs.length ? convoMsgs : [{ role: 'user', content: '' }],
    };
    if (systemMsg) anthropicBody.system = systemMsg;
    if (typeof body.temperature === 'number') anthropicBody.temperature = body.temperature;

    const upstream = await fetch(baseUrl + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + token,
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: { message: (data && data.error && data.error.message) || JSON.stringify(data) } });
      return;
    }

    // Anthropic response: { content: [{ type:'text', text:'...' }], ... }
    let text = Array.isArray(data.content)
      ? data.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : '';
    // Claude sometimes wraps JSON in ```json ... ``` fences — strip them so the
    // browser's JSON.parse succeeds.
    text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    res.status(200).json({ choices: [{ message: { role: 'assistant', content: text } }] });
  } catch (err) {
    res.status(502).json({ error: { message: 'Failed to reach AI endpoint: ' + err.message } });
  }
};
