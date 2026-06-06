export const DECR_INVENTORY = `
-- KEYS[1]: event inventory key e.g. "event:{eventId}:inventory"
-- Returns: 1 if a slot was claimed, 0 if sold out
local count = redis.call('DECR', KEYS[1])
if count < 0 then
  redis.call('INCR', KEYS[1])
  return 0
end
return 1
`

export const SLIDING_WINDOW = `
-- KEYS[1]: rate limit key
-- ARGV[1]: current timestamp ms, ARGV[2]: window ms, ARGV[3]: max requests, ARGV[4]: request id
-- Returns: 1 if allowed, 0 if rate limited
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local reqId = ARGV[4]
local cutoff = now - window

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local count = redis.call('ZCARD', KEYS[1])

if count >= limit then
  return 0
end

redis.call('ZADD', KEYS[1], now, reqId)
redis.call('PEXPIRE', KEYS[1], window)
return 1
`
