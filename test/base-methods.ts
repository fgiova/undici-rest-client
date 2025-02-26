import {test} from "tap";
import {TestClient} from "./test-types.js";
import {MockAgent, setGlobalDispatcher} from "undici";
import RestClient from "../src/index.js";

test("Test HTTP Methods", {only: true}, async t => {

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

	await t.test("GET method", async (t: TestClient) => {
		t.context.mockPool.intercept({
			path: "/",
			method: "GET"
		})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(200,{test: true});

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, { test: true });
	});

	await t.test("GET method text/plain", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET"
			})
			.defaultReplyHeaders({
				"content-type": "text/plain"
			})
			.reply(200, "{test: true}");

		const returndata = await t.context.restClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		});
		t.same(returndata, "{test: true}");
	});

	await t.test("POST method", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "POST",
				body: JSON.stringify({ test: true })
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(200, { test: true });
		const returndata = await t.context.restClient.post("/",{
			requestKey: "test",
			ttl: 5_000,
			body: { test: true }
		});
		t.same(returndata, { test: true });
	});

	await t.test("PUT method", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "PUT",
				body: JSON.stringify({ test: true })
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(200, { test: true });
		const returndata = await t.context.restClient.put("/",{
			requestKey: "test",
			ttl: 5_000,
			body: { test: true }
		});
		t.same(returndata, { test: true });
	});

	await t.test("PATCH method", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "PATCH",
				body: JSON.stringify({ test: true })
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(200, { test: true });
		const returndata = await t.context.restClient.patch("/",{
			requestKey: "test",
			ttl: 5_000,
			body: { test: true }
		});
		t.same(returndata, { test: true });
	});

	await t.test("DELETE method", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "DELETE"
			})
			.defaultReplyHeaders({
				"content-type": "application/json"
			})
			.reply(200, "");

		await t.resolves(t.context.restClient.delete("/",{
			requestKey: "test",
		}));
	});
});