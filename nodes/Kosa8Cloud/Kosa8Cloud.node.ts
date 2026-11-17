import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { fileFields, fileOperations } from './descriptions/FileDescription';
import { sandboxFields, sandboxOperations } from './descriptions/SandboxDescription';
import {
	kosa8ApiRequest,
	MAX_BUFFERED_EXEC_S,
	sandboxPath,
	sandboxUrl,
	simplifySandbox,
} from './GenericFunctions';

/** States a sandbox does not come back from. */
const FINAL_STATES = ['error', 'deleted', 'expired', 'host_removed', 'host_lost', 'stopped'];
const CREATE_POLL_MS = 1000;

interface EnvCollection {
	variables?: Array<{ name: string; value: string }>;
}

function envEntries(env: EnvCollection | undefined): Array<{ name: string; value: string }> {
	return (env?.variables ?? []).filter((v) => v.name && v.name.trim() !== '');
}

function basename(path: string): string {
	const parts = path.split('/').filter((p) => p !== '');
	return parts[parts.length - 1] ?? 'file';
}

export class Kosa8Cloud implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'kosa8 Cloud',
		name: 'kosa8Cloud',
		icon: { light: 'file:../../icons/kosa8.svg', dark: 'file:../../icons/kosa8.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Run commands and move files in kosa8 Cloud sandboxes (sealed Linux microVMs)',
		defaults: {
			name: 'kosa8 Cloud',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'kosa8CloudApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'File', value: 'file' },
					{ name: 'Sandbox', value: 'sandbox' },
				],
				default: 'sandbox',
			},
			...sandboxOperations,
			...sandboxFields,
			...fileOperations,
			...fileFields,
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await kosa8ApiRequest.call(this, 'GET', '/v1/templates')) as IDataObject;
				const templates = (response.templates as IDataObject[]) ?? [];
				const defaultTemplate = response.default_template as string | undefined;
				const options: INodePropertyOptions[] = [
					{
						name: defaultTemplate
							? `Organization Default (${defaultTemplate})`
							: 'Organization Default',
						value: '',
					},
				];
				for (const t of templates) {
					const key = t.key as string;
					const size =
						t.cpus !== undefined && t.mem_mb !== undefined
							? `${t.cpus} vCPU, ${Math.round((t.mem_mb as number) / 1024)} GiB`
							: undefined;
					options.push({
						name: key,
						value: key,
						description: [size, t.image ? `image ${t.image as string}` : undefined]
							.filter(Boolean)
							.join(', '),
					});
				}
				return options;
			},
		},
		listSearch: {
			async searchSandboxes(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const qs: IDataObject = { limit: 100 };
				if (paginationToken) qs.cursor = paginationToken;
				const response = (await kosa8ApiRequest.call(this, 'GET', '/v1/sandboxes', {
					qs,
				})) as IDataObject;
				const needle = (filter ?? '').toLowerCase();
				const results = ((response.sandboxes as IDataObject[]) ?? [])
					.filter((s) => {
						if (!needle) return true;
						const id = String(s.id ?? '').toLowerCase();
						const name = String(s.name ?? '').toLowerCase();
						return id.includes(needle) || name.includes(needle);
					})
					.map((s) => ({
						name: `${(s.name as string) || (s.id as string)} (${s.state as string}, ${s.template as string})`,
						value: s.id as string,
					}));
				return {
					results,
					paginationToken: (response.next_cursor as string | null) ?? undefined,
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'sandbox') {
					returnData.push(...(await sandboxOperation.call(this, operation, i)));
				} else if (resource === 'file') {
					returnData.push(...(await fileOperation.call(this, operation, i)));
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource '${resource}'`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					// Already carries the API's message and status; n8n hands the same error back.
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

function out(json: IDataObject | IDataObject[], i: number): INodeExecutionData[] {
	const list = Array.isArray(json) ? json : [json];
	return list.map((j) => ({ json: j, pairedItem: { item: i } }));
}

async function sandboxOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const simplify = (s: IDataObject): IDataObject =>
		(this.getNodeParameter('simplify', i, true) as boolean) ? simplifySandbox(s) : s;

	if (operation === 'create') {
		const template = this.getNodeParameter('template', i, '') as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const body: IDataObject = {};
		if (template) body.template = template;
		if (options.name) body.name = options.name;
		if (options.size) body.size = options.size;
		if (options.region) body.region = options.region;
		if (options.ttl !== undefined) body.ttl_s = options.ttl;
		if (options.sleepAfter !== undefined) body.sleep_after_s = options.sleepAfter;
		if (options.persistent) body.persistent = true;
		const env = envEntries(options.env as EnvCollection);
		if (env.length) {
			body.env = Object.fromEntries(env.map((v) => [v.name.trim(), v.value]));
		}

		const created = (await kosa8ApiRequest.call(this, 'POST', '/v1/sandboxes', {
			body,
			itemIndex: i,
			timeout: 120_000,
		})) as IDataObject;
		let sandbox = (created.sandbox as IDataObject) ?? created;
		const id = sandbox.id as string;
		const waitTimeoutMs = ((options.waitTimeout as number | undefined) ?? 300) * 1000;
		const deadline = Date.now() + waitTimeoutMs;

		while (sandbox.state !== 'running') {
			if (FINAL_STATES.includes(sandbox.state as string)) {
				throw new NodeOperationError(
					this.getNode(),
					`Sandbox ${id} stopped starting: state '${sandbox.state as string}'`,
					{
						itemIndex: i,
						description:
							(sandbox.last_error as string) || 'Try again, or choose another template or size.',
					},
				);
			}
			if (Date.now() > deadline) {
				throw new NodeOperationError(
					this.getNode(),
					`Sandbox ${id} was not running after ${waitTimeoutMs / 1000} s (state '${sandbox.state as string}')`,
					{
						itemIndex: i,
						description:
							"Raise 'Wait Timeout (Seconds)', or delete the sandbox with the 'Delete' operation if you no longer need it.",
					},
				);
			}
			await sleep(CREATE_POLL_MS);
			const got = (await kosa8ApiRequest.call(this, 'GET', sandboxUrl(id), {
				itemIndex: i,
			})) as IDataObject;
			sandbox = (got.sandbox as IDataObject) ?? got;
		}
		return out(simplify(sandbox), i);
	}

	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const results: IDataObject[] = [];
		let cursor: string | undefined;
		do {
			const qs: IDataObject = {
				limit: Math.min(500, Number.isFinite(limit) ? limit - results.length : 500),
			};
			if (cursor) qs.cursor = cursor;
			if (filters.name) qs.name = filters.name;
			if (filters.includeDeleted) qs.all = '1';
			const page = (await kosa8ApiRequest.call(this, 'GET', '/v1/sandboxes', {
				qs,
				itemIndex: i,
			})) as IDataObject;
			results.push(...((page.sandboxes as IDataObject[]) ?? []));
			cursor = (page.next_cursor as string | null) ?? undefined;
		} while (cursor && results.length < limit);
		return out(results.slice(0, limit).map(simplify), i);
	}

	const id = this.getNodeParameter('sandboxId', i, '', { extractValue: true }) as string;
	if (!id) {
		throw new NodeOperationError(this.getNode(), "'Sandbox' is empty", {
			itemIndex: i,
			description: 'Choose a sandbox from the list, or give its ID (sbx_...).',
		});
	}

	if (operation === 'get') {
		const got = (await kosa8ApiRequest.call(this, 'GET', sandboxUrl(id), {
			itemIndex: i,
		})) as IDataObject;
		return out(simplify((got.sandbox as IDataObject) ?? got), i);
	}

	if (operation === 'delete') {
		await kosa8ApiRequest.call(this, 'DELETE', sandboxUrl(id), { itemIndex: i });
		return out({ deleted: true }, i);
	}

	if (operation === 'sleep' || operation === 'wake') {
		const got = (await kosa8ApiRequest.call(this, 'POST', sandboxUrl(id, `/${operation}`), {
			itemIndex: i,
			timeout: 120_000,
		})) as IDataObject;
		return out(simplify((got.sandbox as IDataObject) ?? got), i);
	}

	if (operation === 'executeCommand') {
		const commandType = this.getNodeParameter('commandType', i) as string;
		const timeout = this.getNodeParameter('timeout', i) as number;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const background = options.background === true;

		let cmd: string[];
		if (commandType === 'argv') {
			const args = this.getNodeParameter('arguments.values', i, []) as Array<{ value: string }>;
			cmd = args.map((a) => a.value);
			if (!cmd.length || !cmd[0]) {
				throw new NodeOperationError(this.getNode(), "'Arguments' is empty", {
					itemIndex: i,
					description: 'Add the program to run as the first argument.',
				});
			}
		} else {
			const command = this.getNodeParameter('command', i) as string;
			if (!command.trim()) {
				throw new NodeOperationError(this.getNode(), "'Command' is empty", {
					itemIndex: i,
					description: 'Type the shell command to run.',
				});
			}
			cmd = ['sh', '-c', command];
		}

		if (!background && timeout > MAX_BUFFERED_EXEC_S) {
			throw new NodeOperationError(
				this.getNode(),
				`'Timeout (Seconds)' is ${timeout}, above the ${MAX_BUFFERED_EXEC_S} s a command can wait for its answer`,
				{
					itemIndex: i,
					description: `Set 'Timeout (Seconds)' to ${MAX_BUFFERED_EXEC_S} or less, or turn on 'Run in Background' and read the result with 'Get Background Command'.`,
				},
			);
		}

		const body: IDataObject = { cmd, timeout_s: timeout };
		const env = envEntries(options.env as EnvCollection);
		if (env.length) body.env = env.map((v) => `${v.name.trim()}=${v.value}`);
		if (background) body.background = true;

		const result = (await kosa8ApiRequest.call(this, 'POST', sandboxUrl(id, '/exec'), {
			body,
			itemIndex: i,
			timeout: background ? 120_000 : (timeout + 60) * 1000,
		})) as IDataObject;

		if (background) {
			const exec = (result.exec as IDataObject) ?? result;
			return out({ sandbox_id: id, ...exec }, i);
		}

		const exitCode = result.exit as number | null;
		if (options.failOnNonZeroExit === true && exitCode !== 0) {
			const stderr = String(result.stderr ?? '').trim();
			throw new NodeOperationError(
				this.getNode(),
				`The command exited with code ${exitCode === null ? 'unknown' : exitCode}`,
				{
					itemIndex: i,
					description: stderr
						? stderr.slice(-1000)
						: "Turn off 'Fail on Non-Zero Exit Code' to get the output anyway.",
				},
			);
		}
		const json: IDataObject = {
			sandbox_id: id,
			exit_code: exitCode,
			stdout: result.stdout ?? '',
			stderr: result.stderr ?? '',
		};
		if (result.stdout_truncated) json.stdout_truncated = true;
		if (result.stderr_truncated) json.stderr_truncated = true;
		return out(json, i);
	}

	if (operation === 'getBackgroundCommand') {
		const execId = (this.getNodeParameter('execId', i) as string).trim();
		if (!execId) {
			throw new NodeOperationError(this.getNode(), "'Background Command ID' is empty", {
				itemIndex: i,
				description: "Use the 'id' that 'Execute Command' returned with 'Run in Background' on.",
			});
		}
		const got = (await kosa8ApiRequest.call(
			this,
			'GET',
			sandboxUrl(id, `/exec/${encodeURIComponent(execId)}`),
			{ itemIndex: i },
		)) as IDataObject;
		const exec = (got.exec as IDataObject) ?? got;
		return out({ sandbox_id: id, ...exec, exit_code: exec.exit ?? null }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation '${operation}'`, {
		itemIndex: i,
	});
}

async function fileOperation(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const id = this.getNodeParameter('sandboxId', i, '', { extractValue: true }) as string;
	if (!id) {
		throw new NodeOperationError(this.getNode(), "'Sandbox' is empty", {
			itemIndex: i,
			description: 'Choose a sandbox from the list, or give its ID (sbx_...).',
		});
	}

	if (operation === 'list') {
		const folder = sandboxPath(
			(this.getNodeParameter('folder', i, '/workspace') as string) || '/workspace',
		);
		const got = (await kosa8ApiRequest.call(this, 'GET', sandboxUrl(id, '/files/list'), {
			qs: { path: folder },
			itemIndex: i,
		})) as IDataObject;
		const files = (got.files as IDataObject[]) ?? [];
		return out(
			files.map((f) => ({ sandbox_id: id, ...f })),
			i,
		);
	}

	const rawPath = this.getNodeParameter('path', i) as string;
	if (!rawPath || !rawPath.trim()) {
		throw new NodeOperationError(this.getNode(), "'Path' is empty", {
			itemIndex: i,
			description: 'Give the file path in the sandbox, for example /workspace/report.csv.',
		});
	}
	const path = sandboxPath(rawPath);

	if (operation === 'read') {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
		const data = (await kosa8ApiRequest.call(this, 'GET', sandboxUrl(id, '/files'), {
			qs: { path },
			binaryResponse: true,
			itemIndex: i,
			timeout: 300_000,
		})) as Buffer;
		const binary = await this.helpers.prepareBinaryData(data, basename(path));
		return [
			{
				json: { sandbox_id: id, path, size: data.length },
				binary: { [binaryPropertyName]: binary },
				pairedItem: { item: i },
			},
		];
	}

	if (operation === 'write') {
		const inputType = this.getNodeParameter('inputType', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		let data: Buffer;
		if (inputType === 'binary') {
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
			this.helpers.assertBinaryData(i, binaryPropertyName);
			data = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
		} else {
			data = Buffer.from(this.getNodeParameter('text', i, '') as string, 'utf8');
		}
		const qs: IDataObject = { path };
		if (options.append === true) qs.append = '1';
		const mode = typeof options.mode === 'string' ? options.mode.trim() : '';
		if (mode) {
			if (!/^[0-7]{3,4}$/.test(mode)) {
				throw new NodeOperationError(
					this.getNode(),
					`'Permissions' must be octal, like 644 or 755`,
					{
						itemIndex: i,
						description: `'${mode}' is not 3 or 4 octal digits.`,
					},
				);
			}
			qs.mode = mode;
		}
		const got = (await kosa8ApiRequest.call(this, 'PUT', sandboxUrl(id, '/files'), {
			qs,
			body: data,
			rawBody: true,
			itemIndex: i,
			timeout: 300_000,
		})) as IDataObject;
		const file = (got.file as IDataObject) ?? {};
		return out({ sandbox_id: id, path, size: data.length, ...file }, i);
	}

	if (operation === 'delete') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const qs: IDataObject = { path };
		if (options.recursive === true) qs.recursive = '1';
		await kosa8ApiRequest.call(this, 'DELETE', sandboxUrl(id, '/files'), { qs, itemIndex: i });
		return out({ deleted: true }, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation '${operation}'`, {
		itemIndex: i,
	});
}
