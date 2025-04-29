import CircuitBreaker from 'opossum'
import { _fetch } from './fetcher.js'

export function initOriginBreaker(server, opts) {
    // Name of the Circuit Breaker
    opts.origin.originBreakerOptions['name'] = `fetch-${opts.id}`
    // Speedis implements its own coalescing mechanism so we disable the one from the circuit breaker.
    opts.origin.originBreakerOptions['coalesce'] = false
    // Speedis itself implements a cache mechanism so we disable the one from the circuit breaker.
    opts.origin.originBreakerOptions['cache'] = false
    // Timeout for the Circuit Breaker
    if (opts.origin.originTimeout) {
      opts.origin.originBreakerOptions['timeout'] = opts.origin.originTimeout
    }

    // Origin Breaker instance
    let originBreaker = new CircuitBreaker(_fetch, opts.origin.originBreakerOptions)
    originBreaker.on('open', () => {
      // We will use this value to set the Retry-After header
      let retryAfter = new Date()
      retryAfter.setSeconds(retryAfter.getSeconds() + originBreaker.options.resetTimeout / 1000)
      originBreaker['retryAfter'] = retryAfter.toUTCString()
      server.log.error(`Origin ${opts.id}. Origin Breaker OPEN: No requests will be made.`)
    })
    originBreaker.on('halfOpen', () => {
      server.log.warn(`Origin ${opts.id}. Origin Breaker HALF OPEN: Requests are being tested.`)
    })
    originBreaker.on('close', () => {
      server.log.info(`Origin ${opts.id}. Origin Breaker CLOSED: Requests are being made normally.`)
    })
    return originBreaker
}