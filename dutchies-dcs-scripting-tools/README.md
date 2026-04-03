# dutchies-dcs-scripting-tools 

My view on a toolset you'll need to write DCS mission scripts. 
Direct DCS API checking and a Transpiler that can help keep huge complex scripts and frameworks simple and overseeable.

## Features

- DCS API checking in VSCode
  Automatic checking of your code for DCS API errors.
- Transpiler
  A tool that can help you write more complex scripts in a more simple and overseeable way.
  Transpiles multiple files into a single file that can be used in DCS, using standard Lua syntax and features.


## How To use

### Intellisense and API checking in VSCode.

1. Install the extension in VSCode.
2. Open your workspace with your DCS mission scripts.
3. Enable: `> Dutchies Scripting Tools: Enable`

### Transpiler

1. Make sure you have the code in `./src` folder by default, or change the `src` folder in the settings.
   `settings.json`:
   ```json
   {
     "dutchiesScriptingTools.src": "./src"
   }
   ```

2. Write your code in the `src` folder, with possible subfolders. You can use standard Lua syntax and features, and the transpiler will handle the rest.

NOTE: 
There's no implicit entry point. The whole code will be put into a single Lua file. <br>
The order of the files depends on dependencies via the `require` function. So if you have a file `main.lua` that requires `utils.lua`, the transpiler will first transpile `utils.lua` and then `main.lua`. <br>
This means that if you have code that executes on load, it will be executed. <br>
Best practice is to have 1 file that executes and the rest be modules. <br>
Eg. `main.lua`:
```lua
local utils = require("utils")   

utils.printHelloWorld()

```
And `utils.lua`:
```lua
local utils = {}
utils.printHelloWorld = function()
    env.info("Hello World!")
end
return utils
```

## Possible Future Features

- DCS Snippets
  A collection of useful code snippets for DCS scripting in VSCode.


## Requirements

`sumenko.lua` : The VSCode Lua Language Server

## Release Notes

### 0.0.1

Initial. 
Still very much in Test/Development. Use at your own risk.

