import * as Log from "../util/logging.js";
import * as Transfers from "./transfers.js";

const TYPE_START = 0;
const TYPE_CHUNK = 1;
const TYPE_END = 2;

const CHUNK_SIZE = 64 * 1024;
const DEFAULT_DEST = "~/Workspace/Documents";

const enc = new TextEncoder();

function packStringFields(...strings) {
    let total = 0;
    const encoded = strings.map(s => {
        const b = enc.encode(s);
        total += 2 + b.length;
        return b;
    });
    return { encoded, total };
}

function packStart(xid, file, dest) {
    const { encoded, total } = packStringFields(file.name, file.type || "application/octet-stream", dest);
    const buf = new Uint8Array(1 + 4 + 8 + total);
    const v = new DataView(buf.buffer);
    let o = 0;
    v.setUint8(o, TYPE_START); o += 1;
    v.setUint32(o, xid, false); o += 4;
    v.setBigUint64(o, BigInt(file.size), false); o += 8;
    for (const b of encoded) {
        v.setUint16(o, b.length, false); o += 2;
        buf.set(b, o); o += b.length;
    }
    return buf;
}

function packChunk(xid, seq, data) {
    const buf = new Uint8Array(1 + 4 + 4 + 4 + data.length);
    const v = new DataView(buf.buffer);
    v.setUint8(0, TYPE_CHUNK);
    v.setUint32(1, xid, false);
    v.setUint32(5, seq, false);
    v.setUint32(9, data.length, false);
    buf.set(data, 13);
    return buf;
}

function packEnd(xid, totalSeq) {
    const buf = new Uint8Array(1 + 4 + 4);
    const v = new DataView(buf.buffer);
    v.setUint8(0, TYPE_END);
    v.setUint32(1, xid, false);
    v.setUint32(5, totalSeq, false);
    return buf;
}

function newXid() {
    return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
}

async function uploadOne(rfb, file, dest) {
    const xid = newXid();
    const handle = Transfers.add({ direction: "up", name: file.name, size: file.size });
    try {
        rfb.sendUnixRelayData("upload", packStart(xid, file, dest));
        let offset = 0;
        let seq = 0;
        while (offset < file.size) {
            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const chunkBuf = await file.slice(offset, end).arrayBuffer();
            rfb.sendUnixRelayData("upload", packChunk(xid, seq, new Uint8Array(chunkBuf)));
            seq += 1;
            offset = end;
            handle.update(offset);
            // Yield so the WebSocket has a chance to flush.
            await new Promise(r => setTimeout(r, 0));
        }
        rfb.sendUnixRelayData("upload", packEnd(xid, seq));
        handle.complete(file.size);
    } catch (e) {
        Log.Error(`upload[${xid}] ${file.name}: ${e}`);
        handle.error(String(e.message || e));
        throw e;
    }
}

// ---------- UI ----------

function styleObj(el, style) { Object.assign(el.style, style); }

function makeOverlay() {
    const el = document.createElement("div");
    styleObj(el, {
        position: "fixed", inset: "0",
        display: "none",
        alignItems: "center", justifyContent: "center",
        background: "rgba(74, 144, 226, 0.18)",
        border: "4px dashed rgba(74, 144, 226, 0.85)",
        boxSizing: "border-box",
        color: "#fff", font: "20px/1.4 system-ui, sans-serif",
        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        pointerEvents: "none",
        zIndex: 2147483400,
    });
    el.textContent = "Drop files to upload";
    document.body.appendChild(el);
    return el;
}

function showModal(files, onUpload, onCancel) {
    const backdrop = document.createElement("div");
    styleObj(backdrop, {
        position: "fixed", inset: "0",
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2147483500,
    });

    const modal = document.createElement("div");
    styleObj(modal, {
        background: "#222", color: "#eee", borderRadius: "10px",
        padding: "16px 20px", width: "min(520px, 90vw)",
        maxHeight: "80vh", display: "flex", flexDirection: "column", gap: "10px",
        font: "13px/1.4 system-ui, sans-serif",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    });

    const title = document.createElement("div");
    title.textContent = `Upload ${files.length} file${files.length === 1 ? "" : "s"}`;
    styleObj(title, { fontSize: "16px", fontWeight: "600" });

    const list = document.createElement("div");
    styleObj(list, {
        overflowY: "auto", maxHeight: "220px",
        background: "#1a1a1a", padding: "6px 8px", borderRadius: "6px",
        border: "1px solid #333",
    });
    files.forEach(f => {
        const row = document.createElement("div");
        styleObj(row, {
            display: "flex", justifyContent: "space-between", gap: "8px",
            padding: "2px 0",
        });
        const n = document.createElement("span");
        n.textContent = f.name;
        styleObj(n, {
            flex: "1 1 auto", overflow: "hidden",
            whiteSpace: "nowrap", textOverflow: "ellipsis",
        });
        n.title = f.name;
        const sz = document.createElement("span");
        sz.textContent = fmtBytes(f.size);
        styleObj(sz, { color: "#aaa" });
        row.appendChild(n);
        row.appendChild(sz);
        list.appendChild(row);
    });

    const destLabel = document.createElement("label");
    destLabel.textContent = "Destination";
    styleObj(destLabel, { fontSize: "12px", color: "#aaa" });

    const destInput = document.createElement("input");
    destInput.type = "text";
    destInput.value = DEFAULT_DEST;
    styleObj(destInput, {
        width: "100%", boxSizing: "border-box",
        padding: "6px 8px", borderRadius: "4px",
        background: "#1a1a1a", color: "#eee",
        border: "1px solid #444", font: "inherit",
    });

    const buttons = document.createElement("div");
    styleObj(buttons, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" });

    const mkBtn = (label, kind) => {
        const b = document.createElement("button");
        b.textContent = label;
        styleObj(b, {
            padding: "6px 14px", borderRadius: "4px", cursor: "pointer",
            border: "none", font: "inherit",
            background: kind === "primary" ? "#4a90e2" : "#444",
            color: "#fff",
        });
        return b;
    };

    const cancelBtn = mkBtn("Cancel", "secondary");
    const uploadBtn = mkBtn("Upload", "primary");

    let removed = false;
    const cleanup = () => {
        if (removed) return;
        removed = true;
        // Hide first so the user sees an immediate response, then remove
        // from DOM. Idempotent — guarded by `removed` so re-entering
        // (e.g. blur after Enter) can't try to remove a detached node.
        backdrop.style.pointerEvents = "none";
        backdrop.style.display = "none";
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };
    cancelBtn.onclick = (e) => { e.stopPropagation(); cleanup(); onCancel(); };
    uploadBtn.onclick = (e) => {
        e.stopPropagation();
        const dest = destInput.value.trim() || DEFAULT_DEST;
        cleanup();
        onUpload(dest);
    };
    backdrop.onclick = (e) => { if (e.target === backdrop) { cleanup(); onCancel(); } };

    buttons.appendChild(cancelBtn);
    buttons.appendChild(uploadBtn);

    modal.appendChild(title);
    modal.appendChild(list);
    modal.appendChild(destLabel);
    modal.appendChild(destInput);
    modal.appendChild(buttons);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    setTimeout(() => destInput.focus(), 0);
}

function fmtBytes(n) {
    if (n == null || !isFinite(n)) return "?";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
}

// ---------- wiring ----------

function isFileDrag(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
        if (types[i] === "Files") return true;
    }
    return false;
}

function attachDragDrop(rfb) {
    const overlay = makeOverlay();
    let depth = 0;

    const onDragEnter = (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depth += 1;
        overlay.style.display = "flex";
    };
    const onDragOver = (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e) => {
        if (!isFileDrag(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) overlay.style.display = "none";
    };
    const onDrop = (e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        depth = 0;
        overlay.style.display = "none";
        const files = Array.from(e.dataTransfer.files || []);
        if (!files.length) return;

        showModal(files, async (dest) => {
            for (const f of files) {
                try { await uploadOne(rfb, f, dest); }
                catch (_e) { /* per-file error already surfaced via Transfers */ }
            }
        }, () => { /* canceled */ });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
}

export default (rfb) => {
    if (!rfb._isPrimaryDisplay) return;

    // Xvnc's VNCSConnectionST::unixRelay() only forwards a client's
    // outbound UnixRelay messages to the daemon IF the client is
    // subscribed to that relay name. We don't actually consume any
    // server→client traffic on this channel (the upload daemon is
    // receive-only as far as the JS side is concerned), but the
    // subscribe is required to register sending permission.
    rfb.subscribeUnixRelay("upload", () => {});

    attachDragDrop(rfb);
};
