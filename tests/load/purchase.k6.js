import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const confirmed = new Counter('tickets_confirmed')
const soldOut = new Counter('tickets_sold_out')
const paymentFailed = new Counter('payment_failed')
const rateLimited = new Counter('rate_limited')

export const options = {
  stages: [
    { duration: '10s', target: 100 },
    { duration: '20s', target: 500 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // checks tracks our 'not 5xx' assertion — the real signal for server errors
    checks: ['rate==1.0'],
    http_req_duration: ['p(95)<2000'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const USERS = Array.from({ length: 20 }, (_, i) => `user${i + 1}@example.com`)

function login(email) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  return res.json('token')
}

export function setup() {
  const tokens = USERS.map(login)
  const eventsRes = http.get(`${BASE_URL}/events`)
  const events = eventsRes.json()
  // Use the largest event so sold_out doesn't dominate early
  const event = events.reduce((a, b) => (a.totalCapacity > b.totalCapacity ? a : b))
  return { tokens, eventId: event.id }
}

export default function ({ tokens, eventId }) {
  const token = tokens[__VU % tokens.length]
  const res = http.post(
    `${BASE_URL}/events/${eventId}/purchase`,
    null,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  check(res, { 'not 5xx': (r) => r.status < 500 })

  if (res.status === 201) confirmed.add(1)
  else if (res.status === 409) soldOut.add(1)
  else if (res.status === 402) paymentFailed.add(1)
  else if (res.status === 429) rateLimited.add(1)

  sleep(0.1)
}
