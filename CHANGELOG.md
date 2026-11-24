# Changelog

## Unreleased

- Sandbox **Create**: a **Repository** option (`owner/name` or `owner/name@ref`) starts the sandbox from a repo of the organization's connected GitHub, cloned into `/workspace/<name>`. Simplified output includes `repo`.
- Sandbox **Push Branch** and **Open Pull Request** operations: commit the changes in the sandbox's repo, push a branch and open a (draft) pull request. kosa8 uses a GitHub token for that one repo and operation; it never enters the sandbox.
- GitHub errors (`github_not_connected`, `github_permissions`, `repo_not_found`, `no_changes`, `github_unavailable`) say where to connect GitHub or approve permissions.

## 0.1.0

- First release: kosa8 Cloud sandboxes (create, get, list, delete, sleep, wake, execute command, background commands) and files (read, write, list, delete).
