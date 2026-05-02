// Shared floating progress panel for download and upload transfers.
// Singleton — call get() to access. Caller obtains a TransferHandle from
// add() and updates progress via update()/complete()/error()/cancel().

const ICON_DOWN = "↓";
const ICON_UP = "↑";

let panel = null;
let panelBody = null;
let hideTimer = null;
let active = 0;

function ensurePanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "kasmvnc_transfers_panel";
    Object.assign(panel.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        width: "320px",
        maxHeight: "60vh",
        overflowY: "auto",
        background: "rgba(20,20,20,0.92)",
        color: "#eee",
        font: "12px/1.4 system-ui, sans-serif",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        zIndex: 2147483600,
        display: "none",
        padding: "8px",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "2px 4px 6px 4px",
        borderBottom: "1px solid #333",
        marginBottom: "6px",
    });
    const title = document.createElement("span");
    title.textContent = "Transfers";
    title.style.fontWeight = "600";
    const close = document.createElement("button");
    close.textContent = "×";
    Object.assign(close.style, {
        background: "transparent", color: "#aaa", border: "none",
        fontSize: "16px", cursor: "pointer", padding: "0 4px",
    });
    close.onclick = () => { panel.style.display = "none"; };
    header.appendChild(title);
    header.appendChild(close);

    panelBody = document.createElement("div");

    panel.appendChild(header);
    panel.appendChild(panelBody);
    document.body.appendChild(panel);
}

function show() {
    ensurePanel();
    panel.style.display = "block";
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function maybeAutoHide() {
    if (active > 0) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (active === 0 && panel) panel.style.display = "none";
    }, 4000);
}

function fmtBytes(n) {
    if (n == null || !isFinite(n)) return "?";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
}

export function add({ direction, name, size }) {
    show();
    active++;

    const row = document.createElement("div");
    Object.assign(row.style, {
        padding: "6px 4px",
        borderBottom: "1px solid #2a2a2a",
    });

    const top = document.createElement("div");
    Object.assign(top.style, { display: "flex", justifyContent: "space-between", gap: "8px" });
    const label = document.createElement("span");
    label.textContent = `${direction === "up" ? ICON_UP : ICON_DOWN} ${name}`;
    Object.assign(label.style, {
        flex: "1 1 auto", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    });
    label.title = name;
    const status = document.createElement("span");
    status.textContent = size ? fmtBytes(size) : "";
    status.style.color = "#aaa";
    top.appendChild(label);
    top.appendChild(status);

    const barWrap = document.createElement("div");
    Object.assign(barWrap.style, {
        height: "4px", background: "#333", borderRadius: "2px",
        marginTop: "4px", overflow: "hidden",
    });
    const bar = document.createElement("div");
    Object.assign(bar.style, {
        height: "100%", width: "0%", background: "#4a90e2",
        transition: "width 120ms linear",
    });
    barWrap.appendChild(bar);

    row.appendChild(top);
    row.appendChild(barWrap);
    panelBody.appendChild(row);

    let done = false;
    const finish = (msg, color) => {
        if (done) return;
        done = true;
        active = Math.max(0, active - 1);
        status.textContent = msg;
        status.style.color = color;
        bar.style.background = color;
        if (color !== "#e74c3c") bar.style.width = "100%";
        maybeAutoHide();
    };

    return {
        update(received) {
            if (done) return;
            if (size && size > 0) {
                const pct = Math.min(100, (received / size) * 100);
                bar.style.width = pct + "%";
                status.textContent = `${fmtBytes(received)} / ${fmtBytes(size)}`;
            } else {
                status.textContent = fmtBytes(received);
                bar.style.width = "100%";
                bar.style.opacity = "0.5";
            }
        },
        complete(finalSize) {
            const s = finalSize ?? size ?? 0;
            finish(s ? fmtBytes(s) + " done" : "done", "#4caf50");
        },
        error(reason) {
            finish(`error: ${reason || "unknown"}`, "#e74c3c");
        },
    };
}
