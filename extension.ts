import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as util from 'node:util';
import * as vscode from 'vscode';
import { abort } from 'node:process';

const wrap = <T extends (...args: any[])=>Promise<any>>(f: T) => async (...args: Parameters<T>):Promise<Awaited<ReturnType<T>>> => {
    try {
        console.log(...args);
        return await f(...args);
    } catch (err) {
        vscode.window.showErrorMessage('Failed to run git command:', `${err}`);
        console.error('Failed to run git command:', err);
        throw err;
    }
};
const execFileUnguarded = util.promisify(child_process.execFile);
const execFile = wrap(execFileUnguarded) as unknown as typeof execFileUnguarded;

const SCHEME = 'icantbeleivegit';

async function getGitRootForFile(filePath: string) {
    return (await execFile('git', ['rev-parse', '--show-toplevel'], {
        cwd: path.dirname(filePath),
    })).stdout;
}

function toLocalPath(uri: vscode.Uri): string {
    console.assert(uri.scheme === SCHEME);
    console.assert(uri.query === '');
    console.assert(uri.fragment === '');
    return vscode.Uri.from({
        scheme: 'file',
        authority: uri.authority,
        path: uri.path,
    }).fsPath;
};

function fromLocalPath(uri: vscode.Uri): vscode.Uri {
    console.assert(uri.scheme === 'file');
    console.assert(uri.query === '');
    console.assert(uri.fragment === '');
    return vscode.Uri.from({
        scheme: SCHEME,
        authority: uri.authority,
        path: uri.path,
    });
};

class GitIndexWatcher extends vscode.Disposable {
    private readonly _listeners = new Set<() => void>();
    constructor(git_root: string) {
        const abort_controller = new AbortController();
        const index_changes = fs.watch(path.join(git_root, 'index'), {
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
                if (err && (err as {name:string}).name === 'AbortError') return;
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

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        throw new Error('Method not implemented.');
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
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
                const TYPE_MAP = {
                    'blob': vscode.FileType.File,
                    'tree': vscode.FileType.Directory,
                } as const;
                console.assert(Object.hasOwn(TYPE_MAP, object_type), `Unexpected type ${object_type}`);
                return [path, TYPE_MAP[object_type as keyof typeof TYPE_MAP]];
            });
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw new Error('GitIndexFS createDirectory not implemented.');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const local_path = toLocalPath(uri);
        const object_id = (await execFile('git', ['--literal-pathspecs', 'ls-files', '--cached', '--format=%(objectname)', local_path], {
            cwd: path.dirname(local_path),
        })).stdout.trim();
        return (await execFile('git', ['cat-file', 'blob', object_id], {
            cwd: path.dirname(local_path),
            encoding: 'buffer',
        })).stdout;
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean; }): Promise<void> {
        const proc = execFile('git', ['hash-object', '-w', '--stdin']);
        proc.child.stdin?.end(content);
        const object_id = (await proc).stdout.trim();
        const local_path = toLocalPath(uri);
        const mode = (await execFile('git',['--literal-pathspecs', 'ls-file', '--format=$(objectmode)', local_path])).stdout.trim() ?? '100644';
        await execFile('git', ['update-index', '--cacheinfo', [mode, object_id, local_path].join(',')]);
    }

    delete(uri: vscode.Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
        throw new Error('Method not implemented.');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
        throw new Error('Method not implemented.');
    }

    copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
        throw new Error('Method not implemented.');
    }
}

export function activate(context: vscode.ExtensionContext) {
    const indexFs = new GitIndexFS();
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
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.openIndexForCurrentFile', _ => {
        const current_local_path = vscode.window.activeTextEditor?.document.uri;
        if (!current_local_path) {
            vscode.window.showErrorMessage("Cannot open index for current file: There isn't an active text editor available");
            return;
        }
        if (current_local_path.scheme !== 'file') {
            vscode.window.showErrorMessage("Cannot open index for current file: Current file isn't a local file");
            return;
        }
        const git_index_path = fromLocalPath(current_local_path);
        vscode.workspace.openTextDocument(git_index_path);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('icantbelievegit.openIndexForPath', async _ => {
        const paths = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Select file",
            title: "Open an indexed version of a file",
        });
        if (!paths) {
            return;
        }
        if (paths[0].scheme !== 'file') {
            vscode.window.showErrorMessage("Cannot open index: Chosen path isn't a local file");
            return;
        }
        const git_index_path = fromLocalPath(paths[0]);
        vscode.workspace.openTextDocument(git_index_path);
    }));
}
