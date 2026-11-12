// Scope streaming fallbacks to the workspace; public HTML must remain useful
// even before framework scripts reveal suspended fragments.
export default function Loading() {
  return (
    <main className="loading-screen" role="status" aria-live="polite">
      جارٍ تحميل الصفحة…
    </main>
  );
}
