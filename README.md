laele-cli
=========

Laele Test NodeJS Cli App

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/laele-cli.svg)](https://npmjs.org/package/laele-cli)
[![Downloads/week](https://img.shields.io/npm/dw/laele-cli.svg)](https://npmjs.org/package/laele-cli)
[![License](https://img.shields.io/npm/l/laele-cli.svg)](https://github.com/edsonma/laele-cli/blob/master/package.json)

<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g laele-cli
$ laele COMMAND
running command...
$ laele (-v|--version|version)
laele-cli/0.0.0 darwin-x64 node-v12.11.1
$ laele --help [COMMAND]
USAGE
  $ laele COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`laele app:ping`](#laele-appping)
* [`laele hello`](#laele-hello)
* [`laele help [COMMAND]`](#laele-help-command)

## `laele app:ping`

Describe the command here

```
USAGE
  $ laele app:ping

OPTIONS
  -n, --name=name  name to print

DESCRIPTION
  ...
  Extra documentation goes here
```

_See code: [src/commands/app/ping.js](https://github.com/edsonma/laele-cli/blob/v0.0.0/src/commands/app/ping.js)_

## `laele hello`

Describe the command here

```
USAGE
  $ laele hello

OPTIONS
  -n, --name=name  name to print

DESCRIPTION
  ...
  Extra documentation goes here
```

_See code: [src/commands/hello.js](https://github.com/edsonma/laele-cli/blob/v0.0.0/src/commands/hello.js)_

## `laele help [COMMAND]`

display help for laele

```
USAGE
  $ laele help [COMMAND]

ARGUMENTS
  COMMAND  command to show help for

OPTIONS
  --all  see all commands in CLI
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v2.2.1/src/commands/help.ts)_
<!-- commandsstop -->
