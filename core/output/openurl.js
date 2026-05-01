import * as Log from "../util/logging.js";

const isInIframe = () => {
    try { return window.self !== window.top; } catch (e) { return true; }
};

export default (rfb) => {
    rfb.subscribeUnixRelay("openurl", (payload) => {
        const url = new TextDecoder("utf-8").decode(new Uint8Array(payload)).trim();

        if (!/^https?:\/\//i.test(url)) {
            Log.Warn(`openurl: refusing non-http(s) URL`);
            return;
        }

        if (isInIframe()) {
            window.parent.postMessage({ action: "openurl", value: url }, "*");
            return;
        }

        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (!w) {
            Log.Warn(`openurl: popup blocked for ${url}; user must allow popups for this origin`);
        }
    });
};
