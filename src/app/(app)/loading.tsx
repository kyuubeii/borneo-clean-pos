/**
 * Shown the instant a nav link is clicked.
 *
 * Every page in this group is server-rendered on demand, so a sidebar click has
 * to wait for a round trip before anything can change. Without a boundary here
 * the browser simply sat on the old page for the duration and the app felt
 * stuck. Next swaps this in synchronously instead, so the click registers at
 * once and the real page replaces it when it arrives.
 *
 * The sidebar and header live in the layout and stay put; this only stands in
 * for <main>.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded-lg bg-ink-100" />
          <div className="h-3 w-24 rounded bg-ink-100/70" />
        </div>
        <div className="h-8 w-28 rounded-lg bg-ink-100" />
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card card-pad space-y-2.5">
            <div className="h-3 w-20 rounded bg-ink-100/70" />
            <div className="h-6 w-24 rounded-lg bg-ink-100" />
            <div className="h-2.5 w-28 rounded bg-ink-100/60" />
          </div>
        ))}
      </div>

      {/* Table / list */}
      <div className="card">
        <div className="border-b border-ink-100 px-4 py-3">
          <div className="h-3.5 w-28 rounded bg-ink-100/70" />
        </div>
        <div className="divide-y divide-ink-50">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-3 w-14 shrink-0 rounded bg-ink-100/70" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 rounded bg-ink-100" style={{ width: `${55 - i * 5}%` }} />
                <div className="h-2.5 w-1/3 rounded bg-ink-100/60" />
              </div>
              <div className="h-5 w-16 shrink-0 rounded-full bg-ink-100/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
