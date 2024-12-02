import { calculateFreshnessLifetime } from '../util/utils.js'

export default function (target, params) {

  let _defaultSpeedisCache = params['default-speedis-cache']
  /*
   * Sometimes, to avoid a large set of entries expiring simultaneously,
   * an interval is defined within which a TTL is randomly selected for each entry.
   * This helps prevent the simultaneous refresh of cache entries from causing
   * overload on the origin.
   */
  _defaultSpeedisCache = Array.isArray(_defaultSpeedisCache)
    ? getTTLValueFromInterval(_defaultSpeedisCache)
    : _defaultSpeedisCache

  // In case of an error or a redirection, the default TTL is not applied.
  if (target.statusCode === 404 ||
    target.statusCode === 302 ||
    target.statusCode === 301 ||
    target.statusCode === 410) {
    _defaultSpeedisCache = null
  }

  /*
   * First, it checks if a specific TTL has been set for a particular entry
   * using a proprietary Speedis header.
   * If not, but a default value has been configured, that value is used.
   * The case of Infinity is handled in accordance with the idiosyncrasy of the value.
   * Finally, the standard Cache-Control header is used to calculate the TTL for the entry.
   */
  if (Object.prototype.hasOwnProperty.call(target.headers, 'x-speedis-cache-control') &&
    parseInt(target.headers['x-speedis-cache-control']) > 0) {
    target.ttl = parseInt(target.headers['x-speedis-cache-control'])
  } else if (_defaultSpeedisCache === Infinity) {
    target.ttl = params['default-speedis-cache']
  } else if (_defaultSpeedisCache) {
    target.ttl = _defaultSpeedisCache
  } else if (Object.prototype.hasOwnProperty.call(target.headers, 'cache-control')) {
    target.ttl = calculateFreshnessLifetime(target)
  };

  /*
   * Function that selects a TTL within a given interval.
   */
  function getTTLValueFromInterval(interval) {
    const min = interval[0]
    const max = interval[1]
    return Math.floor(Math.random() * (max - min + 1) + min)
  }

};
