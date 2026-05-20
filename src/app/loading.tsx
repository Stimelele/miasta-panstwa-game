export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f1] px-6 text-[#19211d]">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-[#d4d8c8] border-t-[#d55138]" />
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#4d6759]">
            INTBA ID
          </p>
          <h1 className="mt-2 text-2xl font-black">Ladowanie gry</h1>
        </div>
      </div>
    </main>
  );
}
