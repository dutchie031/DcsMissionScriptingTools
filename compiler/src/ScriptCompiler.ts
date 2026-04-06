import * as fs from 'fs';
import * as path from 'path';

export interface CompilationError {
    filePath: string;
    line: number;
    charStart?: number;
    charEnd?: number;
    message: string;
}

export interface ScriptCompilerOptions {
    sourcePath: string,
    outputPath: string,
    outputFileName?: string,
    minify: boolean,
    onError?: (error: CompilationError) => void
}

export interface ICompilationLogger {
    info(message: string): void;
    error(message: string): void;
    writeLine(message: string): void;
}

class Metrics {
    public totalLinesRead : number = 0;
    public totalLinesWritten: number = 0;
    public readTimeMs : number = 0;
    public writeTimeMs : number = 0;
    public totalTimeMs : number = 0;
    public filesRead : number = 0;
    public filesWritten : number = 0;

    log(logger: ICompilationLogger){
        logger.writeLine("Compilation Metrics: ")
        logger.writeLine(`=====================`)
        logger.writeLine(`Lines Read:       ${this.totalLinesRead}`)
        logger.writeLine(`Lines Written:    ${this.totalLinesWritten}`)
        logger.writeLine(`Files Processed:  ${this.filesRead} | ${this.filesWritten}`)
        logger.writeLine(`=====================`)
        logger.writeLine(`Read Time (ms):   ${this.readTimeMs} ms`)
        logger.writeLine(`Write Time (ms):  ${this.writeTimeMs} ms`)
        logger.writeLine(`Total Time (ms):  ${this.totalTimeMs} ms`)
    }
}

const LUA_SCRIPT_GLOBAL_KEYWORD = 'ScriptGlobals';

export class ScriptCompiler {

    constructor(private options: ScriptCompilerOptions, private logger: ICompilationLogger) {
        if (options.outputFileName === undefined) {
            this.options.outputFileName = 'compiled.lua';
        }
    }

    public async compile(): Promise<void> {
        const start = Date.now();
        const metricsMeter = new Metrics();
        const entries = fs.readdirSync(this.options.sourcePath, { recursive: true, withFileTypes: true });
        const parsedFiles: Map<string, ParsedFile> = new Map();

        const readStart = Date.now();
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.lua')) {
                

                const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
                const relativePath = path.relative(this.options.sourcePath, fullPath);
                const content = fs.readFileSync(fullPath, 'utf-8');
                
                const parsedFile = this.parseFile(relativePath, content, fullPath, metricsMeter);
                parsedFiles.set(parsedFile.fileKey, parsedFile);
                metricsMeter.filesRead++;
            }
        }
        const readEnd = Date.now();
        metricsMeter.readTimeMs = readEnd - readStart;

        const writer = new Writer(
            path.join(this.options.outputPath, this.options.outputFileName!),
            parsedFiles,
            this.logger,
            this.options.onError
        );
        
        const writeStart = Date.now();
        writer.write(metricsMeter);
        const writeEnd = Date.now();
        metricsMeter.writeTimeMs = (writeEnd - writeStart);

        writer.logDependencyTree();
        this.logger.info(`Compilation complete. Output written to ${path.join(this.options.outputPath, this.options.outputFileName!)}`);
        const end = Date.now();

        metricsMeter.totalTimeMs = (end-start);
        metricsMeter.log(this.logger);
    }

    private reportError(filePath: string, line: number, charStart: number | undefined, charEnd: number | undefined, message: string): void {
        if (this.options.onError) {
            this.options.onError({ filePath, line, charStart, charEnd, message });
        }
    }

    private parseFile(filePath: string, content: string, fullPath: string, metricsMeter: Metrics): ParsedFile {
        const dependencies: Dependency[] = [];
        const newLines: string[] = [`do --${filePath}`];

        content = stripLuaMultilineComments(content);
        const lines = content.split('\n').map(line => line.replace(/--.*$/, ''));
        
        const blockStack : string[] = [];
        let isInFunction = false;
        let foundModuleLevelReturn = false;
        let expectingDo = false;
        
        const blockFound = (blockType: string): void => {
            blockStack.push(blockType);
            if (blockType === 'function') {
                isInFunction = true;
            }
        };

        const blockClosed = (): void => {
            const closedBlock = blockStack.pop();
            if (closedBlock === 'function') {
                isInFunction = blockStack.includes('function');
            }
        };

        for (let i = 0; i < lines.length; i++) {
            metricsMeter.totalLinesRead++;
            let line = lines[i];
            const trimmedLine = line.trim();

            // Skip comments and blank lines
            if (trimmedLine === '' || trimmedLine.startsWith('--')) {
                continue;
            }

            // If we found module-level return, only allow 'end' statements after it
            if (foundModuleLevelReturn) {
                // Check for 'end' keyword
                if (/\bend\b/.test(trimmedLine)) {
                    const endMatches = trimmedLine.match(/\bend\b/g);
                    if (endMatches) {
                        for (let j = 0; j < endMatches.length; j++) {
                            blockClosed();
                        }
                    }
                    newLines.push(line);
                } else {
                    this.reportError(fullPath, i, undefined, undefined, `Code found after module-level return: ${trimmedLine}`);
                    newLines.push(line); // Continue processing despite error
                }
                continue;
            }

            // Handle require statements
            const requireMatch = line.match(/require\(['"](.+?)['"]\)/);
            if (requireMatch) {
                const textMatch = requireMatch[1];
                const requiredModule = fileReferenceToLuaVariable(textMatch);

                dependencies.push(new Dependency(textMatch, i, requireMatch.index ?? 0, (requireMatch.index ?? 0) + requireMatch[0].length));
                line = line.replace(requireMatch[0], requiredModule);
            }

            // Track block keywords AND returns - need to process in order they appear
            const keywords = [
                { regex: /\bfunction\b/, type: 'function' },
                { regex: /\bif\b/, type: 'if' },
                { regex: /\bfor\b/, type: 'for' },
                { regex: /\bwhile\b/, type: 'while' },
                { regex: /\bdo\b/, type: 'do' },
                { regex: /\bend\b/, type: 'end' },
                { regex: /\breturn\b/, type: 'return' }  // Add return to the list!
            ];

            // Find positions of all keywords in the line
            const foundKeywords: Array<{ position: number, type: string }> = [];
            for (const kw of keywords) {
                const matches = [...trimmedLine.matchAll(new RegExp(kw.regex, 'g'))];
                for (const match of matches) {
                    if (match.index !== undefined) {
                        foundKeywords.push({ position: match.index, type: kw.type });
                    }
                }
            }

            // Sort by position to process in order
            foundKeywords.sort((a, b) => a.position - b.position);

            // Process keywords in order
            for (const kw of foundKeywords) {
                if (kw.type === 'end') {
                    blockClosed();
                    expectingDo = false;
                } else if (kw.type === 'for' || kw.type === 'while') {
                    blockFound(kw.type);
                    expectingDo = true;
                } else if (kw.type === 'do') {
                    if (!expectingDo) {
                        // Standalone do block
                        blockFound('do');
                    }
                    expectingDo = false;
                } else if (kw.type === 'return') {
                    // Handle return in sequence
                    if (!isInFunction && !foundModuleLevelReturn) {
                        // Extract the return value (everything after 'return')
                        const afterReturnPos = kw.position + 6; // 'return' is 6 chars
                        const afterReturn = trimmedLine.substring(afterReturnPos).trim();
                        
                        if (afterReturn === '') {
                            this.reportError(fullPath, i, afterReturnPos, afterReturnPos, 'Empty return statement at module level');
                            continue;
                        }

                        // Check for multiple return values (commas outside of parentheses/braces/brackets)
                        let parenDepth = 0;
                        let braceDepth = 0;
                        let bracketDepth = 0;
                        let inString = false;
                        let stringChar = '';
                        let hasMultipleValues = false;
                        
                        for (let j = 0; j < afterReturn.length; j++) {
                            const char = afterReturn[j];
                            
                            if (!inString) {
                                if (char === '"' || char === "'") {
                                    inString = true;
                                    stringChar = char;
                                } else if (char === '(') {
                                    parenDepth++;
                                } else if (char === ')') {
                                    parenDepth--;
                                } else if (char === '{') {
                                    braceDepth++;
                                } else if (char === '}') {
                                    braceDepth--;
                                } else if (char === '[') {
                                    bracketDepth++;
                                } else if (char === ']') {
                                    bracketDepth--;
                                } else if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
                                    hasMultipleValues = true;
                                    break;
                                }
                            } else {
                                if (char === stringChar && afterReturn[j - 1] !== '\\') {
                                    inString = false;
                                }
                            }
                        }
                        
                        if (hasMultipleValues) {
                            this.reportError(fullPath, i, afterReturnPos, afterReturnPos + afterReturn.length, `Multiple return values not supported: ${trimmedLine}`);
                        } else {
                            // Replace return with assignment
                            const moduleVariable = fileReferenceToLuaVariable(filePath);
                            const parts = moduleVariable.split('.');
                            for (let p = 1; p < parts.length; p++) {
                                const path = parts.slice(0, p + 1).join('.');
                                newLines.push(`if not ${path} then ${path} = {} end`);
                            }

                            line = line.replace(/\breturn\b/, moduleVariable + ' =');
                            foundModuleLevelReturn = true;
                        }
                    }
                } else {
                    // function or if
                    blockFound(kw.type);
                    expectingDo = false;
                }
            }

            newLines.push(line);
        }

        newLines.push(`end --${filePath}`);
        return new ParsedFile(filePath, fullPath, newLines, dependencies);
    }
}

function stripLuaMultilineComments(content: string): string {
    // Matches --[[...]], --[=[...]=], --[==[...]==], etc.
    return content.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '');
}

class Dependency {
    public readonly fileKey: string;

    constructor(
        public readonly requiredModule: string,
        public readonly requiredAtLine: number,
        public readonly charStart: number,
        public readonly charEnd: number
    )
    {
        this.fileKey = fileReferenceToLuaVariable(requiredModule);
    }
}

class ParsedFile {
    public readonly fileKey: string;
    
    constructor(
        public readonly filePath: string,
        public readonly fullPath: string,
        public readonly lines: string[],
        public readonly dependencies: Dependency[]
    ) {
        this.fileKey = fileReferenceToLuaVariable(filePath);
    }
}

function fileReferenceToLuaVariable(fileReference: string): string {
    // Remove .lua extension
    if (fileReference.endsWith('.lua')) {
        fileReference = fileReference.substring(0, fileReference.length - 4);
    }
    
    // Remove leading ./
    if (fileReference.startsWith('./')) {
        fileReference = fileReference.substring(2);
    }

    // Normalize path separators
    fileReference = fileReference.replace(/\\/g, '/').replace(/\./g, '/');

    // Split by / to get path parts
    const parts = fileReference.split('/');
    
    // Convert to ScriptGlobals.folder.FileName format
    let result = LUA_SCRIPT_GLOBAL_KEYWORD;
    for (let i = 0; i < parts.length; i++) {
        if (i === parts.length - 1) {
            // Capitalize first letter of filename
            result += '.' + parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
        } else {
            // Folder names stay lowercase
            result += '.' + parts[i];
        }
    }
    return result;
}

class Writer {
    constructor(
        public location: string,
        public files: Map<string, ParsedFile>,
        private readonly logger: ICompilationLogger,
        public onError?: (error: CompilationError) => void
    ) {}

    private getStartLines(): string[] {
        return [
            `-- Transpiled at (UTC): ${new Date().toISOString()}`,
            `local ${LUA_SCRIPT_GLOBAL_KEYWORD} = {}`
        ];
    }
    
    logDependencyTree(): void {
        const visited: Set<string> = new Set();
        const depth : number = 1;
        this.logger.writeLine('Dependency Tree <root>:');
        const logFileRecursive = (parsedFile: ParsedFile, currentDepth: number) => {
            if (visited.has(parsedFile.fileKey)) {
                return;
            }
            visited.add(parsedFile.fileKey);
            let padding = '  '.repeat(currentDepth);
            if (currentDepth > 0) {
                padding = '  '.repeat(currentDepth) + '└─>';
            }
            const printable = parsedFile.fileKey.replace(LUA_SCRIPT_GLOBAL_KEYWORD + '.', '');
            this.logger.writeLine(padding + printable);
            for (const dep of parsedFile.dependencies) {
                const depFile = this.files.get(dep.fileKey);
                if (depFile) {
                    logFileRecursive(depFile, currentDepth + 1);
                }
            }
        }

        for (const parsedFile of this.files.values()) {
            logFileRecursive(parsedFile, depth);
        }
    };

    write(metrics: Metrics): void {
        const writtenFiles: Set<string> = new Set();
        const outputLines: string[] = [];

        const startLines = this.getStartLines();
        metrics.totalLinesWritten+=startLines.length;
        outputLines.push(...startLines);

        //Check for circular dependencies before writing
        const visited: Set<string> = new Set();
        for (const fileKey of this.files.keys()) {
            const stack: string[] = [];
            const checkCircular = (key: string): boolean => {
                if (stack.includes(key)) {
                    const cycleStart = stack.indexOf(key);
                    const cycle = [...stack.slice(cycleStart), key];
                    const file = this.files.get(stack[stack.length - 1]);
                    if (file && this.onError) {
                        this.onError({
                            filePath: file.fullPath,
                            line: 0,
                            message: `Circular dependency detected: ${cycle.map(x => x.split('.').pop()).join(' -> ')}`
                        });
                    }
                    return true;
                }
                if (visited.has(key)) {
                    return false;
                }
                visited.add(key);
                stack.push(key);
                const file = this.files.get(key);
                if (file) {
                    for (const dep of file.dependencies) {
                        if (checkCircular(dep.fileKey)) {
                            return true;
                        }
                    }
                }
                stack.pop();
                return false;
            };
            
            if (checkCircular(fileKey)) {
                throw new Error(`Compilation failed due to circular dependencies`);
            }
        }   

        const writeFileRecursive = (parsedFile: ParsedFile) => {
            if (writtenFiles.has(parsedFile.fileKey)) {
                return;
            }

            // Write dependencies first
            for (const dep of parsedFile.dependencies) {
                const depFile = this.files.get(dep.fileKey);
                if (depFile) {
                    writeFileRecursive(depFile);
                } else {
                    this.onError?.({
                        filePath: parsedFile.fullPath,
                        line: dep.requiredAtLine,
                        charStart: dep.charStart,
                        charEnd: dep.charEnd,
                        message: `Missing dependency: ${dep.fileKey}`
                    });
                }
            }
            metrics.totalLinesWritten += parsedFile.lines.length;
            outputLines.push(...parsedFile.lines);
            writtenFiles.add(parsedFile.fileKey);
            metrics.filesWritten++;
        };

        // Write all files in dependency order
        for (const parsedFile of this.files.values()) {
            writeFileRecursive(parsedFile);
        }

        fs.mkdirSync(path.dirname(this.location), { recursive: true });
        fs.writeFileSync(this.location, outputLines.join('\n'), 'utf-8');
    }
}