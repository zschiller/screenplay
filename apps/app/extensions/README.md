# Extensions

Your own implementations of Screenplay’s interfaces go here, one folder per
extension. Everything in this folder except this README is git-ignored, so
upstream syncs never touch it. A fork that commits its extensions deletes the
`apps/app/extensions/*` line in the repo’s `.gitignore`.

```
extensions/
  acme/            the folder name is the extension’s id
    server.ts      default-exports defineServerExtension({ … })
    client.tsx     optional, "use client": defineClientExtension({ … })
    package.json   optional: only if it needs its own dependencies
```

The config file names an implementation as `acme/<name>`. Build, dev, start
and typecheck pick the folder up; typecheck fails when an implementation
doesn’t match its interface.

See the Extensions page in the docs: Self-hosting › Configuration ›
Extensions.
