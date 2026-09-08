// Express 4 doesn't forward a rejected promise from an async handler to error middleware on
// its own — wrap every async route/middleware in this so a thrown/rejected error becomes a
// clean 500 instead of a hung request.
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
