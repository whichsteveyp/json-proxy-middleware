'use strict';

const NS_PER_SEC = 1e9;
const MS_PER_NS = 1e6;

const _ = require('lodash');
const request = require('request');

const reqOptions = ['method', 'agentOptions'];

const defaultHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

// This middleware proxies requests through Node to a backend service.
// You _must_ register bodyParser.json() before mounting this middleware. Also,
// it only works for JSON bodies (and not, for instance, form encoded bodies,
// or bodies with YAML, or anything else like that).
//
// `grpcClient` is an instance of a `EurekaClient` (like the ones returned by
// `generateEurekaClients`)
module.exports = ({ grpcClient, log, msg, headers = {} }) => (req, res) => {
  const { originalUrl, baseUrl } = req;
  const urlPath = originalUrl.replace(baseUrl, '');
  const requestToForward = _.pick(req, reqOptions);

  const urlHost = grpcClient.getUrlHost();

  if (typeof urlHost !== 'string' || !urlHost) {
    return res.status(500).send({
      errors: [
        {
          status: 500,
          code: 'EUREKA_CLIENT_ERROR',
          title: 'A service did not return a host from Eureka.',
          detail:
            `The service may be down, or you may have misconfigured a VIP.` +
            ` Check your Eureka client configuration.`,
          meta: {
            eurekaOptions: grpcClient.getEurekaOptions(),
            proxyMessage: msg || '',
          },
        },
      ],
    });
  }

  const headersToUse =
    typeof headers === 'function' ? headers(req, res) : headers;

  const fullHeaders = {
    ...defaultHeaders,
    ...headersToUse,
  };

  requestToForward.headers = fullHeaders;

  const requestOptions = Object.assign(requestToForward, {
    url: `${urlHost}${urlPath}`,
    body: JSON.stringify(req.body),
  });

  const canLog = log && log.info && typeof log.info === 'function';

  if (canLog) {
    let fullMsg = 'Proxy start.';
    if (msg) {
      fullMsg += ` ${msg}`;
    }
    log.info(
      {
        urlHost,
        urlPath,
        requestId: req.id || '',
        headers: fullHeaders,
        url: `${urlHost}${urlPath}`,
        body: JSON.stringify(req.body),
      },
      fullMsg
    );
  }

  const startTime = process.hrtime();
  const requestStream = request(requestOptions);

  requestStream.on('error', err => {
    res.status(500).send({
      errors: [
        {
          status: 500,
          code: 'PROXY_REQUEST_ERROR',
          title: 'There was an error while making the proxied request.',
          detail: `The proxied path is ${urlPath}. The host is ${urlHost}.`,
          meta: {
            err,
            eurekaOptions: grpcClient.getEurekaOptions(),
            url: `${urlHost}${urlPath}`,
          },
        },
      ],
    });
  });

  const responseStream = requestStream.pipe(res);
  responseStream.on('error', err => {
    res.status(500).send({
      errors: [
        {
          status: 500,
          code: 'PROXY_RESPONSE_ERROR',
          title: 'There was an error while streaming the response.',
          detail: `The proxied path is ${urlPath}. The host is ${urlHost}.`,
          meta: {
            err,
            eurekaOptions: grpcClient.getEurekaOptions(),
            url: `${urlHost}${urlPath}`,
          },
        },
      ],
    });
  });

  responseStream.on('finish', () => {
    if (canLog) {
      let fullMsg = 'Proxy end.';
      if (msg) {
        fullMsg += ` ${msg}`;
      }
      const diffTime = process.hrtime(startTime);
      const nanoseconds = diffTime[0] * NS_PER_SEC + diffTime[1];
      const milliseconds = nanoseconds / MS_PER_NS;
      const duration = `${milliseconds} ms`;
      log.info(
        { urlHost, urlPath, duration, requestId: req.id || '' },
        fullMsg
      );
    }
  });
};
