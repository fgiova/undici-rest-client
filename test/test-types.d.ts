import type { LRUCache } from "lru-cache";
import { Test } from "tap";
import type { Interceptable } from "undici";
import type RestClient from "../src";

export declare class TestClient extends Test {
	context: {
		mockPool: Interceptable;
		restClient: RestClient;
		cache?: LRUCache<string, unknown>;
	};
}
