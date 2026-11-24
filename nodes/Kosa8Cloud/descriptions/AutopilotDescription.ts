import type { INodeProperties } from 'n8n-workflow';

/** The 'Bot' field: pick one from a list, or give its ID. */
const botLocator: INodeProperties = {
	displayName: 'Bot',
	name: 'botId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The Autopilot bot to use',
	displayOptions: { show: { resource: ['autopilot'], operation: ['runBot', 'listRuns'] } },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a bot...',
			typeOptions: {
				searchListMethod: 'searchBots',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. bot_4Qm2abcd',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '^bot_[A-Za-z0-9_-]+$',
						errorMessage: 'A bot ID starts with bot_',
					},
				},
			],
		},
	],
};

export const autopilotOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['autopilot'] } },
		options: [
			{
				name: 'Get Run',
				value: 'getRun',
				description: 'Get one bot run with its steps',
				action: 'Get a bot run',
			},
			{
				name: 'List Bots',
				value: 'listBots',
				description: "List the organization's Autopilot bots",
				action: 'List bots',
			},
			{
				name: 'List Pending Approvals',
				value: 'listApprovals',
				description:
					'List risky bot steps waiting for a person. Read-only: a person approves or rejects them in kosa8, Slack or a signed link, never from n8n.',
				action: 'List pending approvals',
			},
			{
				name: 'List Runs',
				value: 'listRuns',
				description: "List a bot's runs, newest first",
				action: 'List bot runs',
			},
			{
				name: 'Run Bot',
				value: 'runBot',
				description:
					'Run a bot now. A dry run (the default) says what it would do and changes nothing.',
				action: 'Run a bot',
			},
		],
		default: 'listBots',
	},
];

export const autopilotFields: INodeProperties[] = [
	botLocator,
	{
		displayName: 'Dry Run',
		name: 'dryRun',
		type: 'boolean',
		default: true,
		description:
			'Whether to only report what the bot would do now and over the last 7 days, changing nothing and never billed. Turn off for a real run (the bot must be on).',
		displayOptions: { show: { resource: ['autopilot'], operation: ['runBot'] } },
	},
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. brun_4Qm2abcd',
		description: "The run's ID (brun_...), for example from Run Bot or List Runs",
		displayOptions: { show: { resource: ['autopilot'], operation: ['getRun'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['autopilot'], operation: ['listRuns', 'listApprovals'] },
		},
	},
];
