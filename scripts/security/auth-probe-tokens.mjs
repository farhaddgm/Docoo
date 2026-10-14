/** Change a data character in an opaque session token, retaining its length and alphabet. */
export function tamperSessionToken(token) {
  return `${token.slice(0, -2)}${token.at(-2) === 'A' ? 'B' : 'A'}${token.slice(-1)}`;
}
