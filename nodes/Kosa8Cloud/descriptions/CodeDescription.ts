import type { INodeProperties } from 'n8n-workflow';

const show = { resource: ['code'], operation: ['run'] };

export const codeOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['code'] } },
		options: [
			{
				name: 'Run',
				value: 'run',
				description:
					'Run code in a fresh, sealed microVM with your secrets added outside it, then delete the microVM',
				action: 'Run code safely',
			},
		],
		default: 'run',
	},
];

export const codeFields: INodeProperties[] = [
	{
		displayName: 'Language',
		name: 'language',
		type: 'options',
		options: [
			{ name: 'Bash', value: 'bash' },
			{ name: 'JavaScript (Node.js)', value: 'node' },
			{ name: 'Python', value: 'python' },
		],
		default: 'python',
		displayOptions: { show },
	},
	{
		displayName: 'Code',
		name: 'code',
		type: 'string',
		typeOptions: { rows: 10 },
		default: '',
		required: true,
		placeholder: 'import os, requests\nprint(requests.get(os.environ["OPENAI_BASE_URL"] + "/models").status_code)',
		description:
			'The program to run. It reads input from the KOSA8_INPUT environment variable (this item as JSON) and anything it prints is returned.',
		displayOptions: { show },
	},
	{
		displayName: 'Secret Names or IDs',
		name: 'secrets',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getSecrets' },
		default: [],
		description:
			'Secrets from kosa8 to broker into the run. The microVM only gets a placeholder; kosa8 adds the real value on the way out, and only to that secret\'s own service. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Allowed Hosts',
				name: 'allowHosts',
				type: 'string',
				default: '',
				placeholder: 'pypi.org, files.pythonhosted.org',
				description:
					'Comma-separated hosts the code may reach besides its secrets\' services. Empty means no internet.',
			},
			{
				displayName: 'Pass Input Item',
				name: 'passInput',
				type: 'boolean',
				default: true,
				description: 'Whether to give the code this item as JSON in the KOSA8_INPUT environment variable',
			},
			{
				displayName: 'Size',
				name: 'size',
				type: 'options',
				options: [
					{ name: '2 vCPU, 4 GiB', value: '2x4' },
					{ name: '4 vCPU, 8 GiB', value: '4x8' },
					{ name: '8 vCPU, 16 GiB', value: '8x16' },
				],
				default: '2x4',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 90 },
				default: 60,
				description: 'Stop the program after this many seconds (at most 90)',
			},
		],
	},
];
