# Release build

Run npm run build, then node tools/package-verify.js from the application source root after supplying the licensed local inputs documented in the English/Japanese README.

The release script builds current-user NSIS and portable ZIP separately; portable.flag is included only in the ZIP. Electron is pinned to 44.3.0. The embedded CPU voice runtime is copied outside ASAR to resources/runtime.

The build audits the application archive, excluded private/training files, required model resources and unprivileged executable manifest, then records hashes in dist/SHA256SUMS.txt. The package verifier exercises real application startup, save persistence, second-instance exit, offline local speech and current-user installation/uninstallation.

The upstream Style-Bert-VITS2 source archive accompanies the local voice runtime. Preserve that archive and component licenses when rebuilding.
