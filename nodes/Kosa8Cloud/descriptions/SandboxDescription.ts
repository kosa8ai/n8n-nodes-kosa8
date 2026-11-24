import type { INodeProperties } from 'n8n-workflow';

import { MAX_BUFFERED_EXEC_S } from '../GenericFunctions';

/** The 'Sandbox' field: pick one from a list, or give its ID. */
export function sandboxLocator(resource: string, operations: string[]): INodeProperties {
	return {
		displayName: 'Sandbox',
		name: 'sandboxId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The sandbox to use',
		displayOptions: { show: { resource: [resource], operation: operations } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a sandbox...',
				typeOptions: {
					searchListMethod: 'searchSandboxes',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. sbx_4Qm2abcd',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^sbx_[A-Za-z0-9_-]+$',
							errorMessage: 'A sandbox ID starts with sbx_',
						},
					},
				],
			},
		],
	};
}

const simplifyField = (operations: string[]): INodeProperties => ({
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a simplified version of the response instead of the raw data',
	displayOptions: { show: { resource: ['sandbox'], operation: operations } },
});

export const sandboxOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['sandbox'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new sandbox and wait until it is running',
				action: 'Create sandbox',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a sandbox permanently, with its files',
				action: 'Delete sandbox',
			},
			{
				name: 'Execute Command',
				value: 'executeCommand',
				description: 'Run a command in a sandbox and return its output and exit code',
				action: 'Execute command in sandbox',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a sandbox',
				action: 'Get sandbox',
			},
			{
				name: 'Get Background Command',
				value: 'getBackgroundCommand',
				description:
					'Retrieve the state, exit code and output of a command started in the background',
				action: 'Get background command in sandbox',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Retrieve a list of sandboxes',
				action: 'Get many sandboxes',
			},
			{
				name: 'Open Pull Request',
				value: 'openPullRequest',
				description:
					"Commit the changes in the sandbox's GitHub repo, push a branch and open a pull request",
				action: 'Open pull request from sandbox',
			},
			{
				name: 'Push Branch',
				value: 'pushBranch',
				description: "Commit the changes in the sandbox's GitHub repo and push them to a branch",
				action: 'Push branch from sandbox',
			},
			{
				name: 'Sleep',
				value: 'sleep',
				description: 'Snapshot a sandbox and free its memory until it is used again',
				action: 'Sleep sandbox',
			},
			{
				name: 'Wake',
				value: 'wake',
				description: 'Restore a sleeping sandbox now',
				action: 'Wake sandbox',
			},
		],
		default: 'create',
	},
];

export const sandboxFields: INodeProperties[] = [
	sandboxLocator('sandbox', [
		'delete',
		'executeCommand',
		'get',
		'getBackgroundCommand',
		'openPullRequest',
		'pushBranch',
		'sleep',
		'wake',
	]),

	/* ------------------------------ create ------------------------------ */
	{
		displayName: 'Template Name or ID',
		name: 'template',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTemplates' },
		default: '',
		description:
			'The template to start from. Leave empty for the organization default. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['sandbox'], operation: ['create'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['sandbox'], operation: ['create'] } },
		options: [
			{
				displayName: 'Delete After (Seconds)',
				name: 'ttl',
				type: 'number',
				typeOptions: { minValue: 60, maxValue: 7776000 },
				default: 3600,
				description:
					'Delete the sandbox automatically this many seconds after it is created (60 s to 90 days)',
			},
			{
				displayName: 'Environment Variables',
				name: 'env',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add Variable',
				description: 'Variables every command in the sandbox gets',
				options: [
					{
						displayName: 'Variable',
						name: 'variables',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. NODE_ENV',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. production',
							},
						],
					},
				],
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. report-builder',
				description:
					'Your label for the sandbox: letters, digits, dot, dash and underscore, up to 64 characters',
			},
			{
				displayName: 'Persistent',
				name: 'persistent',
				type: 'boolean',
				default: false,
				description:
					'Whether every command runs in one long-lived container, so packages and background processes outside /workspace last between commands',
			},
			{
				displayName: 'Region',
				name: 'region',
				type: 'options',
				default: '',
				options: [
					{
						name: 'Default',
						value: '',
						description: 'The organization default, else the nearest region',
					},
					{ name: 'EU (Helsinki)', value: 'eu-hel1' },
					{ name: 'US (Dallas)', value: 'us-ash1' },
				],
			},
			{
				displayName: 'Repository',
				name: 'repo',
				type: 'string',
				default: '',
				placeholder: 'e.g. acme/api or acme/api@main',
				description:
					"A GitHub repo of your organization's connected GitHub (owner/name, optionally @branch, tag or commit). It is cloned into /workspace/&lt;name&gt;; no GitHub token enters the sandbox.",
			},
			{
				displayName: 'Size',
				name: 'size',
				type: 'options',
				default: '',
				description:
					'The number of vCPUs and GiB of memory. A sized sandbox can take longer to start.',
				options: [
					{ name: '16 vCPU, 32 GiB', value: '16x32' },
					{ name: '2 vCPU, 4 GiB', value: '2x4' },
					{ name: '4 vCPU, 8 GiB', value: '4x8' },
					{ name: '8 vCPU, 16 GiB', value: '8x16' },
					{ name: 'Template Default', value: '' },
				],
			},
			{
				displayName: 'Sleep After (Seconds)',
				name: 'sleepAfter',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 604800 },
				default: 300,
				description: 'Idle seconds before the sandbox sleeps. 0 means never.',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeout',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 1800 },
				default: 300,
				description: 'How long to wait for the sandbox to reach the running state',
			},
		],
	},
	simplifyField(['create', 'get', 'getAll', 'sleep', 'wake']),

	/* --------------------- pushBranch / openPullRequest --------------------- */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: { resource: ['sandbox'], operation: ['pushBranch', 'openPullRequest'] },
		},
		options: [
			{
				displayName: 'Base Branch',
				name: 'base',
				type: 'string',
				default: '',
				placeholder: 'e.g. main',
				description: "The branch to merge into. Leave empty for the repo's default branch.",
				displayOptions: { show: { '/operation': ['openPullRequest'] } },
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'The pull request description',
				displayOptions: { show: { '/operation': ['openPullRequest'] } },
			},
			{
				displayName: 'Branch',
				name: 'branch',
				type: 'string',
				default: '',
				placeholder: 'e.g. fix/login',
				description: 'The branch to push. Leave empty for kosa8/&lt;sandbox short ID&gt;.',
			},
			{
				displayName: 'Commit Message',
				name: 'message',
				type: 'string',
				default: '',
				description: "Leave empty for 'Changes from kosa8 sandbox &lt;ID&gt;'",
				displayOptions: { show: { '/operation': ['pushBranch'] } },
			},
			{
				displayName: 'Draft',
				name: 'draft',
				type: 'boolean',
				default: true,
				description: 'Whether to open the pull request as a draft',
				displayOptions: { show: { '/operation': ['openPullRequest'] } },
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'The pull request title. Leave empty for a title kosa8 writes.',
				displayOptions: { show: { '/operation': ['openPullRequest'] } },
			},
		],
	},

	/* ------------------------------ getAll ------------------------------ */
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['sandbox'], operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['sandbox'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['sandbox'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Include Deleted',
				name: 'includeDeleted',
				type: 'boolean',
				default: false,
				description: 'Whether to include deleted sandboxes',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. report-builder',
				description: 'Only sandboxes with exactly this name',
			},
		],
	},

	/* -------------------------- executeCommand -------------------------- */
	{
		displayName: 'Command Type',
		name: 'commandType',
		type: 'options',
		default: 'shell',
		displayOptions: { show: { resource: ['sandbox'], operation: ['executeCommand'] } },
		options: [
			{
				name: 'Shell Command',
				value: 'shell',
				description: 'One line run with sh -c, so pipes, && and variables work',
			},
			{
				name: 'Arguments',
				value: 'argv',
				description: 'The program and each argument as a separate value, with no shell',
			},
		],
	},
	{
		displayName: 'Command',
		name: 'command',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		placeholder: 'e.g. echo hello && uname -a',
		description: 'The shell command to run with sh -c',
		displayOptions: {
			show: { resource: ['sandbox'], operation: ['executeCommand'], commandType: ['shell'] },
		},
	},
	{
		displayName: 'Arguments',
		name: 'arguments',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		required: true,
		placeholder: 'Add Argument',
		description: 'The program first, then each of its arguments',
		displayOptions: {
			show: { resource: ['sandbox'], operation: ['executeCommand'], commandType: ['argv'] },
		},
		options: [
			{
				displayName: 'Argument',
				name: 'values',
				values: [
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						placeholder: 'e.g. python3',
					},
				],
			},
		],
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeout',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 86400 },
		default: 60,
		description: `Stop the command after this many seconds. A command that waits for its answer runs at most ${MAX_BUFFERED_EXEC_S} s; use 'Run in Background' for longer ones.`,
		displayOptions: { show: { resource: ['sandbox'], operation: ['executeCommand'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['sandbox'], operation: ['executeCommand'] } },
		options: [
			{
				displayName: 'Environment Variables',
				name: 'env',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add Variable',
				description: 'Variables for this command only; they win over the sandbox ones',
				options: [
					{
						displayName: 'Variable',
						name: 'variables',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. DEBUG',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								placeholder: 'e.g. 1',
							},
						],
					},
				],
			},
			{
				displayName: 'Fail on Non-Zero Exit Code',
				name: 'failOnNonZeroExit',
				type: 'boolean',
				default: false,
				description:
					'Whether to stop the workflow when the command exits with a code other than 0. When off, the exit code is returned in exit_code.',
			},
			{
				displayName: 'Run in Background',
				name: 'background',
				type: 'boolean',
				default: false,
				description:
					"Whether to start the command and return at once with its ID, for commands longer than 90 s. Read the result later with the 'Get Background Command' operation.",
			},
		],
	},

	/* ----------------------- getBackgroundCommand ----------------------- */
	{
		displayName: 'Background Command ID',
		name: 'execId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. bg_3f9c0a1b2c3d4e5f',
		description: "The ID that 'Execute Command' returned with 'Run in Background' on",
		displayOptions: { show: { resource: ['sandbox'], operation: ['getBackgroundCommand'] } },
	},
];
