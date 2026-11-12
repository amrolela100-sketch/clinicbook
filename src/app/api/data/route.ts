import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { fetchAppData } from '@/lib/services/app-data-service';

export const dynamic = 'force-dynamic';

function dataResponse(data: unknown, request?: Request) {
  const body = JSON.stringify({ success: true, data });
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ETag: etag,
    Vary: 'Cookie',
  };
  // Authorization and scope filtering have already run for this request. Never
  // cache a tenant snapshot on the server or compare before resolving identity.
  const validators = request?.headers
    .get('if-none-match')
    ?.split(',')
    .map((value) => value.trim());
  return new NextResponse(validators?.includes(etag) ? null : body, {
    status: validators?.includes(etag) ? 304 : 200,
    headers,
  });
}

export async function GET(request: Request) {
  try {
    return dataResponse(await fetchAppData(), request);
  } catch {
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل بيانات العيادة.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
