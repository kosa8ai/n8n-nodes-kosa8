# n8n-nodes-kosa8

This is an n8n community node for [kosa8 Cloud](https://kosa8.com). It lets your n8n workflows and AI agents run commands and move files in kosa8 Cloud sandboxes: sealed Linux microVMs you create, use and delete through the [kosa8 Cloud API](https://docs.kosa8.com/guides/cloud/).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Using it as an AI agent tool](#using-it-as-an-ai-agent-tool)
- [Example workflow](#example-workflow)
- [Errors](#errors)
- [Compatibility](#compatibility)
- [Pricing](#pricing)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation:

1. In n8n, open **Settings > Community Nodes**.
2. Select **Install**, enter `n8n-nodes-kosa8`, and confirm.

The package has no runtime dependencies.

## Credentials

The node uses a **Kosa8 Cloud API** credential (n8n requires credential names in title case):

1. Sign in to kosa8 Cloud and create an API key at <https://app.kosa8.com/app#keys>. Keys start with `k8c_live_`.
2. In n8n, create a new credential of type **Kosa8 Cloud API**.
3. Paste the key into **API Key**. Leave **Base URL** at `https://api.kosa8.com` unless kosa8 gave you another address.
4. Save. n8n checks the key with `GET /v1/templates`.

The key is sent as `Authorization: Bearer <key>`. Give it the `sandboxes:read` and `sandboxes:write` scopes (or a scope that includes them).

## Operations

### Sandbox

| Operation | What it does |
| --- | --- |
| **Create** | Creates a sandbox and waits until it is running. Choose a **Template** (or the organization default) and, under **Options**: **Name**, **Size** (2x4, 4x8, 8x16 or 16x32 vCPU x GiB), **Region**, **Delete After (Seconds)** (60 s to 90 days), **Sleep After (Seconds)**, **Environment Variables**, **Persistent**, **Repository** (a GitHub repo as `owner/name` or `owner/name@ref`, cloned into `/workspace/<name>`), and **Wait Timeout (Seconds)**. A sized sandbox boots cold and can take longer; the node polls until it is running. |
| **Get** | Returns one sandbox. |
| **Get Many** | Lists sandboxes, newest first, with **Return All** / **Limit** and filters for **Name** and **Include Deleted**. |
| **Delete** | Deletes a sandbox permanently, with its files. Returns `{ "deleted": true }`. |
| **Sleep** | Snapshots a sandbox and frees its memory. It wakes on the next command or file call. |
| **Wake** | Restores a sleeping sandbox now. |
| **Execute Command** | Runs a command and returns `stdout`, `stderr` and `exit_code`. **Command Type** is either **Shell Command** (one line run with `sh -c`, so pipes, `&&` and variables work) or **Arguments** (the program and each argument separately, no shell). Set **Timeout (Seconds)** (a command that waits for its answer runs at most 90 s), per-command **Environment Variables**, **Fail on Non-Zero Exit Code**, and **Run in Background** for longer commands. |
| **Push Branch** | Commits everything that changed in the sandbox's GitHub repo and pushes it to a branch (**Branch**, default `kosa8/<sandbox short ID>`; **Commit Message**). Returns `branch`, `sha`, `compare_url` and `files_changed`. |
| **Open Pull Request** | Pushes as **Push Branch** does and opens a pull request: **Title**, **Body**, **Base Branch** (default the repo's default branch), **Branch**, **Draft** (on by default). Returns `number`, `url`, `branch` and `sha`. |
| **Get Background Command** | Returns the state, exit code and output so far of a command started with **Run in Background**. |

Get, Get Many, Create, Sleep and Wake have a **Simplify** switch (on by default) that returns the ten most useful fields: `id`, `name`, `state`, `template`, `region`, `cpus`, `mem_mb`, `created_at`, `delete_after`, `cost_usd`. Turn it off for the full sandbox record.

### File

Paths are absolute, or relative to `/workspace`. `/workspace` is the sandbox's working folder; it is kept when the sandbox sleeps.

| Operation | What it does |
| --- | --- |
| **Read** | Downloads a file and puts it in a binary field (default `data`), ready for other nodes. |
| **Write** | Uploads a file. **Input Type** is **Binary File** (from a binary field of the input item) or **Text** (UTF-8). Options: **Append**, **Permissions** (octal, like `644`). |
| **List** | Lists a folder (default `/workspace`): one item per file or folder, with `name`, `path`, `type`, `size`, `mode` and `mod_time`. |
| **Delete** | Deletes a file, or a folder with **Recursive**. Returns `{ "deleted": true }`. |

Pick the sandbox from a list, or give its ID (`sbx_…`), usually by expression from an earlier **Create** step: `{{ $('Create Sandbox').item.json.id }}`.

### GitHub repos

Connect GitHub once in kosa8 Cloud (an admin, at <https://app.kosa8.com/auth/github/connect>) and pick the repos kosa8 may use. Then **Create** with **Repository** starts a sandbox from a repo, and **Push Branch** / **Open Pull Request** send the changes back. kosa8 makes a GitHub token for that one repo and that one operation, valid for at most an hour; the token never enters the sandbox, and every use is in the audit log. See <https://docs.kosa8.com/guides/cloud-github/>.

### Autopilot

Autopilot bots watch your sandboxes, spend and agents and act on what they see. From n8n you can read them and run them; turning a bot on and answering approvals stay with a person in kosa8 (<https://app.kosa8.com/app#autopilot>), Slack or a signed link.

| Operation | What it does |
| --- | --- |
| **List Bots** | One item per bot: `id`, `name`, `state` (draft, on, paused, ...), `template`, `last_run`, `spent_usd`, ... |
| **Run Bot** | Runs a bot now. **Dry Run** (on by default) reports what it would do now and over the last 7 days, changes nothing and is never billed. Turn it off for a real run (the bot must be on). Returns the run. |
| **List Runs** | A bot's runs, newest first (**Limit**, up to 100). |
| **Get Run** | One run (`brun_...`) with its steps, cost and outcome. |
| **List Pending Approvals** | Risky (T3) bot steps waiting for a person: `action`, `args`, `rationale`, `expires_at`. Read-only: there is no approve or reject operation, by design. |

## Trigger

The **kosa8 Cloud Trigger** node starts a workflow when a kosa8 event arrives:

- **Bot Run Finished** (`bot.run.finished`: `bot_id`, `run_id`, `state`)
- **Approval Needed** (`bot.approval.requested`: `approval_id`, `bot_id`, `action`, `args`)

When the workflow is activated the node registers its webhook URL with kosa8 (`POST /v1/webhooks`) and keeps the signing secret; it removes the webhook when the workflow is deactivated. Every delivery's `Kosa8-Signature` is checked (HMAC-SHA256, at most 5 minutes old) and a bad one is answered 401. The webhook URL must be public https (kosa8 refuses localhost and private addresses), and the API key needs the `admin` scope to manage webhooks. Under **Options**, **Bot ID** limits it to one bot. Use **Approval Needed** to tell people where to approve (a chat message, a ticket); the approval itself is made by a person in kosa8, Slack or the signed link.

## Using it as an AI agent tool

The node is marked `usableAsTool`, so you can attach it to n8n's **AI Agent** node as a tool. An agent can then create a sandbox, run code in it, read and write files, and delete the sandbox when it is done. Setting **Delete After (Seconds)** on Create is a good guard so a sandbox an agent forgets is removed on its own.

## Example workflow

Manual Trigger → **Create** → **Execute Command** (`echo hello && uname -a`) → **Write** (`/workspace/n8n-hello.txt`) → **Read** → **List** (`/workspace`) → **Delete**.

Every node after Create uses `{{ $('Create Sandbox').item.json.id }}` as the sandbox ID. The Execute Command output looks like:

```json
{
  "sandbox_id": "sbx_…",
  "exit_code": 0,
  "stdout": "hello\nLinux kosa8-guest 6.18.35 #1 SMP … x86_64 Linux\n",
  "stderr": ""
}
```

## Errors

The node shows kosa8 Cloud's own `message` for a failed call, with what to do next:

- **401**: the API key is wrong or revoked. Create a new one at <https://app.kosa8.com/app#keys>.
- **402**: no plan, a plan limit, a failed payment or the spending cap. The node shows kosa8's `agent_message` and the `upgrade_url` where you can fix it.
- **404**: the sandbox or path does not exist.
- **429**: too many requests (retried for you, honouring `Retry-After`) or too many active sandboxes (`quota_exceeded`: delete sandboxes you no longer need).
- **409 `github_not_connected`**: connect GitHub first; the node shows where. **409 `github_permissions`**: the kosa8 GitHub App needs the permissions listed; approve them at the link shown. **409 `no_changes`**: nothing to push. **404 `repo_not_found`**: the repo is not in your GitHub connection.
- **504 `exec_timeout`**: a command ran past its timeout or the 90 s limit. Use **Run in Background** for long commands.

Turn on the node's **On Error > Continue** setting to get the message in the output instead of stopping the workflow.

## Compatibility

Built with `@n8n/node-cli` and tested against n8n 2.48.4 on Node.js 22.

## Pricing

kosa8 Cloud is a paid service; plans start at $29 a month. See <https://kosa8.com/pricing/>.

## Resources

- [kosa8 Cloud guide](https://docs.kosa8.com/guides/cloud/)
- [kosa8 docs](https://docs.kosa8.com/)
- [kosa8 Cloud API reference (OpenAPI)](https://api.kosa8.com/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
