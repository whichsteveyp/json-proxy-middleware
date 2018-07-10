"use strict";

import _pick from "lodash/pick";
import request from "request";
import { RequestHandler, Request, Response } from "express";
import bunyan from "bunyan";

// we use these for more accurate timing when logging
const NS_PER_SEC: number = 1e9;
const MS_PER_NS: number = 1e6;
//
const reqOptions = ["method", "agentOptions"];
// by default, we intend to proxy only json responses
const defaultHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json"
};

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
  urlHost: UrlHost;
  headers: HeaderOption;
  logger: LoggerOption;
  disableLogging: boolean;
  additionalLogMessage: string;
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
  const {
    logger,
    additionalLogMessage,
    headers,
    urlHost,
    disableLogging
  } = options;
  const { originalUrl, baseUrl } = req;
  const urlPath = originalUrl.replace(baseUrl, "");
  const requestToForward = _pick(req, reqOptions);

  let proxyHost: string;
  if (typeof urlHost === "function") {
    proxyHost = urlHost(req, res);
  } else {
    proxyHost = urlHost;
  }

  if (typeof proxyHost !== "string") {
    // error, should likely be converted to a VError
    next({
      errors: [
        {
          status: 500,
          code: "PROXY_HOST_ERROR",
          title: "`urlHost` could not be resolved to a valid string.",
          detail:
            `The options.urlHost provided either was not a string, or the value` +
            `returned from invoking urlHost() was not a string.`,
          meta: {
            additionalLogMessage: additionalLogMessage || ""
          }
        }
      ]
    });
  }

  const headersToUse: request.Headers =
    typeof headers === "function" ? headers(req, res) : headers || {};

  const fullHeaders = {
    ...defaultHeaders,
    ...headersToUse
  };

  requestToForward.headers = fullHeaders;

  const requestOptions = Object.assign(requestToForward, {
    url: `${urlHost}${urlPath}`,
    body: JSON.stringify(req.body)
  });

  const canLog = logger && logger.info && typeof logger.info === "function";

  if (canLog && !disableLogging) {
    let fullMsg = "Proxy start.";
    if (additionalLogMessage) {
      fullMsg += ` ${additionalLogMessage}`;
    }
    logger.info(
      {
        urlHost,
        urlPath,
        headers: fullHeaders,
        url: `${urlHost}${urlPath}`,
        body: JSON.stringify(req.body)
      },
      fullMsg
    );
  }

  const startTime = process.hrtime();
  const requestStream = request(requestOptions);

  requestStream.on("error", err =>
    next({
      errors: [
        {
          status: 500,
          code: "PROXY_REQUEST_ERROR",
          title: "There was an error while making the proxied request.",
          detail: `The proxied path is ${urlPath}. The host is ${urlHost}.`,
          meta: {
            err,
            url: `${urlHost}${urlPath}`
          }
        }
      ]
    })
  );

  const responseStream = requestStream.pipe(res);
  responseStream.on("error", err =>
    next({
      errors: [
        {
          status: 500,
          code: "PROXY_RESPONSE_ERROR",
          title: "There was an error while streaming the response.",
          detail: `The proxied path is ${urlPath}. The host is ${urlHost}.`,
          meta: {
            err,
            url: `${urlHost}${urlPath}`
          }
        }
      ]
    })
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
      logger.info({ urlHost, urlPath, duration }, fullMsg);
    }
  });
};
