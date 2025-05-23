import { setTimeout } from "node:timers/promises";
import createHttpError from "http-errors";
import { LRUCache } from "lru-cache";
import mimeDb from "mime-db";
import { type Dispatcher, MockAgent, Pool, getGlobalDispatcher } from "undici";

type ErrorBody = {
	message: string;
	code?: string;
};

type ResponseBody<T> = T | ArrayBuffer;
type ResponseHeadersAndBody<T> = {
	headers: Dispatcher.ResponseData["headers"];
	body: ResponseBody<T>;
};

interface RestClientOptions {
	baseUrl: string;
	cache?: LRUCache<string, unknown>;
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
	body?: Dispatcher.RequestOptions["body"] | JSONValue;
	headers?: Record<string, string>;
	returnHeaders?: boolean;
};
type RequestOptionsWithHeaders<TOmit = unknown> = Omit<
	RequestOptions,
	TOmit extends string | number | symbol ? TOmit : "returnHeaders"
> & {
	returnHeaders: true;
};
type RequestOptionsOnlyBody<TOmit = unknown> = Omit<
	RequestOptions,
	TOmit extends string | number | symbol ? TOmit : "returnHeaders"
> & {
	returnHeaders?: false;
};

type JSONPrimitive = string | number | boolean | null | undefined;

type JSONValue =
	| JSONPrimitive
	| JSONValue[]
	| {
			[key: string]: JSONValue;
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

	private readonly localCache: LRUCache<string, unknown>;

	constructor(options: RestClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.localCache =
			options.cache ??
			new LRUCache<string, unknown>({ max: 1000, ttl: 30_000 });
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

	async get<TResponseBody>(
		path: string,
		options?: RequestOptionsWithHeaders<"path" | "method" | "body">,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	async get<TResponseBody>(
		path: string,
		options?: RequestOptionsOnlyBody<"path" | "method" | "body">,
	): Promise<ResponseBody<TResponseBody>>;
	async get<TResponseBody>(
		path: string,
		options?:
			| RequestOptionsWithHeaders<"path" | "method" | "body">
			| RequestOptionsOnlyBody<"path" | "method" | "body">,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, ttl, headers, returnHeaders } = options || {};
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "GET",
			path,
			headers,
			// @ts-ignore
			returnHeaders,
		});
	}

	async post<TResponseBody>(
		path: string,
		options?: RequestOptionsWithHeaders<"path" | "method">,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	async post<TResponseBody>(
		path: string,
		options?: RequestOptionsOnlyBody<"path" | "method">,
	): Promise<ResponseBody<TResponseBody>>;
	async post<TResponseBody>(
		path: string,
		options?:
			| RequestOptionsWithHeaders<"path" | "method">
			| RequestOptionsOnlyBody<"path" | "method">,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, ttl, body, headers, returnHeaders } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "POST",
			path,
			body,
			headers,
			// @ts-ignore
			returnHeaders,
		});
	}

	async put<TResponseBody>(
		path: string,
		options?: RequestOptionsWithHeaders<"path" | "method">,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	async put<TResponseBody>(
		path: string,
		options?: RequestOptionsOnlyBody<"path" | "method">,
	): Promise<ResponseBody<TResponseBody>>;
	async put<TResponseBody>(
		path: string,
		options?:
			| RequestOptionsWithHeaders<"path" | "method">
			| RequestOptionsOnlyBody<"path" | "method">,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, ttl, body, headers, returnHeaders } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PUT",
			path,
			body,
			headers,
			// @ts-ignore
			returnHeaders,
		});
	}

	async patch<TResponseBody>(
		path: string,
		options?: RequestOptionsWithHeaders<"path" | "method">,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	async patch<TResponseBody>(
		path: string,
		options?: RequestOptionsOnlyBody<"path" | "method">,
	): Promise<ResponseBody<TResponseBody>>;
	async patch<TResponseBody>(
		path: string,
		options?:
			| RequestOptionsWithHeaders<"path" | "method">
			| RequestOptionsOnlyBody<"path" | "method">,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, ttl, body, headers, returnHeaders } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PATCH",
			path,
			body,
			headers,
			// @ts-ignore
			returnHeaders,
		});
	}

	async delete<TResponseBody>(
		path: string,
		options?: RequestOptionsWithHeaders<"path" | "method" | "body">,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	async delete<TResponseBody>(
		path: string,
		options?: RequestOptionsOnlyBody<"path" | "method" | "body">,
	): Promise<ResponseBody<TResponseBody>>;
	async delete<TResponseBody>(
		path: string,
		options?:
			| RequestOptionsWithHeaders<"path" | "method" | "body">
			| RequestOptionsOnlyBody<"path" | "method" | "body">,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, headers, returnHeaders } = options;
		return this.request<TResponseBody>({
			requestKey,
			method: "DELETE",
			path,
			headers,
			// @ts-ignore
			returnHeaders,
		});
	}

	public async request<TResponseBody>(
		options: RequestOptionsWithHeaders,
	): Promise<ResponseHeadersAndBody<TResponseBody>>;
	public async request<TResponseBody>(
		options: RequestOptionsOnlyBody,
	): Promise<ResponseBody<TResponseBody>>;
	public async request<TResponseBody>(
		options: RequestOptionsWithHeaders | RequestOptionsOnlyBody,
	): Promise<
		ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
	> {
		const { requestKey, ttl, method, path } = options;
		let { body, headers } = options;
		const returnHeaders = Boolean(options.returnHeaders);

		if (
			body &&
			(this.isPlainObject(body) ||
				Array.isArray(body) ||
				!Number.isNaN(Number(body)) ||
				body.constructor === String)
		) {
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
					return oldPromise as Promise<
						ResponseHeadersAndBody<TResponseBody> | ResponseBody<TResponseBody>
					>;
				}
			}
			if (method === "GET" && ttl) {
				const data = this.localCache.get(`${requestKey}#data`);
				if (data) {
					return data as
						| ResponseHeadersAndBody<TResponseBody>
						| ResponseBody<TResponseBody>;
				}
			}
		}

		const resultRetryable = (
			url: string,
			method: Method,
			body?: Dispatcher.RequestOptions["body"],
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

		async function responseData<
			TError extends boolean = false,
			TResponseData = TError extends true
				? ErrorBody
				: typeof returnHeaders extends true
					? {
							headers: Dispatcher.ResponseData["headers"];
							body: TResponseBody | ArrayBuffer;
						}
					: TResponseBody | ArrayBuffer,
		>(
			response: Dispatcher.ResponseData,
			isError?: TError,
		): Promise<TResponseData> {
			let data: unknown;
			const contentType = (response.headers["content-type"] as string)?.split(
				";",
			)[0];
			if (!isError && !mimeDb[contentType]?.compressible) {
				const arrayBuffer = await response.body.arrayBuffer();
				if (returnHeaders) {
					return {
						headers: response.headers,
						body: arrayBuffer,
						// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
					} as any;
				}
				// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
				return arrayBuffer as any;
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
				let message = `${(data && typeof data === "object" && (("message" in data && data.message) || ("error" in data && data.error))) || rawBody}`;
				message = message.length
					? message
					: createHttpError(response.statusCode).message;
				if (data.constructor === String) {
					return {
						message,
						// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
					} as any;
				}
				return {
					code: JSON.stringify(data),
					message,
					// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
				} as any;
			}
			if (returnHeaders) {
				return {
					headers: response.headers,
					body: data,
					// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
				} as any;
			}
			// biome-ignore lint/suspicious/noExplicitAny: override type for conditional type
			return data as any;
		}

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
					let retryResult = await resultRetryable(
						path,
						method,
						body as Dispatcher.RequestOptions["body"],
					);
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
							retryResult = await resultRetryable(
								path,
								method,
								body as Dispatcher.RequestOptions["body"],
							);
						} else {
							resultResponse = retryResult;
							break;
						}
					}
					if (resultResponse) {
						return resolve(resultResponse);
					}
					const error = await responseData(retryResult, true);
					reject(createHttpError(retryResult.statusCode, error.message, error));
				} catch (e) {
					reject(createHttpError(500, e.message, e));
				}
			},
		)
			.then(async (result) => {
				if (!this.isAnError(result.statusCode)) {
					const data = await responseData(result);
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
	}
}
