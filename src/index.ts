import { setTimeout } from "timers/promises";
import mimeDb from "mime-db";
import {
	Dispatcher,
	Pool,
	getGlobalDispatcher,
	MockAgent,
	interceptors,
	MockClient,
	MockPool
} from "undici";
import { LRUCache } from "lru-cache";
import createHttpError from "http-errors";
import {IncomingHttpHeaders} from "node:http";

declare module "undici" {
	namespace Dispatcher {
		interface RequestOptions<TOpaque = null> extends Dispatcher.DispatchOptions {
			bypassNativeCache?: boolean;
		}
		interface DispatchOptions {
			bypassNativeCache?: boolean;
		}
	}
}

interface RestClientOptions {
	baseUrl: string;
	cache?: LRUCache<string, any>;
	cacheNative?: boolean;
	undici?: {
		clientOption?: Pool.Options;
		client?: Dispatcher;
	}
	retry?: {
		httpCodes?: number[];
		backoff?: (retryCount: number) => number;
		baseTimeout?: number;
		maxTimeout?: number;
		maxRetry?: number;
	}
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
	path: string,
	requestKey?: string,
	ttl?: number,
	method: Method,
	body?: any,
	headers?: Record<string, string>
};

export default class RestClient {
	private readonly baseUrl: string;
	private readonly undiciClient: Dispatcher;
	private readonly IdempotentMethods = ["GET", "DELETE"];

	private readonly RetryableCodes;

	private readonly UseNativeCache: boolean;

	private readonly BaseRetryTimeout;
	private readonly MaxRetryTimes;
	private readonly MaxRetryTimeout;

	private readonly IsAMock: boolean;

	private readonly retryBackoff = (retryCount: number) => {
		return this.BaseRetryTimeout * Math.pow(2, retryCount);
	};

	private readonly localCache: LRUCache<string, any>;

	constructor(options: RestClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, "");
		this.localCache = options.cache ?? new LRUCache<string, any>({max: 1000, ttl: 30_000, maxSize: 1024 * 100});
		this.UseNativeCache = options.cacheNative ?? true;
		this.RetryableCodes = options.retry?.httpCodes ?? [502, 503, 429, 408, 504, 599];
		this.BaseRetryTimeout = options.retry?.baseTimeout ?? 300;
		this.MaxRetryTimeout = options.retry?.maxTimeout ?? 30_000;
		this.MaxRetryTimes = options.retry?.maxRetry ?? 3;
		this.IsAMock = (
			(
				getGlobalDispatcher() instanceof MockAgent ||
				getGlobalDispatcher() instanceof MockPool ||
				getGlobalDispatcher() instanceof MockClient
			)
			||
			(
				options.undici?.client instanceof MockAgent ||
				options.undici?.client instanceof MockPool ||
				options.undici?.client instanceof MockClient
			)
		);

		if (options.retry?.backoff) {
			this.retryBackoff = options.retry.backoff;
		}
		if (this.IsAMock){
			this.undiciClient = options.undici?.client ?? getGlobalDispatcher();
			this.UseNativeCache = false;
			return this;
		}

		if(options.undici?.client){
			this.undiciClient = options.undici.client;
			this.UseNativeCache = false;
			return this;
		}

		this.undiciClient = new Pool(this.baseUrl, {
			...options.undici?.clientOption || {}
		})
			.compose(
				[
					...(
						this.UseNativeCache ?
							[
								/* interceptors.retry({
									statusCodes: this.RetryableCodes,
									maxTimeout: this.MaxRetryTimeout,
									minTimeout: this.BaseRetryTimeout,
									maxRetries: this.MaxRetryTimes
								}),*/
								interceptors.cache(),
								(dispatch: Dispatcher["dispatch"] )=> {
									return (options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
										if (options.bypassNativeCache && options.headers) {
											(options.headers as IncomingHttpHeaders)["cache-control"] = "no-store";
										}
										return dispatch(options, handler);
									};
								}
							] :
							[]
					)
				]
			);

		return this;
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

	private readonly isPlainObject = (val: any) =>
		!!val && typeof val === "object" && val.constructor === Object;

	public readonly get = async <TResponseBody>(path: string, options: Omit<RequestOptions, "path" | "method" | "body" > = {} )=> {
		const { requestKey, ttl, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "GET",
			path,
			headers
		});
	};

	public readonly post = async <TResponseBody>(path: string, options: Omit<RequestOptions, "path" | "method"> = {} )=> {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "POST",
			path,
			body,
			headers
		});
	};

	public readonly put = async <TResponseBody>(path: string, options: Omit<RequestOptions, "path" | "method"> = {}  )=> {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PUT",
			path,
			body,
			headers
		});
	};

	public readonly patch = async <TResponseBody>(path: string, options: Omit<RequestOptions, "path" | "method"> = {}  )=> {
		const { requestKey, ttl, body, headers } = options;
		return this.request<TResponseBody>({
			requestKey,
			ttl,
			method: "PATCH",
			path,
			body,
			headers
		});
	};

	public readonly delete = async <TResponseBody>(path: string, options?: Omit<RequestOptions, "path" | "method" | "body" | "ttl"> )=> {
		const { requestKey, headers } = options || {};
		return this.request<TResponseBody>({
			requestKey,
			method: "DELETE",
			path,
			headers
		});
	};

	public readonly request = async <TResponseBody>( options: RequestOptions ): Promise<TResponseBody> => {
		const { requestKey, ttl, method, path } = options;
		let { body, headers } = options;

		const promiseKey = `${method}#${path}#promise`;

		if (body && this.isPlainObject(body)) {
			body = JSON.stringify(body);
			headers = {
				...headers,
				"content-type": "application/json"
			};
		}
		if (this.isIdempotentMethod(method)) {
			const oldPromise = this.localCache.get(promiseKey);
			if (oldPromise) {
				return oldPromise;
			}
		}
		if (requestKey) {
			if (method === "GET" && ttl) {
				const data = this.localCache.get(`${requestKey}#data`);
				if (data) {
					return data;
				}
			}
		}

		const resultRetryable = (url: string, method: Method, body?: any) => {
			return this.undiciClient.request({
				origin: this.baseUrl,
				path: url,
				method,
				headers: {
					...headers
				},
				body,
				bypassNativeCache: !!requestKey
			});
		};

		const responseData = async <TResponseBody>(response: Dispatcher.ResponseData, isError = false): Promise<any> => {

			let data: any;
			const contentType = (response.headers["content-type"] as string ?? "").replace(/;.*$/, "");
			if(!isError && !(mimeDb[contentType]?.compressible)) {
				return response.body.arrayBuffer();
			}
			const rawBody = await response.body.text();
			if(!contentType || contentType?.includes("application/json")) {
				try {
					data = JSON.parse(rawBody) as TResponseBody;
				}
				catch(e: any) {
					data = rawBody;
				}
			}
			else {
				data = rawBody as TResponseBody;
			}
			if (isError) {
				let message = `${data.message || data.error || rawBody}`;
				message = message.length ? message : (createHttpError(response.statusCode) as any).message;
				if (data.constructor === String) {
					return {
						message
					};
				}
				return {
					...data,
					message
				};
			}
			return data;
		};


		const retryTimeout = async (retryResponse: Dispatcher.ResponseData, retryCount: number) => {
			const retryAfterHeader = retryResponse.headers["retry-after"] as string;
			const retryableWithDelay = [429, 502, 503, 504].includes(retryResponse.statusCode) && retryAfterHeader;
			if (retryableWithDelay) {
				const retryAfter = isNaN(Number(retryAfterHeader))
					? 0
					: Number(retryAfterHeader);
				if (retryAfter > 0) {
					await setTimeout(retryAfter * 1_000);
				}
				else {
					if (new Date(retryAfterHeader).valueOf() > Date.now()) {
						const retryAfterDate = new Date(retryAfterHeader).valueOf() - new Date().valueOf();
						if (retryAfterDate > this.MaxRetryTimeout) {
							const error = await responseData<any>(retryResponse, true);
							throw createHttpError(retryResponse.statusCode, error.message, error);
						}
						await setTimeout(retryAfterDate);
						return;
					}
					await setTimeout(this.retryBackoff(retryCount));
				}
			}
			else {
				await setTimeout(this.retryBackoff(retryCount));
			}
		};

		const result = new Promise<Dispatcher.ResponseData>(async (resolve, reject) => {
			try {
				let retryResult = await resultRetryable(path, method, body);
				let resultResponse: Dispatcher.ResponseData | undefined = undefined;
				const now = Date.now();
				for (let i = 0; i < this.MaxRetryTimes && !resultResponse; i++) {
					if (Date.now() - now > this.MaxRetryTimeout) {
						resultResponse = retryResult;
						break;
					}
					if (this.RetryableCodes.includes(retryResult.statusCode)) {
						try {
							await retryTimeout(retryResult, i);
						}
						catch (e: any) {
							return reject(e);
						}
						retryResult = await resultRetryable(path, method, body);
					}
					else {
						resultResponse = retryResult;
						break;
					}
				}
				if (resultResponse) {
					return resolve(resultResponse);
				}
				else {
					const error = await responseData<any>(retryResult, true);
					reject(createHttpError(retryResult.statusCode, error));
				}
			} catch (e: any) {
				reject(createHttpError(500, e.message));
			}
		})
			.then(async (result) => {
				if (!this.isAnError(result.statusCode)) {
					const data = await responseData<TResponseBody>(result);
					if (requestKey) {
						if (method === "DELETE") {
							this.localCache.delete(`${requestKey}#data`);
						}
						if (this.isIdempotentMethod(method) && ttl !== undefined) {
							this.localCache.set(`${requestKey}#data`, data, {
								ttl: ttl || 3_000,
								size: this.localCache.maxSize ?
									data.constructor === String ? data.length || 1 : JSON.stringify(data).length :
									undefined
							});
						}
					}
					return data;
				}
				const error = await responseData<any>(result, true);
				throw createHttpError(result.statusCode, error.message, error);
			})
			.finally(() => {
				this.localCache.delete(promiseKey);
			});
		if (this.isIdempotentMethod(method)) {
			this.localCache.set(promiseKey, result, {
				size: this.localCache.maxSize ? 1 : undefined,
			});
		}
		return result;
	};
}
