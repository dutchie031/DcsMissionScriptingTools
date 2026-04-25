import * as core from '@actions/core';
import { ScriptCompiler, ScriptCompilerOptions, CompilationError, ICompilationLogger } from 'dcs-script-compiler';

class Logger implements ICompilationLogger {
    info(message: string): void {
        core.info(message);
    }

    error(message: string): void {
        core.error(message);
    }

    writeLine(message: string): void {
        core.info(message);
    }
}

async function run() {
    try {

        const sourceRoot = core.getInput('source-root');
        if (!sourceRoot) {
            core.setFailed('Source root is required.');
            return;
        }
        const outputFile = core.getInput('output-file');
        if (!outputFile) {
            core.setFailed('Output file path is required.');
            return;
        }

        const logger = new Logger();

        const outputFileName = outputFile.split('/').pop() || 'compiled.lua';
        const outputFolderPath = outputFile.substring(0, outputFile.lastIndexOf('/'));

        const options: ScriptCompilerOptions = {
            sourcePath: sourceRoot,
            outputPath: outputFolderPath,
            outputFileName: outputFileName,
            minify: false,
            onError: (error: CompilationError) => {
                logger.error(`Error in file ${error.filePath} at line ${error.line}: ${error.message}`);
                core.setFailed(`Compilation error in file ${error.filePath} at line ${error.line}: ${error.message}`);
            }
        }

        const compiler = new ScriptCompiler(options, logger);
        await compiler.compile(false);
        core.info('Compilation completed successfully.');
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed('An unknown error occurred.');
        }
    }
}

run();
