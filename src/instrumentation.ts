/** Runs once when a server instance starts, before it handles a request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./lib/clock")).useBusinessClock();
}
