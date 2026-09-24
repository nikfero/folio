# Code signing

Signing tells Windows and macOS who made Folio, so people don't get security warnings when they install it. The release workflow ([`release.yml`](../.github/workflows/release.yml)) builds unsigned installers until the signing secrets below exist, then signs automatically.

This is separate from the **update key** in [RELEASING.md](RELEASING.md#updates). That key proves updates come from you; code signing is what removes the install warnings.

| System | Without signing | What signing needs |
|---|---|---|
| macOS | "Folio can't be opened" / "is damaged"; users must right-click → Open, or run `xattr -cr` | An Apple Developer Program membership (you have one) |
| Windows | SmartScreen: "Windows protected your PC" → More info → Run anyway | A code-signing certificate, e.g. free from SignPath for open-source projects |
| Linux | Nothing to fix | – |

---

## macOS: Developer ID and notarization

Two things happen on macOS: the app is **signed** with your *Developer ID Application* certificate, then Apple **notarizes** it, checking it for malware and stamping it as approved. Both run in the release workflow once these six secrets exist:

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | Your Developer ID Application certificate with its private key, as a `.p12` file, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password you gave the `.p12` when exporting it |
| `APPLE_SIGNING_IDENTITY` | The certificate's name, e.g. `Developer ID Application: Your Name (AB12CD34EF)` |
| `APPLE_ID` | The Apple ID email of your developer account |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (not your normal password) |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

### 1. Create the certificate

Only the **Account Holder** of the developer account can create a *Developer ID* certificate.

**With a Mac (easiest):**

1. Open **Xcode → Settings → Accounts**, select your Apple ID, then **Manage Certificates…**.
2. Click **+** and choose **Developer ID Application**.
3. Open **Keychain Access → My Certificates**, right-click **Developer ID Application: …**, choose **Export…**, save as `folio.p12` and set a password. That password is `APPLE_CERTIFICATE_PASSWORD`.

**Without a Mac (Windows, with OpenSSL; Git for Windows includes it):**

1. Create a key and a certificate request:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout developer-id.key -out developer-id.csr -subj "/CN=Folio/emailAddress=you@example.com"
   ```
2. On [developer.apple.com → Certificates](https://developer.apple.com/account/resources/certificates/list), click **+**, choose **Developer ID Application**, upload `developer-id.csr`, and download the certificate (`developerID_application.cer`).
3. Combine the certificate and key into a `.p12`, choosing a password when asked:
   ```bash
   openssl x509 -inform DER -in developerID_application.cer -out developer-id.pem
   openssl pkcs12 -export -legacy -inkey developer-id.key -in developer-id.pem -out folio.p12
   ```

Keep `folio.p12` (and `developer-id.key`) somewhere safe and private, never in the repository.

### 2. Find the other values

- **Signing identity:** the certificate's full name. On a Mac, run `security find-identity -v -p codesigning`. Otherwise it's shown on developer.apple.com, and has the form `Developer ID Application: Your Name (TEAMID)`.
- **Team ID:** [developer.apple.com → Membership details](https://developer.apple.com/account#MembershipDetailsCard).
- **App-specific password:** [account.apple.com](https://account.apple.com) → **Sign-In and Security → App-Specific Passwords → +**. Name it "Folio notarization".

### 3. Add the secrets

On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, once for each of the six. Or from the command line, in the project folder:

```bash
base64 -w0 folio.p12 > folio.p12.b64        # on a Mac: base64 -i folio.p12 -o folio.p12.b64
gh secret set APPLE_CERTIFICATE < folio.p12.b64
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set APPLE_SIGNING_IDENTITY
gh secret set APPLE_ID
gh secret set APPLE_PASSWORD
gh secret set APPLE_TEAM_ID
```

Each `gh secret set` without `<` asks for the value. Delete `folio.p12.b64` afterwards.

In PowerShell, which has no `<`, make the base64 file and set it like this:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("folio.p12")) | Set-Content folio.p12.b64 -NoNewline
gh secret set APPLE_CERTIFICATE --body (Get-Content folio.p12.b64 -Raw)
```

### 4. Release

The next release run signs and notarizes both macOS builds, which adds a few minutes. To check a downloaded app on a Mac:

```bash
spctl -a -vv /Applications/Folio.app      # should say: accepted, source=Notarized Developer ID
```

If notarization fails, the macOS job's log shows Apple's reason. The most common causes are a wrong app-specific password or Team ID.

---

## Windows: SignPath (free for open source)

[SignPath Foundation](https://signpath.org) gives open-source projects a free code-signing certificate. The certificate belongs to the SignPath Foundation, and your project signs through their service from GitHub Actions.

### Before applying

Their conditions change from time to time, so check the current ones on [signpath.org](https://signpath.org). They generally ask that:

- **Licence and code:** the project uses an OSI-approved licence (MIT: done) and its source is **public**, so apply after making the repository public.
- **Release:** it has at least one **public release**, and is maintained.
- **Builds:** they happen on GitHub-hosted runners from the public repository, so SignPath can verify that the signed file was built from that source. This is already true here.
- **Signing policy:** you describe who can approve signing, for example in the README.

### Applying

1. Make the repository public and publish a first (unsigned) release.
2. Fill in the application on [signpath.org](https://signpath.org) (**Apply**), with the repository URL and a short description.
3. When accepted, they set up an organization and project for you on [app.signpath.io](https://app.signpath.io). You install their GitHub app on the repository and receive:
   - an **API token**, to store as a GitHub secret (`SIGNPATH_API_TOKEN`)
   - an **organization ID**, a **project slug** and a **signing policy slug**

### Wiring it in

Once you have those, the Windows job of the release workflow changes like this (SignPath's documentation has the details):

1. Build the installers without uploading them yet.
2. Send them to SignPath with their action (`signpath/github-action-submit-signing-request`).
3. Approve the signing request on app.signpath.io (you get an email). SignPath requires a person to approve every release.
4. Re-create the update signature for the signed `.exe`, because signing changes the file. Then upload everything to the draft release.

### Other options for Windows

- **Azure Artifact Signing** (formerly Trusted Signing): about US$10 a month. Microsoft limits which countries and account types can use it, so check whether it's available where you live.
- **A classic OV certificate** from a certificate authority (Sectigo, DigiCert, SSL.com…): about US$200–400 a year. Since 2023 the key must be kept on a hardware token or in a cloud HSM, which makes signing from GitHub Actions more work.
- **Unsigned:** it works; users click **More info → Run anyway** once. SmartScreen warnings also fade as more people download a file.
