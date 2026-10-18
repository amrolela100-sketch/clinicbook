import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="not-found">
      <span>404</span>
      <h1>يبدو أنك اتجهت إلى صفحة غير موجودة</h1>
      <p>لنعد إلى مكان تبدأ منه رعايتك.</p>
      <Link className="btn btn-primary" href="/">
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
