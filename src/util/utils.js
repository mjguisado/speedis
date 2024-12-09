import os from 'os'

export function cloneAndTrimResponse(path, response) {
  return {
    statusCode: response.statusCode,
    body: response.body,
    headers: { ...response.headers },
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

// See: https://tools.ietf.org/html/rfc7234#section-4.2.1
export function calculateFreshnessLifetime(response) {
  // TODO: What do we do with TTL Infinity?
  let freshnessLifetime = 0
  const cacheDirectives = parseCacheControlHeader(response)
  if (Object.prototype.hasOwnProperty.call(cacheDirectives, 's-maxage')) {
    freshnessLifetime = parseInt(cacheDirectives['s-maxage'])
  } else if (Object.prototype.hasOwnProperty.call(cacheDirectives, 'max-age')) {
    freshnessLifetime = parseInt(cacheDirectives['max-age'])
  } else if (Object.prototype.hasOwnProperty.call(response.headers, 'expires') &&
    Object.prototype.hasOwnProperty.call(response.headers, 'date')) {
    const expires = Date.parse(response.headers.expires)
    const date = Date.parse(response.headers.date)
    if (!(isNaN(expires) || isNaN(date))) {
      freshnessLifetime = (expires - date) / 1000
    } else {
      // In our implementation, we do not use the option to heuristically
      // calculate an expiration.
      // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
      // If the origin server does not provide explicit expiration
      // information, we can always add it to the response using its transformers
    }
  }
  return freshnessLifetime
};

// See: https://tools.ietf.org/html/rfc7234#section-4.2.3
export function calculateAge(response) {
  let ageValue = 0
  if (Object.prototype.hasOwnProperty.call(response.headers, 'age')) {
    ageValue = parseInt(response.headers.age)
    if (isNaN(ageValue)) ageValue = 0
  }
  let dateValue = 0
  if (Object.prototype.hasOwnProperty.call(response.headers, 'date')) {
    dateValue = Date.parse(response.headers.date)
    if (isNaN(dateValue)) dateValue = 0
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
};

export function isFreshnessLifeTime(response) {
  if (Object.prototype.hasOwnProperty.call(response.headers, 'x-speedis-freshness-lifetime-infinity')) {
    return response.headers['x-speedis-freshness-lifetime-infinity']
  } else {
    return false
  }
}

export function memHeader(trigger, ff, pv, outResponse) {
  switch (trigger) {
    case 'HIT':
      outResponse.headers['x-speedis-cache'] = 'TCP_MEM_HIT from ' + os.hostname()
      break
    case 'STALE':
      outResponse.headers['x-speedis-cache'] = 'TCP_STALE_MEM_HIT from ' + os.hostname()
      break
    case 'MISS':
      if (ff) {
        outResponse.headers['x-speedis-cache'] = 'TCP_FF_MISS from ' + os.hostname()
      } else if (pv) {
        outResponse.headers['x-speedis-cache'] = 'TCP_PV_MISS from ' + os.hostname()
      } else {
        outResponse.headers['x-speedis-cache'] = 'TCP_MISS from ' + os.hostname()
      };
      break
  };
};
