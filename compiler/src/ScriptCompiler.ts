import * as fs from 'fs';
import * as path from 'path';

export interface CompilationError {
    filePath: string;
    line: number;
    message: string;
}

export interface ScriptCompilerOptions {
    sourcePath: string,
    outputPath: string,
    outputFileName?: string,
    minify: boolean,
    onError?: (error: CompilationError) => void
}

const LUA_SCRIPT_GLOBAL_KEYWORD = 'ScriptGlobals';

export class ScriptCompiler {

    constructor(private options: ScriptCompilerOptions) {
        if (options.outputFileName === undefined) {
            this.options.outputFileName = 'compiled.lua';
        }
    }

    public async compile(): Promise<void> {
        const entries = fs.readdirSync(this.options.sourcePath, { recursive: true, withFileTypes: true });
        const parsedFiles: Map<string, ParsedFile> = new Map();

        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.lua')) {
                const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
                const relativePath = path.relative(this.options.sourcePath, fullPath);
                const content = fs.readFileSync(fullPath, 'utf-8');
                
                const parsedFile = this.parseFile(relativePath, content, fullPath);
                parsedFiles.set(parsedFile.fileKey, parsedFile);
            }
        }

        const writer = new Writer(
            path.join(this.options.outputPath, this.options.outputFileName!),
            parsedFiles,
            this.options.onError
        );

        writer.write();
        console.log(`Compilation complete. Output written to ${path.join(this.options.outputPath, this.options.outputFileName!)}`);
    }

    private reportError(filePath: string, line: number, message: string): void {
        if (this.options.onError) {
            this.options.onError({ filePath, line, message });
        }
    }

    private parseFile(filePath: string, content: string, fullPath: string): ParsedFile {
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
                    this.reportError(fullPath, i, `Code found after module-level return: ${trimmedLine}`);
                    newLines.push(line); // Continue processing despite error
                }
                continue;
            }

            // Handle require statements
            const requireMatch = line.match(/require\(['"](.+?)['"]\)/);
            if (requireMatch) {
                const requiredModule = fileReferenceToLuaVariable(requireMatch[1]);
                dependencies.push(new Dependency(requiredModule, fullPath, i + 1));
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
                            this.reportError(fullPath, i, 'Empty return statement at module level');
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
                            this.reportError(fullPath, i, `Multiple return values not supported: ${trimmedLine}`);
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
    
    constructor(
        public readonly name: string,
        public readonly filePath: string,
        public readonly requiredAtLine: number
    ){}
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
        public onError?: (error: CompilationError) => void
    ) {}

    private getStartLines(): string[] {
        return [`local ${LUA_SCRIPT_GLOBAL_KEYWORD} = {}`];
    }
    
    write(): void {
        const writtenFiles: Set<string> = new Set();
        const outputLines: string[] = [];

        outputLines.push(...this.getStartLines());

        const writeFileRecursive = (parsedFile: ParsedFile) => {
            
            // Write dependencies first
            for (const dep of parsedFile.dependencies) {
                const depFile = this.files.get(dep.name);
                if (depFile) {
                    writeFileRecursive(depFile);
                } else {
                    this.onError?.({
                        filePath: parsedFile.fullPath,
                        line: 0,
                        message: `Missing dependency: ${dep}`
                    });
                }
            }
            
            outputLines.push(...parsedFile.lines);
            writtenFiles.add(parsedFile.fileKey);
        };

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
                        if (checkCircular(dep.name)) {
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

        // Write all files in dependency order
        for (const parsedFile of this.files.values()) {
            writeFileRecursive(parsedFile);
        }

        fs.mkdirSync(path.dirname(this.location), { recursive: true });
        fs.writeFileSync(this.location, outputLines.join('\n'), 'utf-8');
    }
}