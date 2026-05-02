import * as Log from "../util/logging.js";
import * as Transfers from "./transfers.js";

const TYPE_START = 0;
const TYPE_CHUNK = 1;
const TYPE_END = 2;
const TYPE_ERROR = 3;

const decoder = new TextDecoder("utf-8");

function readString(view, offset, lenBytes) {
    const len = lenBytes === 2 ? view.getUint16(offset, false) : view.getUint32(offset, false);
    const start = offset + lenBytes;
    const end = start + len;
    const slice = new Uint8Array(view.buffer, view.byteOffset + start, len);
    return [decoder.decode(slice), end];
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default (rfb) => {
    if (!rfb._isPrimaryDisplay) return;
    const transfers = new Map();   // xid -> { name, mime, size, chunks, received, handle }

    rfb.subscribeUnixRelay("download", (payload) => {
        const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        if (u8.byteLength < 5) {
            Log.Warn("download: short packet");
            return;
        }

        const type = view.getUint8(0);
        const xid = view.getUint32(1, false);
        let off = 5;

        switch (type) {
            case TYPE_START: {
                const size = Number(view.getBigUint64(off, false)); off += 8;
                let name, mime, dest;
                [name, off] = readString(view, off, 2);
                [mime, off] = readString(view, off, 2);
                [dest, off] = readString(view, off, 2);  // unused for download
                Log.Info(`download[${xid}] start name=${name} size=${size} mime=${mime}`);
                const handle = Transfers.add({ direction: "down", name, size });
                transfers.set(xid, {
                    name, mime: mime || "application/octet-stream",
                    size, chunks: [], received: 0, handle,
                });
                break;
            }
            case TYPE_CHUNK: {
                const t = transfers.get(xid);
                if (!t) { Log.Warn(`download[${xid}] chunk before start`); return; }
                /* const seq = view.getUint32(off, false); */ off += 4;
                const clen = view.getUint32(off, false); off += 4;
                if (off + clen > u8.byteLength) {
                    Log.Warn(`download[${xid}] chunk len overflow`);
                    return;
                }
                t.chunks.push(u8.slice(off, off + clen));
                t.received += clen;
                t.handle.update(t.received);
                break;
            }
            case TYPE_END: {
                const t = transfers.get(xid);
                if (!t) { Log.Warn(`download[${xid}] end before start`); return; }
                transfers.delete(xid);
                try {
                    const blob = new Blob(t.chunks, { type: t.mime });
                    triggerDownload(blob, t.name);
                    t.handle.complete(t.received);
                } catch (e) {
                    Log.Error(`download[${xid}] failed to trigger: ${e}`);
                    t.handle.error(String(e.message || e));
                }
                break;
            }
            case TYPE_ERROR: {
                let msg;
                [msg] = readString(view, off, 2);
                Log.Warn(`download[${xid}] server error: ${msg}`);
                const t = transfers.get(xid);
                if (t) {
                    t.handle.error(msg);
                    transfers.delete(xid);
                }
                break;
            }
            default:
                Log.Warn(`download: unknown type ${type}`);
        }
    });
};
