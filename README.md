# Simple REST client using undici

[![NPM version](https://img.shields.io/npm/v/@fgiova/undici-rest-client.svg?style=flat)](https://www.npmjs.com/package/@fgiova/undici-rest-client)
![CI workflow](https://github.com/fgiova/undici-rest-client/actions/workflows/node.js.yml/badge.svg)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![Maintainability](https://api.codeclimate.com/v1/badges/__/maintainability)](https://codeclimate.com/github/fgiova/undici-rest-client/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/__/test_coverage)](https://codeclimate.com/github/fgiova/undici-rest-client/test_coverage)

## Description
This is a simple REST client using [undici](https://www.npmjs.com/package/undici) as http client.<br>
It's support a simple retry mechanism using exponential backoff or using delay based on retry-after HTTP header 
It's implement a simple LRU cache mechanism on idempotent HTTP methods.

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