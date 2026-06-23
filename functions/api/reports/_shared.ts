/**
 * Shared report logic: query the outstanding (active) projects + open tasks a
 * user owns, and render that data to PDF bytes with pdf-lib (works in the
 * Cloudflare Functions runtime). Used by /api/report (email + data) and
 * /api/reports/view + /api/reports/download (same bytes, different disposition).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface ProjectRow {
  id: string;
  title: string;
  company_name: string | null;
  company_id: string | null;
  created_at: number;
  due_date: number | null;
}
export interface TaskRow {
  text: string;
  status: string;
  due_date: number | null;
  accepted_at: number | null;
  assignee_names: string | null;
}
export interface ReportProject extends ProjectRow { tasks: TaskRow[] }

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Outstanding projects the user owns (active, not completed) + their open tasks. */
export async function buildReport(db: D1Database, me: string, companyId: string | null): Promise<ReportProject[]> {
  const params: unknown[] = [me];
  let where = `owner_email = ? AND status != 'done' AND completed_at IS NULL`;
  if (companyId) { where += ' AND company_id = ?'; params.push(companyId); }

  const { results: projects } = await db
    .prepare(`SELECT id, title, company_name, company_id, created_at, due_date FROM tasks WHERE ${where} ORDER BY company_name IS NULL, company_name, created_at DESC`)
    .bind(...params)
    .all<ProjectRow>();

  const out: ReportProject[] = [];
  for (const p of projects) {
    const { results: tasks } = await db.prepare(
      `SELECT s.text, s.status, s.due_date, s.accepted_at,
              (SELECT GROUP_CONCAT(DISTINCT u.name) FROM subtask_assignees sa JOIN users u ON u.email = sa.user_email WHERE sa.subtask_id = s.id) AS assignee_names
       FROM subtasks s WHERE s.task_id = ? AND s.accepted_at IS NULL
       ORDER BY s.position ASC, s.created_at ASC`,
    ).bind(p.id).all<TaskRow>();
    out.push({ ...p, tasks });
  }
  return out;
}

/** Resolve the human label for the report scope (company name or "All companies"). */
export async function reportScope(db: D1Database, companyId: string | null): Promise<string> {
  if (!companyId) return 'All companies';
  const c = await db.prepare('SELECT name FROM companies WHERE id = ?').bind(companyId).first<{ name: string }>();
  return c?.name ?? 'Selected company';
}

/** Greedy word-wrap (with hard-break for over-long words) for a max pixel width. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) { line = test; continue; }
    if (line) { lines.push(line); line = ''; }
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch;
        else { if (chunk) lines.push(chunk); chunk = ch; }
      }
      line = chunk;
    } else line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Render the outstanding report to PDF bytes (A4, paginated). */
export async function buildReportPdf(projects: ReportProject[], scopeLabel: string, generatedAt: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PW = 595.28, PH = 841.89, M = 48;
  const ink = rgb(0.11, 0.1, 0.09);
  const grey = rgb(0.47, 0.45, 0.43);
  const contentW = PW - 2 * M;

  let page: PDFPage = pdf.addPage([PW, PH]);
  let y = PH - M;
  const newPage = () => { page = pdf.addPage([PW, PH]); y = PH - M; };
  const space = (h: number) => { if (y - h < M) newPage(); };

  const draw = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 10;
    const color = opts.color ?? ink;
    const indent = opts.indent ?? 0;
    const gap = opts.gap ?? 3;
    for (const ln of wrapText(text, f, size, contentW - indent)) {
      space(size + gap);
      page.drawText(ln, { x: M + indent, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  draw('Outstanding projects & tasks', { font: bold, size: 18, gap: 4 });
  const totalTasks = projects.reduce((n, p) => n + p.tasks.length, 0);
  draw(`${scopeLabel}  ·  ${fmtDate(generatedAt)}  ·  ${projects.length} project${projects.length === 1 ? '' : 's'}, ${totalTasks} open task${totalTasks === 1 ? '' : 's'}`, { size: 10, color: grey, gap: 8 });
  y -= 6;

  if (projects.length === 0) {
    draw('Nothing outstanding — all clear.', { size: 11, color: grey });
  } else {
    for (const p of projects) {
      space(46);
      y -= 6;
      draw(p.title, { font: bold, size: 13, gap: 3 });
      const meta = [p.company_name, p.due_date ? `due ${fmtDate(p.due_date)}` : null, `added ${fmtDate(p.created_at)}`].filter(Boolean).join('   ·   ');
      if (meta) draw(meta, { size: 9, color: grey, gap: 5 });
      if (p.tasks.length === 0) {
        draw('No open tasks', { size: 10, color: grey, indent: 12, gap: 3 });
      } else {
        for (const t of p.tasks) {
          draw(`•  ${t.text}`, { size: 10, indent: 8, gap: 2 });
          const bits = [t.assignee_names || 'Unassigned', t.due_date ? `due ${fmtDate(t.due_date)}` : null, t.status === 'done' ? 'awaiting sign-off' : null].filter(Boolean).join('  ·  ');
          draw(bits, { size: 8.5, color: grey, indent: 22, gap: 4 });
        }
      }
    }
  }

  return pdf.save();
}
