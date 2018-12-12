# json-proxy-middleware

This is a simple middleware utility that can be used to proxy JSON requests
for Express node.js servers. This is most useful when you want to simply
pass a response from a service to a client, without needing to buffer or
modify it. For example, your server could do an authentication check, and
then simply stream the data from the service to the client.

### Quick Start

Assuming you have an express Router, here's a quick way to get things wired up:

```js
import express from "express";
import jsonProxy from "json-proxy-middleware";

const router = new express.Router();

router.get(
  "/service/proxy/path",
  (req, res, next) => {
    if (req.user.isLoggedIn) {
      next();
    }
  },
  jsonProxy({
    urlHost: "https://my.service.url",
    headers: {
      "x-custom-header-calling-application-name": "my-application"
    }
  }),
  (error, req, res, next) => {
    res.status(500).json({
      message: "Whoops! The Proxy Middleware Broke!"
    });
  }
);

export default router;
```

In the example above, let's break down what happened in our router:

1.  We have some middleware that first checked if a user was loggedIn, assuming
    they are with whatever auth your app is using, we let them through.
1.  We created a `jsonProxy` middleware `RequestHandler`, and pointed it to
    `https://my.service.url`, and attached some custom HTTP headers for the
    service.
1.  We also provided an error handler, which we can use to inform our clients
    of the error how our application best sees fit. This is _different_ from the
    service responding with an error, in which case that would have just been
    proxied through as well.

### API

`json-proxy-middleware` is designed to be fairly flexible, yet performant for
configuring how & where you proxy requests through your node.js middletier.
The quick start above includes the barebones to get you up and running. Below
is the full API with some details on how to use the middleware in a variety
of different scenarios.

There is a single, default export from the utility, and that is the middleware
itself:

```js
import jsonProxy from "json-proxy-middleware";
```

It takes a single `ProxyMiddlewareOptions` object, and returns a `RequestHandler`
function:

```js
jsonProxy({
  additionalLogMessage: "custom appended log message",
  headers: {
    "custom-additional-http-header": "value"
  }
  logger: console,
  urlHost: "https://my.service.uri",
});
```

| property               | type                            | description                                                                                            |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `additionalLogMessage` | `string` (optional)             | a message that will be appended to proxy start/end/error logging                                       |
| `headers(req, res)`    | `object`/`function` (optional)  | an object or function that returns an object with additional headers to forward on the proxied request |
| `logger`               | logger instance (optional)      | any valid logger instance with methods `.info()` and `.error()` to be called with logging messages     |
| `addCurlHeader`        | `boolean`/`function` (optional) | attaches a curlCommand to your request headers for easier debugging (defaults to false)                |
| `urlHost(req, res)`    | `string`/`function`             | a string or function that returns a string indicating a host to have a request proxied to              |

### `additionalLogMessage`

When a logger is provided, this message will be appended to to info/error logs and
can be used to customize the log messages per jsonProxy usage as needed.

### `headers`

When provided, these will be appended to the default headers that we forward. By
default we provide the headers necessary for JSON requests:

```js
{
  Accept: "application/json",
  "Content-Type": "application/json"
}
```

If you'd like, you can provide an object with static headers to forward, like so:

```js
jsonProxy({
  headers: { "custom-http-header": "static value" }
});
```

In some cases, you need to also forward request headers that came in from the client,
or you might need to forward headers based on the request itself. In that case,
you can provide a function that the middleware will call for each incoming proxy
request:

```js
jsonProxy({
  headers(req, res) {
    return {
      userId: req.user.getId(),
      session: req.sessionId
      // etc
    };
  }
});
```

Setting headers this way allows you to perform a white or black list style header
forwarding for the proxy as well.

### `logger`

When a logger is provided, `json-proxy-middleware` will log out information useful
for debugging, such as when a proxy request started, when it ended, and how long it
took. We also log out errors in the event those occur. You can provide any kind of
logger you prefer, as long as it has a `.info()` and `.error()` log level method to
invoke.

### `addCurlHeader`

It's often useful to debug a request using a curl command. You will see this in
your response headers as `headers['x-curl-command']`. You can set this option
as a boolean:

```js
router.get(
  "/service/REST/v1/**",
  jsonProxy({ urlHost: "https://my.service.url", addCurlHeader: true })
);
```

Or set it conditionally:

```js
router.get(
  "/service/REST/v1/**",
  jsonProxy({
    urlHost: "https://my.service.url",
    addCurlHeader: (req, res) => req.originalUrl.includes('foo.bar'),
  })
);
```

### `urlHost`

The `urlHost` is combined with the path on the proxy to perform a request. It is
required, and you can provide either a `string` or `function` that returns a string
for the request. The simplest example looks like this:

```js
router.get(
  "/service/REST/v1",
  jsonProxy({ urlHost: "https://my.service.url" })
);
```

This will result in `jsonProxy` making a `GET` request to:

```
https://my.service.url/service/REST/v1
```

Because of the way Express are designed with their routing, you can also
leverage this with regex / glob paths, like so:

```js
router.get(
  "/service/REST/v1/**",
  jsonProxy({ urlHost: "https://my.service.url" })
);
```

This will mean that `json-proxy-middleware` will proxy **any** paths that match.
It's a **great** idea to understand if this will open up security holes in your
service, and in general proxying requests through globs requires some thought &
coordination with the proxied service.

Another thing to note with Express servers, is that you can mount routes at
different base paths. `json-proxy-middleware` by default navigates this for you,
so keep that in mind when using proxy routers in scenarios like this:

```js
import express from "express";

const server = express();
const router = express.Router();

router.get(
  "/service/REST/v1/**",
  jsonProxy({ urlHost: "https://my.service.url" })
);

server.use("/proxy", router);
```

In this case, your clients will be making requests to `/proxy/service/REST/v1/**`,
but `json-proxy-middleware` will be proxying requests to
`https://my.service.url/service/REST/v1/**`, removing the `/api` portion from the
request.
