/**
* We convert all header names to lowercase to simplify comparisons.
* According to the standard:
* Each header field consists of a name followed by a colon (":") and the field value.
* Field names are case-insensitive.
*/
export default function (target, params) {
  let aux
  for (const header in target.headers) {
    aux = target.headers[header]
    delete target.headers[header]
    target.headers[header.toLowerCase()] = aux
  };
};
