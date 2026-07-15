// Build the single Electron app (daemon + overlay window) into dist/app.
//
// Bundle ONLY our own code (packages: "external"): several dependencies do
// not survive inlining — node-record-lpcm16 (dynamic require),
// node-global-key-listener (vendored binaries), clipboardy (import.meta.url
// asset resolution breaks silently). They resolve from the repo's
// node_modules at runtime instead.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "dist", "app");

// The ESM bundle still needs CJS-era globals for code paths that use
// require/__dirname (our own code after esbuild's CJS->ESM conversion).
const esmCompatBanner = [
	"import{createRequire as __cr}from'module';",
	"import{fileURLToPath as __ftp}from'url';",
	"import{dirname as __dn}from'path';",
	"const require=__cr(import.meta.url);",
	"const __filename=__ftp(import.meta.url);",
	"const __dirname=__dn(__filename);",
].join("");

await build({
	entryPoints: [join(repoRoot, "src", "app", "main.ts")],
	outfile: join(outDir, "main.js"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	packages: "external",
	// src/app/tsconfig.json paths-maps "electron" into overlay/node_modules
	// so tsc can find its types; esbuild honors that mapping, which turns the
	// bare import into a resolvable directory and defeats packages:"external"
	// (the npm installer shim gets inlined). Ignore tsconfig paths here and
	// pin electron external — it is provided by the Electron runtime itself.
	tsconfigRaw: { compilerOptions: {} },
	external: ["electron"],
	banner: { js: esmCompatBanner },
	logLevel: "info",
});

const rootPkg = JSON.parse(
	readFileSync(join(repoRoot, "package.json"), "utf-8"),
);

// Electron derives the window's WM_CLASS from this package.json name; the
// user's Hyprland window rules target class `hyprvox-overlay`, so this name
// is load-bearing — launching the bare bundle instead yields class
// `Electron` and none of the rules match.
const appPkg = {
	name: "hyprvox-overlay",
	version: rootPkg.version,
	private: true,
	type: "module",
	main: "main.js",
};

mkdirSync(outDir, { recursive: true });
writeFileSync(
	join(outDir, "package.json"),
	`${JSON.stringify(appPkg, null, "\t")}\n`,
);

console.log(`Built app bundle: ${join(outDir, "main.js")}`);
