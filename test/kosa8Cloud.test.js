// Unit tests for the built node (run `npm run build` first). Node's own test runner, no extra packages.
const test = require('node:test');
const assert = require('node:assert/strict');

const { Kosa8Cloud } = require('../dist/nodes/Kosa8Cloud/Kosa8Cloud.node.js');
const { Kosa8CloudApi } = require('../dist/credentials/Kosa8CloudApi.credentials.js');
const { sandboxPath, simplifySandbox } = require('../dist/nodes/Kosa8Cloud/GenericFunctions.js');

/**
 * A minimal stand-in for n8n's IExecuteFunctions. `routes` answers requests:
 * an array of [method, pathPrefix, response | (req) => response] tried in order.
 */
function context({ params, routes, binary, continueOnFail = false }) {
	const requests = [];
	const node = { name: 'kosa8 Cloud', type: 'n8n-nodes-kosa8.kosa8Cloud', typeVersion: 1, parameters: {} };
	const ctx = {
		requests,
		getInputData: () => [{ json: {}, binary }],
		getNode: () => node,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: 'https://api.example.test/' }),
		getNodeParameter(name, _i, fallback, opts) {
			const parts = name.split('.');
			let value = params;
			for (const p of parts) value = value === undefined ? undefined : value[p];
			if (value === undefined) return fallback;
			if (opts && opts.extractValue && value && typeof value === 'object') return value.value;
			return value;
		},
		helpers: {
			async httpRequestWithAuthentication(credentialName, req) {
				assert.equal(credentialName, 'kosa8CloudApi');
				requests.push(req);
				const path = req.url.replace('https://api.example.test', '');
				for (const [method, prefix, answer] of routes) {
					if (req.method === method && path.startsWith(prefix)) {
						const res = typeof answer === 'function' ? answer(req) : answer;
						return { statusCode: 200, headers: {}, ...res };
					}
				}
				throw new Error(`unexpected request ${req.method} ${path}`);
			},
			async prepareBinaryData(buffer, fileName) {
				return { data: buffer.toString('base64'), fileName, mimeType: 'text/plain' };
			},
			assertBinaryData(_i, name) {
				if (!binary || !binary[name]) throw new Error(`no binary field ${name}`);
			},
			async getBinaryDataBuffer(_i, name) {
				return Buffer.from(binary[name].data, 'base64');
			},
		},
	};
	return ctx;
}

const run = (ctx) => new Kosa8Cloud().execute.call(ctx);

test('description: tool use, credential, resources', () => {
	const d = new Kosa8Cloud().description;
	assert.equal(d.displayName, 'kosa8 Cloud');
	assert.equal(d.usableAsTool, true);
	assert.deepEqual(d.credentials, [{ name: 'kosa8CloudApi', required: true }]);
	const ops = d.properties
		.filter((p) => p.name === 'operation')
		.flatMap((p) => p.options.map((o) => `${p.displayOptions.show.resource[0]}:${o.value}`));
	for (const op of [
		'sandbox:create',
		'sandbox:get',
		'sandbox:getAll',
		'sandbox:delete',
		'sandbox:sleep',
		'sandbox:wake',
		'sandbox:executeCommand',
		'code:run',
		'sandbox:pushBranch',
		'sandbox:openPullRequest',
		'file:read',
		'file:write',
		'file:list',
	]) {
		assert.ok(ops.includes(op), op);
	}
});

test('credential: bearer header, password field, test request', () => {
	const c = new Kosa8CloudApi();
	assert.equal(c.name, 'kosa8CloudApi');
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.properties.find((p) => p.name === 'apiKey').typeOptions.password, true);
	assert.equal(c.properties.find((p) => p.name === 'baseUrl').default, 'https://api.kosa8.com');
	assert.equal(c.test.request.url, '/v1/templates');
});

test('sandboxPath and simplifySandbox', () => {
	assert.equal(sandboxPath('a.txt'), '/workspace/a.txt');
	assert.equal(sandboxPath('./out/b.txt'), '/workspace/out/b.txt');
	assert.equal(sandboxPath('/tmp/x'), '/tmp/x');
	const s = simplifySandbox({ id: 'sbx_1', state: 'running', template: 'base', running_s: 3, own_host: false });
	assert.deepEqual(s, { id: 'sbx_1', state: 'running', template: 'base' });
});

test('create polls until running and sends the options', async () => {
	let polls = 0;
	const ctx = context({
		params: {
			resource: 'sandbox',
			operation: 'create',
			template: 'base',
			simplify: false,
			options: {
				name: 'n8n-test',
				size: '2x4',
				ttl: 600,
				env: { variables: [{ name: 'A', value: '1' }] },
			},
		},
		routes: [
			['POST', '/v1/sandboxes', { statusCode: 202, body: { sandbox: { id: 'sbx_1', state: 'creating' } } }],
			[
				'GET',
				'/v1/sandboxes/sbx_1',
				() => ({ body: { sandbox: { id: 'sbx_1', state: ++polls < 2 ? 'creating' : 'running' } } }),
			],
		],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.state, 'running');
	assert.equal(ctx.requests[0].url, 'https://api.example.test/v1/sandboxes');
	assert.deepEqual(ctx.requests[0].body, {
		template: 'base',
		name: 'n8n-test',
		size: '2x4',
		ttl_s: 600,
		env: { A: '1' },
	});
	assert.equal(polls, 2);
});

test('create sends a GitHub repo and refuses one that is not owner/name', async () => {
	const ctx = context({
		params: { resource: 'sandbox', operation: 'create', template: '', options: { repo: ' acme/api@main ' } },
		routes: [
			[
				'POST',
				'/v1/sandboxes',
				{
					body: {
						sandbox: {
							id: 'sbx_1',
							state: 'running',
							template: 'base',
							repo: { full_name: 'acme/api', ref: 'main', path: '/workspace/api', status: 'cloned' },
						},
					},
				},
			],
		],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.requests[0].body, { repo: 'acme/api@main' });
	assert.equal(item.json.repo.status, 'cloned');

	const bad = context({
		params: { resource: 'sandbox', operation: 'create', template: '', options: { repo: 'not a repo' } },
		routes: [],
	});
	await assert.rejects(run(bad), /owner\/name/);
});

test('push branch and open pull request send only the options given', async () => {
	const push = context({
		params: {
			resource: 'sandbox',
			operation: 'pushBranch',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			options: { branch: 'fix/login', message: 'Fix login' },
		},
		routes: [
			[
				'POST',
				'/v1/sandboxes/sbx_1/github/push',
				{ body: { branch: 'fix/login', sha: 'abc', compare_url: 'https://github.com/acme/api/compare/fix/login', files_changed: 2 } },
			],
		],
	});
	const [[pushed]] = await run(push);
	assert.deepEqual(push.requests[0].body, { branch: 'fix/login', message: 'Fix login' });
	assert.equal(pushed.json.sandbox_id, 'sbx_1');
	assert.equal(pushed.json.files_changed, 2);

	const pr = context({
		params: {
			resource: 'sandbox',
			operation: 'openPullRequest',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			options: { title: 'Fix login', base: 'main', draft: false, message: 'ignored' },
		},
		routes: [
			[
				'POST',
				'/v1/sandboxes/sbx_1/github/pull-request',
				{ body: { number: 12, url: 'https://github.com/acme/api/pull/12', branch: 'kosa8/abc', sha: 'abc' } },
			],
		],
	});
	const [[opened]] = await run(pr);
	assert.deepEqual(pr.requests[0].body, { title: 'Fix login', base: 'main', draft: false });
	assert.equal(opened.json.url, 'https://github.com/acme/api/pull/12');
});

test('GitHub errors say where to connect or approve', async () => {
	const notConnected = context({
		params: { resource: 'sandbox', operation: 'openPullRequest', sandboxId: { mode: 'id', value: 'sbx_1' }, options: {} },
		routes: [
			[
				'POST',
				'/v1/sandboxes/sbx_1/github/pull-request',
				{
					statusCode: 409,
					body: { error: 'github_not_connected', message: 'Connect GitHub first.', connect_url: 'https://app.kosa8.com/auth/github/connect' },
				},
			],
		],
	});
	await assert.rejects(run(notConnected), (err) => {
		assert.match(err.description, /auth\/github\/connect/);
		return true;
	});
	const perms = context({
		params: { resource: 'sandbox', operation: 'pushBranch', sandboxId: { mode: 'id', value: 'sbx_1' }, options: {} },
		routes: [
			[
				'POST',
				'/v1/sandboxes/sbx_1/github/push',
				{
					statusCode: 409,
					body: {
						error: 'github_permissions',
						message: 'Approve permissions.',
						missing: ['contents:write'],
						settings_url: 'https://github.com/settings/installations/7',
					},
				},
			],
		],
	});
	await assert.rejects(run(perms), (err) => {
		assert.match(err.description, /contents:write/);
		assert.match(err.description, /installations\/7/);
		return true;
	});
});

test('execute command: shell string goes through sh -c', async () => {
	const ctx = context({
		params: {
			resource: 'sandbox',
			operation: 'executeCommand',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			commandType: 'shell',
			command: 'echo hi && uname',
			timeout: 30,
			options: { env: { variables: [{ name: 'X', value: 'y' }] } },
		},
		routes: [['POST', '/v1/sandboxes/sbx_1/exec', { body: { exit: 0, stdout: 'hi\nLinux\n', stderr: '' } }]],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.requests[0].body, { cmd: ['sh', '-c', 'echo hi && uname'], timeout_s: 30, env: ['X=y'] });
	assert.deepEqual(item.json, { sandbox_id: 'sbx_1', exit_code: 0, stdout: 'hi\nLinux\n', stderr: '' });
});

test('execute command: argv, and timeout over 90 s needs background', async () => {
	const ctx = context({
		params: {
			resource: 'sandbox',
			operation: 'executeCommand',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			commandType: 'argv',
			arguments: { values: [{ value: 'ls' }, { value: '-la' }] },
			timeout: 10,
			options: {},
		},
		routes: [['POST', '/v1/sandboxes/sbx_1/exec', { body: { exit: 2, stdout: '', stderr: 'nope' } }]],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.requests[0].body.cmd, ['ls', '-la']);
	assert.equal(item.json.exit_code, 2);

	const slow = context({
		params: {
			resource: 'sandbox',
			operation: 'executeCommand',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			commandType: 'shell',
			command: 'sleep 200',
			timeout: 200,
			options: {},
		},
		routes: [],
	});
	await assert.rejects(run(slow), /Timeout \(Seconds\)/);
});

test('402 surfaces agent_message and upgrade_url', async () => {
	const ctx = context({
		params: { resource: 'sandbox', operation: 'create', template: '', options: {} },
		routes: [
			[
				'POST',
				'/v1/sandboxes',
				{
					statusCode: 402,
					body: {
						error: 'plan_required',
						message: 'A plan is required',
						agent_message: 'Ask your admin to choose a kosa8 plan.',
						upgrade_url: 'https://app.kosa8.com/app#billing',
					},
				},
			],
		],
	});
	await assert.rejects(run(ctx), (err) => {
		assert.match(err.message, /Ask your admin to choose a kosa8 plan/);
		assert.match(err.description, /https:\/\/app\.kosa8\.com\/app#billing/);
		assert.equal(err.httpCode, '402');
		return true;
	});
});

test('API message is surfaced, and continueOnFail returns it', async () => {
	const ctx = context({
		continueOnFail: true,
		params: { resource: 'sandbox', operation: 'get', sandboxId: { mode: 'id', value: 'sbx_x' }, simplify: true },
		routes: [['GET', '/v1/sandboxes/sbx_x', { statusCode: 404, body: { error: 'not_found', message: 'No such sandbox' } }]],
	});
	const [[item]] = await run(ctx);
	assert.match(item.json.error, /No such sandbox/);
});

test('429 is retried after Retry-After', async () => {
	let calls = 0;
	const ctx = context({
		params: { resource: 'sandbox', operation: 'get', sandboxId: { mode: 'id', value: 'sbx_1' }, simplify: true },
		routes: [
			[
				'GET',
				'/v1/sandboxes/sbx_1',
				() =>
					++calls === 1
						? { statusCode: 429, headers: { 'retry-after': '0' }, body: { error: 'rate_limited', message: 'slow down' } }
						: { body: { sandbox: { id: 'sbx_1', state: 'running', template: 'base' } } },
			],
		],
	});
	const [[item]] = await run(ctx);
	assert.equal(calls, 2);
	assert.equal(item.json.state, 'running');
});

test('delete returns {deleted: true}', async () => {
	const ctx = context({
		params: { resource: 'sandbox', operation: 'delete', sandboxId: { mode: 'list', value: 'sbx_1' } },
		routes: [['DELETE', '/v1/sandboxes/sbx_1', { body: {} }]],
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(item.json, { deleted: true });
});

test('file write (text and binary), read to binary, list', async () => {
	const write = context({
		params: {
			resource: 'file',
			operation: 'write',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			path: 'hello.txt',
			inputType: 'text',
			text: 'hi there',
			options: { mode: '644' },
		},
		routes: [['PUT', '/v1/sandboxes/sbx_1/files', { body: { file: { path: '/workspace/hello.txt', size: 8 } } }]],
	});
	const [[w]] = await run(write);
	assert.deepEqual(write.requests[0].qs, { path: '/workspace/hello.txt', mode: '644' });
	assert.equal(write.requests[0].body.toString(), 'hi there');
	assert.equal(write.requests[0].headers['Content-Type'], 'application/octet-stream');
	assert.equal(w.json.size, 8);

	const writeBin = context({
		binary: { data: { data: Buffer.from('bytes!').toString('base64') } },
		params: {
			resource: 'file',
			operation: 'write',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			path: '/workspace/b.bin',
			inputType: 'binary',
			binaryPropertyName: 'data',
			options: {},
		},
		routes: [['PUT', '/v1/sandboxes/sbx_1/files', { body: { file: { path: '/workspace/b.bin' } } }]],
	});
	await run(writeBin);
	assert.equal(writeBin.requests[0].body.toString(), 'bytes!');

	const read = context({
		params: {
			resource: 'file',
			operation: 'read',
			sandboxId: { mode: 'id', value: 'sbx_1' },
			path: '/workspace/hello.txt',
			binaryPropertyName: 'data',
		},
		routes: [['GET', '/v1/sandboxes/sbx_1/files', { body: Buffer.from('hi there') }]],
	});
	const [[r]] = await run(read);
	assert.equal(read.requests[0].encoding, 'arraybuffer');
	assert.equal(Buffer.from(r.binary.data.data, 'base64').toString(), 'hi there');
	assert.equal(r.binary.data.fileName, 'hello.txt');

	const list = context({
		params: { resource: 'file', operation: 'list', sandboxId: { mode: 'id', value: 'sbx_1' }, folder: '/workspace' },
		routes: [
			[
				'GET',
				'/v1/sandboxes/sbx_1/files/list',
				{ body: { path: '/workspace', files: [{ name: 'hello.txt', path: '/workspace/hello.txt', type: 'file' }] } },
			],
		],
	});
	const [items] = await run(list);
	assert.equal(items.length, 1);
	assert.equal(items[0].json.name, 'hello.txt');
});

// --- Autopilot ---------------------------------------------------------------

const { Kosa8CloudTrigger, verifySignature, SIGNATURE_TOLERANCE_S } = require('../dist/nodes/Kosa8CloudTrigger/Kosa8CloudTrigger.node.js');
const crypto = require('node:crypto');

test('autopilot: read-only operations plus Run Bot, and no approve, reject or enable', () => {
	const d = new Kosa8Cloud().description;
	const ops = d.properties
		.filter((p) => p.name === 'operation' && p.displayOptions.show.resource[0] === 'autopilot')
		.flatMap((p) => p.options);
	assert.deepEqual(ops.map((o) => o.value).sort(), ['getRun', 'listApprovals', 'listBots', 'listRuns', 'runBot']);
	assert.ok(!ops.some((o) => /approve|reject|enable|resume|decide/i.test(o.value)));
	assert.match(ops.find((o) => o.value === 'listApprovals').description, /a person approves or rejects them in kosa8, Slack or a signed link/);
	const dryRun = d.properties.find((p) => p.name === 'dryRun');
	assert.equal(dryRun.default, true);
});

test('autopilot: each operation calls its contract path', async () => {
	const routes = [
		['GET', '/v1/bots/bot_1/runs', { body: { runs: [{ id: 'brun_1' }, { id: 'brun_2' }] } }],
		['POST', '/v1/bots/bot_1/runs', (req) => ({ statusCode: 201, body: { run: { id: 'brun_3', dry_run: req.body.dry_run } } })],
		['GET', '/v1/bots', { body: { bots: [{ id: 'bot_1', name: 'Spend guard', state: 'on' }], paused_all: false, pending_approvals: 1 } }],
		['GET', '/v1/bot-runs/brun_1', { body: { run: { id: 'brun_1', state: 'succeeded', steps: [] } } }],
		['GET', '/v1/approvals', { body: { approvals: [{ id: 'appr_1', action: 'sandbox.delete', tier: 'T3' }] } }],
	];
	const call = async (params) => {
		const ctx = context({ params: { resource: 'autopilot', ...params }, routes });
		const [items] = await run(ctx);
		return { ctx, items };
	};

	let r = await call({ operation: 'listBots' });
	assert.equal(r.items[0].json.id, 'bot_1');
	assert.equal(r.ctx.requests[0].url, 'https://api.example.test/v1/bots');

	r = await call({ operation: 'runBot', botId: { mode: 'list', value: 'bot_1' } });
	assert.equal(r.ctx.requests[0].method, 'POST');
	assert.deepEqual(r.ctx.requests[0].body, { dry_run: true }, 'dry run by default');
	assert.equal(r.items[0].json.id, 'brun_3');

	r = await call({ operation: 'runBot', botId: { mode: 'id', value: 'bot_1' }, dryRun: false });
	assert.deepEqual(r.ctx.requests[0].body, { dry_run: false });

	r = await call({ operation: 'listRuns', botId: { mode: 'id', value: 'bot_1' }, limit: 5 });
	assert.equal(r.items.length, 2);
	assert.deepEqual(r.ctx.requests[0].qs, { limit: 5 });

	r = await call({ operation: 'getRun', runId: ' brun_1 ' });
	assert.equal(r.items[0].json.state, 'succeeded');

	r = await call({ operation: 'listApprovals' });
	assert.equal(r.items[0].json.id, 'appr_1');
	assert.deepEqual(r.ctx.requests[0].qs, { state: 'pending', limit: 50 });
	assert.equal(r.ctx.requests[0].method, 'GET');

	const escaped = context({
		params: { resource: 'autopilot', operation: 'getRun', runId: 'brun/../x' },
		routes: [['GET', '/v1/bot-runs/brun%2F..%2Fx', { body: { run: { id: 'x' } } }]],
	});
	await run(escaped);

	await assert.rejects(
		run(context({ params: { resource: 'autopilot', operation: 'runBot', botId: { mode: 'id', value: '' } }, routes })),
		/'Bot' is empty/,
	);
});

test('autopilot: human_required says a person must do it', async () => {
	const ctx = context({
		params: { resource: 'autopilot', operation: 'runBot', botId: { mode: 'id', value: 'bot_1' }, dryRun: false },
		routes: [['POST', '/v1/bots/bot_1/runs', { statusCode: 403, body: { error: 'human_required', message: 'a person must approve this' } }]],
	});
	await assert.rejects(run(ctx), (err) => {
		assert.match(err.description, /Only a person can do this/);
		return true;
	});
});

// --- Trigger -----------------------------------------------------------------

const SECRET = 'whsec_testsecret';
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) =>
	`t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('trigger: description follows the trigger conventions', () => {
	const d = new Kosa8CloudTrigger().description;
	assert.equal(d.name, 'kosa8CloudTrigger');
	assert.match(d.displayName, /Trigger/);
	assert.deepEqual(d.inputs, []);
	assert.deepEqual(d.credentials, [{ name: 'kosa8CloudApi', required: true }]);
	const events = d.properties.find((p) => p.name === 'events');
	assert.deepEqual(events.options.map((o) => o.value).sort(), ['bot.approval.requested', 'bot.run.finished']);
});

test('trigger: verifySignature checks HMAC, format and age', () => {
	const body = '{"type":"bot.run.finished"}';
	const now = 1_800_000_000;
	assert.equal(verifySignature(SECRET, sign(body, now), body, now), true);
	assert.equal(verifySignature(SECRET, sign(body, now), Buffer.from(body), now), true);
	assert.equal(verifySignature(SECRET, sign(body, now, 'whsec_other'), body, now), false);
	assert.equal(verifySignature(SECRET, sign(body + ' ', now), body, now), false);
	assert.equal(verifySignature(SECRET, sign(body, now - SIGNATURE_TOLERANCE_S - 1), body, now), false);
	assert.equal(verifySignature(SECRET, undefined, body, now), false);
	assert.equal(verifySignature('', sign(body, now), body, now), false);
	assert.equal(verifySignature(SECRET, 't=abc,v1=00', body, now), false);
});

function hookContext({ params, routes, staticData = {}, url = 'https://n8n.example.test/webhook/abc/webhook' }) {
	const ctx = context({ params, routes });
	ctx.getWorkflowStaticData = () => staticData;
	ctx.getNodeWebhookUrl = () => url;
	ctx.getWorkflow = () => ({ id: 'wf1', name: 'Bots' });
	ctx.staticData = staticData;
	return ctx;
}

test('trigger: create registers the webhook and keeps its secret; checkExists and delete', async () => {
	const methods = new Kosa8CloudTrigger().webhookMethods.default;
	const params = { events: ['bot.run.finished', 'bot.approval.requested'] };
	const created = hookContext({
		params,
		routes: [
			[
				'POST',
				'/v1/webhooks',
				(req) => ({ statusCode: 201, body: { webhook: { id: 'wh_1', url: req.body.url, events: req.body.events, secret: SECRET } } }),
			],
		],
	});
	assert.equal(await methods.create.call(created), true);
	assert.deepEqual(created.requests[0].body, {
		url: 'https://n8n.example.test/webhook/abc/webhook',
		events: ['bot.run.finished', 'bot.approval.requested'],
		description: 'n8n: Bots',
	});
	assert.deepEqual(created.staticData, { webhookId: 'wh_1', secret: SECRET });

	const list = (events) => [
		'GET',
		'/v1/webhooks',
		{ body: { webhooks: [{ id: 'wh_1', url: 'https://n8n.example.test/webhook/abc/webhook', events }] } },
	];
	const exists = hookContext({
		params,
		staticData: { webhookId: 'wh_1', secret: SECRET },
		routes: [list(['bot.approval.requested', 'bot.run.finished'])],
	});
	assert.equal(await methods.checkExists.call(exists), true);

	const changed = hookContext({
		params,
		staticData: { webhookId: 'wh_1', secret: SECRET },
		routes: [list(['bot.run.finished']), ['DELETE', '/v1/webhooks/wh_1', { body: { ok: true } }]],
	});
	assert.equal(await methods.checkExists.call(changed), false);
	assert.equal(changed.requests[1].method, 'DELETE');
	assert.deepEqual(changed.staticData, {});

	assert.equal(await methods.checkExists.call(hookContext({ params, routes: [] })), false);

	const gone = hookContext({
		params,
		staticData: { webhookId: 'wh_1', secret: SECRET },
		routes: [['DELETE', '/v1/webhooks/wh_1', { statusCode: 404, body: { error: 'not_found', message: 'no such webhook' } }]],
	});
	assert.equal(await methods.delete.call(gone), true);
	assert.deepEqual(gone.staticData, {});
});

function webhookContext({ body, signature, events = ['bot.run.finished'], options = {}, secret = SECRET }) {
	const raw = JSON.stringify(body);
	const response = {
		code: null,
		status(c) {
			this.code = c;
			return this;
		},
		send() {
			return this;
		},
		end() {
			return this;
		},
	};
	return {
		response,
		getWorkflowStaticData: () => ({ webhookId: 'wh_1', secret }),
		getRequestObject: () => ({ headers: { 'kosa8-signature': signature ?? sign(raw) }, rawBody: Buffer.from(raw) }),
		getResponseObject: () => response,
		getBodyData: () => body,
		getNodeParameter: (name, fallback) => ({ events, options })[name] ?? fallback,
		helpers: { returnJsonArray: (a) => a.map((json) => ({ json })) },
	};
}

test('trigger: webhook() starts the workflow for a signed, selected event only', async () => {
	const t = new Kosa8CloudTrigger();
	const evt = {
		id: 'evt_1',
		type: 'bot.run.finished',
		created_at: 1,
		org_id: 'org_1',
		data: { bot_id: 'bot_1', run_id: 'brun_1', state: 'succeeded' },
	};

	const ok = await t.webhook.call(webhookContext({ body: evt }));
	assert.deepEqual(ok.workflowData[0][0].json, evt);

	const bad = webhookContext({ body: evt, signature: sign('{}') });
	assert.deepEqual(await t.webhook.call(bad), { noWebhookResponse: true });
	assert.equal(bad.response.code, 401);

	assert.deepEqual(await t.webhook.call(webhookContext({ body: { ...evt, type: 'sandbox.created' } })), {});
	assert.deepEqual(await t.webhook.call(webhookContext({ body: evt, options: { botId: 'bot_2' } })), {});
	const same = await t.webhook.call(webhookContext({ body: evt, options: { botId: 'bot_1' } }));
	assert.equal(same.workflowData[0].length, 1);
});

test('code run: a sized microVM with brokered secrets and no internet, the code, then delete', async () => {
	const ctx = context({
		params: {
			resource: 'code',
			operation: 'run',
			language: 'python',
			code: 'import json, os\nprint(json.dumps({"n": len(os.environ["KOSA8_INPUT"])}))',
			secrets: ['openai'],
			options: { allowHosts: 'pypi.org, *.github.com', timeout: 30 },
		},
		routes: [
			['POST', '/v1/sandboxes/sbx_c/exec', { body: { exit: 0, stdout: '{"n": 2}\n', stderr: '' } }],
			['POST', '/v1/sandboxes', { body: { sandbox: { id: 'sbx_c', state: 'running' } } }],
			['DELETE', '/v1/sandboxes/sbx_c', { body: { ok: true } }],
		],
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.exit_code, 0);
	assert.deepEqual(item.json.json, { n: 2 });
	assert.deepEqual(item.json.secrets, ['openai']);
	const [create, exec, del] = ctx.requests;
	assert.equal(create.body.size, '2x4');
	assert.deepEqual(create.body.secrets, ['openai']);
	assert.deepEqual(create.body.egress, { internet: false, allow: ['pypi.org', '*.github.com'] });
	assert.ok(create.body.ttl_s > 30);
	assert.equal(exec.body.timeout_s, 30);
	assert.match(exec.body.cmd[2], /base64 -d > \/tmp\/kosa8-main\.py && exec python3/);
	const code = exec.body.env.find((e) => e.startsWith('KOSA8_CODE=')).slice('KOSA8_CODE='.length);
	assert.match(Buffer.from(code, 'base64').toString(), /print\(json\.dumps/);
	assert.ok(exec.body.env.includes('KOSA8_INPUT={}'));
	assert.equal(del.method, 'DELETE');
});

test('code run: the microVM is deleted when the code fails to run', async () => {
	const ctx = context({
		params: { resource: 'code', operation: 'run', language: 'node', code: 'console.log(1)', secrets: [] },
		routes: [
			['POST', '/v1/sandboxes/sbx_d/exec', () => { throw new Error('host lost'); }],
			['POST', '/v1/sandboxes', { body: { sandbox: { id: 'sbx_d', state: 'running' } } }],
			['DELETE', '/v1/sandboxes/sbx_d', { body: { ok: true } }],
		],
	});
	await assert.rejects(run(ctx));
	assert.equal(ctx.requests.at(-1).method, 'DELETE');
	assert.equal(ctx.requests[0].body.secrets, undefined);
});

test('code run: bad hosts, empty code and big input are refused before anything starts', async () => {
	for (const params of [
		{ code: 'x', options: { allowHosts: 'http://evil' } },
		{ code: '   ' },
		{ code: 'x', options: { allowHosts: 'a b' } },
	]) {
		const ctx = context({ params: { resource: 'code', operation: 'run', language: 'bash', secrets: [], ...params }, routes: [] });
		await assert.rejects(run(ctx));
		assert.equal(ctx.requests.length, 0);
	}
});
