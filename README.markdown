# I can't believe (g)it's not a file!

Have you ever opened up a git diff of a file and wished "It would be really nice if I could directly edit the left side of the diff as a file"?

TODO: screen recording

Perhaps, were you a Vim user and you miss this functionality that the [vim-fugitive](https://dzx.fr/blog/introduction-to-vim-fugitive/#:~:text=Fortunately%2C%20one%20of%20Fugitive%27s%20killer%20features%20is%20being%20able%20to%20edit%20the%20content%20of%20the%20index%20directly.%20When%20dealing%20with%20lines%20where%20an%20inline%20diff%20isn%27t%20enough%2C%20you%20can%20open%20a%20full%20vertical%20diff%20between%20the%20worktree%20and%20the%20index%20by%20pressing%20dv%20over%20a%20file%20under%20the%20%22Unstaged%22%20section%3A) plugin supports?

Yes, `git add` already has a `--patch` flag for staging smaller blocks of the file. Yes, you can do stage individual blocks in VSCode as well. But, none of these is as powerful and as elegant as treating the staged version of the file as an editable file, where you can see the full file context and benefit from most of the existing features of your editor.

## But, why? Here are some usecases

I personally use this feature of vim-fugitive very regularly. Here are some typical situations I end up in where I find this useful.

- While working, I may have a lot of local temporary changes that are only there to help debugging. E.g. extra logging, etc. These changes may be intertwined with legitimate changes I wish to commit. 
- I may try to do a full rough prototype of some larger changes first, before going back and commiting the changes as a series of piecemeal/incremental commits.

In these cases, `git add -p` and friends would not be able to provide the level of granularity and ease of editing what I want to commit.

## Disclaimer: Not fully tested

The following areas haven't been looked at nor tested:
- Windows support
- Using this extnsion during a merge conflict resolution
- File mode changes
- Git clean/smudge filters
- Line-ending handling
- Remote files - only local files supported at the moment.
