<div align="center">
  <h1>I can’t believe (g)it’s not a file!</h1>
  <p><i>a Visual Studio Code extension to directly edit what’s staged in git</i></p>
</div>

Have you ever opened up a git diff of a file and wished "It would be really nice if I [could](https://github.com/microsoft/vscode/issues/91065) directly [edit](https://github.com/microsoft/vscode/issues/91274) the [left](https://github.com/microsoft/vscode/issues/15785) side [of](https://github.com/microsoft/vscode/issues/33681) the diff"?

![Screencast](./screencast.gif)

Perhaps, were you a Vim user and you miss this functionality that the [vim-fugitive](https://dzx.fr/blog/introduction-to-vim-fugitive/#:~:text=Fortunately%2C%20one%20of%20Fugitive%27s%20killer%20features%20is%20being%20able%20to%20edit%20the%20content%20of%20the%20index%20directly.%20When%20dealing%20with%20lines%20where%20an%20inline%20diff%20isn%27t%20enough%2C%20you%20can%20open%20a%20full%20vertical%20diff%20between%20the%20worktree%20and%20the%20index%20by%20pressing%20dv%20over%20a%20file%20under%20the%20%22Unstaged%22%20section%3A) plugin supports?

Although, yes, `git add` already has a `--patch` flag for staging smaller blocks of the file and edit the patches, and yes, you can do stage individual blocks in VSCode as well. However, none of these are as powerful and as elegant as treating the staged version of the file as an editable file, where you can see the full file context and benefit from most of the existing features of your editor.

## Usage

| <kbd>Ctrl+Shift+P</kbd> Command | Description |
|----|----|
| `Git: Diff Current File (Editable)` | Just like `Git: Open Changes` but the left-hand side is now editable. Opens a diff comparison where the right side is the current file in your working directory, while the left side is the staged version of the file that will be commited. |
| `Git: Open Staged Changes (Editable)` | Just like `Git: Open Staged Changes` but the right hand side is now editable. It is similar to running `git diff --cached` and shows all the staged changes that will be commited if you ran `git commit`. The diff windows will have the staged versions of the files on the right, and the current HEAD versions of the files on the left. |
| `Git: Open Staged File (Editable)` | Opens a dialog box for you to select a file to open the staged version for. |
| `Git: Open Staged Version of Current File (Editable)` | Opens a new editor (without any diffing) that shows you and allows you to edit what git has staged for the current file. |

## But, why? Here are some usecases

I personally use this feature of vim-fugitive all the time. Here are some typical situations I end up in where I find this useful.

- I regularly have a lot of local temporary changes that are only there to help debugging. E.g. extra logging, etc. These changes may be intertwined with legitimate changes I wish to commit.
- I may try to do a full rough prototype of some larger changes first, before going back and commiting the changes as a series of piecemeal/incremental commits.

In these cases, `git add -p` and friends would not be able to provide the level of granularity and ease of editing what I want to commit, and oftentimes I would reach outside of VS Code and open up Vim just so I can make the change I want.

## Disclaimer: Not fully tested

The following areas haven't been looked at nor tested:
- Windows support
- Using this extension during a merge conflict resolution
- File mode changes
- Git clean/smudge filters
- Line-ending handling
- Remote files - only local files supported at the moment.
- Watching the index for changes and automatically updating the editor.

## How it works

Using [Git Plumbing](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain) commands like `git hash-object`, `git ls-files`, `git cat-file` and `git update-index`, we have all the tools needed to (1) Read the objects pointed to by the index so we can present it to the user as a virtual file, (2) Generate our own objects when the user saves our virtual file, (3) Update the index with our new object.

## Inspiration Credits

Thank you to Tim Pope's legendary [fugitive](https://github.com/tpope/vim-fugitive) vim plugin from which I discovered this feature, and from which led me to appreciate how git works.

Thank you to bers for asking this question on Stack Overflow: https://stackoverflow.com/questions/62810963/why-cant-i-directly-edit-staged-changes-in-the-git-index-with-vs-code which motivated me to go ahead and make this extension.

Do you have a VS Code extension that does something similar? Or perhaps a different tool or a different plugin for a different editor? I'd love to know! Feel free to raise an issue or a PR and I'd be happy to include it here.

<sub>
<i>Icon: Uses duck image from https://pngimg.com/image/5019 (Attribution-NonCommercial 4.0 International (CC BY-NC 4.0))</i>
</sub>
