# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project attempts to adhere to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.11] - 2019-06-28

### Fixed

- Publishing dist folder

## [0.0.10] - 2019-06-28

### Fixed

- Make `logger` an optional property in the TypeScript interface.

## [0.0.9] - 2019-06-28

### Fixed

- Make allowed CURL header size more conservative.

## [0.0.4] - 2018-08-15

### Added

- TypeScript watching, ala `yarn run watch`
- TypeScript is back in strict mode
- Improved logging by leveraging `util.inspect` to prevent
  potentially large JSON bodies cluttering logs
- The final `req.body` is now part of the `next(err)` object
- This CHANGELOG

### Fixed

- A nasty bug reported in some cases with the request module, which
  was resolved by spreading `agentOptions` onto the request
