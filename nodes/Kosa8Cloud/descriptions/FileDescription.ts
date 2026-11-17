import type { INodeProperties } from 'n8n-workflow';

import { sandboxLocator } from './SandboxDescription';

export const fileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a file or folder in a sandbox permanently',
				action: 'Delete file in sandbox',
			},
			{
				name: 'List',
				value: 'list',
				description: 'List the files and folders in a sandbox folder',
				action: 'List files in sandbox',
			},
			{
				name: 'Read',
				value: 'read',
				description: 'Download a file from a sandbox as binary data',
				action: 'Read file from sandbox',
			},
			{
				name: 'Write',
				value: 'write',
				description: 'Upload binary data or text to a file in a sandbox',
				action: 'Write file to sandbox',
			},
		],
		default: 'read',
	},
];

export const fileFields: INodeProperties[] = [
	sandboxLocator('file', ['delete', 'list', 'read', 'write']),
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. /workspace/report.csv',
		description: 'The file path in the sandbox. A relative path is relative to /workspace.',
		displayOptions: { show: { resource: ['file'], operation: ['delete', 'read', 'write'] } },
	},
	{
		displayName: 'Folder',
		name: 'folder',
		type: 'string',
		default: '/workspace',
		placeholder: 'e.g. /workspace/output',
		description: 'The folder to list. A relative path is relative to /workspace.',
		displayOptions: { show: { resource: ['file'], operation: ['list'] } },
	},

	/* ------------------------------- read ------------------------------- */
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: { resource: ['file'], operation: ['read'] } },
	},

	/* ------------------------------- write ------------------------------ */
	{
		displayName: 'Input Type',
		name: 'inputType',
		type: 'options',
		default: 'binary',
		displayOptions: { show: { resource: ['file'], operation: ['write'] } },
		options: [
			{
				name: 'Binary File',
				value: 'binary',
				description: 'Upload a file from a binary field of the input item',
			},
			{
				name: 'Text',
				value: 'text',
				description: 'Upload text typed here or set by an expression',
			},
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field holding the file to upload',
		displayOptions: { show: { resource: ['file'], operation: ['write'], inputType: ['binary'] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		placeholder: 'e.g. print("hello")',
		description: 'The text to write, as UTF-8',
		displayOptions: { show: { resource: ['file'], operation: ['write'], inputType: ['text'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['file'], operation: ['write'] } },
		options: [
			{
				displayName: 'Append',
				name: 'append',
				type: 'boolean',
				default: false,
				description: 'Whether to add the data at the end of the file instead of replacing it',
			},
			{
				displayName: 'Permissions',
				name: 'mode',
				type: 'string',
				default: '',
				placeholder: 'e.g. 755',
				description: 'Unix permission bits in octal',
			},
		],
	},

	/* ------------------------------ delete ------------------------------ */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['file'], operation: ['delete'] } },
		options: [
			{
				displayName: 'Recursive',
				name: 'recursive',
				type: 'boolean',
				default: false,
				description: 'Whether to delete a folder and everything in it',
			},
		],
	},
];
