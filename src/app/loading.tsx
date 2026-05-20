/* eslint-disable @next/next/no-img-element */

export default function Loading() {
  return (
    <main className="intba-game-shell">
      <div className="intro-loader" aria-hidden="true">
        <div className="intro-loader-card">
          <img src="/intba-logo.svg" alt="" />
          <span>INTBA</span>
        </div>
      </div>
    </main>
  );
}
