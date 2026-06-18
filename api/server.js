// Placeholder — overwritten by esbuild during the Vercel build step.
// See vercel.json buildCommand: npx esbuild server.ts ... --outfile=api/server.js
export default function handler(req, res) {
  res.status(503).end("Build not yet complete");
}
