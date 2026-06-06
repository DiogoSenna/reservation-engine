import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRY: z.string().default('8h'),
  PAYMENT_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.85),
  PAYMENT_FAILURE_MODES: z.string().default('card_declined,timeout,fraud'),
  PAYMENT_MIN_LATENCY_MS: z.coerce.number().default(50),
  PAYMENT_MAX_LATENCY_MS: z.coerce.number().default(300),
})

export type AppConfig = z.infer<typeof schema>

export function configuration(): AppConfig {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${result.error.message}`)
  }
  return result.data
}
