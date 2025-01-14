# `yarn-plugin-licenses-json`

This is a fork of [yarn-plugin-licenses](https://github.com/mhassan1/yarn-plugin-licenses), with (hopefully) better support for exporting the licenses to json.
This is a Yarn v3 plugin that adds `yarn licenses` commands (similar to what Yarn v1 had).

## Install

```
yarn plugin import https://raw.githubusercontent.com/sarahsporck/yarn-plugin-licenses-json/v1.0.0/bundles/%40yarnpkg/plugin-licenses.js
```

## Usage

```shell script
yarn licenses list --help
```

## Testing

`yarn test`

NOTE: Integration tests require `yarn build` first.

## Publishing

`npm version <version>`

## License

MIT
