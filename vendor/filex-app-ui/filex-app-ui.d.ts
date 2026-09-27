/** The bridge generation both sides speak. */
export declare const BRIDGE_VERSION = 1;

export declare interface BridgeError {
    code: ErrorCode;
    message?: string;
}

export declare interface ConfirmParams {
    title?: string;
    text: string;
    confirm?: string;
    cancel?: string;
    danger?: boolean;
}

/**
 * The handshake. Resolves once filex answered with its port and the session;
 * rejects outside filex or when filex did not answer in time. Calling it again
 * answers the same connection.
 */
export declare function connect(opts?: ConnectOptions): Promise<FilexApp>;

export declare interface ConnectOptions {
    /** How long to wait for filex (default 10 s). */
    timeoutMs?: number;
    /**
     * Put filex's colours (`--fe-*`), `lang`, `dir` and `data-theme` on
     * `<html>`, and keep them current (default true).
     */
    applyTheme?: boolean;
    /** Ctrl/Cmd+S inside the interface runs the save handler (default true). */
    saveShortcut?: boolean;
}

/** `file.saveAs`: a NEW file, somewhere the person picks in filex's own dialog. */
/**
 * `ui.download`: a file for the person's own disk. filex does it (a sandboxed
 * frame cannot download), with the app's `ui:download` grant, on a gesture in
 * the frame or the person's yes, never over LIMITS.maxDownloadBytes.
 */
export declare interface DownloadParams {
    /** The file name offered — a name, not a path. */
    name: string;
    /** A transferred ReadableStream<Uint8Array>, an ArrayBuffer or a string. */
    data: ReadableStream<Uint8Array> | ArrayBuffer | string;
    mime?: string;
}

export declare interface DownloadResult {
    saved: true;
    size: number;
}

/** `engine.call`: the app's own module, `ui_call` export. */
export declare interface EngineCallParams {
    method: string;
    params?: unknown;
}

/** Why a call was refused. */
export declare type ErrorCode = 
/** The app was not granted what the call needs (files:write for a save…). */
'not_granted'
/** No such file (an index past the opened files), no such key. */
| 'not_found'
/** The file cannot be written: a read-only storage, a view-only opening. */
| 'read_only'
/** The call's parameters are wrong. */
| 'invalid'
/** Over a limit (LIMITS). */
| 'too_large'
/** The server could not be reached or refused; `message` says what. */
| 'failed'
/** The person said no (a confirm, a save-as picker closed). */
| 'cancelled'
/** The host does not offer this here (no engine, no save handler). */
| 'unavailable' | 'unknown_method';

export declare interface EventMessage {
    event: HostEvent;
    data?: unknown;
}

/** One file the interface was opened with. Never a storage path. */
export declare interface FileInfo {
    index: number;
    name: string;
    /** Lower-case, no dot. */
    ext: string;
    size: number;
    mime: string;
    /** It cannot be saved over: read-only storage, view-only opening, or the
     *  app holds no `files:write`. */
    readOnly: boolean;
}

export declare interface FilexApp {
    readonly session: Session;
    /** The file at `index` (default the first) the interface was opened with. */
    open(index?: number): Promise<OpenedFile>;
    /** Save new content over an opened file. */
    save(data: SaveData, opts?: {
        index?: number;
        mime?: string;
    }): Promise<SaveResult>;
    /** Save a NEW file; filex asks the person where (its own folder picker). */
    saveAs(name: string, data: SaveData, mime?: string): Promise<SaveAsResult>;
    /** Unsaved changes, or not: filex asks before the person leaves them. */
    dirty(on: boolean): void;
    title(text: string): void;
    toast(text: string, tone?: ToastParams['tone']): void;
    confirm(opts: ConfirmParams | string): Promise<boolean>;
    /** Ask filex to close the interface (it asks first when there are changes). */
    close(): void;
    /** Put text on the clipboard (filex does it, the same way in every browser). */
    copy(text: string): Promise<void>;
    /**
     * Hand the person a file for their own disk (the app needs `ui.download`
     * in its manifest). Call it from a click or a key press: without one,
     * filex asks the person first. `cancelled` when they say no.
     */
    download(name: string, data: SaveData, mime?: string): Promise<DownloadResult>;
    /** Call the app's own module (`ui_call` export) with the opened files. */
    call<T = unknown>(method: string, params?: unknown): Promise<T>;
    /** Queue one of the app's actions on the opened files; answers the op. */
    submit(action: string, params?: Record<string, unknown>): Promise<{
        op: unknown;
    }>;
    /** This person's small store for this app (JSON values, 8 KiB each). */
    state: {
        get<T = unknown>(key: string): Promise<T | undefined>;
        set(key: string, value: unknown): Promise<void>;
    };
    /** Listen to filex. Returns the unsubscribe. */
    on(event: HostEvent, handler: (data: unknown) => void): () => void;
    /**
     * What to save when filex asks (its Save button, a draft's "Save to disk",
     * Ctrl+S): return the document and the SDK saves it over the opened file;
     * return nothing if the handler saved by itself.
     */
    onSave(handler: () => SaveData | void | Promise<SaveData | void>): () => void;
    /** Raw call, for a method this SDK has no helper for. */
    request<T = unknown>(method: Method, params?: unknown, transfer?: Transferable[]): Promise<T>;
}

/** A call filex refused, with the reason as a code. */
export declare class FilexError extends Error {
    readonly code: ErrorCode;
    constructor(err: BridgeError);
}

/** The app's first message, to `window.parent`. */
export declare const HELLO = "filex:hello";

export declare interface HelloMessage {
    type: typeof HELLO;
    v: number;
}

/** What the host tells the app, unasked. */
export declare type HostEvent = 
/** The interface's colours changed (light/dark, palette). `data: Theme`. */
'theme'
/** The reader's language changed. `data: {locale, dir}`. */
| 'locale'
/** The open file changed underneath (another tab, another person). */
| 'file.changed'
/** The person closed the frame's surroundings; last chance to say so. */
| 'close.request'
/** An administrator installed a new version of this app: reload to use it. */
| 'app.updated';

/** What the host may ask the app (and wait for). */
export declare type HostRequest = 
/** Save now (the host's Save button, a draft's "Save to disk"): the app
*  hands its document to `file.save` and answers when it is written. */
'save';

export declare interface HostRequestMessage {
    hid: number;
    request: HostRequest;
    params?: unknown;
}

export declare interface HostResponseMessage {
    hid: number;
    result?: unknown;
    error?: BridgeError;
}

export declare function isHello(d: unknown): d is HelloMessage;

export declare function isKnownMethod(m: string): m is Method;

export declare function isPortMessage(d: unknown): d is PortMessage;

export declare function isRequest(d: unknown): d is RequestMessage;

/** `job.submit`: queue one of the app's actions on the opened files. */
export declare interface JobSubmitParams {
    action: string;
    params?: Record<string, unknown>;
}

export declare const LIMITS: {
    /** `file.read({as: 'text'})` refuses a file larger than this; read a stream. */
    readonly maxTextBytes: number;
    /** One `state.set` value, as JSON. */
    readonly maxStateBytes: number;
    /** A `ui.toast` / `ui.title` text, in characters. */
    readonly maxLineChars: 300;
    /** How long the SDK waits for the host's port. */
    readonly connectTimeoutMs: 10000;
    /** The largest file `ui.download` hands the person (streamed or not). */
    readonly maxDownloadBytes: number;
};

/** What the app may ask the host. Anything else is `unknown_method`. */
export declare type Method = 'session.get' | 'file.read' | 'file.save' | 'file.saveAs' | 'ui.dirty' | 'ui.title' | 'ui.toast' | 'ui.confirm' | 'ui.close' | 'clipboard.write' | 'ui.download' | 'engine.call' | 'job.submit' | 'state.get' | 'state.set';

export declare const METHODS: readonly Method[];

/** One opened file, read the way the app needs it. */
export declare interface OpenedFile extends FileInfo {
    text(): Promise<string>;
    bytes(): Promise<ArrayBuffer>;
    stream(): Promise<ReadableStream<Uint8Array>>;
    /** Save new content over this file (a new version, or the draft it is). */
    save(data: SaveData, mime?: string): Promise<SaveResult>;
}

/** The host's answer, carrying the port. */
export declare const PORT = "filex:port";

export declare interface PortMessage {
    type: typeof PORT;
    v: number;
}

/** `file.read` params. */
export declare interface ReadParams {
    index?: number;
    /** `stream` (a transferred ReadableStream<Uint8Array>), `bytes` (an
     *  ArrayBuffer), or `text` (UTF-8, at most LIMITS.maxTextBytes). */
    as?: 'stream' | 'bytes' | 'text';
}

export declare interface ReadResult {
    name: string;
    size: number;
    mime: string;
    stream?: ReadableStream<Uint8Array>;
    bytes?: ArrayBuffer;
    text?: string;
}

export declare interface RequestMessage {
    id: number;
    method: Method;
    params?: unknown;
}

export declare interface ResponseMessage {
    id: number;
    result?: unknown;
    error?: BridgeError;
}

export declare interface SaveAsParams {
    name: string;
    data: ReadableStream<Uint8Array> | ArrayBuffer | string;
    mime?: string;
}

export declare interface SaveAsResult {
    saved: true;
    name: string;
    size: number;
}

/** Content the app hands to a save. */
export declare type SaveData = string | Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/** `file.save` params: the new content of the opened file. */
export declare interface SaveParams {
    index?: number;
    /** A transferred ReadableStream<Uint8Array>, an ArrayBuffer or a string. */
    data: ReadableStream<Uint8Array> | ArrayBuffer | string;
    mime?: string;
}

export declare interface SaveResult {
    saved: true;
    size: number;
}

/** What `session.get` answers — what the app knows about where it runs. */
export declare interface Session {
    v: number;
    app: {
        name: string;
        version: string;
    };
    view: {
        id: string;
        placement: 'modal' | 'page' | 'inspector' | 'home' | 'viewer';
    };
    /** The reader's language tag (`tr`, `pt-br`) and its direction. */
    locale: string;
    dir: 'ltr' | 'rtl';
    theme: Theme;
    /** The person's display name; never their e-mail, never a token. */
    user: {
        name: string;
    };
    files: FileInfo[];
    /** The permissions this app was granted — so it can hide what it may not do. */
    grants: string[];
    /** The administrator's non-secret settings for this app (grant `settings`). */
    settings?: Record<string, string>;
}

/** The interface's look: `mode` and filex's own `--fe-*` custom properties. */
export declare interface Theme {
    mode: 'light' | 'dark';
    /** `--fe-bg`, `--fe-text`, `--fe-accent`… — the SDK sets them on `<html>`. */
    tokens: Record<string, string>;
}

export declare interface ToastParams {
    text: string;
    tone?: 'info' | 'success' | 'warning' | 'error';
}

export { }
