// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ScriptCompiler, ScriptCompilerOptions, CompilationError, ICompilationLogger } from 'dcs-script-compiler';
import { Logger } from './logger';

const luaWorkSpaceSettingKey = "Lua.workspace";
const librarySettingsKey = "library";
const diagnosticCollection = vscode.languages.createDiagnosticCollection('lua-transpiler');

let pluginPath : string | undefined;

const logger = new Logger();

const extensionName = 'dutchies-dcs-scripting-tools';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    
	pluginPath = context.asAbsolutePath('lua-addons');
   
    vscode.commands.registerCommand('dutchies-dcs-scripting-tools.enable', () => {
        addPluginPathToSettings();
        vscode.commands.executeCommand(
            "lua.startServer"
        );
        vscode.window.showInformationMessage('Dutchies DCS Scripting Tools enabled.');
    });

    vscode.commands.registerCommand('dutchies-dcs-scripting-tools.disable', () => {
        removePluginPathFromSettings();
        vscode.commands.executeCommand(
            "lua.startServer"
        );
        vscode.window.showInformationMessage('Dutchies DCS Scripting Tools disabled.');
    });

    vscode.commands.registerCommand('dutchies-dcs-scripting-tools.compileLuaScripts', async () => {
        try{
            const start = Date.now();
            await compileLuaScripts();
            const end = Date.now();
            vscode.window.showInformationMessage(`Lua scripts compiled successfully in ${(end - start) / 1000} seconds.`);
        }catch(err){ 
            vscode.window.showErrorMessage('Error compiling Lua scripts: ' + (err as Error).message);
        }
    });
}

// This method is called when your extension is deactivated
export function deactivate() 
{
    removePluginPathFromSettings();
}

class CompilationLogger implements ICompilationLogger {

    constructor(
        private readonly logger: Logger) {
    }
    info(message: string): void {
        this.logger.info(message);
    }
    error(message: string): void {
        this.logger.error(message);
    }
    writeLine(message: string): void {
        this.logger.log(message);
    }
}

async function compileLuaScripts() {

    const config = vscode.workspace.getConfiguration('dcsScriptingTools');
    const sourcePath = config.get<string>('luaSourcePath') || '${workspaceFolder}/src';
    const outputPath = config.get<string>('luaOutputPath') || '${workspaceFolder}/dist';
    const minify = config.get<boolean>('minifyLuaScripts') || false;

    const resolvedSourcePath = sourcePath.replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
    const resolvedOutputPath = outputPath.replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0].uri.fsPath || '');
    
    diagnosticCollection.clear();
    const errorsByFile = new Map<string, CompilationError[]>();

    const options: ScriptCompilerOptions = {
        sourcePath: resolvedSourcePath,
        outputPath: resolvedOutputPath,
        minify: minify,
        onError: (error: CompilationError) => {
            const errors = errorsByFile.get(error.filePath) || [];
            errors.push(error);
            errorsByFile.set(error.filePath, errors);
        }
    };

    const compilationLogger = new CompilationLogger(logger);
    const compiler = new ScriptCompiler(options, compilationLogger);
    try {
        await compiler.compile();
    } catch (err) {
        vscode.window.showErrorMessage('Compilation failed: ' + (err as Error).message);
    }
    
    // Update diagnostics
    diagnosticCollection.clear();
    for (const [filePath, errors] of errorsByFile) {
        const uri = vscode.Uri.file(filePath);
        const diagnostics = errors.map(error => {
            const range = new vscode.Range(error.line, error.charStart ?? 0, error.line, error.charEnd ?? 0);
            const diagnostic = new vscode.Diagnostic(range, error.message, vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'DCS Lua Transpiler';
            return diagnostic;
        });
        diagnosticCollection.set(uri, diagnostics);
    }
}

function addPluginPathToSettings() {
    if (pluginPath) {
        const luaSettings = vscode.workspace.getConfiguration(luaWorkSpaceSettingKey);
        const librarySettings = luaSettings.get<string[]>(librarySettingsKey) || [];
        if (!librarySettings.includes(pluginPath)) {
            librarySettings.push(pluginPath);
            luaSettings.update(librarySettingsKey, librarySettings, vscode.ConfigurationTarget.Workspace);
        }
    }
}

function removePluginPathFromSettings() {  
    if (pluginPath) {
        const luaSettings = vscode.workspace.getConfiguration(luaWorkSpaceSettingKey);
        const librarySettings = luaSettings.get<string[]>(librarySettingsKey) || [];
        const libIndex = librarySettings.indexOf(pluginPath);
        if (libIndex !== -1) {
            librarySettings.splice(libIndex, 1);
            luaSettings.update(librarySettingsKey, librarySettings, vscode.ConfigurationTarget.Workspace);
        }
    }
}
