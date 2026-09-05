import 'dotenv/config'
import express from 'express'
import bodyParser from 'body-parser'
import fetch from 'node-fetch'
import path from 'path'
import { fileURLToPath } from 'url'
import { verifySignature, processEvent } from './webhooks.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.static(path.join(__dirname, 'public')))

async function createSoapCheckout(type) {
  const SOAP_URL = process.env.SOAP_URL 
  const SOAP_API_KEY = process.env.SOAP_API_KEY
  const CHECKOUT_URL = `${SOAP_URL}/checkouts`

  // in your app you would pull the actual user
  const user = {
    email: 'user@example.com',
    available_balance_cents: 10000,
    soap_customer_id: "cus_12345"
  }
  
  let body = {
    customer_id: user.soap_customer_id,// the Soap Customer ID of the logged in user
    type: type // "deposit" or "withdrawal"
  }

  // Sweeps or In-Game Currency
  // body.line_items = [{
  //   product_id: pr_123, // you created this product in Soap Dashboard
  //   quantity: 1,
  // }]

  if (type === 'withdrawal') {
    body.balance_amount_cents = user.available_balance_cents // the user's withdrawable balance in cents
  }

  const response = await fetch(CHECKOUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SOAP_API_KEY}` },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error('Failed to create checkout')
  }

  const data = await response.json()
  return data.url // pass url to client for redirect
}

// creating a checkout
app.post('/submit', async (req, res) => {
  const { type } = req.body

  try {
    const redirectUrl = await createSoapCheckout(type)
    res.redirect(redirectUrl)
  } catch (err) {
    console.error(err)
    res.status(500).send('Error creating checkout')
  }
})

app.post('/webhooks', async (req, res) => {
  const rawBody = JSON.stringify(req.body)
  const signature = req.headers['soap-webhook-signature']

  // in your app you would pull the actual user
  const user = {
    email: 'user@example.com',
    available_balance_cents: 10000,
    soap_customer_id: "cus_12345"
  }

  if (!signature || !verifySignature(rawBody, signature)) {
    return res.status(401).send('Invalid signature')
  }

  try {
    const { balance_change_amount_cents } = processEvent(req.body)
    user.available_balance_cents += balance_change_amount_cents
    return res.status(200).send('OK')
  } catch (err) {
    console.error('Error processing webhook:', err)
    return res.status(500).send('Internal error')
  }
})

app.listen(8008, () => {
  console.log('Server running at http://localhost:8008')
})