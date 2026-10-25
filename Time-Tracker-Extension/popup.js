
const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "timeTrackerData";

let data = {
  logs: [],
  active: null
};

let renderInterval = null;
let messageTimeout = null;

const now = () => Date.now();

function localDateKey(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return localDateKey(now());
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return [h, m, s]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function formatClock(timestamp) {
  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function elapsedMs(session, at = now()) {
  const accumulated = session.accumulatedMs || 0;

  if (session.state === "running" && session.resumedAt) {
    return accumulated + Math.max(0, at - session.resumedAt);
  }

  return accumulated;
}

function completedDuration(log) {
  if (typeof log.durationMs === "number") {
    return Math.max(0, log.durationMs);
  }

  return Math.max(0, (log.endAt || now()) - log.startAt);
}

async function save() {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

async function load() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY];

  if (saved && Array.isArray(saved.logs)) {
    data = {
      logs: saved.logs,
      active: saved.active || null
    };
  }

  // Recover safely if the popup or browser was closed.
  if (data.active?.state === "running" && !data.active.resumedAt) {
    data.active.resumedAt = now();
    await save();
  }
}

function todayLogs() {
  return data.logs
    .filter((log) => localDateKey(log.startAt) === todayKey())
    .sort((a, b) => b.startAt - a.startAt);
}

function todayTotal() {
  const completed = todayLogs().reduce(
    (sum, log) => sum + completedDuration(log),
    0
  );

  const active = data.active &&
    localDateKey(data.active.startAt) === todayKey()
      ? elapsedMs(data.active)
      : 0;

  return completed + active;
}

// Custom confirmation dialog (replaces window.confirm).
function confirmDialog({ title, text, confirmLabel = "Delete" }) {
  return new Promise((resolve) => {
    const modal = $("modal");
    const confirmBtn = $("modalConfirm");
    const cancelBtn = $("modalCancel");

    $("modalTitle").textContent = title;
    $("modalText").textContent = text;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.title = confirmLabel;
    modal.hidden = false;
    cancelBtn.focus();

    const close = (result) => {
      modal.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => { if (e.target === modal) close(false); };
    const onKey = (e) => { if (e.key === "Escape") close(false); };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

// Toast notification: one small, auto-dismissing notice that is always
// visible (fixed to the popup viewport) no matter which section triggered it.
function showMessage(message, isError = false) {
  const toast = $("toast");

  $("toastText").textContent = message;
  $("toastIcon").textContent = isError ? "!" : "✓";
  toast.dataset.type = isError ? "error" : "success";

  // Restart the animation if a toast is already visible.
  toast.hidden = false;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");

  clearTimeout(messageTimeout);
  messageTimeout = setTimeout(hideToast, isError ? 3800 : 2400);
}

function hideToast() {
  const toast = $("toast");
  toast.classList.remove("show");
  toast.hidden = true;
}

function formatShort(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

const STATUS_ORDER = ["In Progress", "Completed", "On Hold", "Not Started"];

function renderSplit() {
  const totals = {};

  todayLogs().forEach((log) => {
    totals[log.status] = (totals[log.status] || 0) + completedDuration(log);
  });

  if (data.active && localDateKey(data.active.startAt) === todayKey()) {
    totals[data.active.status] =
      (totals[data.active.status] || 0) + elapsedMs(data.active);
  }

  const entries = STATUS_ORDER
    .filter((status) => totals[status] > 0)
    .map((status) => [status, totals[status]]);
  const sum = entries.reduce((n, [, ms]) => n + ms, 0);

  if (sum === 0) {
    $("splitBar").innerHTML = "";
    $("splitLegend").innerHTML =
      '<span class="legend-empty">Nothing tracked yet today</span>';
    return;
  }

  $("splitBar").innerHTML = entries.map(([status, ms]) =>
    `<span data-status="${escapeHtml(status)}" style="width:${(ms / sum) * 100}%"></span>`
  ).join("");

  $("splitLegend").innerHTML = entries.map(([status, ms]) =>
    `<span class="legend-item" data-status="${escapeHtml(status)}">
      <i></i>${escapeHtml(status)} <b>${formatShort(ms)}</b>
    </span>`
  ).join("");
}

function renderActive() {
  const active = data.active;
  const container = $("activeTask");
  const controls = $("timerControls");
  const badge = $("stateBadge");

  if (!active) {
    delete container.dataset.status;
    container.classList.remove("has-task");
    container.innerHTML = `
      <span class="empty-icon">◷</span>
      <p>No active task</p>
      <span class="muted small">Start a task to begin tracking.</span>
    `;

    controls.hidden = true;
    $("startBtn").disabled = false;
    badge.dataset.state = "idle";
    badge.querySelector("b").textContent = "Idle";
    return;
  }

  const paused = active.state === "paused";
  const duration = elapsedMs(active);

  container.dataset.status = active.status;
  container.classList.add("has-task");
  container.innerHTML = `
    <span class="live-state ${paused ? "is-paused" : ""}">
      <i></i>${paused ? "Paused" : "Tracking now"}
    </span>
    <p class="active-title">${escapeHtml(active.title)}</p>
    <div class="timer">${formatTime(duration)}</div>
    <div class="active-meta">
      <span class="chip">${escapeHtml(active.category)}</span>
      <span class="chip">Started ${formatClock(active.startAt)}</span>
      <span class="status" data-status="${escapeHtml(active.status)}">${escapeHtml(active.status)}</span>
    </div>
  `;

  controls.hidden = false;
  $("pauseBtn").textContent = paused ? "▶ Resume" : "❚❚ Pause";
  $("startBtn").disabled = true;
  badge.dataset.state = paused ? "paused" : "running";
  badge.querySelector("b").textContent = paused ? "Paused" : "Tracking";
}

let lastLogsSignature = "";

function renderLogs() {
  const logs = todayLogs();
  const list = $("logsList");

  // The popup re-renders every second for the live timer. Only rebuild
  // the log list when it actually changed so hover/shadow effects and
  // button clicks are never interrupted.
  const signature = JSON.stringify(logs);
  if (signature === lastLogsSignature) return;
  lastLogsSignature = signature;

  if (logs.length === 0) {
    list.innerHTML = `
      <div class="empty-logs">
        No sessions recorded today.<br>
        Start your first task above.
      </div>
    `;
    return;
  }

  list.innerHTML = logs.map((log) => `
    <article class="log" data-status="${escapeHtml(log.status)}">
      <div class="log-top">
        <span class="log-title">${escapeHtml(log.title)}</span>
        <span class="log-duration">${formatTime(completedDuration(log))}</span>
      </div>

      <div class="log-meta">
        <span class="chip">${escapeHtml(log.category)}</span>
        <span class="chip">${formatClock(log.startAt)} – ${formatClock(log.endAt)}</span>
        <span class="status" data-status="${escapeHtml(log.status)}">${escapeHtml(log.status)}</span>
      </div>

      ${log.notes ? `
        <p class="log-notes">${escapeHtml(log.notes)}</p>
      ` : ""}

      <div class="log-actions">
        <button class="mini-button change" data-action="status" title="Change status"
          data-id="${escapeHtml(log.id)}">Change status</button>
        <button class="mini-button delete" data-action="delete" title="Delete"
          data-id="${escapeHtml(log.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

function render() {
  $("todayDate").textContent = new Date().toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });

  $("totalTime").textContent = formatTime(todayTotal());
  const sessions = todayLogs().length + (
    data.active &&
    localDateKey(data.active.startAt) === todayKey() ? 1 : 0
  );
  $("sessionCount").textContent =
    `${sessions} session${sessions === 1 ? "" : "s"}`;

  renderActive();
  renderSplit();
  renderLogs();
}

async function startTask(event) {
  event.preventDefault();

  if (data.active) {
    showMessage("Stop the current session before starting another.", true);
    return;
  }

  const title = $("taskTitle").value.trim();

  if (!title) {
    showMessage("Please enter a task title.", true);
    return;
  }

  const timestamp = now();

  data.active = {
    id: crypto.randomUUID(),
    title,
    category: $("category").value,
    status: $("taskStatus").value,
    notes: $("taskNotes").value.trim(),
    startAt: timestamp,
    resumedAt: timestamp,
    accumulatedMs: 0,
    state: "running"
  };

  await save();

  $("taskForm").reset();
  $("category").value = "Work";
  $("taskStatus").value = "In Progress";

  render();
  showMessage("Task tracking started.");
}

async function togglePause() {
  const active = data.active;
  if (!active) return;

  if (active.state === "running") {
    active.accumulatedMs = elapsedMs(active);
    active.resumedAt = null;
    active.state = "paused";
  } else {
    active.resumedAt = now();
    active.state = "running";
  }

  await save();
  render();
}

async function stopTask() {
  const active = data.active;
  if (!active) return;

  const endedAt = now();

  // A session that started running or paused is saved with
  // its accumulated active duration, excluding paused time.
  const durationMs = elapsedMs(active, endedAt);

  data.logs.push({
    id: active.id,
    title: active.title,
    category: active.category,
    status: active.status,
    notes: active.notes,
    startAt: active.startAt,
    endAt: endedAt,
    durationMs
  });

  data.active = null;

  await save();
  render();
  showMessage("Session saved successfully.");
}

async function changeStatus(id) {
  const log = data.logs.find((item) => item.id === id);
  if (!log) return;

  const statuses = [
    "Not Started",
    "In Progress",
    "Completed",
    "On Hold"
  ];

  const current = statuses.indexOf(log.status);
  log.status = statuses[(current + 1) % statuses.length];

  await save();
  render();
  showMessage(`Status changed to ${log.status}.`);
}

async function deleteLog(id) {
  const log = data.logs.find((item) => item.id === id);
  if (!log) return;

  const ok = await confirmDialog({
    title: "Delete time log?",
    text: `"${log.title}" will be permanently removed.`,
    confirmLabel: "Delete"
  });
  if (!ok) return;

  data.logs = data.logs.filter((item) => item.id !== id);

  await save();
  render();
  showMessage("Time log deleted.");
}

function csvCell(value) {
  let text = String(value ?? "");

  // Reduce the risk of spreadsheet formula injection.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

// Forces Excel to keep the value as plain text (so dates/times are never
// converted to numbers, which is what produced the "#####" display).
function csvTextCell(value) {
  const text = String(value ?? "");
  if (!text) return '""';
  return `"=""${text.replace(/"/g, '""""')}"""`;
}

const EXPORT_HEADERS = [
  "Task Title",
  "Category",
  "Date",
  "Start Time",
  "End Time",
  "Duration (HH:MM:SS)",
  "Duration (Minutes)",
  "Task Status",
  "Session State",
  "Notes"
];

function buildExportRows() {
  const rows = todayLogs().map((log) => ({
    ...log,
    durationMs: completedDuration(log)
  }));

  // Include the active session in the export, too.
  if (data.active &&
      localDateKey(data.active.startAt) === todayKey()) {
    const active = data.active;

    rows.push({
      ...active,
      endAt: "",
      durationMs: elapsedMs(active),
      status: active.status,
      sessionState: active.state === "paused" ? "Paused" : "Running"
    });
  }

  // Oldest first reads more naturally in a report.
  rows.sort((a, b) => a.startAt - b.startAt);

  return rows.map((log) => [
    log.title,
    log.category,
    localDateKey(log.startAt),
    new Date(log.startAt).toLocaleTimeString(),
    log.endAt ? new Date(log.endAt).toLocaleTimeString() : "",
    formatTime(log.durationMs),
    (log.durationMs / 60000).toFixed(2),
    log.status,
    log.sessionState || "Stopped",
    log.notes || ""
  ]);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const rows = buildExportRows();

  if (rows.length === 0) {
    showMessage("There are no time logs to export today.", true);
    return;
  }

  // Columns 2-5 (date, start, end, HH:MM:SS) are written as text.
  const textColumns = new Set([2, 3, 4, 5]);

  const csv = [
    EXPORT_HEADERS.map(csvCell).join(","),
    ...rows.map((row) => row.map((value, i) =>
      textColumns.has(i) ? csvTextCell(value) : csvCell(value)
    ).join(","))
  ].join("\r\n");

  // UTF-8 BOM helps Excel recognize Unicode text.
  const blob = new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8;"
  });

  downloadBlob(blob, `Time_Tracker_${todayKey()}.csv`);
  showMessage("Today's CSV report downloaded.");
}

/* ---------- Minimal .xlsx writer (no external libraries) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Builds an uncompressed ZIP archive from [{ name, content }].
function zipStore(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = encoder.encode(file.content);
    const crc = crc32(body);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);      // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, body.length, true);
    local.setUint16(26, name.length, true);

    chunks.push(new Uint8Array(local.buffer), name, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, body.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function buildXlsx(headers, rows) {
  const all = [headers, ...rows];

  // Auto-fit every column to its longest value.
  const widths = headers.map((_, col) => {
    const longest = Math.max(
      ...all.map((row) => {
        const lines = String(row[col] ?? "").split("\n");
        return Math.max(...lines.map((l) => l.length));
      })
    );
    return Math.min(60, Math.max(10, longest + 3));
  });

  const sheetRows = all.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnLetter(c)}${r + 1}`;
      const style = r === 0 ? ' s="1"' : "";
      return `<c r="${ref}" t="inlineStr"${style}>` +
        `<is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");

  const cols = widths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  const lastRef = `${columnLetter(headers.length - 1)}${all.length}`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${sheetRows}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Arial"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  return zipStore([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Time Log" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: "xl/styles.xml", content: styles },
    { name: "xl/worksheets/sheet1.xml", content: sheet }
  ]);
}

function exportXlsx() {
  const rows = buildExportRows();

  if (rows.length === 0) {
    showMessage("There are no time logs to export today.", true);
    return;
  }

  // Guard against spreadsheet formula injection in text fields.
  const safe = rows.map((row) => row.map((value) =>
    /^[\s]*[=+\-@]/.test(String(value)) ? "'" + value : value
  ));

  downloadBlob(buildXlsx(EXPORT_HEADERS, safe),
    `Time_Tracker_${todayKey()}.xlsx`);
  showMessage("Today's Excel report downloaded.");
}

async function clearToday() {
  const key = todayKey();

  // Never silently discard a running task.
  if (data.active && localDateKey(data.active.startAt) === key) {
    showMessage(
      "Stop the active session before clearing today's logs.",
      true
    );
    return;
  }

  const count = todayLogs().length;

  if (count === 0) {
    showMessage("There are no saved logs to clear today.", true);
    return;
  }

  const ok = await confirmDialog({
    title: "Clear today's logs?",
    text: `All ${count} saved log${count === 1 ? "" : "s"} from today will be ` +
      "permanently deleted. This cannot be undone.",
    confirmLabel: "Clear all"
  });
  if (!ok) return;

  data.logs = data.logs.filter(
    (log) => localDateKey(log.startAt) !== key
  );

  await save();
  render();
  showMessage("Today's saved logs were cleared.");
}

async function init() {
  try {
    await load();

    $("toast").addEventListener("click", hideToast);
    $("taskForm").addEventListener("submit", startTask);
    $("pauseBtn").addEventListener("click", togglePause);
    $("stopBtn").addEventListener("click", stopTask);
    $("exportBtn").addEventListener("click", exportCsv);
    $("exportXlsxBtn").addEventListener("click", exportXlsx);
    $("clearBtn").addEventListener("click", clearToday);

    $("logsList").addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const { action, id } = button.dataset;

      if (action === "status") await changeStatus(id);
      if (action === "delete") await deleteLog(id);
    });

    render();

    renderInterval = setInterval(render, 1000);

    // Refresh the view if another popup or extension context
    // updates the stored data.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;

      const saved = changes[STORAGE_KEY].newValue;
      if (!saved) return;

      data = {
        logs: Array.isArray(saved.logs) ? saved.logs : [],
        active: saved.active || null
      };

      render();
    });
  } catch (error) {
    console.error("Time Tracker initialization failed:", error);
    showMessage("Unable to load saved data.", true);
  }
}

document.addEventListener("DOMContentLoaded", init);
