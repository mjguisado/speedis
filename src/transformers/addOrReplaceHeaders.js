export default function (target, params) {
  for (const header in params) {
    target.headers[header.toLowerCase()] = params[header]
  }
}
