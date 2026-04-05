import * as vscode from 'vscode';

export class Logger {

    private outputChannel: vscode.OutputChannel;

    constructor(){
        this.outputChannel = vscode.window.createOutputChannel('DCS Scripting Tools');
    }

    log(message: string) {
        this.outputChannel.appendLine(message);
    }

    info(message: string) {
        this.outputChannel.appendLine(`[${new Date().toISOString()}][INFO] ${message}`);
    }

    error(message: string) {
        this.outputChannel.appendLine(`[${new Date().toISOString()}][ERROR] ${message}`);
    }

    dispose() {
        this.outputChannel.dispose();
    }
}