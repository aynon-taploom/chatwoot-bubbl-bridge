/**
 * A body that isn't valid JSON (or isn't a top-level object/array - express.json's strict
 * mode) throws before any route handler runs. Handle it here with a one-line log and a plain
 * 400, instead of letting Express's default error handler print a full stack trace for what's
 * just bad input.
 */
function handleJsonParseErrors(err, req, res, next) {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    console.error(`[${req.path}] rejecting request with invalid JSON body:`, err.message);
    return res.sendStatus(400);
  }
  next(err);
}

module.exports = { handleJsonParseErrors };
