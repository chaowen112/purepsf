export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-white px-4 py-3 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-800">purePSF</h1>
        <p className="text-xs text-slate-500">
          Independent project · Data sourced from URA &amp; HDB under the{" "}
          <a
            className="underline"
            href="https://www.ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence"
            target="_blank"
            rel="noreferrer"
          >
            Singapore Open Data Licence
          </a>
        </p>
      </header>
      <main className="flex-1 grid place-items-center text-slate-400">
        map placeholder — M3 will fill this with MapLibre
      </main>
    </div>
  );
}
