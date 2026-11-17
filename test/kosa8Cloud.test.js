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
