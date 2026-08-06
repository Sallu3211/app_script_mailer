/**
 * routes/health.js
 * GET /health -- used by Railway's healthcheck.
 */

function buildHealthRoute() {
  const startedAt = Date.now();
  return function (req, res) {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
    });
  };
}

module.exports = { buildHealthRoute };
