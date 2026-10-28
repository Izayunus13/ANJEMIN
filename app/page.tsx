import Script from 'next/script';

export default function Page() {
  return (
    <>
      <div id="app">
        <div className="center-loader">
          <span className="spinner" /> Menyiapkan ANJEMIN...
        </div>
      </div>
      <div id="toast-area" aria-live="polite" />
      <div id="modal-root" />
      <Script id="anjemin-app" src="/legacy/app.js" type="module" strategy="afterInteractive" />
    </>
  );
}
