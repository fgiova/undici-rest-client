import {test} from "tap";
import {LRUCache} from "lru-cache";
import RestClient from "../src";

test("RestClient with connection to internet", async (t) => {
	await t.test("GET google.com", async t => {
		const cache = new LRUCache<string,any>({
			max: 100,
			ttl: 5_000
		});
		const apiClient = new RestClient({
			baseUrl: "https://www.google.com",
			cache
		});

		await t.resolves(apiClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		}));
	});


	await t.test("GET google.pippo", async t => {
		const apiClient = new RestClient({
			baseUrl: "https://www.google.pippo"
		});

		await t.rejects(apiClient.get("/",{
			requestKey: "test",
			ttl: 5_000,
		}));
	});
});