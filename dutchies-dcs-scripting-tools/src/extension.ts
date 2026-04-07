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
const publisherName = 'dutchie031';
const extensionSettingsFilter = `@ext:${publisherName}.${extensionName}`;

//TODO: 
// - ENABLE/DISABLE with settings instead of commands (or both)

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	pluginPath = context.asAbsolutePath('lua-addons');

    context.subscriptions.push(
        vscode.commands.registerCommand('dutchies-dcs-scripting-tools.enable', async () => {
            addPluginPathToSettings();
            await vscode.commands.executeCommand(
                "lua.startServer"
            );
            vscode.window.showInformationMessage('Dutchies DCS Scripting Tools enabled.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dutchies-dcs-scripting-tools.disable', async () => {
            removePluginPathFromSettings();
            await vscode.commands.executeCommand(
                "lua.startServer"
            );
            vscode.window.showInformationMessage('Dutchies DCS Scripting Tools disabled.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dutchies-dcs-scripting-tools.openSettings', async () => {
            await vscode.commands.executeCommand("workbench.action.openSettings", `@ext:${extensionSettingsFilter}`);
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('dutchies-dcs-scripting-tools.compileLuaScripts', async () => {
            try{
                const start = Date.now();
                await compileLuaScripts();
                const end = Date.now();
                vscode.window.showInformationMessage(`Lua scripts compiled successfully in ${(end - start) / 1000} seconds.`);
            }catch(err){ 
                vscode.window.showErrorMessage('Error compiling Lua scripts: ' + (err as Error).message);
            }
        })
    );

    vscode.workspace.onDidSaveTextDocument(async(document) => {
        logger.info(`Document saved: ${document.uri.fsPath} | Language: ${document.languageId}`);
        if (document.languageId === 'lua') {
            const config = vscode.workspace.getConfiguration(extensionName);
            const compileAt = config.get<string>('compileAt') || "undefined";
            if (compileAt === 'onSave') {
                await compileLuaScripts();
            }
        }
    });

    vscode.workspace.onDidChangeConfiguration(async(event) => {
        if (event.affectsConfiguration(`${extensionName}.dcsTypes`)) {
            const config = vscode.workspace.getConfiguration(extensionName);
            const dcsTypesEnabled = config.get<boolean>('dcsTypes') || false;
            if (dcsTypesEnabled) {
                addPluginPathToSettings();
            } else {
                removePluginPathFromSettings();
            }
        }
    });

    logger.info('Dutchies DCS Scripting Tools extension activated');
}

// This method is called when your extension is deactivated
export function deactivate() 
{
    removePluginPathFromSettings();
    logger.info('Dutchies DCS Scripting Tools extension deactivated');
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
    logger.clear();
    logger.info("Compiling...");

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

async function enableIntellisense() {
    addPluginPathToSettings();
    await vscode.commands.executeCommand(
        "lua.startServer"
    );
    vscode.window.showInformationMessage('Dutchies DCS Scripting Tools enabled.');
}

async function disableIntellisense() {
    removePluginPathFromSettings();
    await vscode.commands.executeCommand(
        "lua.startServer"
    );
    vscode.window.showInformationMessage('Dutchies DCS Scripting Tools disabled.');
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
