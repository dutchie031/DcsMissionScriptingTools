#!/bin/bash
set -e

npm install
cd dutchies-dcs-scripting-tools
npm install
npm run package
npx @vscode/vsce package --no-dependencies