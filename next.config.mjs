/** @type {import('next').NextConfig} */
export default {
  // `next build` writes to a separate directory so a production build can never
  // clobber the chunks a running `next dev` is serving. Without this, building
  // while the dev server is up leaves it throwing "Cannot find module './NNN.js'"
  // until it is restarted.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
