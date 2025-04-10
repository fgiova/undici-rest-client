import { test } from "tap";
import { MockAgent, setGlobalDispatcher } from "undici";
import RestClient from "../src/";
import type { TestClient } from "./test-types";

test("Test Cache", { only: true }, async (t) => {
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

	await t.test("Test custom cache time", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(200, { test: true });

		const returndata = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
	});

	await t.test("Test hit call stack", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(200, { test: true });

		const returndata = await Promise.all([
			t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			}),
			t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			}),
		]);
		t.same(returndata[0], { test: true });
		t.equal(returndata[0], returndata[1]);
	});

	await t.test(
		"Test hit call stack on method DELETE",
		async (t: TestClient) => {
			t.context.mockPool
				.intercept({
					path: "/",
					method: "DELETE",
				})
				.defaultReplyHeaders({
					"content-type": "application/json",
				})
				.reply(200, "");

			const returndata = await Promise.all([
				t.context.restClient.delete("/", {
					requestKey: "test",
				}),
				t.context.restClient.delete("/", {
					requestKey: "test",
				}),
			]);
			t.same(returndata[0], "");
			t.equal(returndata[0], returndata[1]);
		},
	);

	await t.test("Test hit result from cache", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(200, { test: true });

		const returndata = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		const returndataCache = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
		t.equal(returndata, returndataCache);
	});

	await t.test("Test force skip from cache", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(200, { test: true })
			.persist();

		const returndata = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		const returndataCache = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 5_000,
		});
		const returndataNoCache = await t.context.restClient.get("/", {
			requestKey: "test",
			ttl: 0,
		});
		t.same(returndata, { test: true });
		t.equal(returndata, returndataCache);
		t.not(returndata, returndataNoCache);
	});
});
