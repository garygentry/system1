# Ways to add rate limiting to outgoing payment calls

## A. Token bucket in process
Wrap postJson with an in-memory token bucket. No new dependencies. Limits apply per process only.

## B. Redis-backed limiter
Use the `rate-limiter-flexible` package with Redis. Shared across processes. Adds a dependency and needs Redis.

## C. Provider-side limits
Rely on the payment provider's 429 responses and retry with backoff. No code for limiting itself.
