/** @type {import('next').NextConfig} */

// `next build` writes to a separate directory so a production build can never
// clobber the chunks a running `next dev` is serving. Without this, building
// while the dev server is up leaves it throwing "Cannot find module './NNN.js'"
// until it is restarted.
//
// That collision only happens on a developer machine. On Vercel the build is
// the only thing running and the platform looks for its output in the default
// `.next`, so the override is ignored there.
const distDir = process.env.VERCEL ? ".next" : process.env.NEXT_DIST_DIR || ".next";

export default {
  distDir,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
