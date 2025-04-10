import fastify from "fastify";
import { LRUCache } from "lru-cache";
import { test } from "tap";
import {
	Agent,
	Client,
	type Dispatcher,
	MockAgent,
	setGlobalDispatcher,
} from "undici";
import RestClient from "../src/";
import type { TestClient } from "./test-types";

test("Test Client options", { only: true }, async (t) => {
	t.beforeEach((t: TestClient) => {
		const mockAgent = new MockAgent();
		setGlobalDispatcher(mockAgent);
		const mockPool = mockAgent.get("https://client.api.com");
		const restClient = new RestClient({
			baseUrl: "https://client.api.com",
		});
		t.context = {
			mockPool,
			restClient,
		};
	});
	t.afterEach(async (t: TestClient) => {
		await t.context.restClient.close();
	});

	await t.test(
		"Client Option undici Option",
		{ only: true },
		async (t: TestClient) => {
			setGlobalDispatcher(new Agent());
			const mockAgent = new MockAgent();
			const mockPool = mockAgent.get("https://client.api.com");
			mockPool
				.intercept({
					path: "/testDifferentPool",
					method: "GET",
				})
				.defaultReplyHeaders({
					"content-type": "application/json",
				})
				.reply(200, { test: true });
			const restClient = new RestClient({
				baseUrl: "https://client.api.com",
				undici: {
					clientOption: {
						factory: (origin: URL, opts: object) => {
							return mockPool as unknown as Dispatcher;
						},
					},
				},
			});

			const returndata = await restClient.get("/testDifferentPool", {
				requestKey: "test",
				ttl: 5_000,
			});
			t.same(returndata, { test: true });
		},
	);

	await t.test("Client Option Custom cache", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/testCustomCache",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(200, { test: true });
		const restClient = new RestClient({
			baseUrl: "https://client.api.com",
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			cache: new LRUCache<string, any>({ max: 100 }),
		});

		const returndata = await restClient.get("/testCustomCache", {
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
	});

	await t.test("Custom Client", async (t) => {
		setGlobalDispatcher(new Agent());

		const app = fastify();
		t.teardown(async () => await app.close());
		app.get("/", async (req, reply) => {
			reply
				.headers({
					"content-type": "application/json",
				})
				.send({ test: true });
		});
		await app.ready();

		const baseUrl = await app.listen();

		const client = new Client(baseUrl);

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const cache = new LRUCache<string, any>({
			max: 100,
			ttl: 5_000,
		});
		const restClient = new RestClient({
			baseUrl: baseUrl,
			cache,
			undici: {
				client,
			},
		});

		await t.resolves(
			restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			}),
		);
	});

	await t.test("Test Custom Backoff", async (t: TestClient) => {
		let retry = 0;
		const now = Date.now();
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(() => {
				if (retry < 2) {
					retry++;
					return { statusCode: 503, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();
		const restClient = new RestClient({
			baseUrl: "https://client.api.com",
			retry: {
				backoff: (retry) => retry * 300,
			},
		});
		const returndata = await restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
		t.ok(Date.now() - now >= 300);
	});

	await t.test("Test simple Request", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/plainText",
				headers: {
					"content-type": "text/plain",
				},
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "text/plain",
			})
			.reply(200, "OK");

		const returndata = await t.context.restClient.get("/plainText", {
			requestKey: "test",
			ttl: 5_000,
			headers: {
				"content-type": "text/plain",
			},
		});
		t.same(returndata, "OK");
	});

	await t.test("Test Array Buffer Response", async (t: TestClient) => {
		const data = Buffer.from(Buffer.alloc(1));
		t.context.mockPool
			.intercept({
				path: "/blob",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/octet-stream",
			})
			.reply(200, data);

		const returndata = await t.context.restClient.get("/blob");
		t.same(Buffer.from(returndata as ArrayBuffer), data);
	});
});
