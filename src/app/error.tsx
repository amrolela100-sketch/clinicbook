'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, Home, AlertCircle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled Application Error:', error);
  }, [error]);

  return (
    <main className="not-found" dir="rtl" role="alert">
      <div
        style={{
          display: 'inline-flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: '1rem',
          color: 'var(--danger, #c25443)',
        }}
      >
        <AlertCircle size={64} strokeWidth={1.5} />
      </div>
      <h1>حدث خطأ غير متوقع</h1>
      <p>نعتذر عن هذا الخطأ المؤقت. تم تسجيل المشكلة وسنعمل على حلها بأسرع وقت.</p>
      <div
        style={{
          display: 'flex',
          gap: '12px',
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginTop: '1.5rem',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => reset()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <RotateCw size={16} />
          إعادة المحاولة
        </button>
        <Link
          className="btn btn-outline"
          href="/"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Home size={16} />
          العودة للرئيسية
        </Link>
      </div>
    </main>
  );
}
