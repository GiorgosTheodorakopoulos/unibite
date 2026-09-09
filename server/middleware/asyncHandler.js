// Express 4 does not forward rejected promises from async handlers to next(err) —
// without this, any thrown/rejected error inside a route crashes the whole process.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
