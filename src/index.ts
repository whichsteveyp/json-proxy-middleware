"use strict";

import _pick from "lodash/pick";
import request from "request";
import { RequestHandler, Request, Response } from "express";
import bunyan from "bunyan";
import VError from "verror";

// we use these for more accurate timing when logging
const NS_PER_SEC: number = 1e9;
const MS_PER_NS: number = 1e6;

// by default, we intend to proxy only json responses
const defaultHeaders: object = {
  Accept: "application/json",
  "Content-Type": "application/json"
};

const reqOptions = ["method", "agentOptions"];

type UrlHost = string | ((req: Request, res: Response) => string);
type HeaderOption = object | ((req: Request, res: Response) => request.Headers);
type LoggerOption =
  | bunyan
  | Console
  | {
      info(message?: any, ...optionalParams: any[]): void;
      error(message?: any, ...optionalParams: any[]): void;
    };

interface ProxyMiddlewareOptions {
  additionalLogMessage: string;
  headers: HeaderOption;
  logger: LoggerOption;
  urlHost: UrlHost;
}

// This middleware proxies requests through Node to a backend service.
// You _must_ register bodyParser.json() before mounting this middleware. Also,
// it only works for JSON bodies (and not, for instance, form encoded bodies,
// or bodies with YAML, or anything else like that).
export default (options: ProxyMiddlewareOptions): RequestHandler => (
  req,
  res,
  next
) => {
  const { logger, additionalLogMessage, headers, urlHost } = options;
  const { originalUrl, baseUrl } = req;
  const urlPath = originalUrl.replace(baseUrl, "");
  const requestToForward = _pick(req, reqOptions);

  let host = typeof urlHost === "function" ? urlHost(req, res) : urlHost;
  if (typeof host !== "string") {
    next(
      new VError(
        {
          name: "PROXY_HOST_ERROR",
          info: {
            detail:
              `The options.urlHost provided either was not a string, or the value` +
              `returned from invoking urlHost() was not a string.`,
            meta: {
              additionalLogMessage: additionalLogMessage || ""
            }
          }
        },
        "`urlHost` could not be resolved to a valid string."
      )
    );
    return;
  }

  const headersToUse: request.Headers =
    typeof headers === "function" ? headers(req, res) : headers || {};

  const fullHeaders: request.Headers = {
    ...defaultHeaders,
    ...headersToUse
  };

  requestToForward.headers = fullHeaders;

  const requestOptions = Object.assign(requestToForward, {
    url: `${host}${urlPath}`,
    body: JSON.stringify(req.body)
  });

  const canLog = logger && logger.info && typeof logger.info === "function";

  if (canLog) {
    let fullMsg = "Proxy start.";
    if (additionalLogMessage) {
      fullMsg += ` ${additionalLogMessage}`;
    }
    logger.info(
      {
        host,
        urlPath,
        headers: fullHeaders,
        url: `${host}${urlPath}`,
        body: JSON.stringify(req.body)
      },
      fullMsg
    );
  }

  const startTime = process.hrtime();
  const requestStream = request(requestOptions);

  requestStream.on("error", err =>
    next(
      new VError(
        {
          name: "PROXY_REQUEST_ERROR",
          cause: err,
          info: {
            detail: `The proxied path is ${urlPath}. The host is ${host}.`,
            meta: {
              additionalLogMessage: additionalLogMessage || "",
              url: `${host}${urlPath}`
            }
          }
        },
        "There was an error while making the proxied request."
      )
    )
  );

  const responseStream = requestStream.pipe(res);
  responseStream.on("error", err =>
    next(
      new VError(
        {
          name: "PROXY_RESPONSE_ERROR",
          cause: err,
          info: {
            detail: `The proxied path is ${urlPath}. The host is ${host}.`,
            meta: {
              additionalLogMessage: additionalLogMessage || "",
              url: `${host}${urlPath}`
            }
          }
        },
        "There was an error while streaming the response."
      )
    )
  );

  responseStream.on("finish", () => {
    if (canLog) {
      let fullMsg = "Proxy end.";
      if (additionalLogMessage) {
        fullMsg += ` ${additionalLogMessage}`;
      }
      const diffTime = process.hrtime(startTime);
      const nanoseconds = diffTime[0] * NS_PER_SEC + diffTime[1];
      const milliseconds = nanoseconds / MS_PER_NS;
      const duration = `${milliseconds} ms`;
      logger.info({ host, urlPath, duration }, fullMsg);
    }
  });
};
