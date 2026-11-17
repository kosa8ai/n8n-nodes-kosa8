import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'kosa8CloudApi';
export const DEFAULT_BASE_URL = 'https://api.kosa8.com';
export const PRICING_URL = 'https://kosa8.com/pricing/';

/** A buffered exec is held to 90 s by the API. */
export const MAX_BUFFERED_EXEC_S = 90;

/** How often a 429 is retried, honouring Retry-After (capped). */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_S = 30;

type Context = IExecuteFunctions | ILoadOptionsFunctions;

interface Kosa8RequestOptions {
	qs?: IDataObject;
	body?: IDataObject | Buffer;
	/** Send the body as raw bytes (application/octet-stream). */
	rawBody?: boolean;
	/** Answer the body as a Buffer instead of parsed JSON. */
	binaryResponse?: boolean;
	/** Request timeout in milliseconds. */
	timeout?: number;
	itemIndex?: number;
}

interface FullResponse {
	body: unknown;
	headers: Record<string, string | string[] | undefined>;
	statusCode: number;
}

async function getBaseUrl(ctx: Context): Promise<string> {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
	const baseUrl = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).trim();
	return baseUrl.replace(/\/+$/, '');
}

function decodeBody(body: unknown): IDataObject {
	if (body === undefined || body === null || body === '') return {};
	if (Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		const text = Buffer.from(body as Buffer).toString('utf8');
		try {
			const parsed = JSON.parse(text) as unknown;
			if (parsed && typeof parsed === 'object') return parsed as IDataObject;
		} catch {
			// not JSON
		}
		return { message: text.slice(0, 500) };
	}
	if (typeof body === 'string') {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed && typeof parsed === 'object') return parsed as IDataObject;
		} catch {
			// not JSON
		}
		return { message: body.slice(0, 500) };
	}
	if (typeof body === 'object') return body as IDataObject;
	return { message: String(body) };
}

function header(headers: FullResponse['headers'], name: string): string | undefined {
	const value = headers?.[name] ?? headers?.[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

function retryAfterSeconds(headers: FullResponse['headers']): number | undefined {
	const value = header(headers, 'retry-after');
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds);
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, (date - Date.now()) / 1000);
	return undefined;
}

/** Turn a kosa8 Cloud answer with a 4xx/5xx status into a NodeApiError users can act on. */
export function kosa8ApiError(
	ctx: Context,
	statusCode: number,
	rawBody: unknown,
	headers: FullResponse['headers'],
	itemIndex?: number,
): NodeApiError {
	const body = decodeBody(rawBody);
	const code = typeof body.error === 'string' ? body.error : undefined;
	const apiMessage =
		(typeof body.message === 'string' && body.message) ||
		code ||
		`kosa8 Cloud answered HTTP ${statusCode}`;

	let message = `kosa8 Cloud: ${apiMessage}`;
	const hints: string[] = [];

	if (statusCode === 401) {
		hints.push(
			'Check the API key in the kosa8 Cloud API credential, or create a new one at https://app.kosa8.com/app#keys.',
		);
	} else if (statusCode === 402) {
		if (typeof body.agent_message === 'string' && body.agent_message) {
			message = `kosa8 Cloud: ${body.agent_message}`;
			if (apiMessage !== body.agent_message) hints.push(apiMessage);
		}
		const upgradeUrl =
			(typeof body.upgrade_url === 'string' && body.upgrade_url) ||
			(typeof body.pack_url === 'string' && body.pack_url) ||
			PRICING_URL;
		hints.push(`Fix it here: ${upgradeUrl}`);
	} else if (statusCode === 403) {
		hints.push(
			'The API key may lack the scope this operation needs (sandboxes:read or sandboxes:write).',
		);
	} else if (statusCode === 404) {
		hints.push('Check the sandbox ID or the path. A deleted sandbox cannot be used again.');
	} else if (statusCode === 423) {
		hints.push(
			'The organization is frozen in the kosa8 Security Center. An owner or admin must unfreeze it.',
		);
	} else if (statusCode === 429) {
		if (typeof body.agent_message === 'string' && body.agent_message)
			hints.push(body.agent_message);
		const retryAfter = retryAfterSeconds(headers);
		hints.push(
			retryAfter !== undefined
				? `Try again in ${Math.ceil(retryAfter)} s.`
				: 'Too many requests or active sandboxes. Wait a moment, or delete sandboxes you no longer need.',
		);
	} else if (statusCode === 504 && code === 'exec_timeout') {
		hints.push(
			`A command that waits for its answer can run for at most ${MAX_BUFFERED_EXEC_S} s. Turn on 'Run in Background' for longer commands and read the result with 'Get Background Command'.`,
		);
	}

	const details: JsonObject = { ...(body as JsonObject), httpCode: String(statusCode) };
	return new NodeApiError(ctx.getNode(), details, {
		message,
		description: hints.join(' ') || undefined,
		httpCode: String(statusCode),
		itemIndex,
	});
}

/** One request to kosa8 Cloud. Answers the decoded body; throws NodeApiError for a 4xx/5xx. */
export async function kosa8ApiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: Kosa8RequestOptions = {},
): Promise<unknown> {
	const baseUrl = await getBaseUrl(this);
	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		qs: options.qs,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: options.timeout ?? 60_000,
		headers: { Accept: options.binaryResponse ? '*/*' : 'application/json' },
	};
	if (options.binaryResponse) {
		request.encoding = 'arraybuffer';
		request.json = false;
	} else {
		request.json = true;
	}
	if (options.body !== undefined) {
		request.body = options.body;
		if (options.rawBody) {
			request.json = false;
			request.headers = { ...request.headers, 'Content-Type': 'application/octet-stream' };
		}
	}

	for (let attempt = 0; ; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			request,
		)) as FullResponse;
		const { statusCode } = response;
		if (statusCode >= 200 && statusCode < 300) {
			if (options.binaryResponse) return Buffer.from(response.body as Buffer);
			return decodeBody(response.body);
		}
		if (statusCode === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
			const body = decodeBody(response.body);
			// quota_exceeded (too many active sandboxes) will not clear by waiting a few seconds.
			if (body.error !== 'quota_exceeded') {
				const wait = retryAfterSeconds(response.headers);
				if (wait === undefined || wait <= MAX_RETRY_AFTER_S) {
					await sleep(1000 * (wait ?? 2 ** attempt));
					continue;
				}
			}
		}
		throw kosa8ApiError(this, statusCode, response.body, response.headers, options.itemIndex);
	}
}

/** A sandbox path relative to /workspace becomes absolute; `..` is refused by the API. */
export function sandboxPath(path: string): string {
	const trimmed = path.trim();
	if (trimmed.startsWith('/')) return trimmed;
	return `/workspace/${trimmed.replace(/^\.\//, '')}`;
}

export function sandboxUrl(id: string, suffix = ''): string {
	return `/v1/sandboxes/${encodeURIComponent(id)}${suffix}`;
}

const SIMPLE_SANDBOX_FIELDS = [
	'id',
	'name',
	'state',
	'template',
	'region',
	'cpus',
	'mem_mb',
	'created_at',
	'delete_after',
	'cost_usd',
];

export function simplifySandbox(sandbox: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const key of SIMPLE_SANDBOX_FIELDS) {
		if (sandbox[key] !== undefined) out[key] = sandbox[key];
	}
	return out;
}
