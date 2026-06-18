interface LogsModalProps {
  serverId: string;
  logs: string;
  loading: boolean;
  onClose: () => void;
}

// Docker captures the container's raw stdout, which for our Deno servers includes
// ANSI escape codes: SGR colour codes (e.g. \x1b[32m) plus cursor/erase codes from
// progress bars (e.g. \x1b[0G\x1b[2K\x1b[J). A real terminal interprets these, but a
// <pre> renders them literally. This converts the colour codes to styled spans and
// drops the cursor/erase codes so the modal looks like the terminal does.
const ANSI_FG: Record<number, string> = {
  30: "#666666", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510",
  34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
  90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f543",
  94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff",
};
const ANSI_BG: Record<number, string> = {
  40: "#666666", 41: "#cd3131", 42: "#0dbc79", 43: "#e5e510",
  44: "#2472c8", 45: "#bc3fbc", 46: "#11a8cd", 47: "#e5e5e5",
  100: "#666666", 101: "#f14c4c", 102: "#23d18b", 103: "#f5f543",
  104: "#3b8eea", 105: "#d670d6", 106: "#29b8db", 107: "#ffffff",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ansiToHtml(input: string): string {
  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false, dim = false, italic = false, underline = false;

  const styleAttr = (): string => {
    const parts: string[] = [];
    if (fg) parts.push(`color:${fg}`);
    if (bg) parts.push(`background:${bg}`);
    if (bold) parts.push("font-weight:bold");
    if (dim) parts.push("opacity:0.7");
    if (italic) parts.push("font-style:italic");
    if (underline) parts.push("text-decoration:underline");
    return parts.join(";");
  };

  let out = "";
  // Each alternative consumes input fully: a CSI sequence, a stray ESC, or a text run.
  const re = /\x1b\[([0-9;]*)([A-Za-z])|\x1b|([^\x1b]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const [, params, final, text] = m;
    if (text !== undefined) {
      const clean = escapeHtml(text.replace(/\r/g, ""));
      const style = styleAttr();
      out += style ? `<span style="${style}">${clean}</span>` : clean;
      continue;
    }
    if (final !== "m") continue; // cursor/erase code (e.g. 0G, 2K, J) — drop it
    const codes = params === "" ? [0] : params.split(";").map(Number);
    for (const code of codes) {
      if (code === 0) { fg = bg = null; bold = dim = italic = underline = false; }
      else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 3) italic = true;
      else if (code === 4) underline = true;
      else if (code === 22) { bold = false; dim = false; }
      else if (code === 23) italic = false;
      else if (code === 24) underline = false;
      else if (code === 39) fg = null;
      else if (code === 49) bg = null;
      else if (ANSI_FG[code]) fg = ANSI_FG[code];
      else if (ANSI_BG[code]) bg = ANSI_BG[code];
    }
  }
  return out;
}

export function LogsModal(props: LogsModalProps) {
  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Server Logs: {props.serverId}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          {props.loading ? (
            <div class="logs-loading">
              <div class="spinner"></div>
              <p>Loading logs...</p>
            </div>
          ) : (
            <pre class="logs-display" innerHTML={ansiToHtml(props.logs)}></pre>
          )}
        </div>
      </div>
    </div>
  );
}
