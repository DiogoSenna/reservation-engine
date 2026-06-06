-- KEYS[1]: event inventory key e.g. "event:{eventId}:inventory"
-- Returns: 1 if a slot was claimed, 0 if sold out
local count = redis.call('DECR', KEYS[1])
if count < 0 then
  redis.call('INCR', KEYS[1])
  return 0
end
return 1
