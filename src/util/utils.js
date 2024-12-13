import os from 'os'

export function cloneAndTrimResponse(response) {
  return {
    statusCode: response.statusCode,
    body: response.body,
    headers: JSON.parse(JSON.stringify(response.headers)),
    requestTime: response.requestTime,
    responseTime: response.responseTime,
    ttl: (Object.prototype.hasOwnProperty.call(response, 'ttl') ? response.ttl : 0)
  }
}

// We parse the Cache-Control header to extract cache directives.
export function parseCacheControlHeader(response) {
  const cacheDirectives = {}
  if (!response.headers) return cacheDirectives
  if ('cache-control' in response.headers) {
    response.headers['cache-control']
      .replace(/ /g, '')
      .split(',')
      .map((cacheDirective) => {
        const tokens = cacheDirective.split('=')
        cacheDirectives[tokens[0].toLowerCase()] = (tokens.length === 1) ? null : tokens[1].toLowerCase()
        return null
      })
  }
  return cacheDirectives
}

// https://httpwg.org/specs/rfc9110.html#rfc.section.6.6.1
export function ensureValidDateHeader(response, responseTime) {
  if (!Object.prototype.hasOwnProperty.call(response.headers, 'date')
    || Number.isNaN(Date.parse(response.headers['date']))) {
    response.headers['date'] = (new Date(responseTime)).toUTCString()
  }
}

// See: https://httpwg.org/specs/rfc9111.html#rfc.section.4.2.1
export function calculateFreshnessLifetime(response) {
  // TODO: What do we do with TTL Infinity?
  let freshnessLifetime = 0
  const cacheDirectives = parseCacheControlHeader(response)
  if (Object.prototype.hasOwnProperty.call(cacheDirectives, 's-maxage')) {
    freshnessLifetime = parseInt(cacheDirectives['s-maxage'])
  } else if (Object.prototype.hasOwnProperty.call(cacheDirectives, 'max-age')) {
    freshnessLifetime = parseInt(cacheDirectives['max-age'])
  } else if (Object.prototype.hasOwnProperty.call(response.headers, 'expires')) {
    const expires = Date.parse(response.headers.expires)
    const date = Date.parse(response.headers.date)
    if (!(isNaN(expires) || isNaN(date))) {
      freshnessLifetime = (expires - date) / 1000
    } else {
      // In the current implementation, we do not use the option to 
      // heuristically calculate an expiration.
      // See: https://httpwg.org/specs/rfc9111.html#rfc.section.4.2.2
      // If the origin server does not provide explicit expiration
      // information, we can always add it to the response using a 
      // transformation
    }
  }
  return freshnessLifetime
}

// See: https://httpwg.org/specs/rfc9111.html#rfc.section.5.1
// See: https://httpwg.org/specs/rfc9111.html#rfc.section.4.2.3
/**
 * The Age header field is used to convey an estimated age of the
 * response message when obtained from a cache. The Age field value
 * is the cache's estimate of the number of seconds since the 
 * origin server generated or validated the response.
 * 
 * The presence of an Age header field implies that the response 
 * was not generated or validated by the origin server for this request.
 * 
 * @param {*} response 
 * @returns age
 */
export function calculateAge(response) {

  let ageValue = 0
  if (Object.prototype.hasOwnProperty.call(response.headers, 'age')) {
    ageValue = parseInt(response.headers.age)
    if (Number.isNaN(ageValue)) ageValue = 0
  }

  let dateValue = 0
  if (Object.prototype.hasOwnProperty.call(response.headers, 'date')) {
    dateValue = Date.parse(response.headers.date)
    if (Number.isNaN(dateValue)) dateValue = 0
    else dateValue /= 1000
  }

  const now = Date.now() / 1000 | 0

  const apparentAge = Math.max(0, response.responseTime - dateValue)
  const responseDelay = response.responseTime - response.requestTime
  const correctedAgeValue = ageValue + responseDelay
  const correctedInitialAge = Math.max(apparentAge, correctedAgeValue)
  const residentTime = now - response.responseTime
  const currentAge = correctedInitialAge + residentTime

  return currentAge
}

// See: https://techdocs.akamai.com/edge-diagnostics/docs/pragma-headers
export function memHeader(trigger, outResponse) {
  switch (trigger) {
    case 'HIT':
      outResponse.headers['x-speedis-cache'] = 'TCP_HIT from ' + os.hostname()
      break
    case 'MISS':
      outResponse.headers['x-speedis-cache'] = 'TCP_MISS from ' + os.hostname()
      break
    case 'REFRESH_HIT':
      outResponse.headers['x-speedis-cache'] = 'TCP_REFRESH_HIT from ' + os.hostname()
      break
    case 'REFRESH_MISS':
      outResponse.headers['x-speedis-cache'] = 'TCP_REFRESH_MISS from ' + os.hostname()
      break
    case 'REFRESH_FAIL_HIT':
      outResponse.headers['x-speedis-cache'] = 'TCP_REFRESH_FAIL_HIT from ' + os.hostname()
    break
  }
}
