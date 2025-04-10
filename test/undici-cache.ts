import fastify from "fastify";
import { test } from "tap";
import RestClient from "../src/";
import type { TestClient } from "./test-types";
import {Agent, setGlobalDispatcher} from "undici";

test("Test Native Cache", { only: true }, async (t) => {
	t.beforeEach(() => {
		setGlobalDispatcher(new Agent());
	})
	await t.test("Test Native Cache",
		{ only: true }, async (t: TestClient) => {
		let requestsToOrigin = 0;

		const app = fastify();
		t.teardown(async () => await app.close());

		app.get("/", async (req, reply) => {
			requestsToOrigin++;
			reply
				.headers({
					"content-type": "application/json",
					"cache-control": "max-age=10000",
				})
				.send({ test: true });
		});
		await app.ready();

		const baseUrl = await app.listen();

		const restClient = new RestClient({
			baseUrl,
			cacheNative: true,
		});

		const returnData = await restClient.get<{ test: boolean }>("/");

		t.same(returnData, { test: true });
		t.same(requestsToOrigin, 1);

		const returnData2 = await restClient.get("/");
		t.same(returnData2, { test: true });
		t.same(requestsToOrigin, 1);
	});

	await t.test(
		"Test Bypass Native Cache and store on LRU-Cache",
		async (t: TestClient) => {
			let requestsToOrigin = 0;

			const app = fastify();
			t.teardown(async () => await app.close());

			app.get("/", async (req, reply) => {
				requestsToOrigin++;
				reply
					.headers({
						"content-type": "application/json",
						"cache-control": "s-maxage=10",
					})
					.send({ test: true });
			});
			await app.ready();

			const baseUrl = await app.listen();

			const restClient = new RestClient({
				baseUrl,
			});

			const returnData = await restClient.get<{ test: boolean }>("/", {
				requestKey: "bypass",
				ttl: 1000,
			});

			t.same(returnData, { test: true });
			t.same(requestsToOrigin, 1);

			const returnData2 = await restClient.get("/");
			t.same(returnData2, { test: true });
			t.same(requestsToOrigin, 2);

			const returnData3 = await restClient.get<{ test: boolean }>("/", {
				requestKey: "bypass",
				ttl: 1000,
			});
			t.same(returnData3, { test: true });
			t.same(requestsToOrigin, 2);
		},
	);

	await t.test(
		"Test Disable Native Cache",
		async (t: TestClient) => {
			let requestsToOrigin = 0;

			const app = fastify();
			t.teardown(async () => await app.close());

			app.get("/", async (req, reply) => {
				requestsToOrigin++;
				reply
					.headers({
						"content-type": "application/json",
						"cache-control": "s-maxage=10",
					})
					.send({ test: true });
			});
			await app.ready();

			const baseUrl = await app.listen();

			const restClient = new RestClient({
				baseUrl,
				cacheNative: false,
			});

			const returnData = await restClient.get<{ test: boolean }>("/");

			t.same(returnData, { test: true });
			t.same(requestsToOrigin, 1);

			const returnData2 = await restClient.get("/");
			t.same(returnData2, { test: true });
			t.same(requestsToOrigin, 2);
		},
	);
});
