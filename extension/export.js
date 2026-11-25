export function sessionsToCsv(sessions) {
  const rows = [["session_id", "session_name", "created_at", "window_index", "tab_index", "title", "url", "pinned", "muted", "group"]];
  for (const session of sessions) {
    session.windows.forEach((window, windowIndex) => {
      window.tabs.forEach((tab, tabIndex) => rows.push([
        session.id,
        session.name,
        new Date(session.createdAt).toISOString(),
        windowIndex + 1,
        tabIndex + 1,
        tab.title || "",
        tab.url,
        Boolean(tab.pinned),
        Boolean(tab.muted),
        tab.group || ""
      ]));
    });
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

// Saved URLs as CSV: one row per URL, with which kinds of window it was saved from.
export function savedToCsv(entries) {
  const rows = [["url", "title", "incognito", "regular"], ...entries.map((e) => [e.url, e.title || "", e.incognito, e.regular])];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
