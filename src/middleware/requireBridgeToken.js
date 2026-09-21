/** Guards a webhook route with a shared secret embedded in the URL path itself (the route
 *  must declare a `:token` param). */
function requireBridgeToken(expectedToken) {
  return (req, res, next) => {
    if (req.params.token !== expectedToken) {
      return res.sendStatus(403);
    }
    next();
  };
}

module.exports = { requireBridgeToken };
