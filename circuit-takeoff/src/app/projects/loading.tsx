export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-perry-white">
      <div className="h-14 bg-perry-industrial" />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8 h-8 w-40 animate-pulse rounded bg-perry-silver/40" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-perry-silver bg-white"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
