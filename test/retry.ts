import {test} from "tap";
import {MockAgent, setGlobalDispatcher} from "undici";
import RestClient from "../src";
import fastify from "fastify";
import {TestClient} from "./test-types";

test("Test retry", {only: true}, async t => {

	t.beforeEach((t: TestClient) => {
		const mockAgent = new MockAgent();
		setGlobalDispatcher(mockAgent);
		const mockPool = mockAgent.get("https://client.api.com");
		const restClient = new RestClient({
			baseUrl: "https://client.api.com",
		});
		t.context = {
			mockPool,
			restClient
		};
	});
	t.afterEach(async (t: TestClient) => {
		await t.context.restClient.close();
	});

	await t.test("Test simple Retry", async (t: TestClient) => {
		let retry = 0;
		const now = Date.now();
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(() => {
				if (retry === 0) {
					retry++;
					return { statusCode: 503, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
		t.ok(Date.now() - now >= 300);
	});

	await t.test("Test retry-after 1 second", async (t: TestClient) => {
		let retry = 0;
		const now = Date.now();
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"Retry-After": "1",
				"content-type": "application/json"
			})
			.reply(() => {
				if (retry === 0) {
					retry++;
					return { statusCode: 429, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
		t.ok(Date.now() - now >= 1_000);
	});

	await t.test("Test retry-after Date.now() + 1 second", async (t: TestClient) => {
		let retry = 0;
		const now = Date.now();
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"Retry-After": new Date(Date.now() + 1_000).toISOString(),
				"content-type": "application/json"
			})
			.reply(() => {
				if (retry === 0) {
					retry++;
					return { statusCode: 503, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 3_000,
		});

		t.same(returndata, { test: true });
		t.ok(Date.now() - now >= 1_000);
	});


	await t.test("Test retry-after date too late", async (t: TestClient) => {
		let retry = 0;
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"Retry-After": new Date(Date.now() + 100_000).toISOString(),
				"content-type": "application/json"
			})
			.reply(() => {
				if (retry === 0) {
					retry++;
					return { statusCode: 429, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();

		await t.rejects(t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		}), "ServiceUnavailableError");
	});

	await t.test("Test retry-after maxTimeout exceeded", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(503, "")
			.persist();
		const apiClient = new RestClient({
			baseUrl: "https://client.api.com",
			retry: {
				baseTimeout: 1_000,
				maxTimeout: 1_000,
				maxRetry: 30
			}
		});
		await t.rejects(apiClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		}), "ServiceUnavailableError");
	});

	await t.test("Test retry-after past date", async (t: TestClient) => {
		let retry = 0;
		const now = Date.now();
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"Retry-After": new Date(Date.now() - 1_000).toISOString(),
				"content-type": "application/json"
			})
			.reply(() => {
				if (retry === 0) {
					retry++;
					return { statusCode: 429, data: "" };
				}
				return { statusCode: 200, data: { test: true } };
			})
			.persist();

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
		t.ok(Date.now() - now >= 300);
	});


	await t.test("Test maxRetry exceeded", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: `/`,
				method: "GET"
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(503, "Service Unavailable")
			.persist();

		const app = fastify();
		app.get("/", async (req, res) => {
			await t.context.restClient.get("/",{
				requestKey: "test",
				ttl: 5_000,
			});
		})
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/"
		});
		const data = await res.json();
		t.has(data, {message: "Service Unavailable"});
	});

});