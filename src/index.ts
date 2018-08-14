'use strict';

import bunyan from 'bunyan';
import { Request, RequestHandler, Response } from 'express';
import _pick from 'lodash/pick';
import request from 'request';
import { inspect } from 'util';
import VError from 'verror';

export type UrlHost = string | ((req: Request, res: Response) => string);
export type HeaderOption = object | ((req: Request, res: Response) => request.Headers);
export type LoggerOption =
  | bunyan
  | Console
  | {
      info(message?: any, ...optionalParams: any[]): void;
      error(message?: any, ...optionalParams: any[]): void;
    };

export interface ProxyMiddlewareOptions {
  additionalLogMessage: string;
  headers: HeaderOption;
  logger: LoggerOption;
  urlHost: UrlHost;
}

interface AgentOptionsRequest extends Request {
  agentOptions: any;
}

// we use these for more accurate timing when logging
const NS_PER_SEC: number = 1e9;
const MS_PER_NS: number = 1e6;

// by default, we intend to proxy only json responses
const defaultHeaders: object = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// This middleware proxies requests through Node to a backend service.
// You _must_ register bodyParser.json() before mounting this middleware. Also,
// it only works for JSON bodies (and not, for instance, form encoded bodies,
// or bodies with YAML, or anything else like that).
export default (options: ProxyMiddlewareOptions): RequestHandler => (
  req,
  res,
  next,
) => {
  const { logger, additionalLogMessage, headers, urlHost } = options;
  const { originalUrl, baseUrl, agentOptions } = req as AgentOptionsRequest;
  const urlPath = originalUrl.replace(baseUrl, '');

  const canLogError =
    logger && logger.error && typeof logger.error === 'function';
  const host = typeof urlHost === 'function' ? urlHost(req, res) : urlHost;
  if (typeof host !== 'string') {
    if (canLogError) {
      let fullMsg = 'Proxy Error: PROXY_HOST_ERROR';
      if (additionalLogMessage) {
        fullMsg += ` ${additionalLogMessage}`;
      }
      logger.error(
        {
          host,
          urlPath,
          url: `${host}${urlPath}`,
        },
        fullMsg,
      );
    }

    next(
      new VError(
        {
          name: 'PROXY_HOST_ERROR',
          info: {
            detail:
              `The options.urlHost provided either was not a string, or the value` +
              `returned from invoking urlHost() was not a string.`,
            meta: {
              additionalLogMessage: additionalLogMessage || '',
              body: req.body,
            },
          },
        },
        '`urlHost` could not be resolved to a valid string.',
      ),
    );
    return;
  }

  const headersToUse: request.Headers =
    typeof headers === 'function' ? headers(req, res) : headers || {};

  const fullHeaders: request.Headers = {
    ...defaultHeaders,
    ...headersToUse,
  };

  const requestOptions = {
    ...agentOptions, // https://github.com/request/request/issues/2964
    headers: fullHeaders,
    method: req.method,
    url: `${host}${urlPath}`,
    body: JSON.stringify(req.body),
  };

  const canLogInfo = logger && logger.info && typeof logger.info === 'function';

  if (canLogInfo) {
    let fullMsg = 'Proxy start.';
    if (additionalLogMessage) {
      fullMsg += ` ${additionalLogMessage}`;
    }
    logger.info(
      {
        host,
        urlPath,
        headers: fullHeaders,
        url: `${host}${urlPath}`,
        body: inspect(req.body, { maxArrayLength: 20 }),
      },
      fullMsg,
    );
  }

  const startTime = process.hrtime();
  const requestStream = request(requestOptions);

  requestStream.on('error', err => {
    if (canLogError) {
      let fullMsg = 'Proxy Error: PROXY_REQUEST_ERROR';
      if (additionalLogMessage) {
        fullMsg += ` ${additionalLogMessage}`;
      }
      logger.error(
        {
          host,
          urlPath,
          url: `${host}${urlPath}`,
        },
        fullMsg,
      );
    }

    next(
      new VError(
        {
          name: 'PROXY_REQUEST_ERROR',
          cause: err,
          info: {
            detail: `The proxied path is ${urlPath}. The host is ${host}.`,
            meta: {
              additionalLogMessage: additionalLogMessage || '',
              url: `${host}${urlPath}`,
              body: req.body,
            },
          },
        },
        'There was an error while making the proxied request.',
      ),
    );
    return;
  });

  const responseStream = requestStream.pipe(res);
  responseStream.on('error', err => {
    if (canLogError) {
      let fullMsg = 'Proxy Error: PROXY_RESPONSE_ERROR';
      if (additionalLogMessage) {
        fullMsg += ` ${additionalLogMessage}`;
      }
      logger.error(
        {
          host,
          urlPath,
          url: `${host}${urlPath}`,
        },
        fullMsg,
      );
    }

    next(
      new VError(
        {
          name: 'PROXY_RESPONSE_ERROR',
          cause: err,
          info: {
            detail: `The proxied path is ${urlPath}. The host is ${host}.`,
            meta: {
              additionalLogMessage: additionalLogMessage || '',
              url: `${host}${urlPath}`,
              body: req.body,
            },
          },
        },
        'There was an error while streaming the response.',
      ),
    );
    return;
  });

  responseStream.on('finish', () => {
    if (canLogInfo) {
      let fullMsg = 'Proxy end.';
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
