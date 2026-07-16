export default function ProjectLoading() {
  return (
    <div className="min-h-screen bg-perry-white">
      <div className="h-14 bg-perry-industrial" />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="h-4 w-24 animate-pulse rounded bg-perry-silver/40" />
        <div className="mt-3 h-8 w-56 animate-pulse rounded bg-perry-silver/40" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg border border-perry-silver bg-white"
              />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-lg border border-perry-silver bg-white" />
        </div>
      </main>
    </div>
  );
}
