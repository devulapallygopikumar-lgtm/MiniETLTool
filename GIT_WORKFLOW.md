# Git: commit and push

Repo: `https://github.com/devulapallygopikumar-lgtm/MiniETLTool.git` (remote `origin`)
Branches: work on `development`; `main` is the stable branch.

## 1. Check where you are

```powershell
git status                 # what changed
git branch --show-current  # should print: development
```

If you're not on `development`: `git checkout development`

## 2. Review what you're about to commit

```powershell
git diff                   # unstaged changes
git diff --stat            # one line per file
```

Don't commit secrets: `backend/.env`, passwords, tokens. Check `git status` for
anything that shouldn't be there.

## 3. Stage

```powershell
git add -A                 # everything (new, changed, deleted)
# or pick files:
git add backend/app/routers/clients.py frontend/src/app/clients/page.tsx
```

## 4. Commit

```powershell
git commit -m "Add domains, clients and role-based access"
```

Message style used in this repo: short, imperative, no full stop
(e.g. "Add Docker Compose setup for local deployment").

## 5. Push

```powershell
git push origin development
```

First push of a new branch: `git push -u origin development` (the `-u` lets you
use plain `git push` afterwards).

## 6. Merge to main (when development is ready)

Safest is a pull request on GitHub: `development` -> `main`.

Or locally:

```powershell
git checkout main
git pull origin main
git merge development
git push origin main
git checkout development
```

## Everyday shortcuts

| Task | Command |
|---|---|
| See history | `git log --oneline -10` |
| Get others' changes | `git pull origin development` |
| Undo staging of a file | `git restore --staged <file>` |
| Discard edits to a file | `git restore <file>` (cannot be undone) |
| Fix last commit message (before pushing) | `git commit --amend -m "new message"` |

## If push is rejected

"Updates were rejected" means the remote has commits you don't:

```powershell
git pull --rebase origin development
git push origin development
```

Never use `git push --force` on `main`.
