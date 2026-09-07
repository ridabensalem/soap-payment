import 'dotenv/config'
import express from 'express'
import crypto from 'crypto'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

const PORT = process.env.PORT || 4243
const SOAP_API_KEY = process.env.SOAP_API_KEY
const SOAP_WEBHOOK_SECRET_SIGNING_KEY = process.env.SOAP_WEBHOOK_SECRET_SIGNING_KEY
const WEBHOOK_TARGET_URL = process.env.WEBHOOK_TARGET_URL || 'http://localhost:8008/webhooks'

// In-memory "database" of checkouts. Restarting this server clears it.
const checkouts = new Map()

function requireApiKey(req, res, next) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace('Bearer ', '')
  if (!SOAP_API_KEY || token !== SOAP_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

// Signs a payload the same way real Soap webhooks are verified in webhooks.js:
// header = "t=<timestamp>,v1=<hmac_sha256(timestamp.rawBody, secret)>"
function signPayload(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000)
  const message = `${timestamp}.${rawBody}`
  const signature = crypto
    .createHmac('sha256', SOAP_WEBHOOK_SECRET_SIGNING_KEY)
    .update(message)
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function sendWebhook(eventType, data) {
  const event = { type: eventType, data }
  const rawBody = JSON.stringify(event)
  const signature = signPayload(rawBody)

  try {
    const res = await fetch(WEBHOOK_TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'soap-webhook-signature': signature,
      },
      body: rawBody,
    })
    console.log(`webhook sent: ${eventType} -> ${res.status}`)
  } catch (err) {
    console.error('Failed to deliver webhook:', err.message)
  }
}

// POST /api/v1/checkouts - mirrors Soap's real checkout creation endpoint
app.post('/api/v1/checkouts', requireApiKey, (req, res) => {
  const { customer_id, type, balance_amount_cents } = req.body

  if (!customer_id || !type) {
    return res.status(400).json({ error: 'customer_id and type are required' })
  }

  const id = 'chk_' + crypto.randomBytes(8).toString('hex')
  // Mock deposit amount since there's no real payment form; withdrawals use
  // the balance_amount_cents your app sent, same as the real API expects.
  const amount_cents = type === 'withdrawal' ? (balance_amount_cents || 0) : 5000

  const checkout = {
    id,
    customer_id,
    type,
    amount_cents,
    status: 'pending',
    created_at: Date.now(),
  }
  checkouts.set(id, checkout)

  res.json({
    id,
    url: `http://localhost:${PORT}/mock-checkout/${id}`,
    client_secret: 'secret_' + crypto.randomBytes(8).toString('hex'),
    status: 'pending',
  })
})

// GET /api/v1/checkouts/:id - lets your app poll checkout status if needed
app.get('/api/v1/checkouts/:id', requireApiKey, (req, res) => {
  const checkout = checkouts.get(req.params.id)
  if (!checkout) return res.status(404).json({ error: 'Not found' })
  res.json(checkout)
})

// GET /mock-checkout/:id - fake hosted checkout page a real payer would see
app.get('/mock-checkout/:id', (req, res) => {
  const checkout = checkouts.get(req.params.id)
  if (!checkout) return res.status(404).send('Checkout not found or expired')

  const label = checkout.type === 'withdrawal' ? 'Withdraw' : 'Deposit'
  const amount = (checkout.amount_cents / 100).toFixed(2)

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bank of SOAP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #10233F;
    --ink-soft: #5B6B7C;
    --paper: #EAF2F3;
    --surface: #FFFFFF;
    --line: #D8E3E3;
    --accent: #1F7A6C;
    --accent-ink: #FFFFFF;
    --decline: #9A4B3A;
    --bubble-a: #BFE3E0;
    --bubble-b: #D9C9F0;
    --focus: #1F7A6C;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    font-family: 'Inter', sans-serif;
    color: var(--ink);
    padding: 24px;
    position: relative;
    overflow: hidden;
  }
  .bubble {
    position: absolute;
    border-radius: 50%;
    filter: blur(2px);
    opacity: 0.55;
    pointer-events: none;
  }
  .bubble.one { width: 180px; height: 180px; top: -60px; left: -50px; background: radial-gradient(circle at 30% 30%, var(--bubble-a), transparent 70%); }
  .bubble.two { width: 120px; height: 120px; bottom: -30px; right: -20px; background: radial-gradient(circle at 30% 30%, var(--bubble-b), transparent 70%); }
  .bubble.three { width: 60px; height: 60px; top: 40px; right: 60px; background: radial-gradient(circle at 30% 30%, var(--bubble-b), transparent 70%); opacity: 0.4; }

  .card {
    position: relative;
    background: var(--surface);
    width: 100%;
    max-width: 380px;
    border-radius: 20px;
    padding: 32px 28px;
    box-shadow: 0 20px 40px -20px rgba(16, 35, 63, 0.25);
    border: 1px solid var(--line);
  }
  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .wordmark {
    font-family: 'Fraunces', serif;
    font-size: 19px;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .env-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-soft);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 10px 4px 8px;
  }
  .env-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0 0 24px;
  }
  .kind {
    font-size: 14px;
    color: var(--ink-soft);
    margin: 0 0 4px;
  }
  .amount {
    font-family: 'Fraunces', serif;
    font-size: 44px;
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0 0 24px;
    line-height: 1.1;
  }
  .details {
    border-top: 1px solid var(--line);
    padding-top: 16px;
    margin-bottom: 24px;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    padding: 6px 0;
  }
  .detail-label { color: var(--ink-soft); }
  .detail-value { color: var(--ink); text-align: right; }

  button, .btn {
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }
  .approve {
    display: block;
    width: 100%;
    padding: 14px;
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: 10px;
    transition: background 0.15s ease;
  }
  .approve:hover { background: #1a6a5d; }
  .decline {
    display: block;
    width: 100%;
    margin-top: 12px;
    padding: 10px;
    background: none;
    border: none;
    color: var(--decline);
    text-align: center;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.15s ease;
  }
  .decline:hover { text-decoration-color: var(--decline); }
  button:focus-visible, .btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .footnote {
    margin: 20px 0 0;
    font-size: 12px;
    color: var(--ink-soft);
    text-align: center;
  }
  .result-card { text-align: center; }
  .result-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    font-size: 22px;
  }
  .result-icon.success { background: #E4F2EE; color: var(--accent); }
  .result-icon.failed { background: #F3E7E3; color: var(--decline); }
  .result-title {
    font-family: 'Fraunces', serif;
    font-size: 22px;
    font-weight: 500;
    margin: 0 0 8px;
  }
  .result-body {
    font-size: 14px;
    color: var(--ink-soft);
    margin: 0;
  }
</style>
</head>
<body>
  <div class="bubble one"></div>
  <div class="bubble two"></div>
  <div class="bubble three"></div>
  
  <div class="card">
    <div class="brand-row">
      <span class="wordmark">Bank of SOAP</span>
      <span class="env-badge"><span class="env-dot"></span>Sandbox</span>
    </div>
    <hr>
    <p class="kind">You're depositing</p>
    <p class="amount">$50.00</p>
    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Customer</span>
        <span class="detail-value">cus_12345</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Reference</span>
        <span class="detail-value">chk_316b8b927574f9c4</span>
      </div>
    </div>
    <form method="POST" action="/mock-checkout/chk_316b8b927574f9c4/resolve">
      <button class="approve" type="submit" name="outcome" value="succeed">Approve payment</button>
      <button class="decline" type="submit" name="outcome" value="fail">Decline payment</button>
    </form>
    <p class="footnote">Payments are simulated locally — no funds move.</p>
  </div>
  
</body>
</html>`)
})

// POST /mock-checkout/:id/resolve - simulates the payer finishing checkout,
// then fires a real signed webhook to your app, just like Soap would.
app.post('/mock-checkout/:id/resolve', async (req, res) => {
  const checkout = checkouts.get(req.params.id)
  if (!checkout) return res.status(404).send('Checkout not found')

  const { outcome } = req.body
  const txType = checkout.type === 'withdrawal' ? 'debit' : 'credit'

  if (outcome === 'succeed') {
    checkout.status = 'succeeded'
    await sendWebhook('checkout.succeeded', {
      id: checkout.id,
      type: checkout.type,
      customer_id: checkout.customer_id,
      charge: { amount_cents: checkout.amount_cents, transaction_type: txType },
    })
    res.send('<h2>Payment approved ✅</h2><p>You can close this window.</p>')
  } else {
    checkout.status = 'failed'
    await sendWebhook('checkout.failed', {
      id: checkout.id,
      type: checkout.type,
      customer_id: checkout.customer_id,
    })
    res.send('<h2>Payment declined ❌</h2><p>You can close this window.</p>')
  }
})

app.listen(PORT, () => {
  console.log(`Mock Soap API running at http://localhost:${PORT}`)
})