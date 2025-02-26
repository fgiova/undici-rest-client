import {Test} from "tap";
import {Interceptable} from "undici";
import RestClient from "../src/index.js";

export declare class TestClient extends Test {
	context: {
		mockPool: Interceptable,
		restClient: RestClient
	};
}