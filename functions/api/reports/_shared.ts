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

// ─── Urgency bucketing — "what needs you now" ───
const DAY = 24 * 60 * 60 * 1000;
const utcMidnight = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

export interface FlatTask {
  project: string;
  company: string | null;
  text: string;
  due: number | null;
  assignees: string | null;
  awaitingSignoff: boolean;
}
export interface ReportBuckets {
  awaiting: FlatTask[];   // assignee marked done, needs the owner to sign off
  overdue: FlatTask[];    // past its due date, not yet done
  dueSoon: FlatTask[];    // due within the next 7 days
  totalTasks: number;
  totalProjects: number;
}

/** Flatten projects→tasks and split into priority buckets (mutually exclusive). */
export function bucketReport(projects: ReportProject[], now: number): ReportBuckets {
  const today = utcMidnight(now);
  const weekEnd = today + 7 * DAY;
  const awaiting: FlatTask[] = [];
  const overdue: FlatTask[] = [];
  const dueSoon: FlatTask[] = [];
  let totalTasks = 0;

  for (const p of projects) {
    for (const t of p.tasks) {
      totalTasks++;
      const ft: FlatTask = {
        project: p.title, company: p.company_name, text: t.text, due: t.due_date,
        assignees: t.assignee_names, awaitingSignoff: t.status === 'done' && !t.accepted_at,
      };
      if (ft.awaitingSignoff) awaiting.push(ft);
      else if (t.due_date != null && t.due_date < today) overdue.push(ft);
      else if (t.due_date != null && t.due_date <= weekEnd) dueSoon.push(ft);
    }
  }
  const byDue = (a: FlatTask, b: FlatTask) => (a.due ?? Infinity) - (b.due ?? Infinity);
  overdue.sort(byDue); dueSoon.sort(byDue);
  return { awaiting, overdue, dueSoon, totalTasks, totalProjects: projects.length };
}

/** Base64-encode bytes in chunks (btoa chokes on very large strings). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
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

/** Truncate to fit a pixel width, adding an ellipsis. */
function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Render the outstanding report as a printable LANDSCAPE checklist — built to be
 * printed and ticked off by hand. Minimal detail: a checkbox + task, a light
 * "who · due" on the right, grouped by company, with ruled note lines per
 * project. Deliberately leaves the full record to the app.
 */
export async function buildReportPdf(projects: ReportProject[], scopeLabel: string, generatedAt: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 landscape.
  const PW = 841.89, PH = 595.28, M = 42;
  const ink = rgb(0.11, 0.1, 0.09);
  const grey = rgb(0.45, 0.43, 0.41);
  const faint = rgb(0.66, 0.64, 0.62);
  const rule = rgb(0.86, 0.85, 0.83);
  const red = rgb(0.70, 0.12, 0.10);
  const amber = rgb(0.62, 0.40, 0.02);
  const leftX = M;
  const rightX = PW - M;

  const BOX = 11;          // checkbox size
  const GAP = 9;           // gap after checkbox
  const META_W = 170;      // right column reserved for "who · due"
  const taskX = leftX + BOX + GAP;
  const taskW = rightX - META_W - 12 - taskX;

  let page: PDFPage = pdf.addPage([PW, PH]);
  let y = PH - M;
  const newPage = () => { page = pdf.addPage([PW, PH]); y = PH - M; };
  const need = (h: number) => { if (y - h < M) newPage(); };

  // Header.
  const prio = bucketReport(projects, generatedAt);
  page.drawText('Outstanding tasks', { x: leftX, y: y - 18, size: 18, font: bold, color: ink });
  y -= 22;
  page.drawText(`${scopeLabel}    ·    ${fmtDate(generatedAt)}    ·    ${projects.length} project${projects.length === 1 ? '' : 's'},  ${prio.totalTasks} open    ·    ${prio.overdue.length} overdue    ·    ${prio.dueSoon.length} due this week`,
    { x: leftX, y: y - 9, size: 9, font, color: grey });
  y -= 22;

  if (projects.length === 0) {
    page.drawText('Nothing outstanding — all clear.', { x: leftX, y: y - 11, size: 11, font, color: grey });
    return pdf.save();
  }

  // ─── "Needs you now" — priority items pulled to the top ───
  const metaXEnd = rightX - META_W - 12;
  const prioLineW = metaXEnd - taskX;
  const renderPrio = (label: string, items: typeof prio.overdue, labelColor: typeof red) => {
    if (!items.length) return;
    need(20);
    page.drawText(`${label} (${items.length})`, { x: taskX, y: y - 9, size: 9, font: bold, color: labelColor });
    y -= 14;
    for (const ft of items) {
      need(16);
      page.drawRectangle({ x: leftX, y: y - BOX, width: BOX, height: BOX, borderColor: grey, borderWidth: 1, color: rgb(1, 1, 1) });
      const meta = [ft.assignees || 'Unassigned', ft.due ? `due ${fmtDate(ft.due)}` : null].filter(Boolean).join('   ·   ');
      const metaText = truncateToWidth(meta, font, 9, META_W);
      page.drawText(metaText, { x: rightX - font.widthOfTextAtSize(metaText, 9), y: y - 10, size: 9, font, color: grey });
      const main = truncateToWidth(`${ft.text}   —   ${ft.project}`, font, 10.5, prioLineW);
      page.drawText(main, { x: taskX, y: y - 10.5, size: 10.5, font, color: ink });
      y -= 16;
    }
    y -= 6;
  };
  if (prio.overdue.length || prio.dueSoon.length || prio.awaiting.length) {
    page.drawText('NEEDS YOU NOW', { x: leftX, y: y - 10, size: 10, font: bold, color: ink });
    y -= 14;
    page.drawLine({ start: { x: leftX, y }, end: { x: rightX, y }, thickness: 1, color: rule });
    y -= 16;
    renderPrio('Overdue', prio.overdue, red);
    renderPrio('Due this week', prio.dueSoon, amber);
    renderPrio('Awaiting your sign-off', prio.awaiting, grey);
    y -= 4;
    page.drawText('ALL OUTSTANDING — print & tick', { x: leftX, y: y - 10, size: 10, font: bold, color: grey });
    y -= 16;
  }

  // Group projects by company, preserving order.
  const groups = new Map<string, ReportProject[]>();
  for (const p of projects) {
    const key = p.company_name || 'No company';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }

  for (const [company, ps] of groups) {
    need(30);
    y -= 4;
    page.drawText(company.toUpperCase(), { x: leftX, y: y - 10, size: 10, font: bold, color: grey });
    y -= 14;
    page.drawLine({ start: { x: leftX, y }, end: { x: rightX, y }, thickness: 1, color: rule });
    y -= 16;

    for (const p of ps) {
      need(38);
      page.drawText(truncateToWidth(p.title, bold, 13, taskW + BOX + GAP), { x: leftX, y: y - 12, size: 13, font: bold, color: ink });
      if (p.due_date) {
        const due = `due ${fmtDate(p.due_date)}`;
        page.drawText(due, { x: rightX - font.widthOfTextAtSize(due, 9), y: y - 11, size: 9, font, color: grey });
      }
      y -= 22;

      if (p.tasks.length === 0) {
        page.drawText('— no open tasks —', { x: taskX, y: y - 9, size: 9, font, color: faint });
        y -= 16;
      } else {
        for (const t of p.tasks) {
          const lines = wrapText(t.text, font, 10.5, taskW);
          need(lines.length * 15 + 4);
          // Checkbox aligned to the first line.
          page.drawRectangle({ x: leftX, y: y - BOX, width: BOX, height: BOX, borderColor: grey, borderWidth: 1, color: rgb(1, 1, 1) });
          // "who · due" right-aligned on the first line.
          const meta = [t.assignee_names || 'Unassigned', t.due_date ? `due ${fmtDate(t.due_date)}` : null].filter(Boolean).join('   ·   ');
          const metaText = truncateToWidth(meta, font, 9, META_W);
          page.drawText(metaText, { x: rightX - font.widthOfTextAtSize(metaText, 9), y: y - 10, size: 9, font, color: grey });
          // Task text (wrapped).
          for (const ln of lines) {
            page.drawText(ln, { x: taskX, y: y - 10.5, size: 10.5, font, color: ink });
            y -= 15;
          }
          y -= 3;
        }
      }

      // Two ruled note lines per project.
      need(34);
      y -= 4;
      page.drawText('Notes', { x: leftX, y: y - 7, size: 7, font, color: faint });
      y -= 13;
      for (let i = 0; i < 2; i++) {
        page.drawLine({ start: { x: leftX, y }, end: { x: rightX, y }, thickness: 0.5, color: rule });
        y -= 16;
      }
      y -= 10;
    }
    y -= 6;
  }

  return pdf.save();
}
