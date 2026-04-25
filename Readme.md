# Dutchies DCS Mission Scripting Tools

This repository is what I see as useful tools for DCS mission scripting. It contains a VS Code extension for easy DCS mission scripting, a Github Action for automatically compiling your mission scripts. 

For me, I've used it in [Spearhead](https://github.com/dutchie031/Spearhead) and am using it for every script I write. 

## VS Code Extension

### Features: 

Get the extension here: https://marketplace.visualstudio.com/items?itemName=dutchie031.dutchies-dcs-scripting-tools

- [x] Syntax highlighting for DCS mission scripts
- [ ] Code snippets for common DCS scripting patterns
- [x] Compilation of mission scripts on save (or command) 
- [x] Additional dev script that can be used in DCS. <br>
      This way the compiled file will be reloaded on each mission restart. <br> 
      Without having to re-import the script file into the mission.

## Github Action

### Features:

- [x] Compile the mission script just like in the VS Code extension, but in a Github Action.

### Usage:

```yaml

name: Compile Scripts
on: [push]
jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dutchie031/DcsMissionScriptingTools/github-action@action/v1
        with:
          source-root: 'src'
          output-file: 'output/compiled.lua'

      - name: Upload Compiled Script
        uses: actions/upload-artifact@v3
        with:
          name: compiled-script
          path: output/compiled.lua

     
```