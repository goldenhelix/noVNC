import RFB from "../core/rfb.js";
import * as WebUtil from "./webutil.js";
import { isTouchDevice, isSafari, hasScrollbarGutter, dragThreshold, supportsBinaryClipboard, isFirefox, isWindows, isIOS, supportsPointerLock }
    from '../core/util/browser.js';
import { MouseButtonMapper, XVNC_BUTTONS } from "../core/mousebuttonmapper.js";
import * as Log from '../core/util/logging.js';
import {showNotification} from "../core/util/notifications";

const UI = {
    connected: false,
    screenID: null,
    screen: {},
    screens: [],
    multiMonitorSupport: (typeof BroadcastChannel !== "undefined" && typeof SharedWorker !== "undefined"),
    get supportsMultiMonitor() {
        return this.multiMonitorSupport;
    },
    controlChannel: null,
    awaitingPrimary: false,       // *GH* primary reconnecting, hold for 'primaryready'
    awaitingPrimaryTimer: null,
    draggingTab: false,
    //Initial Loading of the UI
    prime() {
        this.start();
    },

    //Render default UI
    start() {
        window.addEventListener("beforeunload", (e) => {
            // Clean up secondary display connection before window closes
            const urlParams = new URLSearchParams(window.location.search);
            const windowId = urlParams.get('windowId');

            if (UI.rfb && windowId) {
                // This is a secondary display - unregister it without disconnecting main session
                UI.rfb._unregisterSecondaryDisplay();
            }
        });

        // Settings with immediate effects
        UI.initSetting('logging', 'warn');
        UI.updateLogging();

        UI.addDefaultHandlers();
        UI.updateVisualState('disconnected');

        const webui_mode = window.localStorage.getItem('theme')?.toLowerCase() || 'dark'
        document.getElementById('screen').classList.add(webui_mode);

    },

    addDefaultHandlers() {
        document.getElementById('noVNC_connect_button').addEventListener('click', UI.connect);
        // Control panel events
        document.getElementById('toggleMenu').addEventListener('click', UI.toggleMenu);
        document.getElementById('closeMenu').addEventListener('click', UI.toggleMenu);
        document.getElementById('fullscreenTrigger').addEventListener('click', UI.fullscreenTrigger);
        document.getElementById('menuTab').addEventListener('mousemove', UI.dragTab);
        document.getElementById('menuTab').addEventListener('mouseup', UI.dragEnd);
        document.getElementById('menuTab').addEventListener('touchmove', UI.touchDragTab);
        document.getElementById('dragHandler').addEventListener('mousedown', UI.dragStart);
        document.getElementById('dragHandler').addEventListener('touchstart', UI.dragStart);
        document.getElementById('dragHandler').addEventListener('mouseup', UI.dragEnd);
        document.getElementById('dragHandler').addEventListener('touchend', UI.dragEnd);
        document.getElementById('menuTab').addEventListener('mouseleave', UI.dragEnd);
        // End control panel events
    },

    dragStart(e) {
        UI.draggingTab = true
    },
    dragEnd(e) {
        document.getElementById('menuTab').classList.remove('dragging')
        UI.draggingTab = false
    },

    dragTab(e) {
        if (UI.draggingTab) {
            document.getElementById('menuTab').style.top = (e.clientY - 10) + 'px'
            document.getElementById('menuTab').classList.add('dragging')
        }
    },
    touchDragTab(e) {
        if (UI.draggingTab) {
            e.preventDefault()
            const touch = e.touches[0]
            document.getElementById('menuTab').style.top = (touch.clientY - 10) + 'px'
            document.getElementById('menuTab').classList.add('dragging')
        }
    },

    fullscreenTrigger() {
        if (document.fullscreenElement || // alternative standard method
            document.mozFullScreenElement || // currently working methods
            document.webkitFullscreenElement ||
            document.msFullscreenElement) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        } else {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            } else if (document.documentElement.mozRequestFullScreen) {
                document.documentElement.mozRequestFullScreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
            } else if (document.body.msRequestFullscreen) {
                document.body.msRequestFullscreen();
            }
        }

    },

    toggleMenu() {
        document.getElementById('mySidenav').classList.toggle('show_nav')
        const show = document.getElementById('mySidenav').classList.contains('show_nav')
        if (show) {
            document.getElementById('toggleMenuIcon').classList.add('rotate-180')
        } else {
            document.getElementById('toggleMenuIcon').classList.remove('rotate-180')
        }
    },

    getSetting(name, isBool, default_value) {
        let val = WebUtil.readSetting(name);
        if ((val === 'undefined' || val === null) && default_value !== 'undefined' && default_value !== null) {
            val = default_value;
        }
        if (typeof val !== 'undefined' && val !== null && isBool) {
            if (val.toString().toLowerCase() in {'0': 1, 'no': 1, 'false': 1}) {
                val = false;
            } else {
                val = true;
            }
        }
        return val;
    },

    connect() {
        let details = null
        const initialAutoPlacementValue = window.localStorage.getItem('autoPlacement')
        if (initialAutoPlacementValue === null) {
            details = {
                left: window.screenLeft,
                top: window.screenTop
            }
        }

        if (!UI.rfb) {
            UI.rfb = new RFB(document.getElementById('noVNC_container'),
                        document.getElementById('noVNC_keyboardinput'),
                        "", //URL
                        {
                            shared: UI.getSetting('shared', true),
                            repeaterID: UI.getSetting('repeaterID', false),
                            credentials: { password: null },
                            hiDpi: UI.getSetting('enable_hidpi', true, false),
                            videoRenderingMode: UI.getSetting('video_rendering_mode')
                        },
                        null,
                        false // Not a primary display
                    );
        }

        UI.rfb.addEventListener("connect", UI.connectFinished);
        //UI.rfb.addEventListener("disconnect", UI.disconnectFinished);
        //TODO: add support for forced static resolution for multiple monitors
        //UI.rfb.forcedResolutionX = UI.getSetting('forced_resolution_x', false);
        //UI.rfb.forcedResolutionY = UI.getSetting('forced_resolution_y', false);
        const resize_setting = UI.getSetting('resize', false, 'remote');
        UI.rfb.clipViewport = resize_setting !== 'off';
        UI.rfb.scaleViewport = resize_setting === 'scale';
        UI.rfb.resizeSession = resize_setting === 'remote';
        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
        UI.rfb.dynamicQualityMin = parseInt(UI.getSetting('dynamic_quality_min'));
        UI.rfb.dynamicQualityMax = parseInt(UI.getSetting('dynamic_quality_max'));
        UI.rfb.jpegVideoQuality = parseInt(UI.getSetting('jpeg_video_quality'));
        UI.rfb.webpVideoQuality = parseInt(UI.getSetting('webp_video_quality'));
        UI.rfb.videoArea = parseInt(UI.getSetting('video_area'));
        UI.rfb.videoTime = parseInt(UI.getSetting('video_time'));
        UI.rfb.videoOutTime = parseInt(UI.getSetting('video_out_time'));
        UI.rfb.videoScaling = parseInt(UI.getSetting('video_scaling'));
        UI.rfb.treatLossless = parseInt(UI.getSetting('treat_lossless'));
        UI.rfb.maxVideoResolutionX = parseInt(UI.getSetting('max_video_resolution_x'));
        UI.rfb.maxVideoResolutionY = parseInt(UI.getSetting('max_video_resolution_y'));
        UI.rfb.frameRate = parseInt(UI.getSetting('framerate'));
        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
        UI.rfb.showDotCursor = UI.getSetting('show_dot', true);
        UI.rfb.idleDisconnect = UI.getSetting('idle_disconnect');
        UI.rfb.pointerRelative = UI.getSetting('pointer_relative');
        UI.rfb.videoQuality = parseInt(UI.getSetting('video_quality'));
        UI.rfb.antiAliasing = UI.getSetting('anti_aliasing');
        UI.rfb.clipboardUp = UI.getSetting('clipboard_up', true, true);
        UI.rfb.clipboardDown = UI.getSetting('clipboard_down', true, true);
        let seamlessClip = UI.getSetting('clipboard_seamless', true, true);
        if (isFirefox() || isSafari()) {
            seamlessClip = false;
        }
        UI.rfb.clipboardSeamless = seamlessClip
        UI.rfb.keyboard.enableIME = UI.getSetting('enable_ime', true, false);
        UI.rfb.clipboardBinary = supportsBinaryClipboard() && UI.rfb.clipboardSeamless;
        UI.rfb.enableWebRTC = UI.getSetting('enable_webrtc', true, false);
        UI.rfb.mouseButtonMapper = UI.initMouseButtonMapper();
        if (UI.rfb.videoQuality === 5) {
            UI.rfb.enableQOI = true;
        }

        // *GH* Guarded: a re-attach after the primary reconnects re-runs connect(),
        // and the channel is deliberately kept open across that gap so this window
        // can hear 'primaryready'. Opening a second one would double every message.
        if (UI.supportsMultiMonitor && !UI.controlChannel) {
            UI.controlChannel = new BroadcastChannel(UI.rfb.connectionID);
            UI.controlChannel.addEventListener('message', UI.handleControlMessage)
        }

        //attach this secondary display to the primary display
        const screen = UI.rfb.attachSecondaryDisplay(details);
        UI.screenID = screen.screenID
        UI.screen = screen
        document.querySelector('title').textContent = 'Display ' + UI.screenID
        window.name = UI.screenID

        if (supportsBinaryClipboard()) {
            // explicitly request permission to the clipboard
            navigator.permissions.query({ name: "clipboard-read" })
                .then((result) => { Log.Debug('binary clipboard enabled') })
                .catch(() => {});
        }
    },

    handleControlMessage(event) {
        switch (event.data.eventType) {
            case 'identify':
                UI.identify(event.data)
                break;
            case 'secondarydisconnected':
                UI.handlePrimaryLost();
                break;
            case 'primaryready':
                UI.handlePrimaryReady();
                break;
        }
    },

    // *GH* Secondary displays used to be abandoned by a primary reconnect: the
    // primary broadcast 'secondarydisconnected' and each popup dropped to a
    // terminal disconnected screen with a Connect button the user had to click
    // in every window. Since this fork forces auto-reconnect on, that happened
    // on every network blip. Instead, hold the window in a reconnecting state
    // and re-attach when the primary announces itself.
    //
    // The BroadcastChannel name is derived from the page URL (core/rfb.js:146),
    // so it is stable across the primary's reconnect and this window keeps
    // hearing it. The channel is intentionally NOT closed here.
    handlePrimaryLost() {
        if (UI.awaitingPrimary) { return; }
        UI.awaitingPrimary = true;

        // Drop the dead RFB but leave UI.controlChannel open. Not UI.disconnect(),
        // which also tears the channel down and would make us deaf to the return.
        if (UI.rfb) {
            try {
                UI.rfb.removeEventListener("connect", UI.connectFinished);
                UI.rfb.disconnect();
            } catch (e) {
                Log.Warn("Secondary teardown failed: " + e);
            }
            UI.rfb = null;
        }

        UI.updateVisualState('reconnecting');

        // Don't spin forever if the primary never returns. The primary gives up
        // after reconnect_retries x reconnect_delay (30 x 2s); allow margin, then
        // settle into the real disconnected screen.
        clearTimeout(UI.awaitingPrimaryTimer);
        UI.awaitingPrimaryTimer = setTimeout(() => {
            if (!UI.awaitingPrimary) { return; }
            UI.awaitingPrimary = false;
            Log.Warn("Primary display did not return; giving up.");
            UI.updateVisualState('disconnected');
        }, 90000);
    },

    handlePrimaryReady() {
        if (!UI.awaitingPrimary) { return; }
        UI.awaitingPrimary = false;
        clearTimeout(UI.awaitingPrimaryTimer);
        UI.awaitingPrimaryTimer = null;

        Log.Info("Primary display is back; re-attaching this secondary display.");
        UI.connect();
    },

    updateVisualState(state) {
        document.documentElement.classList.remove("noVNC_connecting");
        document.documentElement.classList.remove("noVNC_connected");
        document.documentElement.classList.remove("noVNC_disconnecting");
        document.documentElement.classList.remove("noVNC_reconnecting");
        document.documentElement.classList.remove("noVNC_disconnected");

        const transitionElem = document.getElementById("noVNC_transition_text");
        if (WebUtil.isInsideKasmVDI())
        {
            parent.postMessage({ action: 'connection_state', value: state}, '*' );
        }

        let connect_el = document.getElementById('noVNC_connect_dlg');

        switch (state) {
            case 'init':
                break;
            case 'connecting':
                transitionElem.textContent = _("Connecting...");
                document.documentElement.classList.add("noVNC_connecting");
                break;
            case 'connected':
                document.documentElement.classList.add("noVNC_connected");
                if (!connect_el.classList.contains("noVNC_hidden")) {
                    connect_el.classList.add('noVNC_hidden');
                }
                break;
            case 'disconnecting':
                transitionElem.textContent = _("Disconnecting...");
                document.documentElement.classList.add("noVNC_disconnecting");
                break;
            case 'disconnected':
                document.documentElement.classList.add("noVNC_disconnected");
                if (connect_el.classList.contains("noVNC_hidden")) {
                    connect_el.classList.remove('noVNC_hidden');
                }
                UI.disconnect()
                break;
            case 'reconnecting':
                transitionElem.textContent = _("Reconnecting...");
                document.documentElement.classList.add("noVNC_reconnecting");
                break;
            default:
                Log.Error("Invalid visual state: " + state);
                UI.showStatus(_("Internal error"), 'error');
                return;
        }
    },

    identify(data) {
        UI.screens = data.screens
        const screen = data.screens.find(el => el.id === UI.screenID)
        if (screen) {
            showNotification(screen.num);
            document.querySelector('title').textContent = 'Display ' + screen.num + ' - ' + UI.screenID;
        }
    },


    showStatus(text, statusType, time, kasm = false) {
        // If inside the full Kasm CDI framework, don't show messages unless explicitly told to
        if (WebUtil.isInsideKasmVDI() && !kasm) {
            return;
        }

        const statusElem = document.getElementById('noVNC_status');

        if (typeof statusType === 'undefined') {
            statusType = 'normal';
        }

        // Don't overwrite more severe visible statuses and never
        // errors. Only shows the first error.
        if (statusElem.classList.contains("noVNC_open")) {
            if (statusElem.classList.contains("noVNC_status_error")) {
                return;
            }
            if (statusElem.classList.contains("noVNC_status_warn") &&
                statusType === 'normal') {
                return;
            }
        }

        clearTimeout(UI.statusTimeout);

        switch (statusType) {
            case 'error':
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_error");
                break;
            case 'warning':
            case 'warn':
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_warn");
                break;
            case 'normal':
            case 'info':
            default:
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.add("noVNC_status_normal");
                break;
        }

        statusElem.textContent = text;
        statusElem.classList.add("noVNC_open");

        // If no time was specified, show the status for 1.5 seconds
        if (typeof time === 'undefined') {
            time = 1500;
        }

        // Error messages do not timeout
        if (statusType !== 'error') {
            UI.statusTimeout = window.setTimeout(UI.hideStatus, time);
        }
    },

    hideStatus() {
        clearTimeout(UI.statusTimeout);
        document.getElementById('noVNC_status').classList.remove("noVNC_open");
    },

    disconnect() {
        if (UI.rfb) {
            UI.rfb.disconnect();
            if (UI.supportsMultiMonitor && UI.controlChannel) {
                UI.controlChannel.removeEventListener('message', UI.handleControlMessage);
                // *GH* removeEventListener alone leaves the BroadcastChannel open, so
                // a secondary that reconnects stacks another subscriber on the same
                // connectionID channel. connect() recreates it, so close it here.
                UI.controlChannel.close();
                UI.controlChannel = null;
                UI.rfb.removeEventListener("connect", UI.connectFinished);
            }
            UI.rfb = null;
        }
    },

    connectFinished(e) {
        UI.connected = true;
        UI.inhibitReconnect = false;

        UI.showStatus("Secondary Screen Connected");
        UI.updateVisualState('connected');

        // Do this last because it can only be used on rendered elements
        UI.rfb.focus();
    },

    initMouseButtonMapper() {
        const mouseButtonMapper = new MouseButtonMapper();

        const settings = WebUtil.readSetting("mouseButtonMapper");
        if (settings) {
            mouseButtonMapper.load(settings);
            return mouseButtonMapper;
        }

        mouseButtonMapper.set(0, XVNC_BUTTONS.LEFT_BUTTON);
        mouseButtonMapper.set(1, XVNC_BUTTONS.MIDDLE_BUTTON);
        mouseButtonMapper.set(2, XVNC_BUTTONS.RIGHT_BUTTON);
        mouseButtonMapper.set(3, XVNC_BUTTONS.BACK_BUTTON);
        mouseButtonMapper.set(4, XVNC_BUTTONS.FORWARD_BUTTON);
        WebUtil.writeSetting("mouseButtonMapper", mouseButtonMapper.dump());

        return mouseButtonMapper;
    },

    updateLogging() {
        WebUtil.initLogging(UI.getSetting('logging'));
    },

    // Initial page load read/initialization of settings
    initSetting(name, defVal) {
        // Check Query string followed by cookie
        let val = WebUtil.getConfigVar(name);
        if (val === null) {
            val = WebUtil.readSetting(name, defVal);
        }
        WebUtil.setSetting(name, val);
        return val;
    },

     // Apply remote resizing or local scaling
     applyResizeMode() {
        if (!UI.rfb) return;
        const resize_setting = UI.getSetting('resize');
        UI.rfb.clipViewport = resize_setting !== 'off';
        UI.rfb.scaleViewport = resize_setting === 'scale';
        UI.rfb.resizeSession = resize_setting === 'remote' || UI.rfb.forcedResolutionX && UI.rfb.forcedResolutionY;
        UI.rfb.idleDisconnect = UI.getSetting('idle_disconnect');
        UI.rfb.videoQuality = UI.getSetting('video_quality');
        UI.rfb.enableWebP = UI.getSetting('enable_webp');
        UI.rfb.enableHiDpi = UI.getSetting('enable_hidpi');
    },

}

UI.prime();
const initialAutoPlacementValue = window.localStorage.getItem('autoPlacement')

if ('getScreenDetails' in window && initialAutoPlacementValue === null) {
    UI.connect();
}
export default UI;
