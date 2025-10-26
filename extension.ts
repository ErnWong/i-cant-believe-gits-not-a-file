import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as util from 'node:util';
import * as vscode from 'vscode';
import type { API as GitAPI, GitExtension, APIState } from './typings/git.d.ts';

let output_channel : vscode.LogOutputChannel;

function showError(message: string) {
    output_channel.error(message);
    vscode.window.showErrorMessage(`(icantbelievegit) ${message}`);
}

function assert(condition: boolean, message: string) {
    if (condition) return;
    output_channel.error(message);
    throw new Error(message);
}

function trace(message: string, ...args: any[]) {
    output_channel.trace(message, ...args);
}

function debug(message: string, ...args: any[]) {
    output_channel.debug(message, ...args);
}

function info(message: string, ...args: any[]) {
    output_channel.info(message, ...args);
}

function warn(message: string, ...args: any[]) {
    output_channel.warn(message, ...args);
}

const execFileUnguarded = util.promisify(child_process.execFile);
const execFile = ((...args: Parameters<typeof execFileUnguarded>):Promise<Awaited<ReturnType<typeof execFileUnguarded>>> => {
    trace('Exec', ...args);
    const promise = execFileUnguarded(...args);
    promise.catch(err => {
        showError(`Failed to run command: ${err}`);
        return Promise.reject(err);
    });
    promise.then(x => {
        trace('Exec output:', x);
    })
    return promise; // Preserve child property of promise
}) as unknown as typeof execFileUnguarded;

const SCHEME = 'icantbelievegit';
const PREFIX_DIR = 'staged';

const TYPE_MAP = {
    'blob': vscode.FileType.File,
    'tree': vscode.FileType.Directory,
} as const;

async function getGitRootForFile(filePath: string) {
    return (await execFile('git', ['rev-parse', '--show-toplevel'], {
        cwd: (await fs.stat(filePath)).isDirectory() ? filePath : path.dirname(filePath),
    })).stdout.trim();
}

function toLocalPath(uri: vscode.Uri): string {
    assert(uri.scheme === SCHEME, `Unexpected scheme ${uri.scheme}`);
    assert(uri.query === '', `Unexpected query ${uri.query}`);
    assert(uri.fragment === '', `Unexpected fragment ${uri.fragment}`);
    assert(path.basename(path.dirname(uri.path)) === PREFIX_DIR, `Missing prefix dir ${PREFIX_DIR} in path ${uri.path}`);
    return vscode.Uri.from({
        scheme: 'file',
        authority: uri.authority,
        path: path.join(path.dirname(path.dirname(uri.path)), path.basename(uri.path)),
    }).fsPath;
};

function fromLocalPath(uri: vscode.Uri): vscode.Uri {
    assert(uri.scheme === 'file', `Unexpected scheme ${uri.scheme}`);
    assert(uri.query === '', `Unexpected query ${uri.query}`);
    assert(uri.fragment === '', `Unexpected fragment ${uri.fragment}`);
    return vscode.Uri.from({
        scheme: SCHEME,
        authority: uri.authority,
        path: path.join(path.dirname(uri.path), PREFIX_DIR, path.basename(uri.path)),
    });
};

class GitIndexWatcher extends vscode.Disposable {
    private readonly _listeners = new Set<() => void>();
    constructor(git_root: string) {
        const abort_controller = new AbortController();
        const index_changes = fs.watch(path.join(git_root, '.git', 'index'), {
            signal: abort_controller.signal,
        });
        super(() => {
            abort_controller.abort();
        });
        (async () => {
            try {
                for await (const event of index_changes) {
                    for (const listener of this._listeners) {
                        listener();
                    }
                }
            } catch (err) {
                if (err && (err as {name?:string}).name === 'AbortError') return;
                throw err;
            }
        })();
    }

    watch(listener: () => void): vscode.Disposable {
        this._listeners.add(listener);
        return new vscode.Disposable(() => {
            this._listeners.delete(listener);
        });
    }

    hasListener(): boolean {
        return this._listeners.size !== 0;
    }
}

class GitIndexFS implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    private _gitIndexWatchers = new Map<string, GitIndexWatcher>();

    watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): vscode.Disposable {
        trace('GitIndexFS.watch', uri, options);

        const local_path = toLocalPath(uri);

        let listener: vscode.Disposable | null = null;
        let git_root: string | null = null;
        let is_cancelled = false;
        (async () => {
            git_root = await getGitRootForFile(local_path);
            if (is_cancelled) return;
            const index_watcher = this._gitIndexWatchers.get(git_root) ?? new GitIndexWatcher(git_root);
            this._gitIndexWatchers.set(git_root, index_watcher);
            listener = index_watcher.watch(() => {
                this._emitter.fire([{
                    type: vscode.FileChangeType.Changed,
                    uri,
                }]);
            })
        })();
        return new vscode.Disposable(() => {
            is_cancelled = true;
            if (listener) {
                listener.dispose();
            }
            if (git_root) {
                const index_watcher = this._gitIndexWatchers.get(git_root)!;
                if (!index_watcher.hasListener()) {
                    this._gitIndexWatchers.delete(git_root);
                    index_watcher.dispose();
                }
            }
        });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        trace('GitIndexFS.stat', uri);

        const local_path = toLocalPath(uri);
        const entries = (await execFile(
            'git',
            ['--literal-pathspecs', 'ls-files', '--cached', '--format=%(objecttype)%x00%(objectname)', local_path],
            {
                cwd: path.dirname(local_path),
            }
        )).stdout.trim().split('\n');
        if (entries[0] === '') {
            // Path may not be in the index yet. Load from working directory instead.
            info('GitIndexFS cached file not found - stat local file from working directory instead');
            try {
                const stat = await fs.stat(local_path);
                return {
                    type: stat.isFile() ? vscode.FileType.File
                        : stat.isDirectory() ? vscode.FileType.Directory
                        : stat.isSymbolicLink() ? vscode.FileType.SymbolicLink
                        : vscode.FileType.Unknown,
                    ctime: stat.ctimeMs,
                    mtime: stat.mtimeMs,
                    size: stat.size,
                };
            } catch (err) {
                if (err && (err as { code?: string }).code === 'ENOENT') {
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
                throw err;
            }
        }
        if (entries.length > 1) {
            warn(`Unsupported: Multiple objects for the same path ${local_path} - is a merge in progress?`);
        }
        const [object_type, object_id] = entries[0].split('\x00');
        const size = Number.parseInt((await execFile(
            'git',
            ['cat-file', '-s', object_id],
            {
                cwd: path.dirname(local_path),
            }
        )).stdout.trim());
        assert(Object.hasOwn(TYPE_MAP, object_type), `Unexpected type ${object_type}`);
        const stat = await fs.stat(path.join(await getGitRootForFile(local_path), '.git', 'index'));
        return {
            type: TYPE_MAP[object_type as keyof typeof TYPE_MAP],
            ctime: 0,
            mtime: stat.mtimeMs,
            size,
        };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        trace('GitIndexFS.readDirectory', uri);

        const local_path = toLocalPath(uri);
        return (await execFile(
            'git',
            ['ls-files', '--cached', '--format=%(path)%x00%(objecttype)', `:(glob)${local_path}/*`],
            {
                cwd: path.dirname(local_path),
            }
        )).stdout
            .split('\n')
            .map(entry => {
                const [path, object_type] = entry.split('\x00');
                console.assert(Object.hasOwn(TYPE_MAP, object_type), `Unexpected type ${object_type}`);
                return [path, TYPE_MAP[object_type as keyof typeof TYPE_MAP]];
            });
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        trace('GitIndexFS.createDirectory', uri);
        throw new Error('GitIndexFS createDirectory not implemented.');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        trace('GitIndexFS.readFile', uri);

        const local_path = toLocalPath(uri);
        const object_ids = (await execFile('git', ['--literal-pathspecs', 'ls-files', '--cached', '--format=%(objectname)', local_path], {
            cwd: path.dirname(local_path),
        })).stdout.trim().split('\n');
        if (object_ids[0] === '') {
            try {
                // File not added to index yet. Load working copy instead to simulate a potential git add.
                info('GitIndexFS cached file not found - loading local file from working directory');
                return await fs.readFile(local_path);
            } catch (err) {
                if (err && (err as { code?: string }).code === 'ENOENT') {
                    // Or should we instead return empty so user can create the index file?
                    throw vscode.FileSystemError.FileNotFound(uri);
                }
                throw err;
            }
        }
        if (object_ids.length > 1) {
            warn(`Unsupported: Multiple objects for the same path ${local_path} - is a merge in progress?`);
        }
        const object_id = object_ids[0];
        return (await execFile('git', ['cat-file', 'blob', object_id], {
            cwd: path.dirname(local_path),
            encoding: 'buffer',
        })).stdout;
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        trace('GitIndexFS.writeFile', uri);

        const local_path = toLocalPath(uri);
        const proc = execFile('git', ['hash-object', '-w', '--stdin'], {
            cwd: path.dirname(local_path),
        });
        proc.child.stdin!.end(content);
        const object_id = (await proc).stdout.trim();
        const existing_mode = (await execFile('git',['--literal-pathspecs', 'ls-files', '--format=%(objectmode)', local_path], {
            cwd: path.dirname(local_path),
        })).stdout.trim();
        const mode = existing_mode || (await fs.stat(local_path)).mode.toString(8);
        const add_flag = existing_mode ? [] : ['--add'];
        const relative_path = path.relative(await getGitRootForFile(local_path), local_path);
        await execFile('git', ['update-index', ...add_flag, '--cacheinfo', [mode, object_id, relative_path].join(',')], {
            cwd: path.dirname(local_path),
        });
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
        trace('GitIndexFS.delete', uri, options);
        throw new Error('GitIndexFS delete not implemented.');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
        trace('GitIndexFS.rename', oldUri, newUri, options);
        throw new Error('GitIndexFS rename not implemented.');
    }

    copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
        trace('GitIndexFS.copy', source, destination, options);
        throw new Error('GitIndexFS copy not implemented.');
    }
}

export function activate(context: vscode.ExtensionContext) {
    const indexFs = new GitIndexFS();

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports?.getAPI(1)!;

    context.subscriptions.push(
        output_channel = vscode.window.createOutputChannel("I Can't Believe (G)it's Not A File", { log: true })
    );
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            SCHEME,
            indexFs,
            {
                isCaseSensitive: true,
                isReadonly: false,
            }
        )
    );
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.openStagedForCurrentFile', async _ => {
        const current_local_path = vscode.window.activeTextEditor?.document.uri;
        if (!current_local_path) {
            vscode.window.showErrorMessage("Cannot open staged version of the current file: There isn't an active text editor available");
            return;
        }
        if (current_local_path.scheme !== 'file') {
            vscode.window.showErrorMessage("Cannot open staged version of the current file: Current file isn't a local file");
            return;
        }
        const git_index_path = fromLocalPath(current_local_path);
        const doc = await vscode.workspace.openTextDocument(git_index_path);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.diffCurrentFile', async _ => {
        const current_local_path = vscode.window.activeTextEditor?.document.uri;
        if (!current_local_path) {
            showError("Cannot open staged version of the current file: There isn't an active text editor available");
            return;
        }
        if (current_local_path.scheme !== 'file') {
            showError("Cannot open staged version of the current file: Current file isn't a local file");
            return;
        }
        const git_index_path = fromLocalPath(current_local_path);
        await vscode.commands.executeCommand('vscode.diff', git_index_path, current_local_path, 'Git diff of ' + path.basename(current_local_path.fsPath));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.openStagedForPath', async _ => {
        const paths = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Select file",
            title: "Open an staged version of a file",
        });
        if (!paths) {
            return;
        }
        if (paths[0].scheme !== 'file') {
            showError("Cannot open staged file: Chosen path isn't a local file");
            return;
        }
        const git_index_path = fromLocalPath(paths[0]);
        const doc = await vscode.workspace.openTextDocument(git_index_path);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.openStagedChanges', async _ => {
        const current_path = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0].uri;
        if (!current_path) {
            showError("Cannot open staged changes: There are no active document or workspace");
            return;
        }
        if (current_path.scheme !== 'file') {
            showError("Cannot open staged changes: Not a local directory");
            return;
        }
        const git_root = await getGitRootForFile(current_path.fsPath);
        const staged_change_paths = (await execFile('git', ['diff', '--name-only', '--cached'], {
            cwd: git_root,
        })).stdout
            .trim()
            .split('\n')
            .map(relative_path => vscode.Uri.file(path.join(git_root, relative_path)));
        await vscode.commands.executeCommand(
            'vscode.changes',
            `Git: Staged Changes (editable)`,
            staged_change_paths.map(local_uri => [
                local_uri,
                gitExtension.toGitUri(local_uri, 'HEAD'),
                fromLocalPath(local_uri),
            ])
        );
    }));
}
