/**
 * middleware/auth.js
 */

function requireRelaySecret(config) {
  return function (req, res, next) {
    const provided = req.get('X-Relay-Secret');
    if (!provided || provided !== config.relaySharedSecret) {
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'AUTH_FAILED', permanent: false });
    }
    next();
  };
}

module.exports = { requireRelaySecret };
