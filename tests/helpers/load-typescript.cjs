const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Load real application modules without Expo/native initialization. Only platform
// and service boundaries are faked; relative TypeScript imports execute normally.
function createModuleLoader({ stubs = {}, globals = {} } = {}) {
  const root = path.resolve(__dirname, '../..');
  const modules = new Map();
  const context = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL,
    crypto: require('node:crypto').webcrypto,
    process: { env: {
      EXPO_PUBLIC_SUPABASE_URL: 'https://test.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    } },
    ...globals,
  });

  function load(request, parent = path.join(root, 'index.ts')) {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    const base = request.startsWith('@/')
      ? path.join(root, request.slice(2))
      : path.resolve(path.dirname(parent), request);
    const filename = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!filename) throw new Error(`Unstubbed dependency: ${request} from ${parent}`);
    const relative = path.relative(root, filename).replaceAll(path.sep, '/');
    if (Object.hasOwn(stubs, relative)) return stubs[relative];
    if (modules.has(filename)) return modules.get(filename).exports;
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    });
    const module = { exports: {} };
    modules.set(filename, module);
    const wrapper = vm.runInContext(
      `(function(require, module, exports, __filename, __dirname) { ${outputText}\n})`,
      context,
      { filename },
    );
    wrapper((next) => load(next, filename), module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }

  return { load: (request) => load(request, path.join(root, 'index.ts')), context };
}

module.exports = { createModuleLoader };
