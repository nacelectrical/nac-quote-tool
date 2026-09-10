# Vendored third-party code

## pdf.js 3.11.174 — Mozilla, Apache-2.0

`pdf.min.js` and `pdf.worker.min.js`, copied unmodified from the `pdfjs-dist`
package. Licence in `pdf.js-LICENSE`.

Builder plans arrive as PDFs, so opening one is the first thing an estimator
does on a job. Serving the reader from the same origin as the app means that
step keeps working on a site with bad reception, a network that blocks CDNs, or
an ad blocker that eats third-party scripts. `designer/ui/pdf.mjs` still falls
back to cdnjs, jsdelivr and unpkg if these files are ever missing.

They load only when someone actually picks a PDF — never on page load.

To update: replace both files with the same version from `pdfjs-dist`, and bump
the version in `designer/ui/pdf.mjs`.
