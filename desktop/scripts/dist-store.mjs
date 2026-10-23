// Builds the Microsoft Store package (MSIX/AppX) for x64 and ARM64, one file per processor:
//   dist/PDF-Tool-Store-<version>-x64.appx and dist/PDF-Tool-Store-<version>-arm64.appx
// The packages are not signed: the Microsoft Store signs them itself after the upload.
//
// Usage (from desktop/, on Windows): npm run dist:store
// electron-builder only builds AppX on Windows – it needs makeappx.exe and makepri.exe, which it
// downloads itself. Everything else about the package is "build.appx" in package.json.
//
// The package identity is assigned by Microsoft Partner Center once the app name is reserved
// (Produktverwaltung → Produktidentität) and is passed in environment variables:
//   MSSTORE_IDENTITY_NAME           Package/Identity/Name                  e.g. 12345Name.PDF-Tool
//   MSSTORE_PUBLISHER               Package/Identity/Publisher             e.g. CN=1A2B3C4D-…
//   MSSTORE_PUBLISHER_DISPLAY_NAME  Package/Properties/PublisherDisplayName
//   MSSTORE_DISPLAY_NAME            Package/Properties/DisplayName (the reserved app name)
// Values come from the environment, not from the command line, so a publisher such as
// "CN=Name, O=Firma, C=DE" needs no shell quoting. Unless all four are set, the package keeps the
// test identity of package.json (PDFTool.Test, CN=PDF-Tool-Test): installable for testing after
// signing it yourself, but the Store rejects it.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Arch, Platform, build } = require('electron-builder');

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

// Store identity field in "build.appx" → environment variable.
const IDENTITY_VARIABLES = {
  identityName: 'MSSTORE_IDENTITY_NAME',
  publisher: 'MSSTORE_PUBLISHER',
  publisherDisplayName: 'MSSTORE_PUBLISHER_DISPLAY_NAME',
  displayName: 'MSSTORE_DISPLAY_NAME',
};

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
const testIdentity = packageJson.build.appx;

const identity = {};
const missing = [];
for (const [field, variable] of Object.entries(IDENTITY_VARIABLES)) {
  const value = (process.env[variable] || '').trim();
  if (value) identity[field] = value;
  else missing.push(variable);
}

let appxOverrides = {};
if (missing.length === 0) {
  // The same rules electron-builder applies, checked up front with a clear message.
  const problems = [];
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.identityName)) {
    problems.push('MSSTORE_IDENTITY_NAME darf nur Buchstaben, Ziffern, Punkt und Bindestrich enthalten (3–50 Zeichen)');
  }
  if (!/^CN=/.test(identity.publisher)) {
    problems.push('MSSTORE_PUBLISHER muss mit „CN=“ beginnen (Wert aus Partner Center → Produktidentität)');
  }
  if (problems.length > 0) {
    for (const problem of problems) report('error', problem);
    process.exit(1);
  }
  appxOverrides = identity;
  console.log(
    `dist-store: Store-Identität ${identity.identityName} (${identity.publisher}), ` +
      `Anzeigename „${identity.displayName}“, Herausgeber „${identity.publisherDisplayName}“.`
  );
} else {
  report(
    'warning',
    `Keine vollständige Microsoft-Store-Identität (es fehlt: ${missing.join(', ')}). Das Paket wird mit der ` +
      `Test-Identität ${testIdentity.identityName} (${testIdentity.publisher}) gebaut und taugt nur zum Testen, ` +
      'nicht zum Einreichen im Microsoft Store.'
  );
}

// Same as: electron-builder --win appx --x64 --arm64 --publish never -c.appx.identityName=… (etc.)
await build({
  projectDir: DESKTOP_DIR,
  targets: Platform.WINDOWS.createTarget('appx', Arch.x64, Arch.arm64),
  config: { appx: appxOverrides },
  publish: 'never',
});
