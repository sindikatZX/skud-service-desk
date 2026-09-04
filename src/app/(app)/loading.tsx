export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Загрузка" className="animate-pulse">
      <div className="mb-4 flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded-lg bg-slate-200" />
          <div className="h-3 w-56 rounded bg-slate-200" />
        </div>
        <div className="hidden h-9 w-32 rounded-xl bg-slate-200 lg:block" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex justify-between"><div className="h-3 w-20 rounded bg-slate-200" /><div className="h-4 w-16 rounded-full bg-slate-200" /></div>
            <div className="mt-3 h-4 w-3/4 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
