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
<html>
<head>
  <title>Soap Mock Checkout</title>
  <style>
    body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f5f5f7; }
    .card { background:white; padding:32px; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,.1); width:320px; text-align:center; }
    button { display:block; width:100%; padding:12px; margin-top:12px; border:none; border-radius:8px; font-size:15px; cursor:pointer; }
    .approve { background:#16a34a; color:white; }
    .decline { background:#dc2626; color:white; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${label} $${amount}</h2>
    <p>Mock Soap Checkout &mdash; simulate the outcome</p>
    <form method="POST" action="/mock-checkout/${checkout.id}/resolve">
      <button class="approve" name="outcome" value="succeed">Approve payment</button>
      <button class="decline" name="outcome" value="fail">Decline payment</button>
    </form>
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