/** The bridge generation both sides speak. */
export declare const BRIDGE_VERSION = 1;

export declare interface BridgeError {
    code: ErrorCode;
    message?: string;
}

/** `coedit.append` params: the host seals it and the relay places it. */
export declare interface CoEditAppendParams {
    kind: CoEditKind;
    body: unknown;
}

export declare interface CoEditAppendResult {
    /** Where it landed; it comes back as a `coedit.entry` too. */
    seq: number;
}

export declare interface CoEditBlobGetParams {
    name: string;
}

export declare interface CoEditBlobGetResult {
    name: string;
    bytes: ArrayBuffer;
}

/** `coedit.blob.put` / `coedit.blob.get`: the session's sealed blobs (the
 *  base document, images added while editing). A name, not a path. */
export declare interface CoEditBlobPutParams {
    name: string;
    data: ArrayBuffer;
}

/** `coedit.cursor` event data. */
export declare interface CoEditCursor {
    client: string;
    cursor: unknown;
}

/** `coedit.cursor` params: passed to the other members, not kept. The host
 *  sends a few a second at most (the last one wins). */
export declare interface CoEditCursorParams {
    cursor: unknown;
}

/** `coedit.dropped` event data (filex 0.56). */
export declare interface CoEditDropped {
    /** The last entry the host handed over. */
    from: number;
    /** `gone`: the membership ended (the session closed, or the page was away
     *  too long) - join again. `broken`: an entry did not check out (missing,
     *  moved, altered, replayed) - stop editing together. */
    reason: 'gone' | 'broken';
}

/** One entry of the session's log, opened and checked by filex. */
export declare type CoEditEntry = (CoEditEntryBase & {
    kind: CoEditKind;
    body: unknown;
}) | (CoEditEntryBase & {
    kind: 'join';
    member: CoEditMember;
}) | (CoEditEntryBase & {
    kind: 'leave';
}) | (CoEditEntryBase & {
    kind: 'saved';
    through: number;
});

declare interface CoEditEntryBase {
    seq: number;
    /** The relay's time, Unix ms - the same for every member. */
    at: number;
    client: string;
}

/**
 * What `coedit.join` answers: who the app is in the session and how far
 * the log has gone. The entries come as `coedit.entry` events once the app
 * subscribes (`coedit.subscribe` from 0 for the whole log). `unavailable`
 * when filex offers no editing together here (filex 0.55, editing together
 * turned off, an encrypted file, a vault): the app edits alone - the message
 * says why (`not_ready` after waiting for a session's creator, `encrypted`,
 * `nothing_to_watch` for a person who may only read the file while nobody
 * edits it, or the server's code: `coedit_off`, `coedit_build`,
 * `coedit_file_changed`).
 */
export declare interface CoEditHello {
    session: string;
    me: CoEditMember;
    /**
     * The last entry's seq when filex handed the session over (0: an empty
     * log). filex 0.56: the changes this browser kept from an earlier opening
     * of the file (a lost connection, a closed tab), which filex sends before
     * it answers, are in the log up to here - an editor that starts once it
     * has read this far opens with them.
     */
    head: number;
    /** The last `changes` entry's seq, as far as `head`. */
    changesHead: number;
    /** The last entry the file on the storage holds. */
    savedThrough: number;
    /**
     * filex 0.56: this member started the session. Before anybody else can
     * join it puts the base document - EXACTLY the bytes it opened - with
     * `coedit.blob.put('base', bytes)`. A member that did not start it opens
     * `coedit.blob.get('base')`, never the file: the file may hold a save of
     * the session already, and the log applies to the base.
     */
    created: boolean;
}

/** `coedit.join` params: join (or start) the session of an opened file. */
export declare interface CoEditJoinParams {
    index?: number;
}

/** What a member appends: the editor's changes, a lock request, a release. */
export declare type CoEditKind = 'changes' | 'lock' | 'release';

/** `coedit.lease`: the changes lease (one writer at a time, one that has
 *  seen every change). */
export declare interface CoEditLeaseParams {
    op: 'acquire' | 'release';
    /** The seq of the last `changes` entry the app applied. */
    changesSeen: number;
}

export declare interface CoEditLeaseResult {
    granted: boolean;
}

/** A member of the session. */
export declare interface CoEditMember {
    /** The relay's id for the connection. */
    client: string;
    /** An opaque id of the person, the same for each of their connections in
     *  this session; never an account id. */
    user: string;
    /** The person's display name. */
    name: string;
    /** The editor's per-session user index: given once, never twice. */
    indexUser: number;
    /** May append changes (an editor role and the right to change the file). */
    canEdit: boolean;
}

/** `coedit.subscribe` params: entries after `from` arrive as `coedit.entry`. */
export declare interface CoEditSubscribeParams {
    from: number;
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

/**
 * What an app says about the CSV it saves (filex 0.57; `SaveParams.csv`):
 * how ITS bytes are written. filex reads the same from the bytes and refuses
 * a save they contradict (`invalid`, message `csv_dialect`): nothing is
 * written. Whatever the app wrote, the file is written in its own way - its
 * delimiter, byte order mark, line ends and encoding - with every cell nobody
 * changed as the file has it. A field left out is not checked; no `csv` at
 * all is read from the bytes alone.
 */
export declare interface CsvDeclaration {
    /** One character: `,`, `;`, `\t` or `|`. */
    delimiter?: string;
    /** As TextDialect.encoding names it (`utf-8` for a string the SDK sent). */
    encoding?: string;
    /** The bytes start with a byte order mark. */
    bom?: boolean;
    /** Their line ends. */
    eol?: 'crlf' | 'lf';
}

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
    /**
     * 0.55.0: the file is end-to-end encrypted - `folder` in an encrypted
     * folder, `vault` in a vault (where only one person edits at a time),
     * `file` for a single encrypted file (`.fxe`). As the server says it;
     * ABSENT for a file that is not encrypted.
     *
     * ⚠ The server holds such a file only as ciphertext and has no key. Unless
     * `plaintext` is true, filex hands the app nothing of it: `file.read` is
     * refused (`failed` with `encrypted`), a save is refused, and `readOnly`
     * is true.
     */
    encrypted?: 'folder' | 'vault' | 'file';
    /**
     * 0.56.0: filex hands this encrypted file to the app in the clear. The
     * person's browser, which holds the folder key while the folder is
     * unlocked, decrypts it for `file.read` and encrypts what `file.save`
     * hands over before it leaves the browser; the server sees only
     * ciphertext. Only with `encrypted: 'folder'` or `'vault'`, for an app
     * whose manifest says `encrypted_folders: {"open": true}` (the grant
     * `files:e2e-plaintext`) - never for a `.fxe`. ABSENT otherwise.
     *
     * In a vault (`encrypted: 'vault'`) the browser reads the file from the
     * vault's packs and writes a save as the vault's next generation, under
     * the vault's write lock (one writer at a time). A save is refused -
     * `failed` with `vault_locked` - while somebody else writes the vault, and
     * with `vault_lock_lost` when this session's write lock ended before the
     * save was committed: nothing was written, save again. The vault locked
     * meanwhile (its keys left the browser): `unavailable`, and filex closes
     * the app.
     *
     * What changes for the app: a read and a save are held whole in the page
     * (at most LIMITS.maxEncryptedBytes); a save is written only over the file
     * as it was opened (`failed` with `changed` when it changed meanwhile);
     * `file.saveAs` answers `unavailable` (a copy elsewhere would leave the
     * folder decrypted); the app's module (`engine.call`, `job.submit`) is
     * never handed the file; `state.get` / `state.set` use a store of their
     * own for this folder, sealed in the person's browser (the server keeps it
     * and cannot read it; apart from the app's ordinary store, a little smaller
     * as it is measured sealed). Everything the app holds is plaintext: keep it
     * in the frame. In a folder whose names are encrypted too, `name` and
     * `ext` are the decrypted name's - the server never sees them.
     */
    plaintext?: true;
}

export declare interface FilexApp {
    readonly session: Session;
    /** The file at `index` (default the first) the interface was opened with. */
    open(index?: number): Promise<OpenedFile>;
    /**
     * Save new content over an opened file. `through` (filex 0.56, editing
     * together): the last log entry the saved document holds, so the session
     * knows what is saved. `csv` (filex 0.57): how the CSV saved over a `.csv`
     * is written (CsvDeclaration); filex checks it against the bytes and
     * writes the file in its own way. `beside` (filex 0.57): the save is in
     * this format, which the file cannot hold - written beside it under a name
     * filex chooses (`SaveResult.name`). `conflict: 'copy'` (filex 0.57): a
     * file that changed since it was opened gets the save as a conflict copy
     * (`SaveResult.conflict`) instead of a refusal.
     */
    save(data: SaveData, opts?: {
        index?: number;
        mime?: string;
        through?: number;
        csv?: CsvDeclaration;
        beside?: string;
        conflict?: 'copy';
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
    /**
     * Print a PDF (filex 0.55; the app needs `ui.print` in its manifest): a
     * sandboxed frame may not open the print dialog, so filex prints it from
     * its own page. filex asks the person every time, and the dialog opens on
     * their click on filex's Allow; at most LIMITS.maxPrintBytes. filex 0.54
     * and older answer `unknown_method`, and a host whose print page may not
     * be shown `unavailable`: hand the PDF over with `download` then.
     */
    print(name: string, pdf: Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>): Promise<PrintResult>;
    /**
     * Editing together (filex 0.56; the app's manifest says `"co_edit":
     * {"open": true}`, granted as `files:co-edit`). filex seals what the app appends, orders it
     * through its relay and hands every member the same entries in the same
     * order (`coedit.entry` events after `subscribe`); the app never holds a
     * key. `join` answering `unavailable` (filex 0.55, editing together off
     * here, an encrypted file) means: edit alone. The member that started the
     * session (`created`) puts the base document before anybody else may join.
     */
    coedit: {
        join(index?: number): Promise<CoEditHello>;
        subscribe(from: number): Promise<void>;
        append(kind: CoEditKind, body: unknown): Promise<CoEditAppendResult>;
        lease(op: 'acquire' | 'release', changesSeen: number): Promise<boolean>;
        cursor(cursor: unknown): void;
        putBlob(name: string, data: Blob | ArrayBuffer | ArrayBufferView): Promise<void>;
        getBlob(name: string): Promise<ArrayBuffer>;
        leave(): Promise<void>;
    };
    /** Call the app's own module (`ui_call` export) with the opened files. */
    call<T = unknown>(method: string, params?: unknown): Promise<T>;
    /** Queue one of the app's actions on the opened files; answers the op. */
    submit(action: string, params?: Record<string, unknown>): Promise<{
        op: unknown;
    }>;
    /**
     * This person's small store for this app (JSON values, 8 KiB each). While
     * the app holds a file of an encrypted folder in the clear
     * (`FileInfo.plaintext`, filex 0.56) it is another store, sealed in the
     * browser - apart from this one, and empty while the folder is locked.
     */
    state: {
        get<T = unknown>(key: string): Promise<T | undefined>;
        set(key: string, value: unknown): Promise<void>;
    };
    /**
     * The app's license (filex 0.52.0; a paid app installed from a store):
     * `{status: "free"}` for a free app, `{status: "valid", valid_until,
     * updates_until}` for a licensed one. Never the key, never the licensee.
     */
    license: {
        get(): Promise<LicenseInfo>;
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
| 'app.updated'
/** Editing together: the next entry of the session's log, opened. `data: CoEditEntry`. */
| 'coedit.entry'
/** Editing together: another member's cursor (not kept). `data: CoEditCursor`. */
| 'coedit.cursor'
/**
* Editing together: the host stopped handing entries over. `data:
* CoEditDropped` - `gone`: the membership ended (join again); `broken`: an
* entry did not check out (stop editing together). A connection that drops
* for a moment is the host's own: it reconnects and says nothing.
*/
| 'coedit.dropped';

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

/**
 * `license.get` (filex 0.52.0): what the app's license says. A paid app is
 * installed from a store, which issues its license and is asked about it every
 * day; filex keeps the key and never hands it to the app. `status`:
 *
 *   - `free`: not a paid app;
 *   - `valid`: the store said valid at its last check;
 *   - `grace`: valid, but the store could not be asked since - it holds until
 *     the grace the store signed ends;
 *   - anything else (`revoked`, `expired`, `invalid`, `seats_exhausted`,
 *     `wrong_app`, `grace_expired`, `missing`, `unverified`): the app is held
 *     and its interface is not served, so an app rarely reads one of these.
 *
 * `valid_until` / `updates_until` are there for a valid license (dates as
 * RFC 3339). Who holds the license is not the app's to read. filex 0.51.0
 * and older answer `unknown_method`.
 */
export declare interface LicenseInfo {
    status: string;
    valid_until?: string;
    updates_until?: string;
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
    /**
     * The largest PDF `ui.print` prints (filex 0.55). Lower than a download:
     * a download can stream to disk, a print is held whole in the page (one
     * Blob) until the print dialog has read it, and a document worth printing
     * is far smaller.
     */
    readonly maxPrintBytes: number;
    /**
     * The largest file of an encrypted folder filex hands an app in the clear
     * or takes back from it (filex 0.56, `FileInfo.plaintext`): it is
     * decrypted and encrypted whole in the page, as filex's own explorer does
     * for a file of this size.
     */
    readonly maxEncryptedBytes: number;
};

/** What the app may ask the host. Anything else is `unknown_method`. */
export declare type Method = 'session.get' | 'file.read' | 'file.save' | 'file.saveAs' | 'ui.dirty' | 'ui.title' | 'ui.toast' | 'ui.confirm' | 'ui.close' | 'clipboard.write' | 'ui.download' | 'engine.call' | 'job.submit' | 'state.get' | 'state.set'
/** 0.52.0: what the app's license says (a paid app from a store), `LicenseInfo`. */
| 'license.get'
/** 0.55.0: filex prints a PDF the app hands it (`PrintParams`, grant `ui:print`). */
| 'ui.print'
/**
* Editing together (`coedit.*`, task #189): the session's log the host
* seals, orders through filex's relay and opens again. Defined in filex
* 0.55, which answers each `unavailable`; offered from 0.56 to an app
* granted `files:co-edit` (see `CoEditHello`). `unavailable` = edit alone.
*/
| 'coedit.join' | 'coedit.subscribe' | 'coedit.append' | 'coedit.lease' | 'coedit.cursor' | 'coedit.blob.put' | 'coedit.blob.get' | 'coedit.leave';

export declare const METHODS: readonly Method[];

/** One opened file, read the way the app needs it. */
export declare interface OpenedFile extends FileInfo {
    text(): Promise<string>;
    bytes(): Promise<ArrayBuffer>;
    stream(): Promise<ReadableStream<Uint8Array>>;
    /**
     * The whole answer of a read (filex 0.57): the content `as` asks for, and
     * what filex knows about how the file is written (`text_dialect`, for a
     * `.csv`).
     */
    read(as?: 'stream' | 'bytes' | 'text'): Promise<ReadResult>;
    /** Save new content over this file (a new version, or the draft it is). */
    save(data: SaveData, mime?: string): Promise<SaveResult>;
}

/** The host's answer, carrying the port. */
export declare const PORT = "filex:port";

export declare interface PortMessage {
    type: typeof PORT;
    v: number;
}

/**
 * `ui.print` (filex 0.55.0): a PDF for the browser's print dialog. A
 * sandboxed frame may not open that dialog (measured: Chromium ignores
 * `print()` there and says so, Firefox ignores it), so filex prints the PDF
 * from a page of its own, with the app's `ui:print` grant, never over
 * LIMITS.maxPrintBytes. filex asks every time, above the frame, and the
 * dialog opens only on the person's click on filex's Allow. The print dialog
 * can save the PDF too, so `ui:print` is the same kind of grant as
 * `ui:download`. filex 0.54 and older answer `unknown_method`.
 */
export declare interface PrintParams {
    /** The document's name, for the question filex may ask - a name, not a path. */
    name: string;
    /** The PDF: a transferred ArrayBuffer or ReadableStream<Uint8Array>. */
    data: ReadableStream<Uint8Array> | ArrayBuffer;
    /** `application/pdf` when given; nothing else is printed. */
    mime?: string;
}

export declare interface PrintResult {
    /** The browser's print dialog was opened with the PDF. */
    printed: true;
    size: number;
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
    /**
     * filex 0.57: how a `.csv` is written (its delimiter, byte order mark,
     * line ends, encoding). Absent for any other file, for a file of an
     * encrypted folder (the server holds its ciphertext only), and from filex
     * 0.56 and older.
     */
    text_dialect?: TextDialect;
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

/**
 * `file.saveAs`: a NEW file, in a folder the person picks in filex's own
 * folder dialog (the one its Move to… uses), which opens in the opened
 * file's folder. Closing the dialog answers `cancelled`.
 */
export declare interface SaveAsParams {
    /** The file name — a name, not a path. */
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
    /**
     * 0.55.0, editing together: the last log entry (`CoEditEntry.seq`) the
     * saved document holds, so the session knows what is saved. Ignored
     * outside a session.
     */
    through?: number;
    /**
     * filex 0.57: what the app says about the CSV it saves over a `.csv`
     * (CsvDeclaration). Ignored for any other file and for a file of an
     * encrypted folder; filex 0.56 and older ignore it.
     */
    csv?: CsvDeclaration;
    /**
     * filex 0.57: the save is in this format (an extension: `docx`, `xlsx`,
     * `pptx`, `docm`, `xlsm`, `pptm`, `odt`, `ods`, `odp`), which the opened
     * file cannot hold (a `.doc`, `.xls`, `.ppt`...). It is written BESIDE the
     * file, which is left as it is, under a name filex chooses - the file's own
     * name with that extension, `rapor (2).docx` when that is taken - and only
     * for a person who may create files in that folder (`permission_denied`
     * otherwise). `SaveResult.name` says where; later saves of the same
     * opening go to that file. The same extension as the file's own: an
     * ordinary save over it. Refused (`unavailable`) for a file of an
     * encrypted folder. filex 0.56 and older ignore it and write over the file.
     */
    beside?: string;
    /**
     * filex 0.57: `'copy'` - when the file changed since the app opened it
     * (somebody else saved it, a sync client wrote it), the save is written as
     * a conflict copy beside it (`<name>.filex-conflict-<UTC time>.<ext>`)
     * instead of being refused, and `SaveResult.conflict` names it; later saves
     * of the same opening go to that copy. Without it such a save is refused
     * (`failed`, message `changed`), as in 0.56. A file of an encrypted folder
     * is never copied: refused as before.
     */
    conflict?: 'copy';
}

export declare interface SaveResult {
    saved: true;
    size: number;
    /**
     * filex 0.57: the name of the file the save was written to when it is not
     * the opened file - the one beside it (`beside`) or the conflict copy
     * (`conflict`). Absent for a save over the opened file.
     */
    name?: string;
    /** filex 0.57: the save went beside the file, in the format `beside` named. */
    beside?: true;
    /** filex 0.57: the save went to this conflict copy (`conflict: 'copy'`). */
    conflict?: string;
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
    /**
     * The person's display name (their profile's, else their username); never
     * their e-mail, never a token. '' where nobody is signed in (a public
     * page). An editor writes it as the author of comments and tracked
     * changes.
     */
    user: {
        name: string;
    };
    /**
     * filex 0.57: the language the administrator fixed for document editors
     * (Admin → External services → ONLYOFFICE → Editor language,
     * `FILEX_ONLYOFFICE_LANG`; a code such as `de`, `pt-PT`, `zh-TW`). An app
     * that draws a document editor draws it in this language rather than the
     * reader's `locale`; its own words stay in `locale`. Absent: each person's
     * own language decides.
     */
    editor_lang?: string;
    files: FileInfo[];
    /** The permissions this app was granted — so it can hide what it may not do. */
    grants: string[];
    /** The administrator's non-secret settings for this app (grant `settings`). */
    settings?: Record<string, string>;
}

/**
 * How a CSV file is written (filex 0.57): `ReadResult.text_dialect` of a
 * `.csv`, read by the server from the file's own bytes.
 */
export declare interface TextDialect {
    /** One character: `,`, `;`, `\t` or `|`. */
    delimiter: string;
    /** The file starts with a byte order mark. */
    bom: boolean;
    /** Its lines end in CRLF (else LF). */
    crlf: boolean;
    /**
     * Its encoding as a browser's TextDecoder names it: `utf-8`, `utf-16le`,
     * `utf-16be`, or a code page (`windows-1250`, `windows-1251`,
     * `windows-1252`, `windows-1254`). `file.read` with `as: 'text'` decodes
     * with it; `bytes` and `stream` hand the bytes as they are.
     */
    encoding: string;
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
