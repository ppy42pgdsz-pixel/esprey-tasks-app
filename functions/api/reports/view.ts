/**
 * GET /api/reports/view?file=<name>&company=<id>
 * Renders the outstanding report to PDF and returns it INLINE (for the in-app
 * PDF.js viewer to fetch and render). Same bytes as /download — only the
 * Content-Disposition differs.
 */

import { meFromCtx } from '../_lib';
import { buildReport, buildReportPdf, reportScope } from './_shared';

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const me = await meFromCtx(ctx.env.DB, ctx);
  const url = new URL(ctx.request.url);
  const companyId = url.searchParams.get('company') || null;
  const file = (url.searchParams.get('file') || 'outstanding.pdf').replace(/"/g, '');

  const scope = await reportScope(ctx.env.DB, companyId);
  const projects = await buildReport(ctx.env.DB, me, companyId);
  const bytes = await buildReportPdf(projects, scope, Date.now());
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
};
