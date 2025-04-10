# Simple REST client using undici

[![NPM version](https://img.shields.io/npm/v/@fgiova/undici-rest-client.svg?style=flat)](https://www.npmjs.com/package/@fgiova/undici-rest-client)
![CI workflow](https://github.com/fgiova/undici-rest-client/actions/workflows/node.js.yml/badge.svg)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![Maintainability](https://api.codeclimate.com/v1/badges/8dafdbda7ca292ca7d00/maintainability)](https://codeclimate.com/github/fgiova/undici-rest-client/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/8dafdbda7ca292ca7d00/test_coverage)](https://codeclimate.com/github/fgiova/undici-rest-client/test_coverage)

## Description
This is a simple REST client using [undici](https://www.npmjs.com/package/undici) as http client.<br>
It's support a simple retry mechanism using exponential backoff or using delay based on retry-after HTTP header 
It's implement a simple LRU cache mechanism on idempotent HTTP methods.

[!NOTE]
For node 16 use version 1.x, version 2.x support only Node.js >= 18.

## Installation

```bash
npm install @fgiova/undici-rest-client
```

## Usage

```typescript
import { RestClient } from "@fgiova/undici-rest-client";

const client = new RestClient({
    baseUrl: "https://foo.bar.org",
    retry: {
        httpCodes: [503, 429],
        baseTimeout: 1000,
        maxTimeout: 10000,
        maxRetry: 5,
        backoff: (retryCount) => 2 ** retryCount * 1000,
    },
	cache: new LRUCache<string, any>({max: 10})
});

const response = await client.get("/foo/bar", {
    headers: {
        "x-foo": "bar",
    },
    ttl: 1000,
    requestKey: "foo-bar",
});

const response = await client.post("/foo/bar", {
    headers: {
        "x-foo": "bar",
    },
    ttl: 1000,
    requestKey: "foo-bar",
    body: {
        foo: "bar",
    }
});
```

## Client Options
| Option      | Type                  | Default | Description                                   |
|-------------|-----------------------|---------|-----------------------------------------------|
| baseUrl     | string                |         | The base domain url to be used for the client |
| retry       | Retry Options         |         | The retry options                             |
| cache       | LRUCache<string, any> |         | The LRU cache instance                        |
| cacheNative | boolean               | true    | Use native Undici's cache                     |
| undici      | Undici Option         |         | The undici options                            |

## Retry Options
| Option          | Type                                | Default                      | Description                                   |
|-----------------|-------------------------------------|------------------------------|-----------------------------------------------|
| httpCodes       | number[]                            | 502, 503, 429, 408, 504, 599 | The HTTP codes to be retried                  |
| baseTimeout     | number                              | 300                          | The base timeout in ms                        |
| maxTimeout      | number                              | 30000                        | The max timeout in ms                         |
| maxRetry        | number                              | 3                            | The max number of retry                       |
| backoff         | (retryCount: number) => number      | exponential backoff          | The backoff function                          |

## Undici Options
| Option          | Type             | Default | Description                                   |
|-----------------|------------------|---------|-----------------------------------------------|
| clientOption    | Pool.Options     |         | The number of connections                     |
| pipelining      | number           |         | The number of pipelining                      |

## RequestOptions
| Option          | Type                                | Default | Description                                   |
|-----------------|-------------------------------------|---------|-----------------------------------------------|
| headers         | Record<string, string>              |         | The HTTP headers                              |
| body            | any                                 |         | The HTTP body                                 |
| ttl             | number                              |         | The TTL for the cache                         |
| requestKey      | string                              |         | The key for the cache                         |
| path            | string                              |         | The path for the request                      |

**Notes**:<br>
The cache is a simple LRU cache with a max size of 1000 items and a default TTL of 30 seconds.<br>
The cache can be enabled using the `requestKey` option in the request (cache TTL must be positive). If cache is enabled will disable Undici's cache.<br>
The cache TTL can be modified using the `ttl` option in the request.<br>
When the request is not idempotent, the cache is disabled.<br>
When the body is a plain object the header content-type "application/json" is added to request.<br>
When response is a not compressible (typically a binary response) array buffer are returned.<br>
Parallel idempotent requests at same resource are deduplicated.<br>

## Methods
### request
```typescript
request<T = any>(options: RequestOptions): Promise<Response<T>>;
```
### get
```typescript
get<T = any>(path: string, options?: Omit<RequestOptions, "path" | "method" | "body" >): Promise<Response<T>>;
```
### post
```typescript
post<T = any>(path: string, options?: Omit<RequestOptions, "path" | "method">): Promise<Response<T>>;
```
### put
```typescript
put<T = any>(path: string, options?: Omit<RequestOptions, "path" | "method">): Promise<Response<T>>;
```
### patch
```typescript
patch<T = any>(path: string, options?: Omit<RequestOptions, "path" | "method">): Promise<Response<T>>;
```
### delete
```typescript
delete<T = any>(path: string, options?: Omit<RequestOptions, "path" | "method" | "body" | "ttl">): Promise<Response<T>>;
```

## License
Licensed under [MIT](./LICENSE).