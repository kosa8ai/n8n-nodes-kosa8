import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Kosa8CloudApi implements ICredentialType {
	name = 'kosa8CloudApi';

	// n8n's lint requires a title-cased credential name, so this one label reads "Kosa8".
	displayName = 'Kosa8 Cloud API';

	icon: Icon = { light: 'file:../icons/kosa8.svg', dark: 'file:../icons/kosa8.svg' };

	documentationUrl = 'https://docs.kosa8.com/guides/cloud/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. k8c_live_...',
			description: 'A kosa8 Cloud API key. Create one at https://app.kosa8.com/app#keys.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.kosa8.com',
			description: 'The kosa8 Cloud API address. Change it only if kosa8 gave you another one.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/templates',
			method: 'GET',
		},
	};
}
