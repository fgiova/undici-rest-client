import {Test} from "tap";
import {Interceptable} from "undici";
import RestClient from "../src";

export declare class TestClient extends Test {
	context: {
		mockPool: Interceptable,
		restClient: RestClient
	}
}