// Vercel entry point. Vercel treats every file under /api as its own
// serverless function; this one just hands the whole Express app to it.
// vercel.json rewrites every request to this function, so the app's own
// /api/* routes still work exactly as they do locally.
module.exports = require('../server');
