import * as Log from "../util/logging.js";

// Forwards structured messages from the X session up to the iframe-hosting
// page. Producer side: a desktop process calls the `kasmvnc-host` helper
// with a JSON payload, which writes to the `host` UnixRelay socket; the
// payload arrives here and is re-emitted as
//   parent.postMessage({ action: `host:${msg.action}`, value: msg.value }, "*")
// The `host:` prefix keeps these distinct from the other actions already on
// the parent message bus (openurl, download, connection_state, etc.). The
// parent decides which actions it actually honors — kasmweb does not need
// to change when new actions are added.

const decoder = new TextDecoder("utf-8");

const isInIframe = () => {
    try { return window.self !== window.top; } catch (e) { return true; }
};

export default (rfb) => {
    rfb.subscribeUnixRelay("host", (payload) => {
        const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
        let msg;
        try {
            msg = JSON.parse(decoder.decode(u8));
        } catch (e) {
            Log.Warn(`host: invalid JSON payload: ${e}`);
            return;
        }
        if (!msg || typeof msg.action !== "string") {
            Log.Warn("host: message missing string 'action'");
            return;
        }
        if (!isInIframe()) {
            Log.Info(`host: not embedded in iframe, dropping ${msg.action}`);
            return;
        }
        window.parent.postMessage({
            action: `host:${msg.action}`,
            value: msg.value,
        }, "*");
    });
};
