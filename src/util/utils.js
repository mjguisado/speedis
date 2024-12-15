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
/*
https://www.rfc-editor.org/rfc/rfc9110#name-syntax-notation

https://www.rfc-editor.org/rfc/rfc9111#name-cache-control
https://www.rfc-editor.org/rfc/rfc9110#name-lists-rule-abnf-extension
Cache-Control   = #cache-directive
https://www.rfc-editor.org/rfc/rfc9110#whitespace
OWS             = *( SP / HTAB )
cache-directive = token [ "=" ( token / quoted-string ) ]
https://www.rfc-editor.org/rfc/rfc9110#name-tokens
token = 1*tchar
tchar           = "!" / "#" / "$" / "%" / "&" / "'" / "*"
                / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
                / DIGIT / ALPHA
                ; any VCHAR, except delimiter
https://www.rfc-editor.org/rfc/rfc9110#name-quoted-strings
quoted-string   = DQUOTE *( qdtext / quoted-pair ) DQUOTE
qdtext          = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
quoted-pair     = "\" ( HTAB / SP / VCHAR / obs-text )
https://www.rfc-editor.org/rfc/rfc5234#appendix-B.1
ALPHA           =  %x41-5A / %x61-7A
DIGIT           =  %x30-39
VCHAR           =  %x21-7E
DQUOTE          =  %x22
HTAB            =  %x09
SP              =  %x20
https://www.rfc-editor.org/rfc/rfc9110#name-field-values
obs-text        = %x80-FF

token = [!#$%&'*+`~\-\.\^\|\w]+
tchar = [!#$%&'*+\-\.\^`\|~\w]
quoted-string  = \x22(?:[\x09\x20\x21\x23-\x5B\x5D-\x7E\x80-\xFF]|\\[\x09\x20\x21-\x7E\x80-\xFF])*\x22
qdtext = [\x09\x20\x21\x23-\x5B\x5D-\x7E\x80-\xFF]
quoted-pair = \\[\x09\x20\x21-\x7E\x80-\xFF]
*/

// RegExp Named Capture Groups 
const cacheDirectiveRE = /(?<key>[!#$%&'*+`~\-\.\^\|\w]+)(?:=(?<value>[!#$%&'*+`~\-\.\^\|\w]+|\x22(?:[\x09\x20\x21\x23-\x5B\x5D-\x7E\x80-\xFF]|\\[\x09\x20\x21-\x7E\x80-\xFF])*\x22))?/g
// response.headers['cache-control']='public,max-age=60,nocache="cabecera1,cabecera2",s-maxage=300,private="cabecera3,cabecera4",must-revalidate'
export function parseCacheControlHeader(response) {
  let cacheDirectives = {}
  if (!response.headers) return cacheDirectives
  if (!Object.prototype.hasOwnProperty.call(response.headers, 'cache-control')) return cacheDirectives
  const matches = response.headers['cache-control'].matchAll(cacheDirectiveRE)
  if (matches === null) return cacheDirectives
  for (const match of matches) {
    cacheDirectives[match.groups.key] =
      (undefined !== match.groups.value) ? match.groups.value : null
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
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-expires
    const expires = Date.parse(response.headers.expires)
    const date = Date.parse(response.headers.date)
    if (!(Number.isNaN(expires) || Number.isNaN(date))) {
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

// See: https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-header-and-trailer-
export function cleanUpHeader(entry, cacheDirectives) {

  let headersToRemove = []

  /*
   * https://www.rfc-editor.org/rfc/rfc9110#name-connection
   * Connection        = #connection-option
   * connection-option = token
   * https://www.rfc-editor.org/rfc/rfc9110#name-tokens
   * token = 1*tchar
   * tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*"
   *         / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
   *         / DIGIT / ALPHA
   *         ; any VCHAR, except delimiter
  */
  const tokenRE = /[!#$%&'*+`~\-\.\^\|\w]+/g
  if (Object.prototype.hasOwnProperty.call(entry.headers, 'connection')) {
    headersToRemove.push('connection')
    const tokens = entry.headers['connection'].match(tokenRE)
    if (tokens !== null) { headersToRemove = headersToRemove.concat(tokens) }
  }

  headersToRemove.push('proxy-connection')
  headersToRemove.push('keep-alive')
  headersToRemove.push('te')
  headersToRemove.push('transfer-encoding')
  headersToRemove.push('ppgrade')

  // The qualified form of the no-cache response directive
  if (Object.prototype.hasOwnProperty.call(cacheDirectives, 'no-cache')
    && cacheDirectives['no-cache'] !== null) {
    let aux = cacheDirectives['no-cache']
    if (aux.startsWith('"') && aux.endsWith('"')) aux = aux.slice(1, -1).replace(/ /g, '')
    headersToRemove = headersToRemove.concat(aux.split(','))
  }

  // The qualified form of the private response directive
  if (Object.prototype.hasOwnProperty.call(cacheDirectives, 'private')
    && cacheDirectives['private'] !== null) {
    let aux = cacheDirectives['private']
    if (aux.startsWith('"') && aux.endsWith('"')) aux = aux.slice(1, -1).replace(/ /g, '')
    headersToRemove = headersToRemove.concat(aux.split(','))
  }

  headersToRemove.push('proxy-authenticate')
  headersToRemove.push('proxy-authentication-info')
  headersToRemove.push('proxy-authorization')

  headersToRemove.forEach(headerToRemove => {
    delete entry.headers[headerToRemove]
  })

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
