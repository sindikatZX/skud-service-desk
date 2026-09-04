export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <div className="text-5xl">📡</div>
        <h1 className="mt-4 text-xl font-bold">Нет подключения к сети</h1>
        <p className="mt-2 text-sm text-slate-600">Ранее открытые экраны доступны из кэша. Повторите попытку, когда появится связь.</p>
        <a href="/" className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Повторить</a>
      </div>
    </main>
  );
}
