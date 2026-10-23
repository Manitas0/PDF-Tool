// Builds the Microsoft Store package (MSIX/AppX) for x64 and ARM64, one file per processor:
//   dist/PDF-Tool-Store-<version>-x64.appx and dist/PDF-Tool-Store-<version>-arm64.appx
// The packages are not signed: the Microsoft Store signs them itself after the upload.
//
// Usage (from desktop/, on Windows): npm run dist:store
// electron-builder only builds AppX on Windows – it needs makeappx.exe and makepri.exe, which it
// downloads itself. Everything else about the package is "build.appx" in package.json.
//
// The package identity is the one Microsoft Partner Center assigned when the app name was reserved
// (Produktverwaltung → Produktidentität). It is not secret – every published package contains it –
// and lives in "build.appx" of package.json:
//   identityName          Package/Identity/Name
//   publisher             Package/Identity/Publisher
//   publisherDisplayName  Package/Properties/PublisherDisplayName
//   displayName           the reserved app name, character for character
// This script checks it before building, so a wrongly copied value fails with a clear message
// instead of being rejected by Partner Center after the upload.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Arch, Platform, build } = require('electron-builder');

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

/** Prints a message; inside GitHub Actions also as an annotation of the run (warning / error). */
function report(level, message) {
  if (IN_GITHUB_ACTIONS) {
    // Workflow commands need %, CR and LF escaped.
    const escaped = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${level}::${escaped}`);
  } else {
    (level === 'error' ? console.error : console.warn)(`dist-store: ${message}`);
  }
}

const packageJson = JSON.parse(await readFile(join(DESKTOP_DIR, 'package.json'), 'utf8'));
const identity = packageJson.build.appx;

// The same rules electron-builder and Partner Center apply, checked up front with a clear message.
const problems = [];
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.identityName || '')) {
  problems.push('build.appx.identityName darf nur Buchstaben, Ziffern, Punkt und Bindestrich enthalten (3–50 Zeichen)');
}
if (!/^CN=/.test(identity.publisher || '')) {
  problems.push('build.appx.publisher muss mit „CN=“ beginnen (Wert aus Partner Center → Produktidentität)');
}
for (const field of ['publisherDisplayName', 'displayName']) {
  const value = identity[field] || '';
  if (!value || value !== value.trim()) problems.push(`build.appx.${field} fehlt oder hat Leerzeichen am Anfang/Ende`);
}
if (problems.length > 0) {
  for (const problem of problems) report('error', problem);
  process.exit(1);
}
console.log(
  `dist-store: Store-Identität ${identity.identityName} (${identity.publisher}), ` +
    `Anzeigename „${identity.displayName}“, Herausgeber „${identity.publisherDisplayName}“.`
);

// Same as: electron-builder --win appx --x64 --arm64 --publish never
await build({
  projectDir: DESKTOP_DIR,
  targets: Platform.WINDOWS.createTarget('appx', Arch.x64, Arch.arm64),
  publish: 'never',
});
