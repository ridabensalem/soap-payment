import crypto from 'crypto'

export function verifySignature(rawBody, signatureHeader) {
  const parts = signatureHeader.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1]
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1]
  if (!timestamp || !signature) return false

  const message = `${timestamp}.${rawBody}`
  const expectedSignature = crypto
    .createHmac('sha256', process.env.SOAP_WEBHOOK_SECRET_SIGNING_KEY)
    .update(message)
    .digest('hex')

  try {
    const r = Buffer.from(signature, 'hex')
    const e = Buffer.from(expectedSignature, 'hex')
    return r.length === e.length && crypto.timingSafeEqual(r, e)
  } catch {
    return false
  }
}

export function processEvent(event) {
  const { type: eventType, data } = event

  console.log(eventType)
  console.log(data)

  // if you put a hold on the players balance before they started the checkout, you need to release the hold here
  // This should only be on withdrawal
  // This is not recommended to do at all, instead use Soap's built in payment reviews
  if (eventType === 'checkout.terminally_failed') {
    if (data.type === "withdrawal") {
      const balance = 1000 // look up the amount you put on hold
      return { balance_change_amount_cents: balance } // add it back to the balance
    } else {
      return { balance_change_amount_cents: 0 }
    }
  }

  // This could be another example if you are placing balance on hold for a withdrawal
  if (eventType === 'checkout.expired') {
    if (data.type === "withdrawal") {
      const balance = 1000 // look up the amount you put on hold
      return { balance_change_amount_cents: balance } // add it back to the balance
    } else {
      return { balance_change_amount_cents: 0 }
    }
  }

  if (eventType === 'checkout.review.created' || eventType === 'checkout.review.approved' || eventType === 'checkout.review.declined') {
    // If you are using these events to move money out of a players withdrawable or available balance we highly recommend creating an additional bucket called "under review"
    // Do not mix these events with checkout.hold and release_hold, they mean different things!!
    return { balance_change_amount_cents: 0 }
  }

  const amount = data.charge.amount_cents
  const txType = data.charge.transaction_type

  switch (eventType) {
    case 'checkout.succeeded':
      // if it's a credit, we need to add the amount to the balance
      // if it's a debit, we don't need to do anything since the balance is already updated in the hold event
      return txType === 'credit' ? { balance_change_amount_cents: amount } : { balance_change_amount_cents: 0}
    case 'checkout.hold':
      return { balance_change_amount_cents: -amount }
    case 'checkout.release_hold':
      return { balance_change_amount_cents: amount }
    case 'checkout.returned':
      // undo the previous transaction bc the payment bounced
      // if it was a debit you need to add back balance
      // if it was a credit you need to subtract balance
      if (txType === 'debit') return { balance_change_amount_cents: amount }
      if (txType === 'credit') return { balance_change_amount_cents: -amount }
    case 'checkout.failed':
      // dont need to do anything here, mostly for tracking purposes and/or you want to disable user accounts for suspicious activity
      return { balance_change_amount_cents: 0 }
    case 'checkout.pending':
      return { balance_change_amount_cents: 0 }
    case 'checkout.voided':
      if (txType === 'debit') return { balance_change_amount_cents: amount }
      if (txType === 'credit') return { balance_change_amount_cents: -amount }
    default:
      throw new Error(`Unknown event type: ${eventType}`)
  }
}
