import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { kosa8ApiRequest } from '../Kosa8Cloud/GenericFunctions';

/** A delivery older than this (by its signed timestamp) is refused as a replay. */
export const SIGNATURE_TOLERANCE_S = 300;

export const TRIGGER_EVENTS = ['bot.run.finished', 'bot.approval.requested'];

/**
 * Check kosa8's `Kosa8-Signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`
 * against the raw body. False when it is missing, wrong or older than the tolerance.
 */
export function verifySignature(
	secret: string,
	header: string | undefined,
	rawBody: Buffer | string,
	nowS = Math.floor(Date.now() / 1000),
): boolean {
	if (!secret || !header) return false;
	let t: string | undefined;
	const sigs: string[] = [];
	for (const part of header.split(',')) {
		const [k, v] = part.trim().split('=', 2);
		if (k === 't') t = v;
		else if (k === 'v1' && v) sigs.push(v);
	}
	if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
	if (Math.abs(nowS - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
	const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
	const expected = createHmac('sha256', secret)
		.update(Buffer.concat([Buffer.from(`${t}.`, 'utf8'), body]))
		.digest();
	return sigs.some((s) => {
		if (!/^[0-9a-f]+$/i.test(s)) return false;
		const got = Buffer.from(s, 'hex');
		return got.length === expected.length && timingSafeEqual(got, expected);
	});
}

export class Kosa8CloudTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'kosa8 Cloud Trigger',
		name: 'kosa8CloudTrigger',
		icon: { light: 'file:../../icons/kosa8.svg', dark: 'file:../../icons/kosa8.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when a kosa8 Autopilot bot run finishes or a bot step needs approval',
		defaults: {
			name: 'kosa8 Cloud Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'kosa8CloudApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"kosa8 registers this workflow's webhook URL when the workflow is activated. The URL must be public https (not localhost), and the API key needs the admin scope. Approvals are answered by a person in kosa8, Slack or a signed link, not from n8n.",
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['bot.run.finished'],
				options: [
					{
						name: 'Approval Needed',
						value: 'bot.approval.requested',
						description: 'A bot step waits for a person to approve it',
					},
					{
						name: 'Bot Run Finished',
						value: 'bot.run.finished',
						description: 'A bot run ended (succeeded, failed, cancelled, ...)',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Bot ID',
						name: 'botId',
						type: 'string',
						default: '',
						placeholder: 'e.g. bot_4Qm2abcd',
						description: 'Only start for events from this bot',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				const got = (await kosa8ApiRequest.call(this, 'GET', '/v1/webhooks')) as IDataObject;
				const hooks = (got.webhooks as IDataObject[]) ?? [];
				const url = this.getNodeWebhookUrl('default');
				const events = [...(this.getNodeParameter('events') as string[])].sort().join(' ');
				const hook = hooks.find((h) => h.id === data.webhookId);
				if (
					hook &&
					hook.url === url &&
					[...((hook.events as string[]) ?? [])].sort().join(' ') === events &&
					data.secret
				) {
					return true;
				}
				if (hook) {
					// Its URL or events changed: remove the old endpoint so create() makes the right one.
					await kosa8ApiRequest.call(
						this,
						'DELETE',
						`/v1/webhooks/${encodeURIComponent(hook.id as string)}`,
					);
				}
				delete data.webhookId;
				delete data.secret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const events = this.getNodeParameter('events') as string[];
				const body: IDataObject = {
					url: this.getNodeWebhookUrl('default'),
					events,
					description:
						`n8n: ${this.getWorkflow().name ?? this.getWorkflow().id ?? 'workflow'}`.slice(0, 200),
				};
				const got = (await kosa8ApiRequest.call(this, 'POST', '/v1/webhooks', {
					body,
				})) as IDataObject;
				const hook = (got.webhook as IDataObject) ?? got;
				if (!hook.id || !hook.secret) return false;
				const data = this.getWorkflowStaticData('node');
				data.webhookId = hook.id;
				data.secret = hook.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) {
					try {
						await kosa8ApiRequest.call(
							this,
							'DELETE',
							`/v1/webhooks/${encodeURIComponent(data.webhookId as string)}`,
						);
					} catch (error) {
						// Already gone is fine; anything else is reported.
						if (!(error instanceof NodeApiError) || error.httpCode !== '404') return false;
					}
				}
				delete data.webhookId;
				delete data.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const data = this.getWorkflowStaticData('node');
		const header = req.headers['kosa8-signature'];
		const ok = verifySignature(
			(data.secret as string) ?? '',
			Array.isArray(header) ? header[0] : header,
			req.rawBody ?? '',
		);
		if (!ok) {
			const res = this.getResponseObject();
			res.status(401).send('bad or missing Kosa8-Signature').end();
			return { noWebhookResponse: true };
		}
		const evt = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events') as string[];
		if (!events.includes(evt.type as string)) return {};
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const payload = (evt.data as IDataObject) ?? {};
		if (options.botId && payload.bot_id !== options.botId) return {};
		return { workflowData: [this.helpers.returnJsonArray([evt])] };
	}
}
