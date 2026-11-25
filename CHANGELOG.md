# Changelog

## Unreleased

- **Code** resource, **Run** operation: Python, JavaScript or Bash in a fresh microVM deleted after the run, with kosa8 secrets brokered (never inside the microVM), no internet unless listed, the item as `KOSA8_INPUT` and printed JSON parsed into `json`.
- **Autopilot** resource: **List Bots**, **Run Bot** (**Dry Run** on by default), **List Runs**, **Get Run** and **List Pending Approvals**. Read-only apart from Run Bot: there is no approve, reject or enable operation; a person answers approvals in kosa8, Slack or a signed link. A `human_required` refusal says so.
- **kosa8 Cloud Trigger** node: starts a workflow on `bot.run.finished` (Bot Run Finished) and `bot.approval.requested` (Approval Needed), optionally for one bot. It registers and removes its webhook through `/v1/webhooks` and checks every delivery's `Kosa8-Signature`.
- Sandbox **Create**: a **Repository** option (`owner/name` or `owner/name@ref`) starts the sandbox from a repo of the organization's connected GitHub, cloned into `/workspace/<name>`. Simplified output includes `repo`.
- Sandbox **Push Branch** and **Open Pull Request** operations: commit the changes in the sandbox's repo, push a branch and open a (draft) pull request. kosa8 uses a GitHub token for that one repo and operation; it never enters the sandbox.
- GitHub errors (`github_not_connected`, `github_permissions`, `repo_not_found`, `no_changes`, `github_unavailable`) say where to connect GitHub or approve permissions.

## 0.1.0

- First release: kosa8 Cloud sandboxes (create, get, list, delete, sleep, wake, execute command, background commands) and files (read, write, list, delete).
