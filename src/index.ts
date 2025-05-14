import { setTimeout } from "node:timers/promises";
import createHttpError from "http-errors";
import { LRUCache } from "lru-cache";
import mimeDb from "mime-db";
import { type Dispatcher, MockAgent, Pool, getGlobalDispatcher } from "undici";

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type BodyContent = any;

interface RestClientOptions {
	baseUrl: string;
	cache?: LRUCache<string, BodyContent>;
	undici?: {
		clientOption?: Pool.Options;
		client?: Dispatcher;
	};
	retry?: {
		httpCodes?: number[];
		backoff?: (retryCount: number) => number;
		baseTimeout?: number;
		maxTimeout?: number;
		maxRetry?: number;
	};
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
	path: string;
	requestKey?: string;
	ttl?: number;
	method: Method;
	body?: BodyContent;
	headers?: Record<string, string>;
};

export default class RestClient {
	private readonly baseUrl: string;
	private readonly undiciClient: Dispatcher;
	private readonly IdempotentMethods = ["GET", "DELETE"];

	private readonly RetryableCodes;

	private readonly BaseRetryTimeout;
	private readonly MaxRetryTimes;
	private readonly MaxRetryTimeout;
	private readonly retryBackoff = (retryCount: number) => {
		return this.BaseRetryTimeout * 2 ** retryCount;
	};

	private readonly localCache: LRUCache<string, BodyContent>;

	constructor(options: RestClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.localCache =
			options.cache ??
			new LRUCache<string, BodyContent>({ max: 1000, ttl: 30_000 });
		this.RetryableCodes = options.retry?.httpCodes ?? [
			502, 503, 429, 408, 504, 599,
		];
		this.BaseRetryTimeout = options.retry?.baseTimeout ?? 300;
		this.MaxRetryTimeout = options.retry?.maxTimeout ?? 30_000;
		this.MaxRetryTimes = options.retry?.maxRetry ?? 3;
		if (options.retry?.backoff) {
			this.retryBackoff = options.retry.backoff;
		}
		if (options.undici?.clientOption) {
			this.undiciClient = new Pool(this.baseUrl, options.undici.clientOption);
		} else if (options.undici?.client) {
			this.undiciClient = options.undici.client;
		} else {
			const globalDispatcher = getGlobalDispatcher();
			if (globalDispatcher instanceof MockAgent) {
				this.undiciClient = globalDispatcher;
			} else {
				this.undiciClient = new Pool(this.baseUrl);
			}
		}
	}

	private readonly isIdempotentMethod = (method: Method) => {
		return this.IdempotentMethods.includes(method);
	};

	private readonly isAnError = (statusCode: number) => {
		return !(statusCode >= 200 && statusCode < 300);
	};

	public readonly close = async () => {
		return this.undiciClient.close();
	};

	private readonly isPlainObject = (val: unknown) =>
		!!val && typeof val === "object" && val.constructor === Object;

	public readonly get = async <TResponseBody>(
		path: string,
		options: Omit<RequestOptions, "path" | "method" | "body"> = {},
	) => {
		const { requestKey, ttl, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "GET",
			path,
			headers,
		});
	};

	public readonly post = async <TResponseBody>(
		path: string,
		options: Omit<RequestOptions, "path" | "method"> = {},
	) => {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "POST",
			path,
			body,
			headers,
		});
	};

	public readonly put = async <TResponseBody>(
		path: string,
		options: Omit<RequestOptions, "path" | "method"> = {},
	) => {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PUT",
			path,
			body,
			headers,
		});
	};

	public readonly patch = async <TResponseBody>(
		path: string,
		options: Omit<RequestOptions, "path" | "method"> = {},
	) => {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PATCH",
			path,
			body,
			headers,
		});
	};

	public readonly delete = async <TResponseBody>(
		path: string,
		options?: Omit<RequestOptions, "path" | "method" | "body" | "ttl">,
	) => {
		const { requestKey, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			method: "DELETE",
			path,
			headers,
		});
	};

	public readonly request = async <TResponseBody>(
		options: RequestOptions,
	): Promise<TResponseBody> => {
		const { requestKey, ttl, method, path } = options;
		let { body, headers } = options;
		if (body && this.isPlainObject(body)) {
			body = JSON.stringify(body);
			headers = {
				...headers,
				"content-type": "application/json",
			};
		}
		if (requestKey) {
			if (this.isIdempotentMethod(method)) {
				const oldPromise = this.localCache.get(`${requestKey}#promise`);
				if (oldPromise) {
					return oldPromise;
				}
			}
			if (method === "GET" && ttl) {
				const data = this.localCache.get(`${requestKey}#data`);
				if (data) {
					return data;
				}
			}
		}

		const resultRetryable = (
			url: string,
			method: Method,
			body?: BodyContent,
		) => {
			return this.undiciClient.request({
				origin: this.baseUrl,
				path: url,
				method,
				headers: {
					...headers,
				},
				body,
			});
		};

		const responseData = async (
			response: Dispatcher.ResponseData,
			isError = false,
		) => {
			let data: BodyContent;
			const contentType = (response.headers["content-type"] as string)?.split(
				";",
			)[0];
			if (!isError && !mimeDb[contentType]?.compressible) {
				return response.body.arrayBuffer();
			}
			const rawBody = await response.body.text();
			if (contentType?.includes("application/json")) {
				try {
					data = JSON.parse(rawBody);
				} catch (e) {
					data = rawBody;
				}
			} else {
				data = rawBody;
			}
			if (isError) {
				let message = `${data.message || data.error || rawBody}`;
				message = message.length
					? message
					: createHttpError(response.statusCode).message;
				if (data.constructor === String) {
					return {
						message,
					};
				}
				return {
					...data,
					message,
				};
			}
			return data;
		};

		const retryTimeout = async (
			retryResponse: Dispatcher.ResponseData,
			retryCount: number,
		) => {
			const retryAfterHeader = retryResponse.headers["retry-after"] as string;
			const retryableWithDelay =
				[429, 503].includes(retryResponse.statusCode) && retryAfterHeader;
			if (retryableWithDelay) {
				const retryAfter = Number.isNaN(Number(retryAfterHeader))
					? 0
					: Number(retryAfterHeader);
				if (retryAfter > 0) {
					await setTimeout(retryAfter * 1_000);
				} else {
					if (new Date(retryAfterHeader).valueOf() > Date.now()) {
						const retryAfterDate =
							new Date(retryAfterHeader).valueOf() - new Date().valueOf();
						if (retryAfterDate > this.MaxRetryTimeout) {
							const error = await responseData(retryResponse, true);
							throw createHttpError(
								retryResponse.statusCode,
								error.message,
								error,
							);
						}
						await setTimeout(retryAfterDate);
						return;
					}
					await setTimeout(this.retryBackoff(retryCount));
				}
			} else {
				await setTimeout(this.retryBackoff(retryCount));
			}
		};

		const result = new Promise<Dispatcher.ResponseData>(
			// biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
			async (resolve, reject) => {
				try {
					let retryResult = await resultRetryable(path, method, body);
					let resultResponse: Dispatcher.ResponseData;
					const now = Date.now();
					for (let i = 0; i < this.MaxRetryTimes && !resultResponse; i++) {
						if (Date.now() - now > this.MaxRetryTimeout) {
							resultResponse = retryResult;
							break;
						}
						if (this.RetryableCodes.includes(retryResult.statusCode)) {
							try {
								await retryTimeout(retryResult, i);
							} catch (e) {
								return reject(e);
							}
							retryResult = await resultRetryable(path, method, body);
						} else {
							resultResponse = retryResult;
							break;
						}
					}
					if (resultResponse) {
						return resolve(resultResponse);
					}
					const error = await responseData(retryResult, true);
					reject(createHttpError(retryResult.statusCode, error));
				} catch (e) {
					reject(createHttpError(500, e.message));
				}
			},
		)
			.then(async (result) => {
				if (!this.isAnError(result.statusCode)) {
					const data = (await responseData(result)) as TResponseBody;
					if (requestKey) {
						if (method === "DELETE") {
							this.localCache.delete(`${requestKey}#data`);
						}
						if (this.isIdempotentMethod(method) && ttl !== undefined) {
							this.localCache.set(`${requestKey}#data`, data, {
								ttl: ttl || 3_000,
							});
						}
					}
					return data;
				}
				const error = await responseData(result, true);
				throw createHttpError(result.statusCode, error.message, error);
			})
			.finally(() => {
				if (requestKey) {
					this.localCache.delete(`${requestKey}#promise`);
				}
			});
		if (this.isIdempotentMethod(method) && requestKey) {
			this.localCache.set(`${requestKey}#promise`, result);
		}
		return result;
	};
}
