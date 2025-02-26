import {test} from "tap";
import {TestClient} from "./test-types.js";
import fastify from "fastify";
import RestClient from "../src/index.js";

test("Test Native Cache", {only: true}, async t => {

	await t.test("Test Native Cache", async (t: TestClient) => {
		let requestsToOrigin = 0;

		const app = fastify();
		t.teardown(async () => await app.close());

		app.get("/", async (req, reply) => {
			requestsToOrigin++;
			reply
				.headers({
					"content-type": "application/json",
					"cache-control": "s-maxage=10"
				})
				.send({ test: true });
		});
		await app.ready();

		const baseUrl = await app.listen();

		const restClient = new RestClient({
			baseUrl
		});

		const returnData = await restClient.get<{test:boolean}>("/");

		t.same(returnData, { test: true });
		t.same(requestsToOrigin, 1);

		const returnData2 = await restClient.get("/");
		t.same(returnData2, { test: true });
		t.same(requestsToOrigin, 1);
	});

	await t.test("Test Bypass Native Cache and store on LRU-Cache", {only: true}, async (t: TestClient) => {
		let requestsToOrigin = 0;

		const app = fastify();
		t.teardown(async () => await app.close());

		app.get("/", async (req, reply) => {
			requestsToOrigin++;
			reply
				.headers({
					"content-type": "application/json",
					"cache-control": "s-maxage=10"
				})
				.send({ test: true });
		});
		await app.ready();

		const baseUrl = await app.listen();

		const restClient = new RestClient({
			baseUrl
		});

		const returnData = await restClient.get<{test:boolean}>("/", {
			requestKey: "bypass",
			ttl: 1000
		});

		t.same(returnData, { test: true });
		t.same(requestsToOrigin, 1);

		const returnData2 = await restClient.get("/");
		t.same(returnData2, { test: true });
		t.same(requestsToOrigin, 2);

		const returnData3 = await restClient.get<{test:boolean}>("/", {
			requestKey: "bypass",
			ttl: 1000
		});
		t.same(returnData3, { test: true });
		t.same(requestsToOrigin, 2);
	});

	await t.test("Test Disable Native Cache", {only: true}, async (t: TestClient) => {
		let requestsToOrigin = 0;

		const app = fastify();
		t.teardown(async () => await app.close());

		app.get("/", async (req, reply) => {
			requestsToOrigin++;
			reply
				.headers({
					"content-type": "application/json",
					"cache-control": "s-maxage=10"
				})
				.send({ test: true });
		});
		await app.ready();

		const baseUrl = await app.listen();

		const restClient = new RestClient({
			baseUrl,
			cacheNative: false
		});

		const returnData = await restClient.get<{test:boolean}>("/");

		t.same(returnData, { test: true });
		t.same(requestsToOrigin, 1);

		const returnData2 = await restClient.get("/");
		t.same(returnData2, { test: true });
		t.same(requestsToOrigin, 2);
	});
});