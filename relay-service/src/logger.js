/**
 * logger.js
 * Timestamp-prefixed console wrapper. Railway captures stdout/stderr, so no
 * logging dependency is needed.
 */

function stamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => console.log(`[${stamp()}] INFO`, ...args),
  warn: (...args) => console.warn(`[${stamp()}] WARN`, ...args),
  error: (...args) => console.error(`[${stamp()}] ERROR`, ...args)
};
