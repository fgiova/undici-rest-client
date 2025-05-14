import fastify from "fastify";
import createHttpError from "http-errors";
import { test } from "tap";
import { MockAgent, setGlobalDispatcher } from "undici";
import RestClient from "../src";
import type { TestClient } from "./test-types";

test("Fail Tests", { only: true }, async (t) => {
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

	await t.test("Return simple error", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(500, "");

		const app = fastify();
		app.get("/", async (req, res) => {
			await t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			});
		});
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/",
		});
		const data = await res.json();
		t.has(data, { message: "Internal Server Error" });
	});

	await t.test("Error with message plain/text", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "plain/text",
			})
			.reply(500, "some error text");

		const app = fastify();
		app.get("/", async (req, res) => {
			await t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			});
		});
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/",
		});
		const data = await res.json();
		t.has(data, { message: "some error text" });
	});

	await t.test(
		"Error with JSON body with error field",
		async (t: TestClient) => {
			t.context.mockPool
				.intercept({
					path: "/",
					method: "GET",
				})
				.defaultReplyHeaders({
					"content-type": "application/json",
				})
				.reply(500, { error: "some error" });

			const app = fastify();
			app.get("/", async (req, res) => {
				await t.context.restClient.get("/", {
					requestKey: "test",
					ttl: 5_000,
				});
			});
			await app.ready();
			const res = await app.inject({
				method: "GET",
				url: "/",
			});
			const data = await res.json();
			t.has(data, { message: "some error" });
		},
	);

	await t.test(
		"Error with JSON body with message field",
		async (t: TestClient) => {
			t.context.mockPool
				.intercept({
					path: "/",
					method: "GET",
				})
				.defaultReplyHeaders({
					"content-type": "application/json",
				})
				.reply(500, { message: "some error message" });

			const app = fastify();
			app.get("/", async (req, res) => {
				await t.context.restClient.get("/", {
					requestKey: "test",
					ttl: 5_000,
				});
			});
			await app.ready();
			const res = await app.inject({
				method: "GET",
				url: "/",
			});
			const data = await res.json();
			t.has(data, { message: "some error message" });
		},
	);

	await t.test("Error with JSON complex body", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.reply(500, { message: "some error message", code: "CODE-error" });

		const app = fastify();
		app.get("/", async (req, res) => {
			await t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			});
		});
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/",
		});
		const data = await res.json();
		t.has(data, {
			message: "some error message",
			code: "CODE-error",
		});
	});

	await t.test("Error with obj http-error", async (t: TestClient) => {
		t.context.mockPool
			.intercept({
				path: "/",
				method: "GET",
			})
			.defaultReplyHeaders({
				"content-type": "application/json",
			})
			.replyWithError(createHttpError(500, "error createHttpError"));

		const app = fastify();
		app.get("/", async (req, res) => {
			await t.context.restClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			});
		});
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/",
		});
		const data = await res.json();
		t.has(data, { message: "error createHttpError" });
	});

	await t.test("Error wrong domain", async (t: TestClient) => {
		const apiClient = new RestClient({
			baseUrl: "https://client.api.com-",
		});

		await t.rejects(
			apiClient.get("/", {
				requestKey: "test",
				ttl: 5_000,
			}),
		);
	});
});
